import { execFile, execFileSync, spawn } from "child_process";
import { existsSync, rmSync, statSync } from "fs";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { buildLaunchOptions, humanizeBrowser } from "cloakbrowser";
import type { LaunchOptions } from "cloakbrowser";
import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";
import { alive } from "./store.js";

const run = promisify(execFile);

// A headed browser spawned as Playwright's child process is a foreground app
// on macOS, so its first window activates it and takes the keyboard from
// whatever the user is in. Launched through LaunchServices in the background
// it never activates, not for new windows, popups or bringToFront either, so
// a watched test runs beside the user's work instead of over it.
export const launchesInBackground = process.platform === "darwin" && !process.env.BROWSER_ALLOW_FOCUS;

// Playwright's own launch flags (chromiumSwitches in playwright-core), which a
// browser started here would otherwise run without. Several are load-bearing:
// with the back/forward cache on, goBack never sees a load event and times out,
// and RenderDocument swaps the frame on navigation so the next call finds the
// page "not attached". CloakBrowser's ignoreDefaultArgs are dropped as usual.
const PLAYWRIGHT_DISABLED_FEATURES = [
  "AvoidUnnecessaryBeforeUnloadCheckSync",
  "BoundaryEventDispatchTracksNodeRemoval",
  "DestroyProfileOnBrowserClose",
  "DialMediaRouteProvider",
  "GlobalMediaControls",
  "HttpsUpgrades",
  "LensOverlay",
  "MediaRouter",
  "PaintHolding",
  "ThirdPartyStoragePartitioning",
  "Translate",
  "AutoDeElevate",
  "RenderDocument",
  "OptimizationHints",
];

const PLAYWRIGHT_DEFAULTS = [
  "--disable-field-trial-config",
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-back-forward-cache",
  "--disable-breakpad",
  "--disable-client-side-phishing-detection",
  "--disable-component-extensions-with-background-pages",
  "--disable-component-update",
  "--no-default-browser-check",
  "--disable-default-apps",
  "--disable-dev-shm-usage",
  "--disable-extensions",
  `--disable-features=${PLAYWRIGHT_DISABLED_FEATURES.join(",")}`,
  "--enable-features=CDPScreenshotNewSurface",
  "--allow-pre-commit-input",
  "--disable-hang-monitor",
  "--disable-ipc-flooding-protection",
  "--disable-popup-blocking",
  "--disable-prompt-on-repost",
  "--disable-renderer-backgrounding",
  "--force-color-profile=srgb",
  "--metrics-recording-only",
  "--no-first-run",
  "--password-store=basic",
  "--use-mock-keychain",
  "--no-service-autorun",
  "--export-tagged-pdf",
  "--disable-search-engine-choice-screen",
  "--unsafely-disable-devtools-self-xss-warnings",
  "--disable-infobars",
  "--disable-sync",
  "--enable-unsafe-swiftshader",
];

// Without the blink settings a headless page reports no hover and a coarse
// pointer, so (hover: hover) styles never apply.
const HEADLESS_FLAGS = [
  "--headless=new",
  "--hide-scrollbars",
  "--mute-audio",
  "--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4",
];

// Not being Playwright's child, the browser outlives this process unless
// ended here; signals skip "exit" unless they are turned into one.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(signal, () => process.exit(0));

export interface Launched {
  browser: Browser;
  cdpUrl: string;
  pid?: number;
  // Only a profile this module created is ever deleted; a userDataDir the
  // caller passed in is theirs to keep.
  tempDir?: string;
}

