import { z } from "zod";
import { writeFile } from "fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { closeBrowser, getPage, setPage, setHeadless, isHeadless, setViewport, getViewport } from "./browser.js";
import type { Viewport } from "./browser.js";

type ToolHandler<T extends z.ZodRawShape> = (args: z.infer<z.ZodObject<T>>) => Promise<unknown>;

interface ToolDefinition<S extends z.ZodRawShape> {
  name: string;
  description: string;
  schema: S;
  handler: ToolHandler<S>;
}

function createTool<S extends z.ZodRawShape>(def: ToolDefinition<S>) {
  return def as unknown as ToolDefinition<z.ZodRawShape>;
}

function success<T extends Record<string, unknown>>(extra: T) {
  return { success: true, ...extra };
}

function collapse(text: string): string {
  return text.replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated, ${text.length - max} more chars]`;
}

// Drop parts of the markup that carry no information for the model: scripts,
// styles, inline SVG paths, comments, and the whitespace between tags.
function compactHtml(html: string): string {
  return html
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "<svg/>")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/>\s+</g, "><")
    .trim();
}

// Playwright appends a multi-line "Call log:" to most errors; the first line
// is what identifies the failure, the rest is retry noise.
function shortError(err: unknown): string {
  if (err instanceof z.ZodError) {
    return clamp(err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "), 300);
  }
  const message = err instanceof Error ? err.message : String(err);
  return clamp(collapse(message.split(/\n?Call log:/)[0]), 300);
}

// Only these actions return something the model cannot already infer from the
// step it sent; everything else is confirmed by `ok` alone.
const VERBOSE_ACTIONS = new Set(["extractText", "extractHtml", "extractAttribute", "evaluate", "waitForResponse", "waitForTab", "switchTab", "snapshot", "styles", "audit", "viewport"]);

function clampValue(value: unknown, max: number): unknown {
  if (typeof value === "string") return clamp(value, max);
  if (value === null || typeof value !== "object") return value;
  const json = JSON.stringify(value);
  return json.length <= max ? value : clamp(json, max);
}

const SearchEngines = {
  google: {
    url: (q: string) => `https://www.google.com/search?q=${q}`,
    item: "div.MjjYud",
    link: "a:has(h3)",
    title: "h3",
    snippet: "[data-sncf]",
  },
  duckduckgo: {
    url: (q: string) => `https://duckduckgo.com/?q=${q}`,
    item: "article[data-testid='result']",
    link: "a[data-testid='result-title-a']",
    title: "",
    snippet: "[data-result='snippet']",
  },
  bing: {
    url: (q: string) => `https://www.bing.com/search?q=${q}`,
    item: "li.b_algo",
    link: "h2 a",
    title: "h2",
    snippet: ".b_caption p, .b_algoSlug",
  },
} as const;

// ---------------------------------------------------------------------------
// Viewport: the width a responsive layout is measured at.
// ---------------------------------------------------------------------------

// At or below this width the page is being looked at as a touch device, which
// is what makes `pointer: coarse` and `hover: none` match and hides or exposes
// hover-only affordances.
const TOUCH_MAX_WIDTH = 768;

function viewportFor(width: number, height?: number, mobile?: boolean, scale = 1): Viewport {
  const touch = mobile ?? width <= TOUCH_MAX_WIDTH;
  return { width, height: height || (touch ? 844 : 900), scale, mobile: touch };
}

// ---------------------------------------------------------------------------
// Page inspection: text descriptions of the UI that stand in for a screenshot
// everywhere except aesthetic judgement.
// ---------------------------------------------------------------------------

const INTERACTIVE_SELECTOR =
  "a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=checkbox],[role=radio],[role=menuitem],[role=switch],[contenteditable=true]";

const STYLE_KEYS = [
  "display", "position", "width", "height", "margin", "padding", "color", "backgroundColor",
  "fontSize", "fontWeight", "fontFamily", "lineHeight", "borderRadius", "border", "boxShadow",
  "flexDirection", "justifyContent", "alignItems", "gap", "gridTemplateColumns", "opacity", "zIndex",
];

interface InspectArgs {
  mode: "snapshot" | "styles" | "audit";
  selector: string;
  interactive: string;
  keys: string[];
  max: number;
}

