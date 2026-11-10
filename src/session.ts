import { randomBytes } from "crypto";
import { mkdir, readFile } from "fs/promises";
import { join } from "path";
import { humanizeBrowser } from "cloakbrowser";
import { chromium } from "playwright-core";
import type { Browser, BrowserContext, BrowserContextOptions, CDPSession, Dialog, Page, Request, Response } from "playwright-core";
import { consoleScript, overlayScript, vitalsScript } from "./overlay.js";
import { closeBrowser, killBrowserSync, launchDetached, parseProxy } from "./background.js";
import type { Launched } from "./background.js";
import {
  addHolder, alive, allSessionRows, consoleSince, deleteSessionRow, findSessionRow, insertConsole, reap, registerSession, releaseHolder, tryLock,
  unlock,
} from "./store.js";
import type { SessionRow } from "./store.js";

export type { Page } from "playwright-core";

// Viewport used in headless mode, where there is no real OS window to size against.
const HEADLESS_VIEWPORT = { width: 1920, height: 1080 };
const LOG_LIMIT = 500;

export const EVIDENCE_ROOT = process.env.BROWSER_EVIDENCE_DIR || "/tmp/mcp-browser-evidence";

// Where a call that names no session lands. Ids are shared by every instance,
// so a fixed default would put unrelated tasks in one browser; each instance
// gets its own instead, and only a session named on purpose is shared.
// BROWSER_SESSION pins it, e.g. to pick a task's browser back up.
export const DEFAULT_SESSION = process.env.BROWSER_SESSION || `task-${randomBytes(3).toString("hex")}`;

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

// Context-isolated sessions share one launched browser per headless mode. These
// stay private to this instance, since a context cannot be found again over CDP.
const sharedBrowsers = new Map<boolean, Promise<Launched>>();
const sharedLaunched: Launched[] = [];

