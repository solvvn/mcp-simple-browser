import { mkdir, writeFile } from "fs/promises";
import { basename, join, relative, resolve, sep } from "path";
import { EVIDENCE_ROOT } from "./session.js";
import type { Page, Session } from "./session.js";

export type EvidenceMode = "steps" | "failures" | "off";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StepRecord {
  i: number;
  action: string;
  name?: string;
  session: string;
  target?: string;
  ok: boolean;
  error?: string;
  ms: number;
  url: string;
  shot?: string;
}

export interface FlowRun {
  id: string;
  dir: string;
  started: number;
  steps: StepRecord[];
}

const runs = new WeakMap<Session, FlowRun[]>();

// Files the tools wrote outside the evidence root (a screenshot to ~/Desktop, a
// PDF, a download). The dashboard lists and serves exactly these and nothing
// else outside the root.
const tracked = new Set<string>();
const TRACK_LIMIT = 500;

export function trackFile(path: string): void {
  const full = resolve(path);
  const root = resolve(EVIDENCE_ROOT);
  if (full === root || full.startsWith(root + sep)) return;
  tracked.delete(full);
  tracked.add(full);
  if (tracked.size > TRACK_LIMIT) tracked.delete(tracked.values().next().value!);
}

export function trackedFiles(): string[] {
  return [...tracked].reverse();
}

export function forgetFile(path: string): void {
  tracked.delete(path);
}

export async function startRun(session: Session): Promise<FlowRun> {
  const list = runs.get(session) ?? [];
  runs.set(session, list);
  const id = `run-${String(list.length + 1).padStart(2, "0")}`;
  const run = { id, dir: join(session.evidenceDir, id), started: Date.now(), steps: [] };
  await mkdir(run.dir, { recursive: true });
  list.push(run);
  return run;
}

// Runs are filed under the session that started the flow, but a flow may also
// drive other sessions; their steps land in the same run so the report reads
// as one story.
export function runsOf(session: Session): FlowRun[] {
  return runs.get(session) ?? [];
}

export async function screenshot(page: Page, filepath: string, box?: Box | null, label?: string, fullPage = false): Promise<string> {
  if (box) {
    await page.evaluate(({ box, label }) => window.__mcpOverlay?.highlight(box, label), { box, label }).catch(() => {});
  }
  try {
    const type = filepath.endsWith(".png") ? "png" : "jpeg";
    await page.screenshot({ path: filepath, type, fullPage, animations: "disabled", ...(type === "jpeg" ? { quality: 75 } : {}) });
  } finally {
    if (box) await page.evaluate(() => window.__mcpOverlay?.clear()).catch(() => {});
  }
  trackFile(filepath);
  return filepath;
}

export function shotPath(run: FlowRun, index: number, action: string, session: string, failed: boolean): string {
  const prefix = String(index).padStart(3, "0");
  return join(run.dir, `${prefix}-${session}-${action}${failed ? "-FAILED" : ""}.jpg`);
}

export async function startTrace(session: Session): Promise<void> {
  if (session.tracing) throw new Error("trace already running");
  await session.context.tracing.start({ screenshots: true, snapshots: true, sources: false, title: session.id });
  session.tracing = true;
}

export async function stopTrace(session: Session): Promise<string> {
  if (!session.tracing) throw new Error("no trace running; start one first");
  const path = join(session.evidenceDir, `trace-${Date.now()}.zip`);
  await session.context.tracing.stop({ path });
  session.tracing = false;
  return path;
}

