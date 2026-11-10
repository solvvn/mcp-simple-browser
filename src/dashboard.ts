import { createServer } from "http";
import type { IncomingMessage, Server, ServerResponse } from "http";
import { createReadStream } from "fs";
import type { ReadStream } from "fs";
import { mkdir, readdir, realpath, rm, stat } from "fs/promises";
import { basename, extname, join, relative, resolve, sep } from "path";
import type { Page } from "playwright-core";
import {
  EVIDENCE_ROOT, activeSessionId, closeSession, exclusive, findSession, isHeadless, leaveSession, listSessions, openSession, useSession,
} from "./session.js";
import type { Session } from "./session.js";
import { forgetFile, thumbPath, trackedFiles, writeReport } from "./evidence.js";
import type { StepRecord } from "./evidence.js";
import { DB_PATH, allSessionRows, changeStamp, consoleErrorCount, findSessionRow, forgetEvidence, loadRuns, recentRuns } from "./store.js";
import type { RunProgress } from "./store.js";
import { dashboardHtml } from "./dashboard-page.js";
import { shortError } from "./util.js";

// A loopback-only page for watching the sessions every instance has open, the
// flows they ran and the files they left behind. It is opt-out (BROWSER_UI=0)
// and binds 127.0.0.1 only.
//
// Two checks stand in for authentication, since anything on this machine can
// reach the port anyway: the Host header must name loopback (stops a web page
// from reading the API through DNS rebinding), and every request that changes
// something must carry X-MCP-UI, a header a cross-origin page cannot add
// without a CORS preflight this server never answers.
//
// The port is also the election: every instance reads the same store, so one
// dashboard shows everything. Whoever binds it serves; the rest stand by and
// take over when it frees up.
const APP = "mcp-simple-browser";
const DEFAULT_PORT = 9330;
const STANDBY_MS = 3000;
const PORT_TRIES = 10;
const HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".har": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

let server: Server | null = null;
let url: string | null = null;

export function dashboardUrl(): string | null {
  return url;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type Kind = "image" | "video" | "report" | "trace" | "har" | "pdf" | "other";

function kindOf(name: string): Kind {
  const ext = extname(name).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return "image";
  if ([".webm", ".mp4"].includes(ext)) return "video";
  if (ext === ".html") return "report";
  if (ext === ".zip") return "trace";
  if (ext === ".har") return "har";
  if (ext === ".pdf") return "pdf";
  return "other";
}

let realRoot: string | null = null;

async function root(): Promise<string> {
  if (realRoot) return realRoot;
  await mkdir(EVIDENCE_ROOT, { recursive: true });
  return (realRoot = await realpath(EVIDENCE_ROOT));
}

// A path inside the evidence root as the /files/ route names it. The root may
// be reached through a symlink (/tmp on macOS), so both spellings are tried.
async function relFile(path: string): Promise<string | null> {
  for (const base of [resolve(EVIDENCE_ROOT), await root()]) {
    if (path.startsWith(base + sep)) return path.slice(base.length + 1);
  }
  return null;
}

// Resolves a path relative to the evidence root and refuses anything that
// lands outside it, symlinks included.
async function inRoot(rel: string): Promise<string> {
  const base = await root();
  const target = resolve(base, rel.replace(/^\/+/, ""));
  const real = await realpath(target).catch(() => {
    throw new HttpError(404, "not found");
  });
  if (real !== base && !real.startsWith(base + sep)) throw new HttpError(403, "outside the evidence dir");
  return real;
}

// Evidence folders of a session still open in any instance, by folder name.
async function openDirs(): Promise<Map<string, string>> {
  const dirs = new Map<string, string>();
  for (const row of allSessionRows()) dirs.set(basename(row.evidenceDir), row.id);
  for (const s of listSessions()) dirs.set(basename(s.evidenceDir), s.id);
  return dirs;
}

interface FileInfo {
  path: string;
  size: number;
  mtime: number;
  kind: Kind;
  thumb?: string;
}

// Hidden directories hold derived files (.thumbs); they ride along on the
// image they belong to instead of being listed.
async function walk(dir: string, base: string, out: FileInfo[] = []): Promise<FileInfo[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const thumbs = entries.some((e) => e.isDirectory() && e.name === ".thumbs")
    ? new Set(await readdir(join(dir, ".thumbs")).catch(() => []))
    : null;
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".")) await walk(full, base, out);
    } else if (entry.isFile()) {
      const info = await stat(full).catch(() => null);
      if (!info) continue;
      const kind = kindOf(entry.name);
      const thumb = kind === "image" && thumbs?.has(basename(thumbPath(full))) ? relative(base, thumbPath(full)) : undefined;
      out.push({ path: relative(base, full), size: info.size, mtime: info.mtimeMs, kind, ...(thumb ? { thumb } : {}) });
    }
  }
  return out;
}

