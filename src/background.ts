import { execFile } from "child_process";
import { existsSync, statSync } from "fs";
import { mkdtemp, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { buildLaunchOptions, humanizeBrowser } from "cloakbrowser";
import type { LaunchOptions } from "cloakbrowser";
import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";

const run = promisify(execFile);

// A headed browser spawned as Playwright's child process is a foreground app
// on macOS, so its first window activates it and takes the keyboard from
// whatever the user is in. Launched through LaunchServices in the background
// it never activates, not for new windows, popups or bringToFront either, so
// a watched test runs beside the user's work instead of over it.
export const launchesInBackground = process.platform === "darwin" && !process.env.BROWSER_ALLOW_FOCUS;

// The flags Playwright adds to its own launches that matter here: no first-run
// UI, and no throttling of the windows the user is not looking at.
const PLAYWRIGHT_DEFAULTS = [
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-popup-blocking",
  "--password-store=basic",
  "--use-mock-keychain",
];

const pids = new Map<Browser, number>();

// Not being Playwright's child, the browser outlives this process unless
// ended here; signals skip "exit" unless they are turned into one.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(signal, () => process.exit(0));
process.on("exit", () => {
  for (const pid of pids.values()) {
    try {
      process.kill(pid);
    } catch {}
  }
});

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

export async function launchInBackground(options: LaunchOptions, userDataDir?: string): Promise<Browser> {
  const resolved = await buildLaunchOptions({ ...options, headless: false });
  const executable = resolved.executablePath!;
  const app = executable.slice(0, executable.indexOf(".app/") + 4);
  const dir = userDataDir ?? (await mkdtemp(join(tmpdir(), "mcp-browser-")));
  const env = Object.entries(resolved.env ?? {}).filter(([key]) => key.startsWith("CLOAKBROWSER"));
  const since = Date.now() - 1000;

  await run("open", [
    "-g", "-n", "-a", app,
    ...env.flatMap(([key, value]) => ["--env", `${key}=${value}`]),
    "--args",
    ...(resolved.args ?? []),
    ...PLAYWRIGHT_DEFAULTS,
    "--remote-debugging-port=0",
    `--user-data-dir=${dir}`,
    "about:blank",
  ]);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${await devToolsPort(dir, since)}`);
  const cdp = await browser.newBrowserCDPSession();
  const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
  const main = processInfo.find((info: { type: string; id: number }) => info.type === "browser");
  if (main) pids.set(browser, main.id);
  await cdp.detach();
  if (options.humanize) await humanizeBrowser(browser, options);
  return browser;
}

// close() on a connected browser only disconnects; this one is ours to end.
export async function closeBrowser(browser: Browser): Promise<void> {
  const pid = pids.get(browser);
  if (pid === undefined) {
    await browser.close().catch(() => {});
    return;
  }
  pids.delete(browser);
  try {
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send("Browser.close");
  } catch {
    try {
      process.kill(pid);
    } catch {}
  }
  await browser.close().catch(() => {});
}

export function parseProxy(proxy: string) {
  const url = new URL(proxy);
  return {
    server: `${url.protocol}//${url.host}`,
    ...(url.username ? { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) } : {}),
  };
}
