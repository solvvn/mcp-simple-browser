import { mkdir } from "fs/promises";
import { join } from "path";
import { launch, launchPersistentContext, humanizeBrowser } from "cloakbrowser";
import { chromium } from "playwright-core";
import type { Browser, BrowserContext, BrowserContextOptions, CDPSession, Dialog, Page, Request, Response } from "playwright-core";
import { overlayScript, vitalsScript } from "./overlay.js";
import { closeBrowser, launchInBackground, launchesInBackground, parseProxy } from "./background.js";

export type { Page } from "playwright-core";

// Viewport used in headless mode, where there is no real OS window to size against.
const HEADLESS_VIEWPORT = { width: 1920, height: 1080 };
const LOG_LIMIT = 500;

export const EVIDENCE_ROOT = process.env.BROWSER_EVIDENCE_DIR || "/tmp/mcp-browser-evidence";

export interface Viewport {
  width: number;
  height: number;
  scale: number;
  mobile: boolean;
}

export type Isolation = "browser" | "context" | "cdp";

export interface SessionOptions {
  isolation?: Isolation;
  headless?: boolean;
  cdpUrl?: string;
  userDataDir?: string;
  storageState?: string;
  proxy?: string;
  userAgent?: string;
  locale?: string;
  timezone?: string;
  colorScheme?: "light" | "dark" | "no-preference";
  humanize?: boolean;
  cursor?: boolean;
  video?: boolean;
  har?: boolean;
}

export interface ConsoleEntry {
  t: number;
  type: string;
  text: string;
  url?: string;
}

export interface NetworkEntry {
  id: number;
  t: number;
  method: string;
  url: string;
  type: string;
  status?: number;
  ms?: number;
  failure?: string;
}

let defaultHeadless = true;

