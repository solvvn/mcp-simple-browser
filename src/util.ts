import { z } from "zod";
import type { Page, Request } from "playwright-core";

export function collapse(text: string): string {
  return text.replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

export function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated, ${text.length - max} more chars]`;
}

export function clampValue(value: unknown, max: number): unknown {
  if (typeof value === "string") return clamp(value, max);
  if (value === null || typeof value !== "object") return value;
  const json = JSON.stringify(value);
  return json.length <= max ? value : clamp(json, max);
}

// Drop parts of the markup that carry no information for the model: scripts,
// styles, inline SVG paths, comments, the cursor overlay, and the whitespace
// between tags.
export function compactHtml(html: string): string {
  return html
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "<svg/>")
    .replace(/<mcp-overlay\b[^>]*>[\s\S]*?<\/mcp-overlay>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/>\s+</g, "><")
    .trim();
}

// Playwright appends a multi-line "Call log:" to most errors; the first line
// is what identifies the failure, the rest is retry noise.
export function shortError(err: unknown): string {
  if (err instanceof z.ZodError) {
    return clamp(err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "), 300);
  }
  const message = err instanceof Error ? err.message : String(err);
  return clamp(collapse(message.split(/\n?Call log:/)[0]), 300);
}

const AsyncFunction = (async () => {}).constructor as new (body: string) => unknown;
const FUNCTION_SOURCE = /^\s*(async\s+)?(function\b|\([^)]*\)\s*=>|[\w$]+\s*=>)/;

function isExpression(script: string): boolean {
  try {
    new AsyncFunction(`return (${script}\n)`);
    return true;
  } catch {
    return false;
  }
}

// page.evaluate(string) runs a classic script: function source comes back as
// an unusable {} and a top-level `await` is a syntax error. Function source is
// called; a script that awaits runs as an async function, as one expression
// when it parses as one, so its value comes back without `return`, else as a body.
export function evaluable(script: string): string {
  const expression = isExpression(script);
  if (expression && FUNCTION_SOURCE.test(script)) return `(${script}\n)()`;
  if (!/\bawait\b/.test(script)) return script;
  return expression ? `(async () => (${script}\n))()` : `(async () => {${script}\n})()`;
}

// A script that lands while the page navigates loses its context; once the
// new document is there it can run.
export async function evaluateScript(page: Page, script: string): Promise<unknown> {
  const source = evaluable(script);
  try {
    return await page.evaluate(source);
  } catch (err) {
    if (!/Execution context was destroyed|Cannot find context/.test(String(err))) throw err;
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    return page.evaluate(source);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A click that starts a navigation resolves before the next document exists,
// so whatever runs next races it ("context destroyed", a goBack that skips the
// new entry). When the action asked the main frame to navigate, wait for the
// new document; a response that never commits (a download, a 204) only gets a
// short grace.
export async function settleNavigation<T>(page: Page, act: () => Promise<T>): Promise<T> {
  let request: Request | null = null;
  let committed = false;
  const onRequest = (req: Request) => {
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()) request = req;
  };
  const onNavigated = (frame: unknown) => {
    if (frame === page.mainFrame()) committed = true;
  };
  page.on("request", onRequest);
  page.on("framenavigated", onNavigated);
  try {
    const result = await act();
    await sleep(100);
    const nav = request as Request | null;
    if (nav && !committed) {
      await Promise.race([
        page.waitForEvent("framenavigated", { predicate: (frame) => frame === page.mainFrame(), timeout: 15000 }).catch(() => {}),
        page.waitForEvent("download", { timeout: 15000 }).catch(() => {}),
        nav.response().then(() => sleep(1000), () => {}),
      ]);
    }
    if (nav) await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    return result;
  } finally {
    page.off("request", onRequest);
    page.off("framenavigated", onNavigated);
  }
}

// A bare snapshot ref ("e5") is shorthand for the data-ref it stamped.
export function ref(selector: string): string {
  return /^e\d+$/.test(selector) ? `[data-ref="${selector}"]` : selector;
}
