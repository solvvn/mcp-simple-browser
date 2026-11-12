import { z } from "zod";
import { basename, join } from "path";
import { exclusive, getSession } from "./session.js";
import type { Locator } from "playwright-core";
import type { Page, Session } from "./session.js";
import { runInspect, viewportFor } from "./inspect.js";
import { recordStep, screenshot, shotPath, startRun, trackFile } from "./evidence.js";
import type { Box, EvidenceMode, FlowRun, StepRecord } from "./evidence.js";
import { clamp, clampValue, collapse, compactHtml, evaluateScript, ref, settleNavigation, shortError } from "./util.js";
import { finishRun, setRunCurrent } from "./store.js";

export const waitUntilSchema = z
  .enum(["load", "domcontentloaded", "networkidle", "commit"])
  .default("networkidle");

const ACTIONS = [
  "navigate", "newTab", "click", "dblclick", "rightClick", "type", "fill", "clear", "focus", "selectOption",
  "check", "uncheck", "press", "upload", "hover", "drag", "mouseMove", "mouseClick", "mouseDown", "mouseUp", "draw",
  "wait", "waitForSelector", "waitForNavigation", "waitForURL", "waitForResponse", "waitForTab", "waitForDownload",
  "scroll", "scrollToTop", "scrollToBottom", "goBack", "goForward", "reload",
  "extractText", "extractHtml", "extractAttribute", "evaluate",
  "assertText", "assertVisible", "assertNotVisible", "assertUrl", "assertCount", "assertAttribute", "assertValue",
  "assertChecked", "assertNoErrors",
  "switchTab", "closeTab", "dialog", "screenshot", "snapshot", "styles", "audit", "viewport",
] as const;

// Only these actions return something the model cannot already infer from the
// step it sent; everything else is confirmed by `ok` alone.
const VERBOSE_ACTIONS = new Set(["extractText", "extractHtml", "extractAttribute", "evaluate", "waitForResponse", "waitForTab", "waitForDownload", "switchTab", "snapshot", "styles", "audit", "viewport", "screenshot", "newTab"]);

// Steps that change nothing on screen; a picture after them repeats the last one.
const NO_SHOT = new Set(["wait", "extractText", "extractHtml", "extractAttribute", "evaluate", "snapshot", "styles", "audit", "screenshot", "dialog", "assertNoErrors", "assertUrl", "waitForResponse"]);

// The target is measured before these act, since a click may navigate it away.
const BOX_BEFORE = new Set(["click", "dblclick", "rightClick", "type", "fill", "clear", "focus", "selectOption", "check", "uncheck", "hover", "upload", "drag", "draw"]);
const BOX_AFTER = new Set(["waitForSelector", "assertVisible", "assertText", "assertValue", "assertAttribute", "assertChecked", "assertCount"]);

const pointSchema = z.object({ x: z.number(), y: z.number() });

