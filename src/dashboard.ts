import { createServer } from "http";
import type { IncomingMessage, Server, ServerResponse } from "http";
import { createReadStream } from "fs";
import { mkdir, readdir, realpath, rm, stat } from "fs/promises";
import { extname, join, relative, resolve, sep } from "path";
import {
  EVIDENCE_ROOT, activeSessionId, closeSession, findSession, isHeadless, listSessions, openSession, useSession,
} from "./session.js";
import type { Isolation } from "./session.js";
import { forgetFile, trackedFiles, writeReport } from "./evidence.js";
import { dashboardHtml } from "./dashboard-page.js";
import { shortError } from "./util.js";

// A loopback-only page for watching the open sessions and the files they left
// behind. It is opt-out (BROWSER_UI=0) and binds 127.0.0.1 only.
//
// Two checks stand in for authentication, since anything on this machine can
// reach the port anyway: the Host header must name loopback (stops a web page
// from reading the API through DNS rebinding), and every request that changes
// something must carry X-MCP-UI, a header a cross-origin page cannot add
// without a CORS preflight this server never answers.

const DEFAULT_PORT = 9330;
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

function kindOf(name: string): string {
  const ext = extname(name).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return "image";
  if ([".webm", ".mp4"].includes(ext)) return "video";
  if (ext === ".html") return "report";
  if (ext === ".zip") return "trace";
  if (ext === ".har") return "har";
  if (ext === ".pdf") return "pdf";
  return "other";
}

async function root(): Promise<string> {
  await mkdir(EVIDENCE_ROOT, { recursive: true });
  return realpath(EVIDENCE_ROOT);
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

// The evidence folders that belong to a session still open in this process.
async function openDirs(): Promise<Map<string, string>> {
  const base = await root();
  const dirs = new Map<string, string>();
  for (const s of listSessions()) {
    const real = await realpath(s.evidenceDir).catch(() => s.evidenceDir);
    dirs.set(relative(base, real), s.id);
  }
  return dirs;
}

interface FileEntry {
  path: string;
  size: number;
  mtime: number;
  kind: string;
}

async function walk(dir: string, base: string, out: FileEntry[] = []): Promise<FileEntry[]> {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, base, out);
    else if (entry.isFile()) {
      const info = await stat(full).catch(() => null);
      if (info) out.push({ path: relative(base, full), size: info.size, mtime: info.mtimeMs, kind: kindOf(entry.name) });
    }
  }
  return out;
}

async function listFolders() {
  const base = await root();
  const open = await openDirs();
  const folders = [];
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const files = await walk(join(base, entry.name), base);
    const info = await stat(join(base, entry.name));
    folders.push({
      name: entry.name,
      mtime: Math.max(info.mtimeMs, ...files.map((f) => f.mtime)),
      size: files.reduce((n, f) => n + f.size, 0),
      files: files.length,
      images: files.filter((f) => f.kind === "image").length,
      session: open.get(entry.name) ?? null,
      hasReport: files.some((f) => f.path === `${entry.name}/report.html`),
    });
  }
  folders.sort((a, b) => b.mtime - a.mtime);
  const external = [];
  for (const path of trackedFiles()) {
    const info = await stat(path).catch(() => null);
    if (info) external.push({ path, size: info.size, mtime: info.mtimeMs, kind: kindOf(path) });
    else forgetFile(path);
  }
  return { root: base, folders, external };
}

async function sessionsInfo() {
  const sessions = await Promise.all(
    listSessions().map(async (s) => {
      const session = findSession(s.id)!;
      const pages = session.context.pages().filter((page) => !page.isClosed());
      const tabs = await Promise.all(
        pages.map(async (page) => ({
          url: page.url(),
          title: await Promise.race([page.title(), new Promise<string>((r) => setTimeout(() => r(""), 500))]).catch(() => ""),
          current: page === session.page,
        })),
      );
      return {
        ...s,
        tabs,
        tracing: session.tracing,
        video: !!session.options.video,
        har: !!session.options.har,
        consoleErrors: session.consoleLog.filter((e) => /error/.test(e.type)).length,
        requests: session.networkLog.length,
        failedRequests: session.networkLog.filter((e) => e.failure || (e.status ?? 0) >= 400).length,
        evidenceFolder: relative(await root(), await realpath(s.evidenceDir).catch(() => s.evidenceDir)),
      };
    }),
  );
  return { active: activeSessionId(), defaultHeadless: isHeadless(), evidenceRoot: EVIDENCE_ROOT, sessions };
}

