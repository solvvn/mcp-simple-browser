import { z } from "zod";
import { writeFile } from "fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { closeBrowser, getPage, setHeadless, isHeadless, pressKey, scrollPage, scrollToTop, scrollToBottom, hoverElement, goBack, goForward, reload } from "./browser.js";

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
        "hover",
        "scroll",
        "scrollToTop",
        "scrollToBottom",
        "extractText",
        "extractHtml",
        "extractAttribute",
        "assertText",
        "assertVisible",
        "assertUrl",
        "evaluate",
        "screenshot",
      ])
      .describe("Action to execute in the current browser session"),
    name: z.string().optional().describe("Optional label for easier debugging"),
    selector: z.string().optional().describe("CSS selector used by the action"),
    url: z.string().optional().describe("Target URL for navigate"),
    text: z.string().optional().describe("Input text or expected text depending on action"),
    key: z.string().optional().describe("Keyboard key for press"),
    milliseconds: z.number().optional().describe("Delay in milliseconds for wait"),
    delay: z.number().default(50).describe("Delay between keystrokes for type"),
    timeout: z.number().default(5000).describe("Timeout in milliseconds"),
    waitUntil: waitUntilSchema.describe("Navigation wait strategy"),
    fullPage: z.boolean().default(false).describe("Capture full page for screenshot"),
    filepath: z.string().optional().describe("Absolute path for saved screenshot"),
    x: z.number().default(0).describe("Horizontal scroll amount"),
    y: z.number().default(0).describe("Vertical scroll amount"),
    script: z.string().optional().describe("JavaScript to run inside browser context"),
    variable: z.string().optional().describe("Store the step result under this key"),
    attribute: z.string().optional().describe("Attribute name for extractAttribute"),
    match: z
      .enum(["equals", "includes", "regex"])
      .default("includes")
      .describe("Comparison mode for assertText or assertUrl"),
    selectedValue: z.string().optional().describe("Value to select for selectOption"),
    continueOnError: z.boolean().default(false).describe("Continue even if this step fails"),
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

function toLoadState(waitUntil: z.infer<typeof waitUntilSchema>): "load" | "domcontentloaded" | "networkidle" {
  return waitUntil === "commit" ? "domcontentloaded" : waitUntil;
}

async function runBrowserFlow(
  steps: Array<z.infer<typeof automationStepSchema>>,
  stopOnError: boolean,
) {
  const page = await getPage();
  const variables: Record<string, unknown> = {};
  const results: Array<Record<string, unknown>> = [];

  for (const [index, step] of steps.entries()) {
    const label = createStepLabel(step, index);

    try {
      let value: unknown = null;

      switch (step.action) {
        case "navigate":
          await page.goto(step.url!, { waitUntil: step.waitUntil });
          value = { url: page.url(), title: await page.title() };
          break;
        case "click":
          await page.click(step.selector!);
          value = { clicked: step.selector };
          break;
        case "type":
          await page.type(step.selector!, step.text!, { delay: step.delay });
          value = { typed: step.selector, length: step.text!.length };
          break;
        case "clear":
          await page.locator(step.selector!).clear();
          value = { cleared: step.selector };
          break;
        case "focus":
          await page.focus(step.selector!);
          value = { focused: step.selector };
          break;
        case "selectOption": {
          const selected = await page.selectOption(step.selector!, step.selectedValue!);
          value = { selector: step.selector, selected };
          break;
        }
        case "check":
          await page.check(step.selector!);
          value = { checked: step.selector };
          break;
        case "uncheck":
          await page.uncheck(step.selector!);
          value = { unchecked: step.selector };
          break;
        case "press":
          await pressKey(step.key!);
          value = { key: step.key };
          break;
        case "wait":
          await new Promise((resolve) => setTimeout(resolve, step.milliseconds));
          value = { waited: step.milliseconds };
          break;
        case "waitForSelector":
          await page.waitForSelector(step.selector!, { timeout: step.timeout });
          value = { selector: step.selector, visible: true };
          break;
        case "waitForNavigation":
          await page.waitForLoadState(toLoadState(step.waitUntil), { timeout: step.timeout });
          value = { state: toLoadState(step.waitUntil) };
          break;
        case "hover":
          await hoverElement(step.selector!);
          value = { hovered: step.selector };
          break;
        case "scroll":
          await scrollPage(step.x, step.y);
          value = { x: step.x, y: step.y };
          break;
        case "scrollToTop":
          await scrollToTop();
          value = { position: "top" };
          break;
        case "scrollToBottom":
          await scrollToBottom();
          value = { position: "bottom" };
          break;
        case "extractText": {
          const selector = step.selector || "body";
          const text = await page.$eval(selector, (el: HTMLElement) => el.textContent ?? "");
          value = text;
          break;
        }
        case "extractHtml": {
          const html = await page.$eval(step.selector!, (el: HTMLElement) => el.innerHTML);
          value = html;
          break;
        }
        case "extractAttribute": {
          const attribute = await page.$eval(
            step.selector!,
            (el: HTMLElement, name: string) => el.getAttribute(name),
            step.attribute!,
          );
          value = attribute;
          break;
        }
        case "assertText": {
          const selector = step.selector || "body";
          const actual = await page.$eval(selector, (el: HTMLElement) => el.textContent ?? "");
          if (!textMatches(actual, step.text!, step.match)) {
            throw new Error(`assertText failed at ${selector}. expected ${step.match} "${step.text}" but got "${actual}"`);
          }
          value = { selector, matched: true, match: step.match };
          break;
        }
        case "assertVisible":
          await page.waitForSelector(step.selector!, { timeout: step.timeout });
          value = { selector: step.selector, visible: true };
          break;
        case "assertUrl": {
          const actual = page.url();
          if (!textMatches(actual, step.text!, step.match)) {
            throw new Error(`assertUrl failed. expected ${step.match} "${step.text}" but got "${actual}"`);
          }
          value = { url: actual, matched: true, match: step.match };
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
      setHeadless(headless);
      return success({ headless, current: isHeadless() });
    },
  }),
  createTool({
    name: "browser_navigate",
    description: "Go to a URL. Use this first to load a webpage before taking actions. Supports any HTTP/HTTPS URL.",
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
    description: "Click a button, link, or any element. Use after navigating to a page. Requires knowing the element's CSS selector.",
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
    description: "Type text into an input field or text area. Use for filling forms, search boxes, or any text input.",
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
    description: "Run multiple browser actions in sequence in a single call. Best for multi-step workflows like navigation, form filling, scraping, extraction, assertions, screenshots, and general browser automation.",
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