export const automationStepSchema = z
  .object({
    action: z.enum(ACTIONS).describe("Action to run"),
    session: z.string().optional().describe("Run this step in another session (auto-opened), e.g. a second user"),
    name: z.string().optional().describe("Short description of what the step does, shown on its evidence screenshot (on the outline, or in a bar with the URL and time when nothing is outlined), e.g. \"Đăng nhập bằng tài khoản admin\". Default: generated from the action and target. Use this rather than injecting a banner into the page"),
    selector: z.string().optional().describe("CSS/Playwright selector, or a snapshot ref like e5"),
    target: z.string().optional().describe("Drop target selector for drag"),
    frame: z.string().optional().describe("iframe selector to scope this step into"),
    url: z.string().optional().describe("URL for navigate/newTab, or pattern for waitForURL/waitForResponse/assertUrl"),
    text: z.string().optional().describe("Text to type/fill, expected text for assert*, prompt text for dialog, ignore regex for assertNoErrors"),
    key: z.string().optional().describe("Key for press, e.g. Enter, Control+A"),
    files: z.array(z.string()).optional().describe("Absolute file paths for upload"),
    points: z.array(pointSchema).optional().describe("Path for draw; relative to selector's box when given, else the viewport"),
    accept: z.boolean().default(true).describe("dialog: accept or dismiss the next dialog"),
    milliseconds: z.number().optional().describe("Delay for wait"),
    delay: z.number().default(50).describe("Keystroke delay, ms"),
    timeout: z.number().default(5000).describe("Step timeout, ms"),
    waitUntil: waitUntilSchema.describe("Navigation wait strategy"),
    fullPage: z.boolean().default(false).describe("Full-page screenshot"),
    crop: z.boolean().default(false).describe("screenshot with selector: crop to the outlined element plus some context"),
    filepath: z.string().optional().describe("Save path for screenshot/waitForDownload. Default: the run's evidence dir"),
    width: z.number().optional().describe("Viewport width in CSS px; 0 resets"),
    height: z.number().optional().describe("Viewport height in CSS px"),
    x: z.number().default(0).describe("Scroll px, or viewport x for mouse*"),
    y: z.number().default(0).describe("Scroll px, or viewport y for mouse*"),
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
    const need = (field: keyof typeof step, allowEmpty = false) => {
      const value = step[field];
      if (value === undefined || (!allowEmpty && value === "")) {
        ctx.addIssue({ code: "custom", message: `${field} is required for ${step.action}`, path: [field] });
      }
    };

    switch (step.action) {
      case "navigate":
      case "waitForURL":
      case "waitForResponse":
        need("url");
        break;
      case "click":
      case "dblclick":
      case "rightClick":
      case "hover":
      case "waitForSelector":
      case "assertVisible":
      case "assertNotVisible":
      case "extractHtml":
      case "clear":
      case "focus":
      case "check":
      case "uncheck":
        need("selector");
        break;
      case "type":
      case "fill":
        need("selector");
        need("text", step.action === "fill");
        break;
      case "selectOption":
        need("selector");
        need("selectedValue");
        break;
      case "upload":
        need("selector");
        need("files");
        break;
      case "drag":
        need("selector");
        need("target");
        break;
      case "draw":
        need("points");
        break;
      case "press":
        need("key");
        break;
      case "wait":
        need("milliseconds");
        break;
      case "extractAttribute":
        need("selector");
        need("attribute");
        break;
      case "assertText":
        need("text", true);
        break;
      case "assertUrl":
        if (step.url === undefined) need("text", true);
        break;
      case "assertCount":
        need("selector");
        need("count");
        break;
      case "assertAttribute":
        need("selector");
        need("attribute");
        need("text", true);
        break;
      case "assertValue":
        need("selector");
        need("text", true);
        break;
      case "assertChecked":
        need("selector");
        need("checked");
        break;
      case "switchTab":
        need("tabIndex");
        break;
      case "evaluate":
        need("script");
        break;
      case "styles":
        need("selector");
        break;
      case "viewport":
        need("width");
        break;
      default:
        break;
    }
  });

export type Step = z.infer<typeof automationStepSchema>;