// A folder no open session owns only changes through this server (deletes),
// so its walk is kept until its own mtime moves or a delete invalidates it.
const folderCache = new Map<string, { mtime: number; files: FileInfo[] }>();

async function folderFiles(base: string, name: string, open: boolean): Promise<{ files: FileInfo[]; mtime: number }> {
  const info = await stat(join(base, name));
  const cached = folderCache.get(name);
  if (!open && cached && cached.mtime === info.mtimeMs) return { files: cached.files, mtime: info.mtimeMs };
  const files = await walk(join(base, name), base);
  folderCache.set(name, { mtime: info.mtimeMs, files });
  return { files, mtime: info.mtimeMs };
}

async function listFolders() {
  const base = await root();
  const open = await openDirs();
  const folders = [];
  const seen = new Set<string>();
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    seen.add(entry.name);
    const { files, mtime } = await folderFiles(base, entry.name, open.has(entry.name));
    folders.push({
      name: entry.name,
      mtime: Math.max(mtime, ...files.map((f) => f.mtime)),
      size: files.reduce((n, f) => n + f.size, 0),
      files: files.length,
      images: files.filter((f) => f.kind === "image").length,
      failed: files.filter((f) => /FAILED/.test(f.path)).length,
      session: open.get(entry.name) ?? null,
      hasReport: files.some((f) => f.path === `${entry.name}/report.html`),
    });
  }
  for (const name of folderCache.keys()) if (!seen.has(name)) folderCache.delete(name);
  folders.sort((a, b) => b.mtime - a.mtime);
  const external = [];
  for (const path of trackedFiles()) {
    const info = await stat(path).catch(() => null);
    if (info) external.push({ path, size: info.size, mtime: info.mtimeMs, kind: kindOf(path) });
    else forgetFile(path);
  }
  return { root: base, folders, external };
}

// Sessions another instance drives are watched over raw CDP, never through
// Playwright: the tab list is a plain HTTP read, and a live picture needs one
// socket to that tab. Neither joins the session nor touches its other pages.
interface Target {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl?: string;
}

async function targetsOf(cdpUrl: string): Promise<Target[]> {
  const res = await fetch(new URL("/json/list", cdpUrl), { signal: AbortSignal.timeout(2000) });
  return ((await res.json()) as Target[]).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
}

const SOCKET_IDLE_MS = 30_000;
const sockets = new Map<string, { ws: Promise<WebSocket>; used: number }>();
let cdpSeq = 0;

setInterval(() => {
  for (const [id, entry] of sockets) {
    if (Date.now() - entry.used < SOCKET_IDLE_MS) continue;
    sockets.delete(id);
    entry.ws.then((ws) => ws.close(), () => {});
  }
}, SOCKET_IDLE_MS).unref();

function socketFor(target: Target): Promise<WebSocket> {
  const entry = sockets.get(target.id);
  if (entry) {
    entry.used = Date.now();
    return entry.ws;
  }
  const ws = new Promise<WebSocket>((ok, fail) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl!);
    socket.onopen = () => ok(socket);
    socket.onerror = () => fail(new Error("CDP connection failed"));
    socket.onclose = () => sockets.delete(target.id);
  });
  sockets.set(target.id, { ws, used: Date.now() });
  ws.catch(() => sockets.delete(target.id));
  return ws;
}