async function devToolsPort(dir: string, since: number): Promise<string> {
  const file = join(dir, "DevToolsActivePort");
  const deadline = Date.now() + 30000;
  // A profile reused from an earlier run may still hold that run's port file.
  while (!existsSync(file) || statSync(file).mtimeMs < since) {
    if (Date.now() > deadline) throw new Error("browser did not open its DevTools port within 30s");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return (await readFile(file, "utf8")).split("\n")[0].trim();
}

// Every browser is started detached and reachable over CDP, so another
// instance can attach to it and it can outlive the instance that started it.
export async function launchDetached(options: LaunchOptions, userDataDir?: string): Promise<Launched> {
  const headless = options.headless ?? true;
  const resolved = await buildLaunchOptions({ ...options, headless });
  const executable = resolved.executablePath!;
  const tempDir = userDataDir ? undefined : await mkdtemp(join(tmpdir(), "mcp-browser-"));
  const dir = userDataDir ?? tempDir!;
  const env = Object.entries(resolved.env ?? {}).filter(([key]) => key.startsWith("CLOAKBROWSER"));
  const since = Date.now() - 1000;
  // CloakBrowser leaves an HTTP proxy to Playwright's launch, which this skips.
  const proxy = resolved.proxy && !resolved.proxy.username ? [`--proxy-server=${resolved.proxy.server}`] : [];
  const ignored = new Set(Array.isArray(resolved.ignoreDefaultArgs) ? resolved.ignoreDefaultArgs : []);
  const args = [
    ...(resolved.args ?? []),
    ...proxy,
    ...PLAYWRIGHT_DEFAULTS.filter((arg) => !ignored.has(arg)),
    ...(headless ? HEADLESS_FLAGS : []),
    "--remote-debugging-port=0",
    `--user-data-dir=${dir}`,
    "about:blank",
  ];

  let pid: number | undefined;
  let spawnFailed: Promise<never> = new Promise(() => {});
  if (!headless && launchesInBackground) {
    const app = executable.slice(0, executable.indexOf(".app/") + 4);
    await run("open", ["-g", "-n", "-a", app, ...env.flatMap(([key, value]) => ["--env", `${key}=${value}`]), "--args", ...args]);
  } else {
    const child = spawn(executable, args, { detached: true, stdio: "ignore", env: { ...process.env, ...Object.fromEntries(env) } });
    spawnFailed = new Promise((_, reject) => child.once("error", reject));
    spawnFailed.catch(() => {});
    pid = child.pid;
    child.unref();
  }

  let browser: Browser | undefined;
  try {
    const cdpUrl = `http://127.0.0.1:${await Promise.race([devToolsPort(dir, since), spawnFailed])}`;
    browser = await chromium.connectOverCDP(cdpUrl);
    const cdp = await browser.newBrowserCDPSession();
    const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
    const main = processInfo.find((info: { type: string; id: number }) => info.type === "browser");
    await cdp.detach();
    pid = main?.id ?? pid;
    if (options.humanize) await humanizeBrowser(browser, options);
    return { browser, cdpUrl, pid, tempDir };
  } catch (err) {
    // Detached, the half-started browser would outlive this process; one
    // started through `open` has no pid yet, so find it by its profile.
    await browser?.close().catch(() => {});
    if (pid && alive(pid)) process.kill(pid, "SIGKILL");
    else if (process.platform !== "win32") await run("pkill", ["-f", "--", `--user-data-dir=${dir}`]).catch(() => {});
    if (tempDir) await rm(tempDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    throw err;
  }
}

// A pid kept in the database survives a reboot, after which it can name any
// process. Only one still running a debugging-port Chromium, on the session's
// profile when known, is ours to end.
function isOurBrowser(pid: number, tempDir?: string | null): boolean {
  if (process.platform === "win32") return true;
  try {
    const command = execFileSync("ps", ["-ww", "-o", "command=", "-p", String(pid)], { encoding: "utf8" });
    return command.includes("--remote-debugging-port") && (!tempDir || command.includes(tempDir));
  } catch {
    return false;
  }
}

// Synchronous, for the process "exit" handler, where nothing async runs.
export function killBrowserSync(pid?: number | null, tempDir?: string | null): void {
  if (pid && alive(pid) && isOurBrowser(pid, tempDir)) {
    process.kill(pid);
    const deadline = Date.now() + 2000;
    const nap = new Int32Array(new SharedArrayBuffer(4));
    while (alive(pid) && Date.now() < deadline) Atomics.wait(nap, 0, 0, 50);
    if (alive(pid)) process.kill(pid, "SIGKILL");
  }
  if (tempDir) rmSync(tempDir, { recursive: true, force: true, maxRetries: 3 });
}

// close() on a connected browser only disconnects; this ends the process.
export async function closeBrowser(browser: Browser, pid?: number | null, tempDir?: string | null): Promise<void> {
  try {
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send("Browser.close");
  } catch {
    if (pid && alive(pid)) process.kill(pid);
  }
  await browser.close().catch(() => {});

  // Chromium keeps writing its profile while it shuts down.
  const deadline = Date.now() + 5000;
  while (pid && alive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (pid && alive(pid)) process.kill(pid, "SIGKILL");
  if (tempDir) await rm(tempDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}

export function parseProxy(proxy: string) {
  const url = new URL(proxy);
  return {
    server: `${url.protocol}//${url.host}`,
    ...(url.username ? { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) } : {}),
  };
}
