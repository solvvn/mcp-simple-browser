import { mkdir, writeFile } from "fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "path";
import type { CDPSession } from "playwright-core";
import type { MarkKind } from "./overlay.js";
import { EVIDENCE_ROOT } from "./session.js";
import type { Page, Session } from "./session.js";
import { insertRun, insertStep, loadRuns } from "./store.js";

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
  label?: string;
  session: string;
  target?: string;
  ok: boolean;
  error?: string;
  t: number;
  ms: number;
  url: string;
  shot?: string;
}

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

export interface FlowRun {
  id: string;
  dir: string;
  started: number;
  steps: StepRecord[];
  evidenceDir: string;
}

// Runs live in the shared store, so the report covers the flows every
// instance attached to the session has run, numbered as one sequence.
export async function startRun(session: Session, total: number): Promise<FlowRun> {
  const started = Date.now();
  const { id, dir } = insertRun(session.evidenceDir, (id) => join(session.evidenceDir, id), started, total);
  await mkdir(dir, { recursive: true });
  return { id, dir, started, steps: [], evidenceDir: session.evidenceDir };
}

export function recordStep(run: FlowRun, record: StepRecord): void {
  run.steps.push(record);
  insertStep(run.evidenceDir, run.id, record);
}

// Runs are filed under the session that started the flow, but a flow may also
// drive other sessions; their steps land in the same run so the report reads
// as one story.
export function runsOf(session: Session): FlowRun[] {
  return loadRuns<StepRecord>(session.evidenceDir).map((run) => ({ ...run, evidenceDir: session.evidenceDir }));
}

export interface ShotOptions {
  box?: Box | null;
  label?: string;
  kind?: MarkKind;
  fullPage?: boolean;
  // Cut the image down to the box plus a margin of context around it.
  crop?: boolean;
}

const CROP_MARGIN = 40;

async function cropTo(page: Page, box: Box) {
  const view = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const x = Math.max(0, box.x - CROP_MARGIN);
  const y = Math.max(0, box.y - CROP_MARGIN);
  const width = Math.min(view.width, box.x + box.width + CROP_MARGIN) - x;
  const height = Math.min(view.height, box.y + box.height + CROP_MARGIN) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}

// A small copy next to each evidence shot, so the dashboard's galleries do not
// decode full-size images. Chrome scales it down itself, from the same frame
// with the same outline on it.
const THUMB_WIDTH = 400;
const cdpSessions = new WeakMap<Page, Promise<CDPSession>>();

export function thumbPath(filepath: string): string {
  return join(dirname(filepath), ".thumbs", basename(filepath).replace(/\.\w+$/, "") + ".jpg");
}

function inEvidence(path: string): boolean {
  return resolve(path).startsWith(resolve(EVIDENCE_ROOT) + sep);
}

async function thumbnail(page: Page, filepath: string, clip?: Box): Promise<void> {
  let cdp = cdpSessions.get(page);
  if (!cdp) {
    cdp = page.context().newCDPSession(page);
    cdpSessions.set(page, cdp);
  }
  const view = await page.evaluate(() => ({ x: scrollX, y: scrollY, width: innerWidth, height: innerHeight }));
  const area = clip ?? { x: 0, y: 0, width: view.width, height: view.height };
  // CDP clips are in document coordinates; the box is in viewport ones.
  const { data } = await (await cdp).send("Page.captureScreenshot", {
    format: "jpeg",
    quality: 70,
    clip: { x: area.x + view.x, y: area.y + view.y, width: area.width, height: area.height, scale: Math.min(1, THUMB_WIDTH / area.width) },
  });
  const path = thumbPath(filepath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(data, "base64"));
}