function inspectPage({ mode, selector, interactive, keys, max }: InspectArgs): string {
  const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
  const box = (el: Element) => el.getBoundingClientRect();

  const hidden = (el: Element) => {
    const r = box(el);
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) <= 0.05) return true;
    // Screen-reader-only patterns: clipped to nothing, or parked off-canvas.
    if (r.width <= 1 && r.height <= 1) return true;
    return r.bottom < -500 || r.right < -500;
  };

  const named = (el: Element) => {
    const cls = typeof el.className === "string" && el.className.trim()
      ? `.${el.className.trim().split(/\s+/)[0]}`
      : "";
    return el.tagName.toLowerCase() + (el.id ? `#${el.id}` : cls);
  };

  const label = (el: Element) => {
    const input = el as HTMLInputElement;
    const candidates = [
      el.getAttribute("aria-label"),
      input.labels?.[0]?.textContent,
      el.getAttribute("placeholder"),
      /^(submit|button|reset)$/.test(input.type ?? "") ? input.value : "",
      (el as HTMLElement).innerText,
      el.getAttribute("title"),
      el.getAttribute("alt"),
      el.getAttribute("name"),
      el.id ? `#${el.id}` : "",
    ];
    for (const candidate of candidates) {
      const value = clean(candidate);
      if (value) return value.slice(0, 80);
    }
    return "";
  };

  const scope = selector ? document.querySelector(selector) : document.body;
  if (!scope) throw new Error(`${mode}: no element matches ${selector}`);

  if (mode === "styles") {
    const out: string[] = [];
    for (const el of [...document.querySelectorAll(selector || "body")].slice(0, max)) {
      const style = getComputedStyle(el) as unknown as Record<string, string>;
      const r = box(el);
      const pairs = keys
        .map((key) => [key, style[key]] as const)
        .filter(([, value]) => value && !["none", "normal", "auto", "0px", "static", "rgba(0, 0, 0, 0)"].includes(value));
      out.push(
        `${named(el)} [${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.x)},${Math.round(r.y)}] `
        + pairs.map(([key, value]) => `${key}:${value}`).join("; "),
      );
    }
    return out.join("\n") || `(no element matches ${selector})`;
  }

  if (mode === "snapshot") {
    const lines: string[] = [];
    scope.querySelectorAll("[data-ref]").forEach((el) => el.removeAttribute("data-ref"));

    for (const heading of scope.querySelectorAll("h1,h2,h3")) {
      if (hidden(heading)) continue;
      const text = clean((heading as HTMLElement).innerText);
      if (text) lines.push(`${heading.tagName.toLowerCase()} ${text.slice(0, 100)}`);
    }
    if (lines.length) lines.push("--");

    let count = 0;
    for (const el of scope.querySelectorAll(interactive)) {
      if (count >= max) break;
      if (hidden(el)) continue;
      const ref = `e${++count}`;
      el.setAttribute("data-ref", ref);
      const input = el as HTMLInputElement;
      const tag = el.tagName.toLowerCase();
      const kind = tag === "input" ? `input:${input.type || "text"}` : tag;
      const state: string[] = [];
      if (input.disabled) state.push("disabled");
      if (input.checked) state.push("checked");
      if (input.value && !/^(submit|button|reset|checkbox|radio)$/.test(input.type ?? "")) {
        state.push(`="${clean(input.value).slice(0, 40)}"`);
      }
      lines.push(`${ref} ${kind} "${label(el)}"${state.length ? ` ${state.join(" ")}` : ""}`);
    }
    return lines.join("\n") || "(no visible interactive elements)";
  }

  const channels = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
  const luminance = (c: number[]) => {
    const f = (x: number) => (x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const backdrop = (el: Element) => {
    for (let node: Element | null = el; node && node !== document.documentElement; node = node.parentElement) {
      const c = channels(getComputedStyle(node).backgroundColor);
      if (c.length >= 3 && (c[3] === undefined || c[3] > 0.5)) return c;
    }
    return [255, 255, 255];
  };
  const contrast = (el: Element) => {
    const [light, dark] = [luminance(channels(getComputedStyle(el).color)), luminance(backdrop(el))].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
  };

  const issues: string[] = [];
  const report = (message: string) => { if (issues.length < max) issues.push(message); };

  if (document.documentElement.scrollWidth > window.innerWidth + 1) {
    report(`overflow-x: page is ${document.documentElement.scrollWidth}px wide vs viewport ${window.innerWidth}px`);
  }

  for (const el of scope.querySelectorAll("*")) {
    if (issues.length >= max) break;
    if (hidden(el)) continue;
    const style = getComputedStyle(el);
    const r = box(el);

    if ([...el.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim())) {
      const ratio = contrast(el);
      const size = parseFloat(style.fontSize) || 16;
      const floor = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700) ? 3 : 4.5;
      if (ratio < floor) report(`contrast ${named(el)}: ${ratio.toFixed(2)}:1 below ${floor} (${style.color})`);
      if (el.scrollWidth > el.clientWidth + 1 && !/auto|scroll/.test(style.overflowX + style.overflow)) {
        report(`clipped ${named(el)}: content ${el.scrollWidth}px in a ${el.clientWidth}px box`);
      }
    }
    if (r.right > window.innerWidth + 1) {
      report(`offscreen ${named(el)}: ${Math.round(r.right - window.innerWidth)}px past the right edge`);
    }

    const role = el.getAttribute("role") ?? "";
    if (/^(a|button|input|select|textarea)$/.test(el.tagName.toLowerCase()) || /^(button|link|tab|checkbox)$/.test(role)) {
      // Inline links inside running text are not tap targets; only standalone
      // controls are measured against the 24px floor.
      if (style.display !== "inline" && Math.min(r.width, r.height) < 24) {
        report(`tap-target ${named(el)}: ${Math.round(r.width)}x${Math.round(r.height)}px under 24x24`);
      }
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
        report(`covered ${named(el)}: obscured by ${named(hit)}`);
      }
    }
    const img = el as HTMLImageElement;
    if (el.tagName === "IMG" && img.complete && img.naturalWidth === 0) {
      report(`broken-img ${el.getAttribute("src")}`);
    }
  }
  return issues.length ? issues.join("\n") : "(no layout or contrast issues found)";
}