function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
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

async function serveFile(req: IncomingMessage, res: ServerResponse, path: string) {
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
      return res.end();
    }
    res.writeHead(206, { ...headers, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${info.size}` });
    return createReadStream(path, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, "content-length": info.size });
  createReadStream(path).pipe(res);
}

function sessionOrThrow(id: string) {
  const session = findSession(id);
  if (!session || session.id !== id) throw new HttpError(404, `no open session "${id}"`);
  return session;
}

async function liveShot(res: ServerResponse, id: string) {
  const session = sessionOrThrow(id);
  if (session.page.isClosed()) throw new HttpError(404, "no open page");
  const jpeg = await session.page.screenshot({ type: "jpeg", quality: 60, animations: "allow", timeout: 5000 });
  res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store", "content-length": jpeg.length });
  res.end(jpeg);
}

async function sessionAction(id: string, action: string, body: Record<string, unknown>) {
  const session = sessionOrThrow(id);
  switch (action) {
    case "use":
      useSession(id);
      return { active: activeSessionId() };
    case "close":
      return { closed: id, ...(await closeSession(id)) };
    case "navigate": {
      const target = String(body.url ?? "").trim();
      if (!/^(https?|file|about|data):/i.test(target)) throw new HttpError(400, "url must start with http(s)://");
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
      return { report: relative(await root(), await realpath(path)) };
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
  return { deleted: rel };
}

// Remove every evidence folder that no open session owns, optionally only the
// ones untouched for some days.
async function prune(body: Record<string, unknown>) {
  const days = Number(body.olderThanDays ?? 0);
  const cutoff = Date.now() - days * 86400_000;
  const { root: base, folders } = await listFolders();
  const removed: string[] = [];
  for (const folder of folders) {
    if (folder.session || folder.mtime > cutoff) continue;
    await rm(join(base, folder.name), { recursive: true, force: true });
    removed.push(folder.name);
  }
  return { removed };
}

async function handle(req: IncomingMessage, res: ServerResponse) {
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
    return res.end(dashboardHtml);
  }
  if (method === "GET" && pathname === "/api/sessions") return send(res, 200, await sessionsInfo());
  if (method === "GET" && pathname === "/api/assets") return send(res, 200, await listFolders());

  let m: RegExpExecArray | null;
  if (method === "GET" && (m = /^\/api\/assets\/(.+)$/.exec(pathname))) {
    const dir = await inRoot(decodeURIComponent(m[1]));
    const files = await walk(dir, await root());
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
    const isolation = body.isolation === "context" ? "context" : ("browser" as Isolation);
    const session = await openSession(id, {
      isolation,
      ...(typeof body.headless === "boolean" ? { headless: body.headless } : {}),
    });
    if (typeof body.url === "string" && body.url) await session.page.goto(body.url, { waitUntil: "domcontentloaded" }).catch(() => {});
    return send(res, 200, { id: session.id });
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

// Several MCP clients may each run this server; each one takes the next free
// port so their dashboards do not collide.
export async function startDashboard(): Promise<string | null> {
  if (server) return url;
  if (/^(0|false|off|no)$/i.test(process.env.BROWSER_UI ?? "")) return null;
  const first = Number(process.env.BROWSER_UI_PORT) || DEFAULT_PORT;
  for (let port = first; port < first + PORT_TRIES; port++) {
    try {
      server = await listen(port);
      // The page must never be what keeps the process alive.
      server.unref();
      url = `http://127.0.0.1:${port}/`;
      return url;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    }
  }
  return null;
}