export function textMatches(actual: string, expected: string, match: "equals" | "includes" | "regex"): boolean {
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

const INTERPOLATED_FIELDS = ["selector", "target", "frame", "url", "text", "key", "script", "attribute", "selectedValue", "filepath", "session"] as const;

function interpolateStep(step: Step, variables: Record<string, unknown>): Step {
  const out = { ...step } as Record<string, unknown>;
  for (const field of INTERPOLATED_FIELDS) {
    const current = out[field];
    if (typeof current === "string") out[field] = interpolate(current, variables);
  }
  if (step.files) out.files = step.files.map((file) => interpolate(file, variables));
  return out as Step;
}

export function toLoadState(waitUntil: z.infer<typeof waitUntilSchema>): "load" | "domcontentloaded" | "networkidle" {
  return waitUntil === "commit" ? "domcontentloaded" : waitUntil;
}

const IGNORED_FAILURES = /ERR_ABORTED|ERR_BLOCKED_BY_CLIENT/;

function errorsSince(session: Session, since: number, ignore?: string) {
  const skip = ignore ? new RegExp(ignore) : null;
  const consoleErrors = session.consoleLog
    .filter((e) => e.t >= since && (e.type === "error" || e.type === "pageerror"))
    .map((e) => `${e.type}: ${e.text}`);
  const requests = session.networkLog
    .filter((e) => e.t >= since && ((e.status ?? 0) >= 500 || (e.failure && !IGNORED_FAILURES.test(e.failure))))
    .map((e) => `${e.method} ${e.url} -> ${e.status ?? e.failure}`);
  return [...consoleErrors, ...requests].filter((line) => !skip?.test(line));
}

// What existed when the previous step began. A wait* step usually follows the
// click that caused the event, which may already have fired during that click
// or its evidence shot; the wait accepts it rather than timing out.
interface Prior {
  t: number;
  pages: Set<Page>;
}

async function runStep(step: Step, session: Session, run: FlowRun, index: number, flowStart: number, prior: Prior): Promise<unknown> {
  const page = await session.activePage();
  // Scope element actions to an iframe when `frame` is set, otherwise the page.
  const scope = step.frame ? page.frameLocator(step.frame) : page;
  const locator = step.selector ? scope.locator(ref(step.selector)) : null;
  const t = { timeout: step.timeout };
  // The humanize layer chains several waits per action, each with the full
  // timeout, so a missing element would take minutes to fail. Waiting once up
  // front makes "not found" cost exactly one timeout.
  if (locator && BOX_BEFORE.has(step.action)) await locator.first().waitFor({ state: "attached", ...t });

  switch (step.action) {
    case "navigate":
      await page.goto(step.url!, { waitUntil: step.waitUntil, timeout: Math.max(step.timeout, 30000) });
      return { url: page.url(), title: await page.title() };
    case "newTab": {
      const next = await session.context.newPage();
      await session.usePage(next);
      if (step.url) await next.goto(step.url, { waitUntil: step.waitUntil, timeout: Math.max(step.timeout, 30000) });
      return { tabIndex: session.context.pages().indexOf(next), url: next.url() };
    }
    case "click":
      return void (await settleNavigation(page, () => locator!.click(t)));
    case "dblclick":
      return void (await settleNavigation(page, () => locator!.dblclick(t)));
    case "rightClick":
      return void (await locator!.click({ ...t, button: "right" }));
    case "type":
      return void (await locator!.pressSequentially(step.text!, { delay: step.delay, ...t }));
    case "fill":
      return fastFill(locator!, step.text!, step.timeout);
    case "clear":
      return void (await locator!.clear(t));
    case "focus":
      return void (await locator!.focus(t));
    case "selectOption":
      return { selected: await locator!.selectOption(step.selectedValue!, t) };
    case "check":
      return void (await locator!.check(t));
    case "uncheck":
      return void (await locator!.uncheck(t));
    case "press":
      return void (await settleNavigation(page, () => (locator ? locator.press(step.key!, t) : page.keyboard.press(step.key!))));
    case "upload":
      return void (await locator!.setInputFiles(step.files!, t));
    case "hover":
      return void (await locator!.hover(t));
    case "drag":
      return void (await locator!.dragTo(scope.locator(ref(step.target!)), t));
    case "mouseMove":
      return void (await page.mouse.move(step.x, step.y, { steps: 20 }));
    case "mouseClick":
      await page.mouse.move(step.x, step.y, { steps: 20 });
      return void (await settleNavigation(page, () => page.mouse.click(step.x, step.y)));
    case "mouseDown":
      return void (await page.mouse.down());
    case "mouseUp":
      return void (await page.mouse.up());
    case "draw": {
      const origin = locator ? await locator.boundingBox(t) : { x: 0, y: 0 };
      if (!origin) throw new Error(`draw: ${step.selector} is not visible`);
      const [first, ...rest] = step.points!.map((p) => ({ x: origin.x + p.x, y: origin.y + p.y }));
      await page.mouse.move(first.x, first.y, { steps: 10 });
      await page.mouse.down();
      for (const p of rest) await page.mouse.move(p.x, p.y, { steps: 6 });
      await page.mouse.up();
      return { points: step.points!.length };
    }
    case "wait":
      await new Promise((resolve) => setTimeout(resolve, step.milliseconds));
      return;
    case "waitForSelector":
      return void (await locator!.waitFor({ state: "visible", ...t }));
    case "waitForNavigation":
      return void (await page.waitForLoadState(toLoadState(step.waitUntil), t));
    case "waitForURL": {
      const pattern = step.url!;
      await page.waitForURL((url) => textMatches(url.toString(), pattern, step.match), { ...t, waitUntil: toLoadState(step.waitUntil) });
      return { url: page.url() };
    }
    case "waitForResponse": {
      const pattern = step.url!;
      const seen = session.networkLog.find((e) => e.t >= prior.t && e.status !== undefined && textMatches(e.url, pattern, step.match));
      if (seen) return { url: seen.url, status: seen.status, ok: seen.status! < 400 };
      const response = await page.waitForResponse((res) => textMatches(res.url(), pattern, step.match), t);
      return { url: response.url(), status: response.status(), ok: response.ok() };
    }
    case "waitForTab": {
      const opened = session.context.pages().find((p) => !prior.pages.has(p) && p !== page);
      const next = opened ?? (await session.context.waitForEvent("page", t));
      await next.waitForLoadState(toLoadState(step.waitUntil), t).catch(() => {});
      await session.usePage(next);
      return { url: next.url(), title: await next.title() };
    }
    case "waitForDownload": {
      const [download] = await Promise.all([page.waitForEvent("download", t), locator?.click(t)]);
      const path = step.filepath || join(run.dir, download.suggestedFilename());
      await download.saveAs(path);
      trackFile(path);
      return { filepath: path, url: download.url() };
    }
    case "scroll":
      return void (await page.evaluate(({ x, y }) => window.scrollBy(x, y), { x: step.x, y: step.y }));
    case "scrollToTop":
      return void (await page.evaluate(() => window.scrollTo(0, 0)));
    case "scrollToBottom":
      return void (await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)));
    case "goBack":
      return void (await page.goBack({ waitUntil: step.waitUntil, ...t }));
    case "goForward":
      return void (await page.goForward({ waitUntil: step.waitUntil, ...t }));
    case "reload":
      return void (await page.reload({ waitUntil: step.waitUntil, ...t }));
    case "extractText":
      return collapse((await (locator ?? scope.locator("body")).first().textContent(t)) ?? "");
    case "extractHtml":
      return compactHtml(await locator!.first().innerHTML(t));
    case "extractAttribute":
      return locator!.first().getAttribute(step.attribute!, t);
    case "evaluate":
      return evaluateScript(page, step.script!);
    case "assertText": {
      const actual = collapse((await (locator ?? scope.locator("body")).first().textContent(t)) ?? "");
      if (!textMatches(actual, step.text!, step.match)) {
        throw new Error(`assertText failed at ${step.selector ?? "body"}. expected ${step.match} "${step.text}" but got "${clamp(actual, 200)}"`);
      }
      return;
    }
    case "assertVisible":
      return void (await locator!.first().waitFor({ state: "visible", ...t }));
    case "assertNotVisible":
      return void (await locator!.first().waitFor({ state: "hidden", ...t }));
    case "assertUrl": {
      const actual = page.url();
      const expected = step.text ?? step.url!;
      if (!textMatches(actual, expected, step.match)) {
        throw new Error(`assertUrl failed. expected ${step.match} "${expected}" but got "${actual}"`);
      }
      return;
    }
    case "assertCount": {
      const actual = await locator!.count();
      if (actual !== step.count) throw new Error(`assertCount failed at ${step.selector}. expected ${step.count} but got ${actual}`);
      return;
    }
    case "assertAttribute": {
      const actual = await locator!.first().getAttribute(step.attribute!, t);
      if (actual === null || !textMatches(actual, step.text!, step.match)) {
        throw new Error(`assertAttribute failed at ${step.selector}[${step.attribute}]. expected ${step.match} "${step.text}" but got ${actual === null ? "null" : `"${actual}"`}`);
      }
      return;
    }
    case "assertValue": {
      const actual = await locator!.first().inputValue(t);
      if (!textMatches(actual, step.text!, step.match)) {
        throw new Error(`assertValue failed at ${step.selector}. expected ${step.match} "${step.text}" but got "${actual}"`);
      }
      return;
    }
    case "assertChecked": {
      const actual = await locator!.first().isChecked(t);
      if (actual !== step.checked) throw new Error(`assertChecked failed at ${step.selector}. expected ${step.checked} but got ${actual}`);
      return;
    }
    case "assertNoErrors": {
      await session.syncConsole();
      const errors = errorsSince(session, flowStart, step.text);
      if (errors.length) throw new Error(`assertNoErrors failed: ${errors.length} error(s): ${errors.slice(0, 5).join(" | ")}`);
      return;
    }
    case "switchTab": {
      const pages = session.context.pages();
      const next = pages[step.tabIndex!];
      if (!next) throw new Error(`switchTab failed. no tab at index ${step.tabIndex}, only ${pages.length} open`);
      await session.usePage(next);
      return { tabIndex: step.tabIndex, url: next.url() };
    }
    case "closeTab": {
      await page.close();
      const next = session.context.pages()[0];
      if (!next) throw new Error("closeTab failed. no remaining tab");
      await session.usePage(next);
      return { url: next.url() };
    }
    case "dialog":
      session.nextDialog = (dialog) => (step.accept ? dialog.accept(step.text) : dialog.dismiss());
      return;
    case "snapshot":
    case "styles":
    case "audit":
      return runInspect(page, step.action, step.selector ? ref(step.selector) : "", 60);
    case "viewport":
      await session.setViewport(step.width! > 0 ? viewportFor(step.width!, step.height) : null);
      return page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, touch: matchMedia("(pointer: coarse)").matches }));
    case "screenshot": {
      const path = step.filepath || join(run.dir, `${String(index).padStart(3, "0")}-screenshot.png`);
      if (locator) await locator.first().scrollIntoViewIfNeeded(t);
      const target = await measure(page, step);
      await screenshot(page, path, {
        box: target?.box,
        label: `#${index} ${step.name ?? describe(step, target)}`,
        fullPage: step.fullPage,
        crop: step.crop,
      });
      return { filepath: path };
    }
  }
}

