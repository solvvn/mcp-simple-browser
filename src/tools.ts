import { z } from "zod";
import { writeFile } from "fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { closeBrowser, getPage, setPage, setHeadless, isHeadless, pressKey, scrollPage, scrollToTop, scrollToBottom, hoverElement, goBack, goForward, reload } from "./browser.js";

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

const SearchEngines = {
  google: (q: string) => `https://www.google.com/search?q=${q}`,
  duckduckgo: (q: string) => `https://duckduckgo.com/?q=${q}`,
  bing: (q: string) => `https://www.bing.com/search?q=${q}`,
} as const;

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
      ])
      .describe("Action to execute in the current browser session"),
    name: z.string().optional().describe("Optional label for easier debugging"),
    selector: z.string().optional().describe("CSS selector used by the action. Supports ${var} interpolation from prior steps"),
    frame: z.string().optional().describe("Optional CSS selector of an <iframe> to scope this action inside. Supports ${var}"),
    url: z.string().optional().describe("Target URL for navigate, or URL pattern for waitForURL/waitForResponse. Supports ${var}"),
    text: z.string().optional().describe("Input text or expected text depending on action. Supports ${var} interpolation"),
    key: z.string().optional().describe("Keyboard key for press"),
    milliseconds: z.number().optional().describe("Delay in milliseconds for wait"),
    delay: z.number().default(50).describe("Delay between keystrokes for type"),
    timeout: z.number().default(5000).describe("Timeout in milliseconds"),
    waitUntil: waitUntilSchema.describe("Navigation wait strategy"),
    fullPage: z.boolean().default(false).describe("Capture full page for screenshot"),
    filepath: z.string().optional().describe("Absolute path for saved screenshot. Supports ${var}"),
    x: z.number().default(0).describe("Horizontal scroll amount"),
    y: z.number().default(0).describe("Vertical scroll amount"),
    script: z.string().optional().describe("JavaScript to run inside browser context. Supports ${var}"),
    variable: z.string().optional().describe("Store the step result under this key for use as ${key} in later steps"),
    attribute: z.string().optional().describe("Attribute name for extractAttribute or assertAttribute"),
    count: z.number().optional().describe("Expected number of matching elements for assertCount"),
    checked: z.boolean().optional().describe("Expected checked state for assertChecked"),
    tabIndex: z.number().optional().describe("Zero-based tab index for switchTab"),
    match: z
      .enum(["equals", "includes", "regex"])
      .default("includes")
      .describe("Comparison mode for assertText/assertUrl/assertAttribute/assertValue/waitForURL/waitForResponse"),
    selectedValue: z.string().optional().describe("Value to select for selectOption. Supports ${var}"),
    continueOnError: z.boolean().default(false).describe("Continue even if this step fails (soft assertion)"),
  })
  .superRefine((step, ctx) => {
    const requireField = (field: keyof typeof step, message: string) => {
      if (step[field] === undefined || step[field] === "") {
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
        requireField("text", "text is required for assertText");
        break;
      case "assertUrl":
        requireField("text", "text is required for assertUrl");
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
        requireField("text", "text is required for assertAttribute");
        break;
      case "assertValue":
        requireField("selector", "selector is required for assertValue");
        requireField("text", "text is required for assertValue");
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
      default:
        break;
    }
  });

function createStepLabel(step: z.infer<typeof automationStepSchema>, index: number): string {
  return step.name || `${index + 1}:${step.action}`;
}

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
    const label = createStepLabel(step, index);

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
          await page.press("body", step.key!);
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
        case "extractText": {
          const target = locator ?? scope.locator("body");
          value = (await target.textContent({ timeout: step.timeout })) ?? "";
          break;
        }
        case "extractHtml":
          value = await locator!.innerHTML({ timeout: step.timeout });
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
          setPage(page);
          value = { tabIndex: step.tabIndex, url: page.url() };
          break;
        }
        case "waitForTab": {
          const target = await page.context().waitForEvent("page", { timeout: step.timeout });
          await target.waitForLoadState(toLoadState(step.waitUntil), { timeout: step.timeout }).catch(() => {});
          page = target;
          await page.bringToFront();
          setPage(page);
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
          setPage(page);
          value = { closed: true, url: page.url() };
          break;
        }
        case "evaluate":
          value = await page.evaluate(step.script!);
          break;
        case "screenshot": {
          const buffer = await page.screenshot({ fullPage: step.fullPage });
          await writeFile(step.filepath!, buffer);
          value = { filepath: step.filepath, size: buffer.length };
          break;
        }
      }

      if (step.variable) {
        variables[step.variable] = value;
      }

      results.push({
        index,
        name: label,
        action: step.action,
        ok: true,
        value,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({
        index,
        name: label,
        action: step.action,
        ok: false,
        error,
      });

      if (step.continueOnError) {
        continue;
      }

      if (stopOnError) {
        return {
          success: false,
          failedStep: index,
          error,
          results,
          variables,
          currentUrl: page.url(),
          title: await page.title(),
        };
      }
    }
  }

  return {
    success: results.every((result) => result.ok === true),
    results,
    variables,
    currentUrl: page.url(),
    title: await page.title(),
  };
}