async function runInspect(
  page: Awaited<ReturnType<typeof getPage>>,
  mode: InspectArgs["mode"],
  selector: string,
  max: number,
): Promise<string> {
  return page.evaluate(inspectPage, {
    mode,
    selector,
    interactive: INTERACTIVE_SELECTOR,
    keys: STYLE_KEYS,
    max,
  });
}

// Reporting each width's findings in full is mostly repetition: an issue that
// holds at every width is one line, and the interesting ones are those tagged
// with the widths where they actually appear.
async function inspectWidths(
  page: Awaited<ReturnType<typeof getPage>>,
  mode: InspectArgs["mode"],
  selector: string,
  max: number,
  widths: number[],
): Promise<string> {
  const targets = [...new Set(widths)].sort((a, b) => a - b);
  const previous = getViewport();
  const seen = new Map<string, number[]>();

  try {
    for (const width of targets) {
      await setViewport(viewportFor(width));
      // Two frames: one for reflow, one for any ResizeObserver-driven relayout.
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))),
      );
      const report = await runInspect(page, mode, selector, max);
      for (const raw of report.split("\n")) {
        // snapshot numbers its refs per run, so the same control is e3 at one
        // width and e7 at another; drop the ref or nothing would ever group.
        const line = mode === "snapshot" ? raw.replace(/^e\d+ /, "") : raw;
        if (!line.trim()) continue;
        const at = seen.get(line);
        if (at) at.push(width);
        else seen.set(line, [width]);
      }
    }
  } finally {
    await setViewport(previous);
  }

  const everywhere = (at: number[]) => at.length === targets.length;
  return [...seen]
    .sort(([, a], [, b]) => Number(everywhere(b)) - Number(everywhere(a)) || a[0] - b[0])
    .map(([line, at]) => `[${everywhere(at) ? "all" : at.join(",")}] ${line}`)
    .join("\n");
}

const waitUntilSchema = z
  .enum(["load", "domcontentloaded", "networkidle", "commit"])
  .default("networkidle");

const automationStepSchema = z
  .object({
    action: z
      .enum([
        "navigate",
        "click",
        "type",
        "clear",
        "focus",
        "selectOption",
        "check",
        "uncheck",
        "press",
        "wait",
        "waitForSelector",
        "waitForNavigation",
        "waitForURL",
        "waitForResponse",
        "hover",
        "scroll",
        "scrollToTop",
        "scrollToBottom",
        "goBack",
        "goForward",
        "reload",
        "extractText",
        "extractHtml",
        "extractAttribute",
        "assertText",
        "assertVisible",
        "assertNotVisible",
        "assertUrl",
        "assertCount",
        "assertAttribute",
        "assertValue",
        "assertChecked",
        "switchTab",
        "waitForTab",
        "closeTab",
        "evaluate",
        "screenshot",
        "snapshot",
        "styles",
        "audit",
        "viewport",
      ])
      .describe("Action to run"),
    name: z.string().optional().describe("Step label"),
    selector: z.string().optional().describe("CSS selector"),
    frame: z.string().optional().describe("iframe selector to scope this step into"),
    url: z.string().optional().describe("URL for navigate, or pattern for waitForURL/waitForResponse"),
    text: z.string().optional().describe("Text to type, or expected text for assert*"),
    key: z.string().optional().describe("Key for press"),
    milliseconds: z.number().optional().describe("Delay for wait"),
    delay: z.number().default(50).describe("Keystroke delay, ms"),
    timeout: z.number().default(5000).describe("Step timeout, ms"),
    waitUntil: waitUntilSchema.describe("Navigation wait strategy"),
    fullPage: z.boolean().default(false).describe("Full-page screenshot"),
    filepath: z.string().optional().describe("Absolute path for screenshot"),
    width: z.number().optional().describe("Viewport width in CSS px; 0 resets"),
    height: z.number().optional().describe("Viewport height in CSS px"),
    x: z.number().default(0).describe("Scroll px, horizontal"),
    y: z.number().default(0).describe("Scroll px, vertical"),
    script: z.string().optional().describe("JS to run in the page"),
    variable: z.string().optional().describe("Save result as ${key} for later steps"),
    attribute: z.string().optional().describe("Attribute name"),
    count: z.number().optional().describe("Expected count for assertCount"),
    checked: z.boolean().optional().describe("Expected state for assertChecked"),
    tabIndex: z.number().optional().describe("Tab index for switchTab"),
    match: z
      .enum(["equals", "includes", "regex"])
      .default("includes")
      .describe("Comparison mode for assert*/waitForURL/waitForResponse"),
    selectedValue: z.string().optional().describe("Value for selectOption"),
    maxLength: z.number().default(2000).describe("Max chars returned by extract*/evaluate"),
    continueOnError: z.boolean().default(false).describe("Keep going if this step fails"),
  })
  .superRefine((step, ctx) => {
    // Assertions may legitimately expect an empty string ("this field is
    // blank"), so only there does "" count as a real value.
    const requireField = (field: keyof typeof step, message: string, allowEmpty = false) => {
      const value = step[field];
      if (value === undefined || (!allowEmpty && value === "")) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [field] });
      }
    };

    switch (step.action) {
      case "navigate":
        requireField("url", "url is required for navigate");
        break;
      case "click":
      case "hover":
      case "waitForSelector":
      case "assertVisible":
      case "assertNotVisible":
      case "extractHtml":
      case "clear":
      case "focus":
      case "check":
      case "uncheck":
        requireField("selector", `selector is required for ${step.action}`);
        break;
      case "type":
        requireField("selector", "selector is required for type");
        requireField("text", "text is required for type");
        break;
      case "selectOption":
        requireField("selector", "selector is required for selectOption");
        requireField("selectedValue", "selectedValue is required for selectOption");
        break;
      case "press":
        requireField("key", "key is required for press");
        break;
      case "wait":
        requireField("milliseconds", "milliseconds is required for wait");
        break;
      case "waitForNavigation":
        break;
      case "waitForURL":
        requireField("url", "url is required for waitForURL");
        break;
      case "waitForResponse":
        requireField("url", "url is required for waitForResponse");
        break;
      case "scroll":
        requireField("y", "y is required for scroll");
        break;
      case "extractAttribute":
        requireField("selector", "selector is required for extractAttribute");
        requireField("attribute", "attribute is required for extractAttribute");
        break;
      case "assertText":
        requireField("text", "text is required for assertText", true);
        break;
      case "assertUrl":
        requireField("text", "text is required for assertUrl", true);
        break;
      case "assertCount":
        requireField("selector", "selector is required for assertCount");
        if (step.count === undefined) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "count is required for assertCount", path: ["count"] });
        }
        break;
      case "assertAttribute":
        requireField("selector", "selector is required for assertAttribute");
        requireField("attribute", "attribute is required for assertAttribute");
        requireField("text", "text is required for assertAttribute", true);
        break;
      case "assertValue":
        requireField("selector", "selector is required for assertValue");
        requireField("text", "text is required for assertValue", true);
        break;
      case "assertChecked":
        requireField("selector", "selector is required for assertChecked");
        if (step.checked === undefined) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "checked is required for assertChecked", path: ["checked"] });
        }
        break;
      case "switchTab":
        if (step.tabIndex === undefined) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "tabIndex is required for switchTab", path: ["tabIndex"] });
        }
        break;
      case "waitForTab":
      case "closeTab":
        break;
      case "evaluate":
        requireField("script", "script is required for evaluate");
        break;
      case "screenshot":
        requireField("filepath", "filepath is required for screenshot");
        break;
      case "styles":
        requireField("selector", "selector is required for styles");
        break;
      case "viewport":
        requireField("width", "width is required for viewport (0 resets)");
        break;
      default:
        break;
    }
  });