async function cdpCall<T>(target: Target, method: string, params: object, ms = 5000): Promise<T> {
  const ws = await socketFor(target);
  const id = ++cdpSeq;
  return new Promise<T>((ok, fail) => {
    const timer = setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      fail(new Error(`${method} timed out`));
    }, ms);
    function onMessage(event: MessageEvent) {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      if (msg.error) fail(new Error(msg.error.message));
      else ok(msg.result as T);
    }
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

interface Tab {
  url: string;
  title: string;
  current: boolean;
}

type View =
  | { local: Session; tabs: Tab[]; current: Page | null }
  | { local: null; tabs: Tab[]; target: Target | null };

const title = (page: Page) =>
  Promise.race([page.title(), new Promise<string>((r) => setTimeout(() => r(""), 500))]).catch(() => "");

async function viewOf(id: string): Promise<View> {
  const local = findSession(id);
  if (local && local.id === id) {
    const pages = local.context.pages().filter((page) => !page.isClosed());
    const current = local.page.isClosed() ? (pages[pages.length - 1] ?? null) : local.page;
    const tabs = await Promise.all(pages.map(async (page) => ({ url: page.url(), title: await title(page), current: page === current })));
    return { local, tabs, current };
  }
  const row = findSessionRow(id);
  const targets = row?.cdpUrl ? await targetsOf(row.cdpUrl).catch(() => []) : [];
  // Chrome lists the most recently active tab first.
  return { local: null, tabs: targets.map((t, i) => ({ url: t.url, title: t.title, current: i === 0 })), target: targets[0] ?? null };
}

function summarize(steps: StepRecord[]) {
  const failed = steps.find((step) => !step.ok);
  return {
    passed: steps.filter((step) => step.ok).length,
    done: steps.length,
    ...(failed ? { failed: { i: failed.i, label: failed.name || failed.label || failed.action, error: failed.error ?? "" } } : {}),
  };
}

function progress(run: RunProgress, done: number) {
  return { total: run.total ?? done, running: run.running, ...(run.current ? { current: run.current } : {}) };
}

async function sessionsInfo() {
  const sessions = await Promise.all(listSessions().map(async (s) => {
    const view = await viewOf(s.id);
    const { local, tabs } = view;
    const runs = loadRuns<StepRecord>(s.evidenceDir);
    const last = runs[runs.length - 1];
    return {
      ...s,
      tabs,
      tracing: local?.tracing ?? false,
      video: !!local?.options.video,
      har: !!local?.options.har,
      consoleErrors: local ? local.consoleLog.filter((e) => /error/.test(e.type)).length : consoleErrorCount(s.evidenceDir),
      // The network log lives in the instance that recorded it.
      requests: local ? local.networkLog.length : null,
      failedRequests: local ? local.networkLog.filter((e) => e.failure || (e.status ?? 0) >= 400).length : null,
      runs: runs.length,
      lastRun: last ? { id: last.id, started: last.started, ...summarize(last.steps), ...progress(last, last.steps.length) } : null,
      evidenceFolder: basename(s.evidenceDir),
    };
  }));
  return { active: activeSessionId(), defaultHeadless: isHeadless(), evidenceRoot: EVIDENCE_ROOT, db: DB_PATH, pid: process.pid, sessions };
}

const STAMP = /^(.*)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;
const RUN_LIMIT = 60;

async function runsInfo() {
  const open = await openDirs();
  const runs = await Promise.all(recentRuns<StepRecord>(RUN_LIMIT).map(async (run) => {
    const folder = basename(run.evidenceDir);
    const steps = await Promise.all(run.steps.map(async (step) => {
      const shot = step.shot ? await relFile(step.shot) : null;
      return {
        i: step.i,
        action: step.action,
        label: step.name || step.label || step.action,
        session: step.session,
        ok: step.ok,
        error: step.error,
        ms: step.ms,
        url: step.url,
        shot,
        // Shots taken before thumbnails existed have none; the page falls back.
        thumb: shot ? await relFile(thumbPath(step.shot!)) : null,
      };
    }));
    const report = await stat(join(run.evidenceDir, "report.html")).then(() => `${folder}/report.html`, () => null);
    return {
      session: STAMP.exec(folder)?.[1] ?? folder,
      open: open.has(folder),
      folder,
      id: run.id,
      started: run.started,
      ms: run.steps.reduce((n, step) => n + step.ms, 0),
      report,
      ...summarize(run.steps),
      ...progress(run, run.steps.length),
      steps,
    };
  }));
  return { runs };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e5) throw new HttpError(413, "body too large");
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

async function serveFile(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new HttpError(404, "not found");
  const type = TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
  const headers: Record<string, string | number> = {
    "content-type": type,
    "cache-control": "no-cache",
    "accept-ranges": "bytes",
    // A report is our own HTML, but a downloaded page saved here is not: never
    // let it script against this origin.
    "content-security-policy": "sandbox allow-popups; default-src 'self' 'unsafe-inline' data:",
  };
  if (new URL(req.url!, "http://x").searchParams.has("download")) {
    headers["content-disposition"] = `attachment; filename="${encodeURIComponent(path.split(sep).pop()!)}"`;
  }
  // Videos need range requests to be seekable.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) {
      res.writeHead(416, { "content-range": `bytes */${info.size}` });
      return void res.end();
    }
    res.writeHead(206, { ...headers, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${info.size}` });
    return void stream(createReadStream(path, { start, end }), res);
  }
  res.writeHead(200, { ...headers, "content-length": info.size });
  stream(createReadStream(path), res);
}

// A file pruned or deleted between stat and open would otherwise raise an
// uncaught error, and with it end the process and every browser it holds.
function stream(source: ReadStream, res: ServerResponse): void {
  source.on("error", () => res.destroy()).pipe(res);
}

async function liveShot(res: ServerResponse, id: string): Promise<void> {
  const view = await viewOf(id);
  let jpeg: Buffer;
  if (view.local) {
    if (!view.current) throw new HttpError(404, "no open page");
    jpeg = await view.current.screenshot({ type: "jpeg", quality: 60, animations: "allow", timeout: 5000 });
  } else {
    if (!view.target) throw new HttpError(404, "no open page");
    const { data } = await cdpCall<{ data: string }>(view.target, "Page.captureScreenshot", { format: "jpeg", quality: 60 });
    jpeg = Buffer.from(data, "base64");
  }
  res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store", "content-length": jpeg.length });
  res.end(jpeg);
}

// Acting on a session another instance opened joins it first, under the same
// lock the tools take, so the dashboard never drives a page an agent is on.
// It leaves again afterwards, so the session still ends with its last client
// rather than living as long as the dashboard; "use" is a choice to stay.
async function sessionAction(id: string, action: string, body: Record<string, unknown>) {
  return exclusive(id, async () => {
    const existing = findSession(id);
    const joined = !(existing && existing.id === id);
    const session = !joined ? existing : findSessionRow(id)?.cdpUrl ? await openSession(id) : null;
    if (!session) throw new HttpError(404, `no open session "${id}"`);
    try {
      return await runAction(session, id, action, body);
    } finally {
      if (joined && action !== "use" && action !== "close") await leaveSession(id);
    }
  });
}

async function runAction(session: Session, id: string, action: string, body: Record<string, unknown>) {
  switch (action) {
    case "use":
      useSession(id);
      return { active: activeSessionId() };
    case "close":
      return { closed: id, ...(await closeSession(id)) };
    case "navigate": {
      const target = String(body.url ?? "").trim();
      if (!/^(https?|file|about|data):/i.test(target)) throw new HttpError(400, "url must start with http(s)://, file:, about: or data:");
      const page = await session.activePage();
      await page.goto(target, { waitUntil: "domcontentloaded" });
      return { url: page.url() };
    }
    case "reload":
      await (await session.activePage()).reload({ waitUntil: "domcontentloaded" });
      return {};
    case "back":
      await (await session.activePage()).goBack({ waitUntil: "domcontentloaded" });
      return {};
    case "tab": {
      const page = session.context.pages().filter((p) => !p.isClosed())[Number(body.index)];
      if (!page) throw new HttpError(404, "no such tab");
      await session.usePage(page);
      return {};
    }
    case "report": {
      const path = await writeReport(session);
      return { report: await relFile(path) };
    }
  }
  throw new HttpError(404, `unknown action "${action}"`);
}

async function deleteAsset(body: Record<string, unknown>) {
  if (typeof body.external === "string") {
    if (!trackedFiles().includes(body.external)) throw new HttpError(403, "not a file this server saved");
    await rm(body.external, { force: true });
    forgetFile(body.external);
    return { deleted: body.external };
  }
  const rel = String(body.path ?? "");
  if (!rel || rel === "." || rel.includes("\0")) throw new HttpError(400, "path is required");
  const base = await root();
  const target = await inRoot(rel);
  if (target === base) throw new HttpError(400, "refusing to delete the evidence root");
  const open = await openDirs();
  const top = relative(base, target).split(sep)[0];
  // A live session may still write into its folders; its files can go one by one.
  if ((await stat(target)).isDirectory() && open.has(top)) {
    throw new HttpError(409, `folder belongs to open session "${open.get(top)}"; close it or delete single files`);
  }
  await rm(target, { recursive: true, force: true });
  if (kindOf(target) === "image") await rm(thumbPath(target), { force: true });
  if (relative(base, target) === top) forgetEvidence(join(EVIDENCE_ROOT, top));
  folderCache.delete(top);
  return { deleted: rel };
}

// Server-sent events: the page refetches what changed instead of polling.
// The store is the only place every instance's activity meets, so the change
// stamp is polled there, and only while a page is listening.
const listeners = new Set<ServerResponse>();
const WATCH_MS = 700;
const HEARTBEAT_TICKS = Math.round(20_000 / WATCH_MS);
let watcher: NodeJS.Timeout | null = null;

function broadcast(data: object): void {
  const frame = `event: change\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of listeners) res.write(frame);
}

function watch(): void {
  if (watcher) return;
  let last = changeStamp();
  let ticks = 0;
  watcher = setInterval(() => {
    if (!listeners.size) {
      clearInterval(watcher!);
      watcher = null;
      return;
    }
    if (++ticks % HEARTBEAT_TICKS === 0) for (const res of listeners) res.write(": ping\n\n");
    let now;
    try {
      now = changeStamp();
    } catch {
      return;
    }
    const changed = { sessions: now.sessions !== last.sessions, runs: now.runs !== last.runs };
    last = now;
    if (changed.sessions || changed.runs) broadcast(changed);
  }, WATCH_MS);
  watcher.unref();
}

function events(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  res.write("retry: 2000\n\n");
  listeners.add(res);
  req.on("close", () => listeners.delete(res));
  watch();
}

// Remove every evidence folder that no open session owns, optionally only the
// ones untouched for some days.
async function prune(body: Record<string, unknown>) {
  const days = Number(body.olderThanDays ?? 0);
  const cutoff = Date.now() - days * 86400_000;
  const { root: base, folders } = await listFolders();
  const removed = [];
  for (const folder of folders) {
    if (folder.session || folder.mtime > cutoff) continue;
    await rm(join(base, folder.name), { recursive: true, force: true });
    forgetEvidence(join(EVIDENCE_ROOT, folder.name));
    removed.push(folder.name);
  }
  return { removed };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  if (!HOSTS.has(host)) throw new HttpError(403, "bad host");
  const { pathname } = new URL(req.url!, "http://x");
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD" && req.headers["x-mcp-ui"] !== "1") throw new HttpError(403, "missing X-MCP-UI header");

  if (method === "GET" && pathname === "/") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self'; frame-src 'self'",
    });
    return void res.end(dashboardHtml);
  }
  if (method === "GET" && pathname === "/api/ping") return send(res, 200, { app: APP, pid: process.pid });
  if (method === "GET" && pathname === "/api/events") return events(req, res);
  if (method === "GET" && pathname === "/api/sessions") return send(res, 200, await sessionsInfo());
  if (method === "GET" && pathname === "/api/runs") return send(res, 200, await runsInfo());
  if (method === "GET" && pathname === "/api/assets") return send(res, 200, await listFolders());
  let m: RegExpExecArray | null;
  if (method === "GET" && (m = /^\/api\/assets\/(.+)$/.exec(pathname))) {
    const rel = decodeURIComponent(m[1]);
    const dir = await inRoot(rel);
    const base = await root();
    const top = relative(base, dir);
    const files = top && !top.includes(sep)
      ? [...(await folderFiles(base, top, (await openDirs()).has(top))).files]
      : await walk(dir, base);
    files.sort((a, b) => a.path.localeCompare(b.path));
    return send(res, 200, { files });
  }
  if (method === "GET" && (m = /^\/api\/sessions\/([^/]+)\/shot$/.exec(pathname))) return liveShot(res, decodeURIComponent(m[1]));
  if (method === "GET" && (m = /^\/files\/(.+)$/.exec(pathname))) return serveFile(req, res, await inRoot(decodeURIComponent(m[1])));
  if (method === "GET" && pathname === "/external") {
    const path = new URL(req.url!, "http://x").searchParams.get("p") ?? "";
    if (!trackedFiles().includes(path)) throw new HttpError(403, "not a file this server saved");
    return serveFile(req, res, path);
  }
  if (method === "POST" && pathname === "/api/sessions") {
    const body = await readJson(req);
    const id = String(body.id ?? "").trim();
    if (!/^[\w.-]{1,64}$/.test(id)) throw new HttpError(400, "id: letters, digits, . _ - only");
    const isolation = body.isolation === "context" ? "context" : "browser";
    const session = await exclusive(id, () => openSession(id, {
      isolation,
      ...(typeof body.headless === "boolean" ? { headless: body.headless } : {}),
    }));
    if (typeof body.url === "string" && body.url) await session.page.goto(body.url, { waitUntil: "domcontentloaded" }).catch(() => {});
    return send(res, 200, { id: session.id, attached: session.attached });
  }
  if (method === "POST" && (m = /^\/api\/sessions\/([^/]+)\/(\w+)$/.exec(pathname))) {
    return send(res, 200, await sessionAction(decodeURIComponent(m[1]), m[2], await readJson(req)));
  }
  if (method === "POST" && pathname === "/api/assets/delete") return send(res, 200, await deleteAsset(await readJson(req)));
  if (method === "POST" && pathname === "/api/assets/prune") return send(res, 200, await prune(await readJson(req)));
  throw new HttpError(404, "not found");
}