// The default context takes no storageState, so a saved login is replayed:
// cookies directly, localStorage on each page of its origin before it runs.
async function loadStorageState(context: BrowserContext, path: string): Promise<void> {
  const state = JSON.parse(await readFile(path, "utf8")) as {
    cookies?: Parameters<BrowserContext["addCookies"]>[0];
    origins?: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
  };
  if (state.cookies?.length) await context.addCookies(state.cookies);
  if (!state.origins?.length) return;
  await context.addInitScript((origins) => {
    const saved = origins.find((entry) => entry.origin === location.origin);
    if (!saved) return;
    for (const { name, value } of saved.localStorage) {
      if (localStorage.getItem(name) === null) localStorage.setItem(name, value);
    }
  }, state.origins);
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export class Session {
  readonly id: string;
  readonly options: SessionOptions;
  readonly isolation: Isolation;
  readonly headless: boolean;
  readonly evidenceDir: string;
  // Set when another instance started the session and this one attached to it.
  readonly attached: boolean;
  cdpUrl: string | null = null;
  browserPid: number | null = null;
  tempDir: string | null = null;
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
  private consoleSeq = 0;

  constructor(id: string, options: SessionOptions, row?: SessionRow) {
    this.id = id;
    this.options = row ? (row.options as SessionOptions) : options;
    const o = this.options;
    this.isolation = o.cdpUrl ? "cdp" : o.userDataDir ? "browser" : o.isolation ?? "browser";
    this.headless = o.headless ?? defaultHeadless;
    this.evidenceDir = row?.evidenceDir ?? join(EVIDENCE_ROOT, `${id}-${stamp()}`);
    this.attached = !!row;
    if (row) {
      this.cdpUrl = row.cdpUrl;
      this.browserPid = row.browserPid;
      this.tempDir = row.tempDir;
    }
  }

  // Whether other instances can attach. Recordings and an authenticated proxy
  // need a context Playwright creates, which dies with the instance that made it.
  get shareable(): boolean {
    const o = this.options;
    if (this.isolation === "cdp") return true;
    if (this.isolation === "context" || o.video || o.har) return false;
    return !(o.proxy && new URL(o.proxy).username);
  }

  private adopt(launched: Launched): Browser {
    this.browser = launched.browser;
    this.cdpUrl = launched.cdpUrl;
    this.browserPid = launched.pid ?? null;
    this.tempDir = launched.tempDir ?? null;
    return launched.browser;
  }

  // Publishes the session so other instances can attach. False when another
  // instance registered the same id while this one was starting.
  register(): boolean {
    return registerSession({
      id: this.id,
      cdpUrl: this.shareable ? this.cdpUrl : null,
      browserPid: this.browserPid,
      owned: this.browserPid !== null,
      tempDir: this.tempDir,
      evidenceDir: this.evidenceDir,
      options: { ...this.options, headless: this.headless },
      ownerPid: process.pid,
      created: Date.now(),
    });
  }

  // Ends a browser this instance launched but never published.
  async discard(): Promise<void> {
    if (this.isolation === "context") await this.context.close().catch(() => {});
    else if (this.browserPid !== null && this.browser) await closeBrowser(this.browser, this.browserPid, this.tempDir);
    else await this.browser?.close().catch(() => {});
  }

  // Drops a connection to someone else's browser without ending it.
  async disconnect(): Promise<void> {
    await this.browser?.close().catch(() => {});
  }

  onGone(fn: () => void): void {
    if (this.browser) this.browser.on("disconnected", fn);
    else this.context.on("close", fn);
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
    const args = this.headless ? [`--window-size=${HEADLESS_VIEWPORT.width},${HEADLESS_VIEWPORT.height}`] : ["--start-maximized"];
    const launchOptions = {
      headless: this.headless,
      humanize,
      args,
      ...(o.proxy ? { proxy: o.proxy } : {}),
      ...(o.locale ? { locale: o.locale } : {}),
      ...(o.timezone ? { timezone: o.timezone } : {}),
    };

    if (this.attached) {
      this.browser = await chromium.connectOverCDP(this.cdpUrl!);
      if (humanize) await humanizeBrowser(this.browser, { humanize: true });
      const context = this.browser.contexts()[0];
      if (!context) throw new Error(`session "${this.id}" has no browser context left`);
      this.context = context;
    } else if (this.isolation === "cdp") {
      // Attaching to a Chrome the user already runs: reuse its default context
      // so existing logins and tabs are in reach. close() only disconnects.
      this.browser = await chromium.connectOverCDP(o.cdpUrl!);
      this.cdpUrl = o.cdpUrl!;
      if (humanize) await humanizeBrowser(this.browser, { humanize: true });
      this.context = this.browser.contexts()[0] ?? (await this.browser.newContext(contextOptions));
    } else if (this.shareable) {
      // Chrome disposes a context made over CDP once the connection that made
      // it closes, which would take the session down with its first instance.
      // The default context lasts as long as the browser, so a shared session
      // lives there, with the context options it cannot take applied by hand.
      const userAgent = o.userAgent ? [`--user-agent=${o.userAgent}`] : [];
      const launched = await launchDetached({ ...launchOptions, args: [...args, ...userAgent] }, o.userDataDir);
      this.context = this.adopt(launched).contexts()[0];
      if (o.storageState) await loadStorageState(this.context, o.storageState);
    } else if (this.isolation === "context") {
      if (o.proxy) contextOptions.proxy = parseProxy(o.proxy);
      let shared = sharedBrowsers.get(this.headless);
      if (!shared) {
        shared = launchDetached({ ...launchOptions, proxy: undefined });
        sharedBrowsers.set(this.headless, shared);
        shared.then((launched) => sharedLaunched.push(launched), () => sharedBrowsers.delete(this.headless));
      }
      this.context = await (await shared).browser.newContext(contextOptions);
    } else {
      // Only Playwright can answer a proxy's auth challenge, and only per context.
      if (o.proxy) contextOptions.proxy = parseProxy(o.proxy);
      this.context = await this.adopt(await launchDetached({ ...launchOptions, proxy: undefined })).newContext(contextOptions);
    }

    // Playwright's 30s default outlives the MCP client's own request timeout
    // once the humanize layer chains several waits; fail well inside it.
    this.context.setDefaultTimeout(10000);
    this.context.setDefaultNavigationTimeout(30000);
    if (o.cursor ?? true) await this.context.addInitScript(overlayScript);
    await this.context.addInitScript(vitalsScript);
    await this.context.addInitScript(consoleScript);
    this.context.on("page", (page) => this.watch(page));
    for (const page of this.context.pages()) this.watch(page);

    const existing = this.context.pages();
    this.page = existing[existing.length - 1] ?? (await this.context.newPage());
  }

  private watch(page: Page): void {
    if (this.options.colorScheme && (this.attached || this.shareable)) {
      page.emulateMedia({ colorScheme: this.options.colorScheme }).catch(() => {});
    }
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

  // Messages logged right before a navigation are lost with the page, so this
  // runs around every flow step, not only when the log is read.
  // Whichever instance drains a page first stores what it found, so every
  // instance attached to the session reads the same log back from the store.
  async syncConsole(): Promise<void> {
    const drained: ConsoleEntry[] = [];
    // A hung background tab must not stall every flow step that syncs.
    const pages = this.context.pages();
    const batches = await Promise.all(pages.map((page) => Promise.race([
      page.evaluate(() => window.__mcpConsole?.drain() ?? []).catch(() => [] as ConsoleEntry[]),
      new Promise<ConsoleEntry[]>((resolve) => setTimeout(() => resolve([]), 1000)),
    ])));
    for (const batch of batches) drained.push(...batch);
    insertConsole(this.evidenceDir, drained);
    for (const { seq, ...entry } of consoleSince(this.evidenceDir, this.consoleSeq)) {
      this.consoleSeq = seq;
      // A stock Chrome attached over cdpUrl reports these over CDP as well,
      // and CloakBrowser still reports its own network messages that way.
      const seen = this.consoleLog.some((e) => e.type === entry.type && e.text === entry.text && Math.abs(e.t - entry.t) < 2000);
      if (seen) continue;
      this.consoleLog.push(entry);
      if (this.consoleLog.length > LOG_LIMIT) this.consoleLog.shift();
    }
    this.consoleLog.sort((a, b) => a.t - b.t);
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
    // Closing ends the session for every instance attached to it.
    deleteSessionRow(this.id);
    if (this.isolation === "cdp") {
      // Never close the user's own Chrome or its tabs, only detach.
      await this.browser?.close().catch(() => {});
    } else {
      await this.context.close().catch(() => {});
      if (this.browser) await closeBrowser(this.browser, this.browserPid, this.tempDir);
    }
    const paths = await Promise.all(videos.map((video) => video.path().catch(() => "")));
    return {
      ...(paths.filter(Boolean).length ? { video: paths.filter(Boolean) } : {}),
      ...(this.options.har ? { har: join(this.evidenceDir, "network.har") } : {}),
    };
  }

  // On exit this instance only lets go; the browser lives on while another
  // instance still holds the session, and the last one out ends it.
  releaseSync(): void {
    const { row, others } = releaseHolder(this.id);
    if (others > 0 || !row) return;
    if (row.owned) killBrowserSync(row.browserPid, row.tempDir);
    deleteSessionRow(this.id);
  }
}

const sessions = new Map<string, Session>();
const starting = new Map<string, Promise<Session>>();
let activeId = DEFAULT_SESSION;
let reapedAt = 0;

process.on("exit", () => {
  for (const session of sessions.values()) {
    try {
      session.releaseSync();
    } catch {}
  }
  for (const launched of sharedLaunched) killBrowserSync(launched.pid, launched.tempDir);
});

function killRow(row: SessionRow): void {
  killBrowserSync(row.browserPid, row.tempDir);
}

// Siblings die without cleaning up at any time, so a long-lived instance
// keeps sweeping rather than only once at startup.
const REAP_EVERY = 30000;

// Attaches to the session if any instance has it open, else starts it here.
async function startSession(id: string, options: SessionOptions): Promise<Session> {
  if (Date.now() - reapedAt > REAP_EVERY) {
    reapedAt = Date.now();
    reap(killRow);
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = findSessionRow(id);
    if (row) {
      if (!row.cdpUrl) {
        if (!alive(row.ownerPid)) {
          if (row.owned) killRow(row);
          deleteSessionRow(id);
          continue;
        }
        throw new Error(`session "${id}" belongs to another instance (pid ${row.ownerPid}) and cannot be shared (isolation: context); use another id`);
      }
      // Held before connecting, so its last other holder cannot end it meanwhile.
      addHolder(id);
      const session = new Session(id, options, row);
      try {
        await session.start();
        return session;
      } catch (err) {
        await session.disconnect();
        releaseHolder(id);
        if (row.browserPid === null || alive(row.browserPid)) throw err;
        deleteSessionRow(id);
        continue;
      }
    }
    const session = new Session(id, options);
    try {
      await session.start();
    } catch (err) {
      // Never registered, so no reap would ever find this browser.
      await session.discard().catch(() => {});
      throw err;
    }
    if (session.register()) return session;
    await session.discard();
  }
  throw new Error(`could not open session "${id}": other instances keep racing for it`);
}

export async function openSession(id: string, options: SessionOptions = {}): Promise<Session> {
  if (sessions.has(id)) throw new Error(`session "${id}" is already open; close it first`);
  const pending = starting.get(id);
  if (pending) return pending;
  const task = startSession(id, options)
    .then((session) => {
      sessions.set(id, session);
      // Another instance closing the session, or the browser dying, ends it here too.
      session.onGone(() => {
        if (sessions.get(id) === session) sessions.delete(id);
      });
      return session;
    })
    .finally(() => starting.delete(id));
  starting.set(id, task);
  return task;
}

// Lets go of a session this instance joined for a moment: it lives on with
// its other clients, or ends here if this was the last.
export async function leaveSession(id: string): Promise<void> {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  const { row, others } = releaseHolder(id);
  if (others > 0 || !row) await session.disconnect();
  else await session.close();
}

const lockDepth = new Map<string, number>();
const lockRenewals = new Map<string, NodeJS.Timeout>();
const LOCK_MS = 120000;
// Under the usual MCP client timeout (~60s), so "busy" reaches the caller
// instead of the action running after it gave up.
const LOCK_WAIT_MS = 45000;

// Runs fn while this instance holds the session, waiting for another instance
// that is driving it to finish first. The lock is renewed while held, so a
// long flow keeps it, and expires soon after a holder hangs.
export async function exclusive<T>(id: string | undefined, fn: () => Promise<T>): Promise<T> {
  const key = id || activeId;
  const depth = lockDepth.get(key) ?? 0;
  if (depth === 0) {
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      const result = tryLock(key, LOCK_MS);
      if (result.ok) break;
      if (Date.now() > deadline) throw new Error(`session "${key}" is busy in another instance (pid ${result.pid}); try again or use another session id`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const renew = setInterval(() => {
      try {
        tryLock(key, LOCK_MS);
      } catch {}
    }, LOCK_MS / 4);
    renew.unref();
    lockRenewals.set(key, renew);
  }
  lockDepth.set(key, depth + 1);
  try {
    return await fn();
  } finally {
    const left = (lockDepth.get(key) ?? 1) - 1;
    if (left > 0) lockDepth.set(key, left);
    else {
      lockDepth.delete(key);
      clearInterval(lockRenewals.get(key));
      lockRenewals.delete(key);
      unlock(key);
    }
  }
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

// Sessions open here, then those other instances have open, which any tool
// call naming them attaches to.
export function listSessions() {
  const rows = new Map(allSessionRows().map((row) => [row.id, row]));
  const here = [...sessions.values()].map((s) => ({
    id: s.id,
    active: s.id === activeId,
    here: true,
    shared: rows.get(s.id)?.cdpUrl ? true : false,
    instances: rows.get(s.id)?.holders.filter((pid) => alive(pid)).length ?? 1,
    isolation: s.isolation,
    headless: s.headless,
    tabs: s.context.pages().length,
    url: s.page.isClosed() ? "" : s.page.url(),
    evidenceDir: s.evidenceDir,
  }));
  const elsewhere = [...rows.values()]
    .filter((row) => !sessions.has(row.id))
    .map((row) => ({
      id: row.id,
      active: row.id === activeId,
      here: false,
      shared: row.cdpUrl !== null,
      instances: row.holders.filter((pid) => alive(pid)).length,
      isolation: (row.options.cdpUrl ? "cdp" : row.options.isolation ?? "browser") as Isolation,
      headless: row.options.headless as boolean,
      evidenceDir: row.evidenceDir,
    }));
  return [...here, ...elsewhere];
}

// The instance's own default opens on first use, so switching back to it
// needs nothing open yet.
export function useSession(id: string): void {
  if (id !== DEFAULT_SESSION && !sessions.has(id) && !findSessionRow(id)?.cdpUrl) throw new Error(`no open session "${id}"`);
  activeId = id;
}

export function activeSessionId(): string {
  return activeId;
}

// Closing a session another instance opened attaches to it first, so it ends
// the same way for everyone.
export async function closeSession(id?: string) {
  const key = id || activeId;
  const session = sessions.get(key) ?? (findSessionRow(key)?.cdpUrl ? await openSession(key) : undefined);
  if (!session) return null;
  sessions.delete(key);
  if (activeId === key) activeId = DEFAULT_SESSION;
  return session.close();
}

export async function closeAll(): Promise<void> {
  await Promise.all([...sessions.keys()].map((id) => closeSession(id)));
  for (const [key, shared] of sharedBrowsers) {
    sharedBrowsers.delete(key);
    const launched = await shared.catch(() => null);
    if (!launched) continue;
    sharedLaunched.splice(sharedLaunched.indexOf(launched), 1);
    await closeBrowser(launched.browser, launched.pid, launched.tempDir);
  }
  activeId = DEFAULT_SESSION;
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