// The humanize layer turns fill() into per-key typing with deliberate typos,
// which is right for `type` but makes `fill` as slow as it. Setting the value
// through the native setter (so React/Vue see it) and firing input/change keeps
// fill instant; anything that is not a plain field falls back to fill().
async function fastFill(locator: Locator, text: string, timeout: number): Promise<void> {
  const target = locator.first();
  await target.waitFor({ state: "visible", timeout });
  const done = await target.evaluate((el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLInputElement ? HTMLInputElement.prototype : null;
    if (!proto || (el as HTMLInputElement).readOnly || (el as HTMLInputElement).disabled) return false;
    (el as HTMLElement).focus();
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, text);
  if (!done) await target.fill(text, { timeout });
}

interface Target {
  box: Box;
  text: string;
  secret: boolean;
}

async function measure(page: Page, step: Step): Promise<Target | null> {
  if (!step.selector) return null;
  const scope = step.frame ? page.frameLocator(step.frame) : page;
  const element = scope.locator(ref(step.selector)).first();
  const box = await element.boundingBox({ timeout: 300 }).catch(() => null);
  if (!box) return null;
  // What a person would call the element, so the label reads "Nhấn "Đăng nhập""
  // rather than a selector or a snapshot ref.
  const about = await element
    .evaluate((el) => {
      const field = el as HTMLInputElement;
      const text =
        el.getAttribute("aria-label") ||
        field.labels?.[0]?.innerText.trim() ||
        (el as HTMLElement).innerText?.trim().split("\n")[0] ||
        field.placeholder ||
        el.getAttribute("title") ||
        field.name ||
        el.id ||
        el.tagName.toLowerCase();
      return { text, secret: field.type === "password" };
    }, undefined, { timeout: 300 })
    .catch(() => ({ text: step.selector!, secret: false }));
  return { box, ...about };
}

const quote = (value: string) => `"${clamp(collapse(value), 40)}"`;

const MATCH_WORDS = { includes: "chứa", equals: "bằng", regex: "khớp" } as const;

// A one-line account of the step for its evidence screenshot and the report.
function describe(step: Step, target: Target | null): string {
  const el = target ? quote(target.text) : step.selector ? quote(step.selector) : "";
  const value = target?.secret ? "\"••••\"" : quote(step.text ?? "");
  const match = MATCH_WORDS[step.match];
  switch (step.action) {
    case "navigate": return `Mở ${quote(step.url ?? "")}`;
    case "newTab": return step.url ? `Mở tab mới ${quote(step.url)}` : "Mở tab mới";
    case "reload": return "Tải lại trang";
    case "goBack": return "Quay lại trang trước";
    case "goForward": return "Đi tới trang sau";
    case "press": return `Nhấn phím ${step.key}${el ? ` tại ${el}` : ""}`;
    case "scroll": return `Cuộn trang (${step.x}, ${step.y})`;
    case "scrollToTop": return "Cuộn lên đầu trang";
    case "scrollToBottom": return "Cuộn xuống cuối trang";
    case "mouseClick": return `Nhấn chuột tại (${step.x}, ${step.y})`;
    case "wait": return `Chờ ${step.milliseconds}ms`;
    case "waitForURL": return `Chờ URL ${match} ${quote(step.url ?? "")}`;
    case "waitForResponse": return `Chờ phản hồi ${quote(step.url ?? "")}`;
    case "waitForTab": return "Chờ tab mới mở";
    case "waitForDownload": return el ? `Nhấn ${el} và chờ tải xuống` : "Chờ tải xuống";
    case "switchTab": return `Chuyển sang tab ${step.tabIndex}`;
    case "closeTab": return "Đóng tab";
    case "dialog": return step.accept ? "Đồng ý hộp thoại kế tiếp" : "Huỷ hộp thoại kế tiếp";
    case "evaluate": return "Chạy script trên trang";
    case "extractText": return `Đọc nội dung ${el || "trang"}`;
    case "extractHtml": return `Đọc HTML ${el}`;
    case "extractAttribute": return `Đọc ${step.attribute} của ${el}`;
    case "assertUrl": return `Kiểm tra URL ${match} ${quote(step.text ?? step.url ?? "")}`;
    case "assertNotVisible": return `Kiểm tra ${el} không hiển thị`;
    case "assertNoErrors": return "Kiểm tra không có lỗi console hoặc request";
    case "click": return `Nhấn ${el}`;
    case "dblclick": return `Nhấn đúp ${el}`;
    case "rightClick": return `Nhấn chuột phải ${el}`;
    case "hover": return `Rê chuột lên ${el}`;
    case "focus": return `Chọn ${el}`;
    case "clear": return `Xoá nội dung ${el}`;
    case "check": return `Tích ${el}`;
    case "uncheck": return `Bỏ tích ${el}`;
    case "type":
    case "fill": return `Nhập ${value} vào ${el}`;
    case "selectOption": return `Chọn ${quote(step.selectedValue ?? "")} ở ${el}`;
    case "upload": return `Tải lên ${(step.files ?? []).map((file) => basename(file)).join(", ")}`;
    case "drag": return `Kéo ${el} đến ${quote(step.target ?? "")}`;
    case "draw": return `Vẽ qua ${step.points?.length ?? 0} điểm`;
    case "waitForSelector": return `Chờ ${el} hiển thị`;
    case "assertVisible": return `Kiểm tra ${el} hiển thị`;
    // The element's own text is the value under test, so it cannot name it.
    case "assertText": return `Kiểm tra nội dung ${step.selector ? quote(step.selector) : "trang"} ${match} ${value}`;
    case "assertValue": return `Kiểm tra giá trị ${el} ${match} ${value}`;
    case "assertAttribute": return `Kiểm tra ${step.attribute} của ${el} ${match} ${value}`;
    case "assertChecked": return `Kiểm tra ${el} ${step.checked ? "đã tích" : "chưa tích"}`;
    case "assertCount": return `Kiểm tra có ${step.count} phần tử ${quote(step.selector ?? "")}`;
    case "screenshot": return el ? `Chụp ${el}` : "Chụp màn hình";
    default: return step.action;
  }
}

export async function runBrowserFlow(steps: Step[], stopOnError: boolean, sessionId: string | undefined, evidence: EvidenceMode) {
  const root = await getSession(sessionId);
  const run = await startRun(root, steps.length);
  try {
    return await runSteps(steps, stopOnError, root, run, evidence);
  } finally {
    finishRun(run.evidenceDir, run.id);
  }
}

async function runSteps(steps: Step[], stopOnError: boolean, root: Session, run: FlowRun, evidence: EvidenceMode) {
  const flowStart = Date.now();
  const variables: Record<string, unknown> = {};
  const results: Array<Record<string, unknown>> = [];
  let failureShot: string | undefined;
  let failedStep: number | undefined;
  let session = root;
  let prior: Prior = { t: flowStart, pages: new Set(root.context.pages()) };

  for (const [index, rawStep] of steps.entries()) {
    const step = interpolateStep(rawStep, variables);
    const started = Date.now();
    const record: StepRecord = { i: index, action: step.action, name: step.name, session: "", target: step.selector, ok: true, t: started, ms: 0, url: "" };
    setRunCurrent(run.evidenceDir, run.id, index, step.name ?? describe(step, null));

    try {
      session = step.session ? await getSession(step.session) : root;
      record.session = session.id;
      const page = await session.activePage();
      const before: Prior = { t: started, pages: new Set(session.context.pages()) };
      await session.syncConsole();
      let target: Target | null = null;
      if (evidence === "steps" && BOX_BEFORE.has(step.action)) target = await measure(page, step);
      record.label = step.name ?? describe(step, target);

      // The flow holds only its own session; a step in another one takes that
      // session's lock for just the step, so two flows crossing each other
      // stall for one lock wait at most, not for each other's whole run.
      const value = session === root
        ? await runStep(step, session, run, index, flowStart, prior)
        : await exclusive(session.id, () => runStep(step, session, run, index, flowStart, prior));
      prior = before;
      if (step.action === "screenshot") record.shot = (value as { filepath?: string } | undefined)?.filepath;

      if (evidence === "steps" && !NO_SHOT.has(step.action)) {
        const current = await session.activePage();
        if (!target && BOX_AFTER.has(step.action)) {
          target = await measure(current, step);
          record.label = step.name ?? describe(step, target);
        }
        record.shot = await screenshot(current, shotPath(run, index, step.action, session.id, false), {
          box: target?.box,
          label: `#${index} ${record.label}`,
          kind: BOX_AFTER.has(step.action) ? "assert" : "action",
        }).catch(() => undefined);
      }

      if (step.variable) variables[step.variable] = clampValue(value, step.maxLength);

      // Echoing back what the step itself said (clicked selector, scroll
      // offsets, ...) is pure token cost: `ok` already confirms it ran, and a
      // stored value is reported once through `variables`.
      const keepValue = VERBOSE_ACTIONS.has(step.action) && !step.variable && value !== undefined;
      results.push({
        i: index,
        action: step.action,
        ok: true,
        ...(step.name ? { name: step.name } : {}),
        ...(keepValue ? { value: clampValue(value, step.maxLength) } : {}),
      });
    } catch (err) {
      const error = shortError(err);
      record.ok = false;
      record.error = error;
      record.session ||= step.session ?? root.id;
      if (evidence !== "off") {
        const page = await session.activePage().catch(() => null);
        if (page) {
          const target = await measure(page, step);
          record.label = step.name ?? describe(step, target);
          record.shot = await screenshot(page, shotPath(run, index, step.action, session.id, true), {
            box: target?.box,
            label: `#${index} LỖI · ${record.label}`,
            kind: "fail",
          }).catch(() => undefined);
          failureShot ??= record.shot;
        }
      }
      results.push({ i: index, action: step.action, ok: false, ...(step.name ? { name: step.name } : {}), error });
      if (!step.continueOnError && stopOnError) failedStep = index;
    } finally {
      await session.syncConsole().catch(() => {});
      record.ms = Date.now() - started;
      record.url = session.page.isClosed() ? "" : session.page.url();
      recordStep(run, record);
    }
    if (failedStep !== undefined) break;
  }

  // Steps that neither failed, carried a value, nor were named add nothing the
  // caller cannot read off its own request, so they are counted, not listed.
  const passed = results.filter((result) => result.ok === true).length;
  const notable = results.filter((result) => result.ok !== true || "value" in result || "name" in result);
  const page = await root.activePage();
  if (session !== root) await root.syncConsole();
  const errors = passed < results.length ? errorsSince(root, flowStart).slice(-5) : [];
  return {
    success: failedStep === undefined && passed === results.length,
    steps: `${passed}/${results.length}`,
    ...(failedStep !== undefined ? { failedStep } : {}),
    ...(notable.length ? { results: notable } : {}),
    ...(Object.keys(variables).length ? { variables } : {}),
    ...(errors.length ? { pageErrors: errors } : {}),
    ...(evidence !== "off" && run.steps.some((step) => step.shot) ? { evidence: run.dir } : {}),
    ...(failureShot ? { failureShot } : {}),
    url: page.url(),
    title: await page.title(),
  };
}
