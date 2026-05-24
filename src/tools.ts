import { z } from "zod";
import { writeFile } from "fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { closeBrowser, getPage } from "./browser.js";

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

const tools = [
  createTool({
    name: "browser_navigate",
    description: "Go to a URL. Use this first to load a webpage before taking actions. Supports any HTTP/HTTPS URL.",
    schema: {
      url: z.string().describe("Full URL including https:// (e.g., https://example.com)"),
      waitUntil: z
        .enum(["load", "domcontentloaded", "networkidle", "commit"])
        .default("networkidle")
        .describe("When to consider navigation complete: networkidle (recommended) waits for all requests to finish"),
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