const escape = (value: unknown) =>
  String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function writeReport(session: Session): Promise<string> {
  const list = runsOf(session);
  const time = (t: number) => new Date(t).toLocaleTimeString("vi-VN", { hour12: false });
  const errors = session.consoleLog.filter((entry) => /error|pageerror/.test(entry.type));
  const failedRequests = session.networkLog.filter((entry) => entry.failure || (entry.status ?? 0) >= 400);
  const total = list.reduce((n, run) => n + run.steps.length, 0);
  const failed = list.reduce((n, run) => n + run.steps.filter((step) => !step.ok).length, 0);

  const runHtml = list.map((run) => `
    <section>
      <h2>${escape(run.id)} <small>${time(run.started)} · ${run.steps.filter((s) => s.ok).length}/${run.steps.length} bước đạt</small></h2>
      <div class="grid">${run.steps.map((step) => `
        <figure class="${step.ok ? "ok" : "fail"}">
          ${step.shot ? `<a href="${escape(relative(session.evidenceDir, step.shot))}" target="_blank"><img loading="lazy" src="${escape(relative(session.evidenceDir, step.shot))}" alt=""></a>` : ""}
          <figcaption>
            <b>#${step.i} ${escape(step.action)}</b>${step.name ? ` · ${escape(step.name)}` : ""}
            <span class="meta">${escape(step.session)} · ${step.ms}ms</span>
            ${step.target ? `<code>${escape(step.target)}</code>` : ""}
            ${step.error ? `<p class="err">${escape(step.error)}</p>` : ""}
            <span class="url">${escape(step.url)}</span>
          </figcaption>
        </figure>`).join("")}
      </div>
    </section>`).join("");

  const logRows = <T>(rows: T[], cols: (row: T) => unknown[]) =>
    rows.length ? `<table>${rows.map((row) => `<tr>${cols(row).map((c) => `<td>${escape(c)}</td>`).join("")}</tr>`).join("")}</table>` : "<p class=\"meta\">Không có.</p>";

  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>E2E ${escape(session.id)}</title>
<style>
  :root{--bg:#f6f7f9;--card:#fff;--fg:#1c1e21;--muted:#65676b;--ok:#1a7f37;--fail:#cf222e;--line:#d0d7de}
  @media (prefers-color-scheme:dark){:root{--bg:#0d1117;--card:#161b22;--fg:#e6edf3;--muted:#8b949e;--line:#30363d}}
  body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
  main{padding:24px 16px}
  h1{margin:0 0 4px}h2{font-size:17px;margin:28px 0 12px}small,.meta{color:var(--muted);font-weight:400}
  .summary{display:flex;gap:16px;flex-wrap:wrap;margin:12px 0}
  .summary div{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 16px}
  .summary b{display:block;font-size:22px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
  figure{margin:0;background:var(--card);border:1px solid var(--line);border-top:4px solid var(--ok);border-radius:8px;overflow:hidden}
  figure.fail{border-top-color:var(--fail)}
  img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;object-position:top;border-bottom:1px solid var(--line)}
  figcaption{padding:8px 10px;display:grid;gap:2px}
  code{font-size:12px;word-break:break-all}.url{font-size:12px;color:var(--muted);word-break:break-all}
  .err{color:var(--fail);margin:4px 0;font-size:13px}
  table{border-collapse:collapse;width:100%;background:var(--card);font-size:12px}
  td{border:1px solid var(--line);padding:4px 8px;vertical-align:top;word-break:break-all}
</style></head><body><main>
<h1>Báo cáo E2E · ${escape(session.id)}</h1>
<p class="meta">${escape(basename(session.evidenceDir))} · ${new Date().toLocaleString("vi-VN")}</p>
<div class="summary">
  <div><b>${list.length}</b>flow</div>
  <div><b>${total - failed}/${total}</b>bước đạt</div>
  <div><b style="color:${failed ? "var(--fail)" : "var(--ok)"}">${failed}</b>bước lỗi</div>
  <div><b>${errors.length}</b>lỗi console</div>
  <div><b>${failedRequests.length}</b>request lỗi</div>
</div>
${runHtml || "<p>Chưa có flow nào được chạy trong session này.</p>"}
<h2>Lỗi console</h2>
${logRows(errors, (e) => [time(e.t), e.type, e.text, e.url ?? ""])}
<h2>Request lỗi (4xx/5xx/failed)</h2>
${logRows(failedRequests, (e) => [time(e.t), e.method, e.status ?? e.failure, e.url])}
</main></body></html>`;

  const path = join(session.evidenceDir, "report.html");
  await writeFile(path, html);
  return path;
}