export async function screenshot(page: Page, filepath: string, options: ShotOptions = {}): Promise<string> {
  const { box, label, kind, fullPage = false, crop = false } = options;
  if (box) {
    await page.evaluate(({ box, label, kind }) => window.__mcpOverlay?.highlight(box, label, kind), { box, label, kind }).catch(() => {});
  }
  try {
    const type = filepath.endsWith(".png") ? "png" : "jpeg";
    const clip = crop && box ? await cropTo(page, box) : undefined;
    await page.screenshot({
      path: filepath,
      type,
      fullPage: fullPage && !clip,
      ...(clip ? { clip } : {}),
      animations: "disabled",
      ...(type === "jpeg" ? { quality: 75 } : {}),
    });
    if (!fullPage && inEvidence(filepath)) await thumbnail(page, filepath, clip).catch(() => {});
  } finally {
    await page.evaluate(() => window.__mcpOverlay?.clear()).catch(() => {});
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

// Turns a step's error into the expected/actual pair of a bug report. The
// assertion errors in flow.ts all end in "expected X but got Y".
function expectation(step: StepRecord): { expected: string; actual: string } {
  const error = step.error ?? "";
  const what = step.name || step.label || step.action;
  const assertion = error.match(/expected (.+?) but got ([\s\S]+)$/);
  if (assertion) {
    const got = step.action === "assertChecked" ? (assertion[2] === "true" ? "đã tích" : "chưa tích") : assertion[2];
    return { expected: what, actual: `Nhận được ${got}` };
  }
  if (step.action === "assertNoErrors") {
    return { expected: "Không có lỗi console hoặc request lỗi", actual: error.replace(/^assertNoErrors failed: /, "") };
  }
  const timeout = error.match(/Timeout (\d+)ms exceeded/);
  if (timeout) {
    const subject = step.target ? `phần tử "${step.target}"` : "trang";
    return { expected: what, actual: `Không thao tác được với ${subject} sau ${timeout[1]}ms. ${error}` };
  }
  return { expected: what, actual: error };
}

export async function writeReport(session: Session): Promise<string> {
  await session.syncConsole();
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
            <b>#${step.i} ${escape(step.action)}</b>${step.name || step.label ? ` · ${escape(step.name || step.label)}` : ""}
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

  const bugs = list.flatMap((run) => run.steps.filter((step) => !step.ok).map((step) => ({ run, step })));
  const bugHtml = bugs.map(({ run, step }, n) => {
    const upTo = run.steps.filter((s) => s.i <= step.i);
    const sessions = new Set(upTo.map((s) => s.session));
    const { expected, actual } = expectation(step);
    // Errors that surfaced while the run led up to the failure, plus a second
    // after it for the ones a failing request logs late.
    const from = run.started;
    const next = list[list.indexOf(run) + 1]?.started ?? Infinity;
    const to = Math.min(step.t + step.ms + 1000, next);
    const nearConsole = errors.filter((e) => e.t >= from && e.t <= to);
    const nearRequests = failedRequests.filter((e) => e.t >= from && e.t <= to);
    const shot = step.shot ? escape(relative(session.evidenceDir, step.shot)) : "";
    return `
    <article class="bug">
      <h3>Lỗi ${n + 1}: ${escape(step.name || step.label || step.action)}</h3>
      <p class="meta">${escape(run.id)} · bước #${step.i} · session ${escape(step.session)} · ${time(step.t)} · <span class="url">${escape(step.url)}</span></p>
      <div class="cols">
        <div>
          <h4>Các bước tái hiện</h4>
          <ol>${upTo.map((s) => `<li${s === step ? " class=\"at\"" : ""}>${sessions.size > 1 ? `<span class="meta">[${escape(s.session)}]</span> ` : ""}${escape(s.name || s.label || s.action)}</li>`).join("")}</ol>
          <h4>Mong đợi</h4><p>${escape(expected)}</p>
          <h4>Thực tế</h4><p class="err">${escape(actual)}</p>
          ${nearConsole.length || nearRequests.length ? `<h4>Lỗi đi kèm</h4>
          <ul class="log">${[
            ...nearConsole.map((e) => `<li>${time(e.t)} console ${escape(e.type)}: ${escape(e.text)}</li>`),
            ...nearRequests.map((e) => `<li>${time(e.t)} ${escape(e.method)} ${escape(e.url)} → ${escape(e.status ?? e.failure)}</li>`),
          ].join("")}</ul>` : ""}
        </div>
        ${shot ? `<a href="${shot}" target="_blank"><img src="${shot}" alt="Ảnh lúc lỗi"></a>` : ""}
      </div>
    </article>`;
  }).join("");

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
  .verdict b{font-size:18px}.verdict.ok b{color:var(--ok)}.verdict.fail b{color:var(--fail)}
  .bug{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--fail);border-radius:8px;padding:12px 16px;margin-bottom:12px}
  .bug h3{margin:0 0 2px;font-size:16px}.bug h4{margin:12px 0 4px;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}
  .bug p{margin:0}.bug ol,.bug ul{margin:0;padding-left:22px}.bug li.at{color:var(--fail);font-weight:600}
  .bug .cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:16px;align-items:start}
  .bug img{aspect-ratio:auto;border:1px solid var(--line);border-radius:6px}
  .log{font:12px/1.5 ui-monospace,monospace;word-break:break-all}
  @media (max-width:800px){.bug .cols{grid-template-columns:1fr}}
</style></head><body><main>
<h1>Báo cáo E2E · ${escape(session.id)}</h1>
<p class="meta">${escape(basename(session.evidenceDir))} · ${new Date().toLocaleString("vi-VN")}</p>
<div class="summary">
  <div class="verdict ${failed ? "fail" : "ok"}"><b>${total === 0 ? "CHƯA CHẠY" : failed ? "KHÔNG ĐẠT" : "ĐẠT"}</b>kết luận</div>
  <div><b>${list.length}</b>flow</div>
  <div><b>${total - failed}/${total}</b>bước đạt</div>
  <div><b style="color:${failed ? "var(--fail)" : "var(--ok)"}">${failed}</b>bước lỗi</div>
  <div><b>${errors.length}</b>lỗi console</div>
  <div><b>${failedRequests.length}</b>request lỗi</div>
</div>
${bugs.length ? `<h2>Lỗi phát hiện <small>${bugs.length}</small></h2>${bugHtml}` : ""}
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