function listen(port: number): Promise<Server> {
  return new Promise((ok, fail) => {
    const s = createServer((req, res) => {
      handle(req, res).catch((err) => {
        if (res.headersSent) return res.destroy();
        send(res, err instanceof HttpError ? err.status : 500, { error: shortError(err) });
      });
    });
    s.once("error", fail);
    s.listen(port, "127.0.0.1", () => {
      s.off("error", fail);
      ok(s);
    });
  });
}

// Is the port held by another instance's dashboard, rather than some other
// program? Versions before /api/ping still answer /api/sessions.
async function ours(port: number): Promise<boolean> {
  const get = (path: string) =>
    fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(1500) }).then((r) => (r.ok ? r.json() : null), () => null);
  const ping = await get("/api/ping");
  if (ping) return ping.app === APP;
  const sessions = await get("/api/sessions");
  return !!sessions && "evidenceRoot" in sessions;
}

async function bind(port: number): Promise<boolean> {
  try {
    server = await listen(port);
    // The page must never be what keeps the process alive.
    server.unref();
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    return false;
  }
}

function standBy(port: number): void {
  const timer = setInterval(async () => {
    if (server || (await bind(port).catch(() => false))) {
      clearInterval(timer);
      console.error(`Dashboard: took over ${url}`);
    }
  }, STANDBY_MS);
  timer.unref();
}

// Every instance points at the same dashboard. When another program sits on
// the port, the next free one is used instead.
export async function startDashboard(): Promise<string | null> {
  if (url) return url;
  if (/^(0|false|off|no)$/i.test(process.env.BROWSER_UI ?? "")) return null;
  const first = Number(process.env.BROWSER_UI_PORT) || DEFAULT_PORT;
  for (let port = first; port < first + PORT_TRIES; port++) {
    if (await bind(port)) return (url = `http://127.0.0.1:${port}/`);
    if (await ours(port)) {
      url = `http://127.0.0.1:${port}/`;
      standBy(port);
      return url;
    }
  }
  return null;
}