const tools = [
  createTool({
    name: "browser_set_headless",
    description: "Set whether browser runs in headless mode. Use true for automation/testing, false to see the browser window.",
    schema: {
      headless: z.boolean().describe("true = headless (no visible window), false = show browser window"),
    },
    handler: async ({ headless }) => {
      const restarted = await setHeadless(headless);
      return success({ headless, current: isHeadless(), restarted });
    },
  }),
  createTool({
    name: "browser_navigate",
    description: "Go to a URL (single one-off action). Supports any HTTP/HTTPS URL. If the task has further steps after loading, prefer browser_run_flow instead of chaining single actions.",
    schema: {
      url: z.string().describe("Full URL including https:// (e.g., https://example.com)"),
      waitUntil: waitUntilSchema.describe("When to consider navigation complete: networkidle (recommended) waits for all requests to finish"),
    },
    handler: async ({ url, waitUntil }) => {
      const page = await getPage();
      await page.goto(url, { waitUntil });
      return success({ url: page.url(), title: await page.title() });
    },
  }),
  createTool({
    name: "browser_click",
    description: "Click a button, link, or any element (single one-off action). Requires the element's CSS selector. For a multi-step interaction, prefer browser_run_flow.",
    schema: {
      selector: z.string().describe("CSS selector of the element to click (e.g., button, a, #id, .class)"),
    },
    handler: async ({ selector }) => {
      await (await getPage()).click(selector);
      return success({});
    },
  }),
  createTool({
    name: "browser_type",
    description: "Type text into an input field or text area (single one-off action). For filling a form with multiple fields, prefer browser_run_flow.",
    schema: {
      selector: z.string().describe("CSS selector of the input field (e.g., input, textarea, #search)"),
      text: z.string().describe("Text to type"),
      delay: z.number().default(50).describe("Delay between keystrokes in milliseconds (default: 50)"),
    },
    handler: async ({ selector, text, delay }) => {
      await (await getPage()).type(selector, text, { delay });
      return success({});
    },
  }),
  createTool({
    name: "browser_get_content",
    description: "Get the raw HTML source of the current page. Use when you need the full HTML structure for scraping or analysis.",
    schema: {},
    handler: async () => ({ html: await (await getPage()).content() }),
  }),
  createTool({
    name: "browser_get_text",
    description: "Extract visible text from the page or a specific element. Use for reading content like article text, prices, or descriptions.",
    schema: {
      selector: z.string().optional().describe("CSS selector to extract text from specific element. Defaults to entire page."),
    },
    handler: async ({ selector }) => {
      const el = selector || "body";
      const text = await (await getPage()).$eval(el, (el: HTMLElement) => el.textContent);
      return { text: text ?? "" };
    },
  }),
  createTool({
    name: "browser_evaluate",
    description: "Run custom JavaScript in the page context. Use for complex interactions, data extraction, or DOM manipulation that other tools can't handle.",
    schema: {
      script: z.string().describe("JavaScript code to execute. Can return values. Runs in browser context (window, document available)."),
    },
    handler: async ({ script }) => ({ result: await (await getPage()).evaluate(script) }),
  }),
  createTool({
    name: "browser_search",
    description: "Search the web and get ranked results with titles, URLs, and snippets. Good for research, finding pages, or checking information.",
    schema: {
      query: z.string().describe("Search query/keywords"),
      engine: z.enum(["google", "duckduckgo", "bing"]).default("duckduckgo").describe("Search engine to use: duckduckgo (default, no tracking), google (more results), bing (alternative)"),
    },
    handler: async ({ query, engine }) => {
      const page = await getPage();
      const searchUrl = SearchEngines[engine](encodeURIComponent(query));
      await page.goto(searchUrl, { waitUntil: "networkidle" });

      const results = await page.evaluate(() => {
        const out: Array<{ title: string; url: string; snippet: string }> = [];
        const selectors = ["div.g a[href^='http']", "div[data-srg] a[href^='http']", ".result a[href^='http']"];

        for (const sel of selectors) {
          document.querySelectorAll<HTMLAnchorElement>(sel).forEach((a) => {
            if (!a.href || /google|bing|duckduckgo/.test(a.href)) return;
            const titleEl = a.querySelector("h3") || a;
            out.push({
              title: titleEl.textContent?.trim() ?? "",
              url: a.href,
              snippet: a.textContent?.trim() ?? "",
            });
          });
          if (out.length) break;
        }
        return out.slice(0, 10);
      });

      return success({ engine, query, results });
    },
  }),
  createTool({
    name: "browser_wait",
    description: "Pause execution for a specified time. Use when you need to wait for page animations, lazy loading, or after clicking something that triggers async updates.",
    schema: {
      milliseconds: z.number().describe("Time to wait in milliseconds (e.g., 1000 = 1 second)"),
    },
    handler: async ({ milliseconds }) => {
      await new Promise((resolve) => setTimeout(resolve, milliseconds));
      return success({ waited: milliseconds });
    },
  }),
  createTool({
    name: "browser_close",
    description: "Close the browser and free up resources. Call this when you're done with browser operations to clean up.",
    schema: {},
    handler: async () => {
      await closeBrowser();
      return success({});
    },
  }),
  createTool({
    name: "browser_save_screenshot",
    description: "Take a screenshot of the current page and save to a file. Use to capture visual state, verify page content, or create records.",
    schema: {
      filepath: z.string().describe("Full path where to save the image (e.g., /tmp/screenshot.png)"),
      fullPage: z.boolean().default(false).describe("true = capture entire scrollable page, false = only visible viewport"),
    },
    handler: async ({ filepath, fullPage }) => {
      const buffer = await (await getPage()).screenshot({ fullPage });
      await writeFile(filepath, buffer);
      return success({ filepath, size: buffer.length });
    },
  }),
  createTool({
    name: "browser_print_to_pdf",
    description: "Save the current page as a PDF document. Useful for archiving pages, generating reports, or preserving content in printable format.",
    schema: {
      filepath: z.string().describe("Full path where to save the PDF (e.g., /tmp/page.pdf)"),
      landscape: z.boolean().default(false).describe("true = landscape orientation, false = portrait"),
      printBackground: z.boolean().default(true).describe("true = include background colors/images, false = white background only"),
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
    name: "browser_press",
    description: "Press a keyboard key. Use for Enter, Tab, Escape, Arrow keys, etc.",
    schema: {
      key: z.string().describe("Key to press: Enter, Tab, Escape, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Backspace, Delete, etc."),
    },
    handler: async ({ key }) => {
      await pressKey(key);
      return success({ key });
    },
  }),
  createTool({
    name: "browser_scroll",
    description: "Scroll the page by x/y pixels. Positive values scroll down/right, negative scroll up/left.",
    schema: {
      x: z.number().default(0).describe("Horizontal scroll amount in pixels (positive = right, negative = left)"),
      y: z.number().describe("Vertical scroll amount in pixels (positive = down, negative = up)"),
    },
    handler: async ({ x, y }) => {
      await scrollPage(x, y);
      return success({ x, y });
    },
  }),
  createTool({
    name: "browser_scroll_to_top",
    description: "Scroll to the top of the page.",
    schema: {},
    handler: async () => {
      await scrollToTop();
      return success({});
    },
  }),
  createTool({
    name: "browser_scroll_to_bottom",
    description: "Scroll to the bottom of the page.",
    schema: {},
    handler: async () => {
      await scrollToBottom();
      return success({});
    },
  }),
  createTool({
    name: "browser_hover",
    description: "Hover over an element. Useful for dropdowns, tooltips, and menus that appear on hover.",
    schema: {
      selector: z.string().describe("CSS selector of the element to hover over"),
    },
    handler: async ({ selector }) => {
      await hoverElement(selector);
      return success({});
    },
  }),
  createTool({
    name: "browser_go_back",
    description: "Navigate back to the previous page in browser history.",
    schema: {},
    handler: async () => {
      await goBack();
      return success({});
    },
  }),
  createTool({
    name: "browser_go_forward",
    description: "Navigate forward in browser history.",
    schema: {},
    handler: async () => {
      await goForward();
      return success({});
    },
  }),
  createTool({
    name: "browser_reload",
    description: "Reload the current page.",
    schema: {},
    handler: async () => {
      await reload();
      return success({});
    },
  }),
  createTool({
    name: "browser_run_flow",
    description: "PREFERRED tool for ANY browser task with 2+ steps — use this instead of chaining single-action tools. Runs an ordered list of actions in ONE call on the same page: navigation, form filling, scraping, extraction, assertions, screenshots, and automation tests. Supports ${var} interpolation between steps (store with `variable`, reuse in any string field), iframe scoping via `frame`, multi-tab control (switchTab/waitForTab/closeTab), network waits (waitForURL/waitForResponse), and assertions (assertText/assertVisible/assertNotVisible/assertUrl/assertCount/assertAttribute/assertValue/assertChecked). For tests, set stopOnError: true.",
    schema: {
      steps: z.array(automationStepSchema).min(1).describe("Ordered list of browser actions to run in a single multi-step workflow"),
      stopOnError: z.boolean().default(true).describe("Stop immediately when a step fails. Recommended for tests or strict workflows."),
    },
    handler: async ({ steps, stopOnError }) => runBrowserFlow(steps, stopOnError),
  }),
  createTool({
    name: "browser_run_automation",
    description: "Backward-compatible alias for browser_run_flow. Use browser_run_flow for new integrations and general multi-step browser workflows.",
    schema: {
      steps: z.array(automationStepSchema).min(1).describe("Ordered list of browser actions to run in a single multi-step workflow"),
      stopOnError: z.boolean().default(true).describe("Stop immediately when a step fails. Recommended for tests or strict workflows."),
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
          return toResult(
            { error: err instanceof Error ? err.message : String(err) },
            true,
          );
        }
      },
    );
  }
}