// Context-isolated sessions share one launched browser per headless mode.
const sharedBrowsers = new Map<boolean, Promise<Browser>>();

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export class Session {
  readonly id: string;
  readonly options: SessionOptions;
  readonly isolation: Isolation;
  readonly headless: boolean;
  readonly evidenceDir: string;
  browser: Browser | null = null;
  context!: BrowserContext;
  page!: Page;
  viewport: Viewport | null = null;
  consoleLog: ConsoleEntry[] = [];
  networkLog: NetworkEntry[] = [];
  tracing = false;
  // Set by a flow's dialog step to answer the next dialog differently.
  nextDialog: ((dialog: Dialog) => Promise<void>) | null = null;
  private responses = new Map<number, Response>();
  private requestIds = new WeakMap<Request, number>();
  private nextRequestId = 1;
  // Emulation is per page and reverts when its last CDP client detaches, so
  // the session is kept alive for as long as the page is.
  private cdpSessions = new WeakMap<Page, CDPSession>();

  constructor(id: string, options: SessionOptions) {
    this.id = id;
    this.options = options;
    this.isolation = options.cdpUrl ? "cdp" : options.userDataDir ? "browser" : options.isolation ?? "browser";
    this.headless = options.headless ?? defaultHeadless;
    this.evidenceDir = join(EVIDENCE_ROOT, `${id}-${stamp()}`);
  }

  async start(): Promise<void> {
    await mkdir(this.evidenceDir, { recursive: true });
    const o = this.options;
    const humanize = o.humanize ?? true;
    const contextOptions: BrowserContextOptions = {
      viewport: this.headless ? HEADLESS_VIEWPORT : null,
      ...(o.userAgent ? { userAgent: o.userAgent } : {}),
      ...(o.colorScheme ? { colorScheme: o.colorScheme } : {}),
      ...(o.storageState ? { storageState: o.storageState } : {}),
      ...(o.video ? { recordVideo: { dir: join(this.evidenceDir, "video"), size: this.headless ? HEADLESS_VIEWPORT : undefined } } : {}),
      ...(o.har ? { recordHar: { path: join(this.evidenceDir, "network.har"), content: "embed" as const } } : {}),
    };
    // In headed mode, open the window maximized so the page can use the full screen.
    const args = this.headless ? [] : ["--start-maximized"];
    const launchOptions = {
      headless: this.headless,
      humanize,
      args,
      ...(o.proxy ? { proxy: o.proxy } : {}),
      ...(o.locale ? { locale: o.locale } : {}),
      ...(o.timezone ? { timezone: o.timezone } : {}),
    };

    const background = !this.headless && launchesInBackground;
    // A browser launched outside Playwright takes the proxy per context, which
    // is also the only place Playwright can answer the proxy's auth challenge.
    if (background && o.proxy && !o.userDataDir) contextOptions.proxy = parseProxy(o.proxy);
    const launchBrowser = (opts: typeof launchOptions) =>
      background ? launchInBackground({ ...opts, proxy: undefined }) : launch(opts);

    if (this.isolation === "cdp") {
      // Attaching to a Chrome the user already runs: reuse its default context
      // so existing logins and tabs are in reach. close() only disconnects.
      this.browser = await chromium.connectOverCDP(o.cdpUrl!);
      if (humanize) await humanizeBrowser(this.browser, { humanize: true });
      this.context = this.browser.contexts()[0] ?? (await this.browser.newContext(contextOptions));
    } else if (o.userDataDir && background) {
      // The profile lives in the default context, which takes no context
      // options; recordings and storage state need a non-persistent session.
      this.browser = await launchInBackground(launchOptions, o.userDataDir);
      this.context = this.browser.contexts()[0];
    } else if (o.userDataDir) {
      this.context = await launchPersistentContext({ ...launchOptions, userDataDir: o.userDataDir, contextOptions });
    } else if (this.isolation === "context") {
      let shared = sharedBrowsers.get(this.headless);
      if (!shared) {
        shared = launchBrowser(launchOptions);
        sharedBrowsers.set(this.headless, shared);
        shared.catch(() => sharedBrowsers.delete(this.headless));
      }
      this.context = await (await shared).newContext(contextOptions);
    } else {
      this.browser = await launchBrowser(launchOptions);
      this.context = await this.browser.newContext(contextOptions);
    }

    // Playwright's 30s default outlives the MCP client's own request timeout
    // once the humanize layer chains several waits; fail well inside it.
    this.context.setDefaultTimeout(10000);
    this.context.setDefaultNavigationTimeout(30000);
    if (o.cursor ?? true) await this.context.addInitScript(overlayScript);
    await this.context.addInitScript(vitalsScript);
    this.context.on("page", (page) => this.watch(page));
    for (const page of this.context.pages()) this.watch(page);

    const existing = this.context.pages();
    this.page = existing[existing.length - 1] ?? (await this.context.newPage());
  }

  private watch(page: Page): void {
    const push = <T>(list: T[], entry: T) => {
      list.push(entry);
      if (list.length > LOG_LIMIT) list.shift();
    };
    page.on("console", (msg) => {
      const loc = msg.location();
      push(this.consoleLog, { t: Date.now(), type: msg.type(), text: msg.text(), url: loc.url ? `${loc.url}:${loc.lineNumber}` : undefined });
    });
    page.on("pageerror", (err) => push(this.consoleLog, { t: Date.now(), type: "pageerror", text: err.message }));
    page.on("request", (req) => {
      const id = this.nextRequestId++;
      this.requestIds.set(req, id);
      push(this.networkLog, { id, t: Date.now(), method: req.method(), url: req.url(), type: req.resourceType() });
    });
    page.on("response", (res) => {
      const entry = this.entryFor(res.request());
      if (!entry) return;
      entry.status = res.status();
      entry.ms = Date.now() - entry.t;
      this.responses.set(entry.id, res);
      if (this.responses.size > LOG_LIMIT) this.responses.delete(this.responses.keys().next().value!);
    });
    page.on("requestfailed", (req) => {
      const entry = this.entryFor(req);
      if (!entry) return;
      entry.failure = req.failure()?.errorText ?? "failed";
      entry.ms = Date.now() - entry.t;
    });
    page.on("close", () => {
      if (page !== this.page) return;
      const rest = this.context.pages();
      if (rest.length) this.page = rest[rest.length - 1];
    });
    // Without a listener Playwright dismisses dialogs silently, which leaves a
    // confirm() returning false; accepting matches what a tester would click.
    page.on("dialog", (dialog) => {
      push(this.consoleLog, { t: Date.now(), type: `dialog:${dialog.type()}`, text: dialog.message() });
      const answer = this.nextDialog ?? ((d: Dialog) => d.accept());
      this.nextDialog = null;
      answer(dialog).catch(() => {});
    });
  }

  private entryFor(req: Request): NetworkEntry | undefined {
    const id = this.requestIds.get(req);
    return id === undefined ? undefined : this.networkLog.find((entry) => entry.id === id);
  }

  response(id: number): Response | undefined {
    return this.responses.get(id);
  }

  async cdp(page: Page = this.page): Promise<CDPSession> {
    let session = this.cdpSessions.get(page);
    if (!session) {
      session = await this.context.newCDPSession(page);
      this.cdpSessions.set(page, session);
    }
    return session;
  }

  async activePage(): Promise<Page> {
    if (this.page.isClosed()) {
      const rest = this.context.pages().filter((page) => !page.isClosed());
      this.page = rest[rest.length - 1] ?? (await this.context.newPage());
      await this.applyViewport();
    }
    return this.page;
  }

  async usePage(page: Page): Promise<void> {
    this.page = page;
    await page.bringToFront().catch(() => {});
    if (this.viewport) await this.applyViewport();
  }

  async setViewport(next: Viewport | null): Promise<void> {
    this.viewport = next;
    await this.applyViewport();
  }

  // Device metrics go through CDP rather than page.setViewportSize: the CDP
  // override is the one that can be cleared again afterwards, and it carries
  // deviceScaleFactor, which setViewportSize does not.
  private async applyViewport(): Promise<void> {
    const cdp = await this.cdp();
    if (this.viewport) {
      const { width, height, scale, mobile } = this.viewport;
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: scale,
        // Deliberately not `mobile`: that hands the meta viewport control of the
        // layout width, so a page that overflows silently gets a wider viewport
        // instead of overflowing — hiding the exact bug this is used to find.
        // Touch emulation below is what `pointer`/`hover` queries actually read.
        mobile: false,
      });
      // maxTouchPoints must stay in 1..16 even when disabling.
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
      return;
    }

    // Headed has a real window to fall back to. Headless does not: clearing there
    // leaves the page a few px off, so the launch viewport is restated instead.
    if (this.headless) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { ...HEADLESS_VIEWPORT, deviceScaleFactor: 1, mobile: false });
    } else {
      await cdp.send("Emulation.clearDeviceMetricsOverride");
    }
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 });
  }

  async close(): Promise<{ video?: string[]; har?: string }> {
    const pages = this.context.pages();
    const videos = this.options.video ? pages.map((page) => page.video()).filter((video) => video !== null) : [];
    if (this.tracing) {
      await this.context.tracing.stop({ path: join(this.evidenceDir, "trace.zip") }).catch(() => {});
    }
    if (this.isolation === "cdp") {
      // Never close the user's own Chrome or its tabs, only detach.
      await this.browser?.close().catch(() => {});
    } else {
      await this.context.close().catch(() => {});
      if (this.browser) await closeBrowser(this.browser);
    }
    const paths = await Promise.all(videos.map((video) => video.path().catch(() => "")));
    return {
      ...(paths.filter(Boolean).length ? { video: paths.filter(Boolean) } : {}),
      ...(this.options.har ? { har: join(this.evidenceDir, "network.har") } : {}),
    };
  }
}