function textMatches(actual: string, expected: string, match: "equals" | "includes" | "regex"): boolean {
  if (match === "equals") return actual === expected;
  if (match === "regex") return new RegExp(expected).test(actual);
  return actual.includes(expected);
}

// Resolve a dot-path like "user.url" against the variables collected so far.
function resolveVariable(path: string, variables: Record<string, unknown>): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, variables);
}

// Replace ${var} / ${var.path} tokens in a string with values from prior steps.
function interpolate(input: string, variables: Record<string, unknown>): string {
  return input.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
    const value = resolveVariable(expr.trim(), variables);
    if (value === undefined || value === null) return "";
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

const INTERPOLATED_FIELDS = ["selector", "frame", "url", "text", "key", "script", "attribute", "selectedValue", "filepath"] as const;

function interpolateStep(
  step: z.infer<typeof automationStepSchema>,
  variables: Record<string, unknown>,
): z.infer<typeof automationStepSchema> {
  const out = { ...step } as Record<string, unknown>;
  for (const field of INTERPOLATED_FIELDS) {
    const current = out[field];
    if (typeof current === "string") {
      out[field] = interpolate(current, variables);
    }
  }
  return out as z.infer<typeof automationStepSchema>;
}

function toLoadState(waitUntil: z.infer<typeof waitUntilSchema>): "load" | "domcontentloaded" | "networkidle" {
  return waitUntil === "commit" ? "domcontentloaded" : waitUntil;
}

async function runBrowserFlow(
  steps: Array<z.infer<typeof automationStepSchema>>,
  stopOnError: boolean,
) {
  let page = await getPage();
  const variables: Record<string, unknown> = {};
  const results: Array<Record<string, unknown>> = [];

  for (const [index, rawStep] of steps.entries()) {
    const step = interpolateStep(rawStep, variables);

    // Scope element actions to an iframe when `frame` is set, otherwise the page.
    const scope = step.frame ? page.frameLocator(step.frame) : page;
    const locator = step.selector ? scope.locator(step.selector) : null;

    try {
      let value: unknown = null;

      switch (step.action) {
        case "navigate":
          await page.goto(step.url!, { waitUntil: step.waitUntil });
          value = { url: page.url(), title: await page.title() };
          break;
        case "click":
          await locator!.click({ timeout: step.timeout });
          value = { clicked: step.selector };
          break;
        case "type":
          await locator!.pressSequentially(step.text!, { delay: step.delay, timeout: step.timeout });
          value = { typed: step.selector, length: step.text!.length };
          break;
        case "clear":
          await locator!.clear({ timeout: step.timeout });
          value = { cleared: step.selector };
          break;
        case "focus":
          await locator!.focus({ timeout: step.timeout });
          value = { focused: step.selector };
          break;
        case "selectOption": {
          const selected = await locator!.selectOption(step.selectedValue!, { timeout: step.timeout });
          value = { selector: step.selector, selected };
          break;
        }
        case "check":
          await locator!.check({ timeout: step.timeout });
          value = { checked: step.selector };
          break;
        case "uncheck":
          await locator!.uncheck({ timeout: step.timeout });
          value = { unchecked: step.selector };
          break;
        case "press":
          await page.keyboard.press(step.key!);
          value = { key: step.key };
          break;
        case "wait":
          await new Promise((resolve) => setTimeout(resolve, step.milliseconds));
          value = { waited: step.milliseconds };
          break;
        case "waitForSelector":
          await locator!.waitFor({ state: "visible", timeout: step.timeout });
          value = { selector: step.selector, visible: true };
          break;
        case "waitForNavigation":
          await page.waitForLoadState(toLoadState(step.waitUntil), { timeout: step.timeout });
          value = { state: toLoadState(step.waitUntil) };
          break;
        case "waitForURL": {
          const pattern = step.url!;
          const mode = step.match;
          await page.waitForURL(
            (url) => textMatches(url.toString(), pattern, mode),
            { timeout: step.timeout, waitUntil: toLoadState(step.waitUntil) },
          );
          value = { url: page.url(), matched: true };
          break;
        }
        case "waitForResponse": {
          const pattern = step.url!;
          const mode = step.match;
          const response = await page.waitForResponse(
            (res) => textMatches(res.url(), pattern, mode),
            { timeout: step.timeout },
          );
          value = { url: response.url(), status: response.status(), ok: response.ok() };
          break;
        }
        case "hover":
          await locator!.hover({ timeout: step.timeout });
          value = { hovered: step.selector };
          break;
        case "scroll":
          await page.evaluate(({ x, y }) => window.scrollBy(x, y), { x: step.x, y: step.y });
          value = { x: step.x, y: step.y };
          break;
        case "scrollToTop":
          await page.evaluate(() => window.scrollTo(0, 0));
          value = { position: "top" };
          break;
        case "scrollToBottom":
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          value = { position: "bottom" };
          break;
        case "goBack":
          await page.goBack({ waitUntil: step.waitUntil, timeout: step.timeout });
          break;
        case "goForward":
          await page.goForward({ waitUntil: step.waitUntil, timeout: step.timeout });
          break;
        case "reload":
          await page.reload({ waitUntil: step.waitUntil, timeout: step.timeout });
          break;
        case "extractText": {
          const target = locator ?? scope.locator("body");
          value = collapse((await target.textContent({ timeout: step.timeout })) ?? "");
          break;
        }
        case "extractHtml":
          value = compactHtml(await locator!.innerHTML({ timeout: step.timeout }));
          break;
        case "extractAttribute":
          value = await locator!.getAttribute(step.attribute!, { timeout: step.timeout });
          break;
        case "assertText": {
          const target = locator ?? scope.locator("body");
          const actual = (await target.textContent({ timeout: step.timeout })) ?? "";
          if (!textMatches(actual, step.text!, step.match)) {
            throw new Error(`assertText failed at ${step.selector ?? "body"}. expected ${step.match} "${step.text}" but got "${actual}"`);
          }
          value = { selector: step.selector ?? "body", matched: true, match: step.match };
          break;
        }
        case "assertVisible":
          await locator!.waitFor({ state: "visible", timeout: step.timeout });
          value = { selector: step.selector, visible: true };
          break;
        case "assertNotVisible":
          await locator!.waitFor({ state: "hidden", timeout: step.timeout });
          value = { selector: step.selector, visible: false };
          break;
        case "assertUrl": {
          const actual = page.url();
          if (!textMatches(actual, step.text!, step.match)) {
            throw new Error(`assertUrl failed. expected ${step.match} "${step.text}" but got "${actual}"`);
          }
          value = { url: actual, matched: true, match: step.match };
          break;
        }
        case "assertCount": {
          const actual = await locator!.count();
          if (actual !== step.count) {
            throw new Error(`assertCount failed at ${step.selector}. expected ${step.count} but got ${actual}`);
          }
          value = { selector: step.selector, count: actual };
          break;
        }
        case "assertAttribute": {
          const actual = await locator!.getAttribute(step.attribute!, { timeout: step.timeout });
          if (actual === null || !textMatches(actual, step.text!, step.match)) {
            throw new Error(`assertAttribute failed at ${step.selector}[${step.attribute}]. expected ${step.match} "${step.text}" but got ${actual === null ? "null" : `"${actual}"`}`);
          }
          value = { selector: step.selector, attribute: step.attribute, matched: true };
          break;
        }
        case "assertValue": {
          const actual = await locator!.inputValue({ timeout: step.timeout });
          if (!textMatches(actual, step.text!, step.match)) {
            throw new Error(`assertValue failed at ${step.selector}. expected ${step.match} "${step.text}" but got "${actual}"`);
          }
          value = { selector: step.selector, matched: true };
          break;
        }
        case "assertChecked": {
          const actual = await locator!.isChecked({ timeout: step.timeout });
          if (actual !== step.checked) {
            throw new Error(`assertChecked failed at ${step.selector}. expected ${step.checked} but got ${actual}`);
          }
          value = { selector: step.selector, checked: actual };
          break;
        }
        case "switchTab": {
          const pages = page.context().pages();
          const target = pages[step.tabIndex!];
          if (!target) {
            throw new Error(`switchTab failed. no tab at index ${step.tabIndex}, only ${pages.length} open`);
          }
          page = target;
          await page.bringToFront();
          await setPage(page);
          value = { tabIndex: step.tabIndex, url: page.url() };
          break;
        }
        case "waitForTab": {
          const target = await page.context().waitForEvent("page", { timeout: step.timeout });
          await target.waitForLoadState(toLoadState(step.waitUntil), { timeout: step.timeout }).catch(() => {});
          page = target;
          await page.bringToFront();
          await setPage(page);
          value = { url: page.url(), title: await page.title() };
          break;
        }
        case "closeTab": {
          const context = page.context();
          await page.close();
          const next = context.pages()[0];
          if (!next) {
            throw new Error("closeTab failed. no remaining tab");
          }
          page = next;
          await page.bringToFront();
          await setPage(page);
          value = { closed: true, url: page.url() };
          break;
        }
        case "evaluate":
          value = await page.evaluate(step.script!);
          break;
        case "snapshot":
        case "styles":
        case "audit":
          value = await runInspect(page, step.action, step.selector ?? "", 60);
          break;
        case "viewport": {
          await setViewport(step.width! > 0 ? viewportFor(step.width!, step.height) : null);
          value = await page.evaluate(() => ({
            width: window.innerWidth,
            height: window.innerHeight,
            touch: matchMedia("(pointer: coarse)").matches,
          }));
          break;
        }
        case "screenshot": {
          const buffer = await page.screenshot({ fullPage: step.fullPage });
          await writeFile(step.filepath!, buffer);
          value = { filepath: step.filepath, size: buffer.length };
          break;
        }
      }

      if (step.variable) {
        variables[step.variable] = clampValue(value, step.maxLength);
      }

      // Echoing back what the step itself said (clicked selector, scroll
      // offsets, ...) is pure token cost: `ok` already confirms it ran, and a
      // stored value is reported once through `variables`.
      const keepValue = VERBOSE_ACTIONS.has(step.action) && !step.variable;
      results.push({
        i: index,
        action: step.action,
        ok: true,
        ...(step.name ? { name: step.name } : {}),
        ...(keepValue ? { value: clampValue(value, step.maxLength) } : {}),
      });
    } catch (err) {
      const error = shortError(err);
      results.push({
        i: index,
        action: step.action,
        ok: false,
        ...(step.name ? { name: step.name } : {}),
        error,
      });

      if (step.continueOnError) {
        continue;
      }

      if (stopOnError) {
        return summarizeFlow(results, variables, page, index);
      }
    }
  }

  return summarizeFlow(results, variables, page);
}

// Steps that neither failed, carried a value, nor were named add nothing the
// caller cannot read off its own request, so they are counted, not listed.
async function summarizeFlow(
  results: Array<Record<string, unknown>>,
  variables: Record<string, unknown>,
  page: Awaited<ReturnType<typeof getPage>>,
  failedStep?: number,
) {
  const passed = results.filter((result) => result.ok === true).length;
  const notable = results.filter((result) => result.ok !== true || "value" in result || "name" in result);
  return {
    success: failedStep === undefined && passed === results.length,
    steps: `${passed}/${results.length}`,
    ...(failedStep !== undefined ? { failedStep } : {}),
    ...(notable.length ? { results: notable } : {}),
    ...(Object.keys(variables).length ? { variables } : {}),
    url: page.url(),
    title: await page.title(),
  };
}

const tools = [
  createTool({
    name: "browser_set_headless",
    description: "Show or hide the browser window.",
    schema: {
      headless: z.boolean().describe("true = no window, false = visible window"),
    },
    handler: async ({ headless }) => {
      const restarted = await setHeadless(headless);
      return success({ headless, current: isHeadless(), restarted });
    },
  }),
  createTool({
    name: "browser_set_viewport",
    description: "Resize the page to a CSS-pixel width to check a responsive breakpoint. Width <= 768 also emulates touch, so `pointer: coarse` and `hover: none` match. Sticks across navigation, new tabs and headless toggles until reset. To compare several widths at once, pass `widths` to browser_inspect instead.",
    schema: {
      width: z.number().describe("CSS px wide, e.g. 320/360/390/768/1024/1440. 0 resets to the window size"),
      height: z.number().optional().describe("CSS px tall. Default 844 at touch widths, else 900"),
      mobile: z.boolean().optional().describe("Touch emulation. Default: width <= 768"),
      scale: z.number().default(1).describe("devicePixelRatio"),
    },
    handler: async ({ width, height, mobile, scale }) => {
      const page = await getPage();
      await setViewport(width > 0 ? viewportFor(width, height, mobile, scale) : null);
      // Report what the page actually sees, so a size the site overrides shows up.
      const actual = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
        touch: matchMedia("(pointer: coarse)").matches,
      }));
      return success({ ...actual, override: getViewport() !== null });
    },
  }),
  createTool({
    name: "browser_navigate",
    description: "Go to a URL. One-off only; for anything with further steps use browser_run_flow.",
    schema: {
      url: z.string().describe("Full URL including https://"),
      waitUntil: waitUntilSchema.describe("When navigation counts as done"),
    },
    handler: async ({ url, waitUntil }) => {
      const page = await getPage();
      await page.goto(url, { waitUntil });
      return success({ url: page.url(), title: await page.title() });
    },
  }),
  createTool({
    name: "browser_click",
    description: "Click an element. One-off only; for a multi-step interaction use browser_run_flow.",
    schema: {
      selector: z.string().describe("CSS selector"),
    },
    handler: async ({ selector }) => {
      await (await getPage()).locator(selector).first().click();
      return success({});
    },
  }),
  createTool({
    name: "browser_type",
    description: "Type into one field. For a whole form use browser_run_flow.",
    schema: {
      selector: z.string().describe("CSS selector"),
      text: z.string().describe("Text to type"),
      delay: z.number().default(50).describe("Keystroke delay, ms"),
    },
    handler: async ({ selector, text, delay }) => {
      await (await getPage()).locator(selector).first().pressSequentially(text, { delay });
      return success({});
    },
  }),
  createTool({
    name: "browser_get_content",
    description: "Get page HTML, with scripts/styles/comments stripped. Scope with a selector and keep maxLength low; prefer browser_get_text when only the wording matters.",
    schema: {
      selector: z.string().optional().describe("Limit to this element. Defaults to the whole page"),
      maxLength: z.number().default(20000).describe("Max chars returned"),
      raw: z.boolean().default(false).describe("Skip stripping and return the HTML untouched"),
    },
    handler: async ({ selector, maxLength, raw }) => {
      const page = await getPage();
      const html = selector
        ? await page.locator(selector).first().innerHTML()
        : await page.content();
      return { html: clamp(raw ? html : compactHtml(html), maxLength) };
    },
  }),
  createTool({
    name: "browser_get_text",
    description: "Read visible text from the page or one element. Cheaper than browser_get_content.",
    schema: {
      selector: z.string().optional().describe("Element to read. Defaults to the whole page"),
      maxLength: z.number().default(20000).describe("Max chars returned"),
    },
    handler: async ({ selector, maxLength }) => {
      const page = await getPage();
      const text = await page.locator(selector || "body").first().textContent();
      return { text: clamp(collapse(text ?? ""), maxLength) };
    },
  }),
  createTool({
    name: "browser_inspect",
    description: "Read the UI as text instead of a screenshot. snapshot: visible interactive elements, each stamped with data-ref so you can click it as [data-ref=\"e5\"]. styles: computed style and geometry. audit: contrast, overflow, clipped text, covered or undersized controls, broken images. Screenshot only for genuinely visual judgement.",
    schema: {
      mode: z.enum(["snapshot", "styles", "audit"]).default("snapshot").describe("What to read"),
      selector: z.string().optional().describe("Root for snapshot/audit, target elements for styles"),
      max: z.number().default(60).describe("Max elements or issues"),
      maxLength: z.number().default(8000).describe("Max chars returned"),
      widths: z
        .array(z.number())
        .optional()
        .describe("Re-run at each CSS-px width and tag every line with where it occurs, e.g. [360,768,1440]. Restores the viewport after"),
    },
    handler: async ({ mode, selector, max, maxLength, widths }) => {
      const page = await getPage();
      const report = widths?.length
        ? await inspectWidths(page, mode, selector ?? "", max, widths)
        : await runInspect(page, mode, selector ?? "", max);
      return { [mode]: clamp(report, maxLength) };
    },
  }),
  createTool({
    name: "browser_evaluate",
    description: "Run JavaScript in the page. Return only the data you need, not whole DOM dumps.",
    schema: {
      script: z.string().describe("JS to run; its return value comes back"),
      maxLength: z.number().default(20000).describe("Max chars returned"),
    },
    handler: async ({ script, maxLength }) => ({
      result: clampValue(await (await getPage()).evaluate(script), maxLength),
    }),
  }),
  createTool({
    name: "browser_search",
    description: "Search the web and get titles, URLs and snippets.",
    schema: {
      query: z.string().describe("Search keywords"),
      engine: z.enum(["google", "duckduckgo", "bing"]).default("duckduckgo").describe("Search engine"),
      limit: z.number().default(10).describe("Max results"),
    },
    handler: async ({ query, engine, limit }) => {
      const page = await getPage();
      const config = SearchEngines[engine];
      await page.goto(config.url(encodeURIComponent(query)), { waitUntil: "networkidle" });

      const results = await page.evaluate(({ item, link, title, snippet, max }) => {
        const clean = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim() ?? "";

        // Every engine routes result links through its own redirector; recover
        // the real target from the redirect payload or the displayed citation
        // rather than discarding the result.
        const resolve = (anchor: HTMLAnchorElement, node: Element) => {
          if (!anchor.href.includes(location.host)) return anchor.href;
          const params = new URL(anchor.href).searchParams;
          for (const key of ["u", "url", "q"]) {
            const raw = params.get(key);
            if (!raw) continue;
            if (/^https?:/.test(raw)) return raw;
            try {
              const decoded = atob(raw.replace(/^a1/, "").replace(/-/g, "+").replace(/_/g, "/"));
              if (/^https?:/.test(decoded)) return decoded;
            } catch {}
          }
          // Google's citation shortens the breadcrumb without marking it, so it
          // cannot be rebuilt into a URL. Hand back the redirect, which is
          // opaque but navigable, rather than a plausible-looking wrong path.
          return anchor.href;
        };

        const out: Array<{ title: string; url: string; snippet: string }> = [];
        const seen = new Set<string>();

        for (const node of document.querySelectorAll(item)) {
          if (out.length >= max) break;
          const anchor = node.querySelector<HTMLAnchorElement>(link);
          if (!anchor?.href || !/^https?:/.test(anchor.href)) continue;
          const url = resolve(anchor, node);
          if (seen.has(url)) continue;
          seen.add(url);
          const heading = clean((title ? node.querySelector(title) : anchor)?.textContent);
          const described = clean(node.querySelector(snippet)?.textContent)
            || clean(node.textContent).replace(heading, "");
          out.push({ title: heading, url, snippet: described.slice(0, 200).trim() });
        }
        return out;
      }, { item: config.item, link: config.link, title: config.title as string, snippet: config.snippet, max: limit });

      return success({ results });
    },
  }),
  createTool({
    name: "browser_close",
    description: "Close the browser and free resources.",
    schema: {},
    handler: async () => {
      await closeBrowser();
      return success({});
    },
  }),
  createTool({
    name: "browser_save_screenshot",
    description: "Screenshot the page to a file. Use browser_inspect to read the UI as text; screenshot only when the judgement needs eyes.",
    schema: {
      filepath: z.string().describe("Absolute path for the .png"),
      fullPage: z.boolean().default(false).describe("Capture the whole scrollable page"),
    },
    handler: async ({ filepath, fullPage }) => {
      const buffer = await (await getPage()).screenshot({ fullPage });
      await writeFile(filepath, buffer);
      return success({ filepath, size: buffer.length });
    },
  }),
  createTool({
    name: "browser_print_to_pdf",
    description: "Save the page as a PDF.",
    schema: {
      filepath: z.string().describe("Absolute path for the .pdf"),
      landscape: z.boolean().default(false).describe("Landscape orientation"),
      printBackground: z.boolean().default(true).describe("Include background colors and images"),
    },
    handler: async ({ filepath, landscape, printBackground }) => {
      const pdf = await (await getPage()).pdf({
        landscape,
        printBackground,
        format: "A4",
      });
      await writeFile(filepath, pdf);
      return success({ filepath, size: pdf.length });
    },
  }),
  createTool({
    name: "browser_go_back",
    description: "Go back in history.",
    schema: {},
    handler: async () => {
      await (await getPage()).goBack();
      return success({});
    },
  }),
  createTool({
    name: "browser_go_forward",
    description: "Go forward in history.",
    schema: {},
    handler: async () => {
      await (await getPage()).goForward();
      return success({});
    },
  }),
  createTool({
    name: "browser_reload",
    description: "Reload the current page.",
    schema: {},
    handler: async () => {
      await (await getPage()).reload();
      return success({});
    },
  }),
  createTool({
    name: "browser_run_flow",
    description: "PREFERRED for ANY browser task of 2+ steps — use it instead of chaining single-action tools. Runs ordered actions in one call on the same page: navigation, forms, scraping, assertions, snapshot/styles/audit, screenshots. It is also the only place for wait, press, hover, scroll, viewport and tab control. Open an unfamiliar page with a `snapshot` step, then act on the refs it stamps via [data-ref=\"e5\"]. Every string field supports ${var} from a prior step's `variable`; `frame` scopes into an iframe. Results are compacted: passing steps report only a count, so use `variable` or an extract* step for anything you need back.",
    schema: {
      steps: z.array(automationStepSchema).min(1).describe("Ordered actions to run"),
      stopOnError: z.boolean().default(true).describe("Stop at the first failing step"),
    },
    handler: async ({ steps, stopOnError }) => runBrowserFlow(steps, stopOnError),
  }),
];

function toResult(value: unknown, isError = false): CallToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return { content: [{ type: "text", text }], ...(isError && { isError }) };
}

export function registerTools(server: McpServer): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.schema },
      async (args) => {
        try {
          return toResult(await tool.handler(args as never));
        } catch (err) {
          return toResult({ error: shortError(err) }, true);
        }
      },
    );
  }
}
