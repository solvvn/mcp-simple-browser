import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { Browser, Page } from "puppeteer-core";
import { launch } from "cloakbrowser/puppeteer";

const browser: { instance: Browser | null; page: Page | null } = {
  instance: null,
  page: null,
};

async function getBrowser(): Promise<Browser> {
  if (!browser.instance) {
    browser.instance = await launch({ headless: true });
  }
  return browser.instance;
}

async function getPage(): Promise<Page> {
  if (!browser.page) {
    const b = await getBrowser();
    browser.page = await b.newPage();
  }
  return browser.page;
}

async function closeBrowser(): Promise<void> {
  if (browser.page) {
    await browser.page.close();
    browser.page = null;
  }
  if (browser.instance) {
    await browser.instance.close();
    browser.instance = null;
  }
}

const tools: Tool[] = [
  {
    name: "browser_navigate",
    description:
      "Navigate to a URL. Opens the page and waits for it to load.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to navigate to",
        },
        waitUntil: {
          type: "string",
          description:
            "When to consider navigation complete. Options: load, domcontentloaded, networkidle0, networkidle2",
          default: "networkidle2",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_screenshot",
    description: "Take a screenshot of the current page",
    inputSchema: {
      type: "object",
      properties: {
        fullPage: {
          type: "boolean",
          description: "Capture full scrollable page",
          default: false,
        },
      },
    },
  },
  {
    name: "browser_click",
    description: "Click an element by CSS selector",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the element to click",
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "browser_type",
    description: "Type text into an input field",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the input field",
        },
        text: {
          type: "string",
          description: "Text to type",
        },
        delay: {
          type: "number",
          description: "Delay between keystrokes in ms",
          default: 50,
        },
      },
      required: ["selector", "text"],
    },
  },
  {
    name: "browser_get_content",
    description: "Get the HTML content of the page",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "browser_get_text",
    description: "Get text content from the page or element",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector (optional, gets from element or body)",
        },
      },
    },
  },
  {
    name: "browser_evaluate",
    description: "Execute JavaScript in the page context",
    inputSchema: {
      type: "object",
      properties: {
        script: {
          type: "string",
          description: "JavaScript code to execute",
        },
      },
      required: ["script"],
    },
  },
  {
    name: "browser_search",
    description: "Search the web using a search engine",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        engine: {
          type: "string",
          description: "Search engine to use",
          enum: ["google", "duckduckgo", "bing"],
          default: "duckduckgo",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "browser_wait",
    description: "Wait for a specified time",
    inputSchema: {
      type: "object",
      properties: {
        milliseconds: {
          type: "number",
          description: "Time to wait in milliseconds",
        },
      },
      required: ["milliseconds"],
    },
  },
  {
    name: "browser_close",
    description: "Close the browser and clean up resources",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

const server = new Server(
  {
    name: "cloak-browser",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "browser_navigate": {
        const page = await getPage();
        const url = args?.url as string;
        const waitUntil = (args?.waitUntil as string) || "networkidle2";
        await page.goto(url, { waitUntil: waitUntil as any });
        const title = await page.title();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                url: page.url(),
                title,
              }),
            },
          ],
        };
      }

      case "browser_screenshot": {
        const page = await getPage();
        const fullPage = (args?.fullPage as boolean) || false;
        const screenshot = await page.screenshot({
          fullPage,
          encoding: "base64",
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                format: "png",
                data: screenshot,
              }),
            },
          ],
        };
      }

      case "browser_click": {
        const page = await getPage();
        const selector = args?.selector as string;
        await page.click(selector);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true }),
            },
          ],
        };
      }

      case "browser_type": {
        const page = await getPage();
        const selector = args?.selector as string;
        const text = args?.text as string;
        const delay = (args?.delay as number) || 50;
        await page.type(selector, text, { delay });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true }),
            },
          ],
        };
      }

      case "browser_get_content": {
        const page = await getPage();
        const content = await page.content();
        return {
          content: [
            {
              type: "text",
              text: content,
            },
          ],
        };
      }

      case "browser_get_text": {
        const page = await getPage();
        let text: string;
        if (args?.selector) {
          text = (await page.$eval(args.selector as string, (el) => el.textContent)) || "";
        } else {
          text = (await page.$eval("body", (el) => el.textContent)) || "";
        }
        return {
          content: [
            {
              type: "text",
              text,
            },
          ],
        };
      }

      case "browser_evaluate": {
        const page = await getPage();
        const script = args?.script as string;
        const result = await page.evaluate(script);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        };
      }

      case "browser_search": {
        const page = await getPage();
        const query = encodeURIComponent(args?.query as string);
        const engine = (args?.engine as string) || "duckduckgo";

        const searchUrls: Record<string, string> = {
          google: `https://www.google.com/search?q=${query}`,
          duckduckgo: `https://duckduckgo.com/?q=${query}`,
          bing: `https://www.bing.com/search?q=${query}`,
        };

        const url = searchUrls[engine];
        await page.goto(url, { waitUntil: "networkidle2" });

        // Get search results
        const results = await page.evaluate(() => {
          const items: Array<{ title: string; url: string; snippet: string }> = [];
          const selectors = [
            'div.g a[href^="http"]',
            'div[data-srg] a[href^="http"]',
            '.result a[href^="http"]',
          ];

          for (const selector of selectors) {
            const elements = (globalThis as any).document.querySelectorAll(selector);
            elements.forEach((el: Element) => {
              const anchor = el as HTMLAnchorElement;
              if (anchor.href && !anchor.href.includes("google") && !anchor.href.includes("bing") && !anchor.href.includes("duckduckgo")) {
                const titleEl = el.querySelector("h3") || el;
                items.push({
                  title: titleEl.textContent?.trim() || "",
                  url: anchor.href,
                  snippet: el.textContent?.trim() || "",
                });
              }
            });
            if (items.length > 0) break;
          }
          return items.slice(0, 10);
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                engine,
                query: args?.query,
                results,
              }),
            },
          ],
        };
      }

      case "browser_wait": {
        const ms = args?.milliseconds as number;
        await new Promise((resolve) => setTimeout(resolve, ms));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, waited: ms }),
            },
          ],
        };
      }

      case "browser_close": {
        await closeBrowser();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true }),
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `Unknown tool: ${name}` }),
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("CloakBrowser MCP Server running on stdio");
}

main().catch(console.error);