const sessions = new Map<string, Session>();
const starting = new Map<string, Promise<Session>>();
let activeId = "default";

export async function openSession(id: string, options: SessionOptions = {}): Promise<Session> {
  if (sessions.has(id)) throw new Error(`session "${id}" is already open; close it first`);
  const pending = starting.get(id);
  if (pending) return pending;
  const session = new Session(id, options);
  const task = session
    .start()
    .then(() => {
      sessions.set(id, session);
      return session;
    })
    .finally(() => starting.delete(id));
  starting.set(id, task);
  return task;
}

// Any tool may name a session that was never opened: it is started with the
// defaults, so a multi-user flow needs no setup call.
export async function getSession(id?: string): Promise<Session> {
  const key = id || activeId;
  return sessions.get(key) ?? starting.get(key) ?? openSession(key);
}

export function findSession(id?: string): Session | undefined {
  return sessions.get(id || activeId);
}

export async function getPage(id?: string): Promise<Page> {
  return (await getSession(id)).activePage();
}

export function listSessions() {
  return [...sessions.values()].map((s) => ({
    id: s.id,
    active: s.id === activeId,
    isolation: s.isolation,
    headless: s.headless,
    tabs: s.context.pages().length,
    url: s.page.isClosed() ? "" : s.page.url(),
    evidenceDir: s.evidenceDir,
  }));
}

export function useSession(id: string): void {
  if (!sessions.has(id)) throw new Error(`no open session "${id}"`);
  activeId = id;
}

export function activeSessionId(): string {
  return activeId;
}

export async function closeSession(id?: string) {
  const key = id || activeId;
  const session = sessions.get(key);
  if (!session) return null;
  sessions.delete(key);
  if (activeId === key) activeId = "default";
  return session.close();
}

export async function closeAll(): Promise<void> {
  await Promise.all([...sessions.keys()].map((id) => closeSession(id)));
  for (const [key, shared] of sharedBrowsers) {
    sharedBrowsers.delete(key);
    const browser = await shared.catch(() => null);
    if (browser) await closeBrowser(browser);
  }
  activeId = "default";
}

export async function setHeadless(headless: boolean): Promise<boolean> {
  const changed = defaultHeadless !== headless;
  defaultHeadless = headless;
  // Headless is fixed at launch. If the active session runs in the other mode,
  // restart it with the same options so the new setting applies on next use.
  const current = sessions.get(activeId);
  if (!changed || !current || current.options.headless !== undefined || current.isolation === "cdp") return false;
  const { id, options } = current;
  await closeSession(id);
  await openSession(id, options);
  activeId = id;
  return true;
}

export function isHeadless(): boolean {
  return defaultHeadless;
}
