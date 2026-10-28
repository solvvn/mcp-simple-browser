import { z } from "zod";
import { writeFile } from "fs/promises";
import { join } from "path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  activeSessionId, closeAll, closeSession, findSession, getPage, getSession, isHeadless, listSessions, openSession,
  setHeadless, useSession,
} from "./session.js";
import { inspectWidths, runInspect, viewportFor } from "./inspect.js";
import { automationStepSchema, runBrowserFlow, waitUntilSchema } from "./flow.js";
import { screenshot, startTrace, stopTrace, writeReport } from "./evidence.js";
import { addMock, emulate, listMocks, readConsole, readNetwork, readPerformance, readResponse, removeMock, sendCdp } from "./devtools.js";
import { clamp, clampValue, collapse, compactHtml, ref, shortError } from "./util.js";

const sessionField = z.string().optional().describe("Session id. Default: the active one");

type ToolHandler<T extends z.ZodRawShape> = (args: z.infer<z.ZodObject<T>> & { session?: string }) => Promise<unknown>;

interface ToolDefinition<S extends z.ZodRawShape> {
  name: string;
  // false for tools that manage sessions themselves rather than act in one.
  sessioned?: boolean;
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

const tools = [
  createTool({
    name: "browser_set_headless",
    description: "Show or hide the browser window for new sessions; restarts the active session if it uses the default.",
    sessioned: false,
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
    handler: async ({ width, height, mobile, scale, session }) => {
      const current = await getSession(session);
      const page = await current.activePage();
      await current.setViewport(width > 0 ? viewportFor(width, height, mobile, scale) : null);
      // Report what the page actually sees, so a size the site overrides shows up.
      const actual = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
        touch: matchMedia("(pointer: coarse)").matches,
      }));
      return success({ ...actual, override: current.viewport !== null });
    },
  }),
  createTool({
    name: "browser_navigate",
    description: "Go to a URL. One-off only; for anything with further steps use browser_run_flow.",
    schema: {
      url: z.string().describe("Full URL including https://"),
      waitUntil: waitUntilSchema.describe("When navigation counts as done"),
    },
    handler: async ({ url, waitUntil, session }) => {
      const page = await getPage(session);
      await page.goto(url, { waitUntil });
      return success({ url: page.url(), title: await page.title() });
    },
  }),
  createTool({
    name: "browser_click",
    description: "Click an element. One-off only; for a multi-step interaction use browser_run_flow.",
    schema: {
      selector: z.string().describe("CSS selector or snapshot ref like e5"),
    },
    handler: async ({ selector, session }) => {
      const target = (await getPage(session)).locator(ref(selector)).first();
      await target.waitFor({ state: "attached", timeout: 5000 });
      await target.click();
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
    handler: async ({ selector, text, delay, session }) => {
      const target = (await getPage(session)).locator(ref(selector)).first();
      await target.waitFor({ state: "attached", timeout: 5000 });
      await target.pressSequentially(text, { delay });
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
    handler: async ({ selector, maxLength, raw, session }) => {
      const page = await getPage(session);
      const html = selector
        ? await page.locator(ref(selector)).first().innerHTML()
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
    handler: async ({ selector, maxLength, session }) => {
      const page = await getPage(session);
      const text = await page.locator(selector || "body").first().textContent();
      return { text: clamp(collapse(text ?? ""), maxLength) };
    },
  }),
  createTool({
    name: "browser_inspect",
    description: "Read the UI as text instead of a screenshot. snapshot: visible interactive elements, each stamped with data-ref so any selector field accepts it as e5 or [data-ref=\"e5\"]. styles: computed style and geometry. audit: contrast, overflow, clipped text, covered or undersized controls, broken images. Screenshot only for genuinely visual judgement.",
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
    handler: async ({ mode, selector, max, maxLength, widths, session }) => {
      const current = await getSession(session);
      const page = await current.activePage();
      const root = selector ? ref(selector) : "";
      const report = widths?.length
        ? await inspectWidths(current, page, mode, root, max, widths)
        : await runInspect(page, mode, root, max);
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
    handler: async ({ script, maxLength, session }) => ({
      result: clampValue(await (await getPage(session)).evaluate(script), maxLength),
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
    handler: async ({ query, engine, limit, session }) => {
      const page = await getPage(session);
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
    description: "Close every session and browser and free resources. To close just one, use browser_session.",
    sessioned: false,
    schema: {},
    handler: async () => {
      await closeAll();
      return success({});
    },
  }),
  createTool({
    name: "browser_save_screenshot",
    description: "Screenshot the page to a file. Use browser_inspect to read the UI as text; screenshot only when the judgement needs eyes.",
    schema: {
      filepath: z.string().optional().describe("Absolute path for the .png/.jpg. Default: the session's evidence dir"),
      fullPage: z.boolean().default(false).describe("Capture the whole scrollable page"),
      selector: z.string().optional().describe("Outline this element in the shot"),
    },
    handler: async ({ filepath, fullPage, selector, session }) => {
      const current = await getSession(session);
      const page = await current.activePage();
      const box = selector ? await page.locator(ref(selector)).first().boundingBox({ timeout: 2000 }) : null;
      const path = filepath || join(current.evidenceDir, `shot-${Date.now()}.png`);
      await screenshot(page, path, box, selector, fullPage);
      return success({ filepath: path });
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
    handler: async ({ filepath, landscape, printBackground, session }) => {
      const pdf = await (await getPage(session)).pdf({
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
    handler: async ({ session }) => {
      await (await getPage(session)).goBack();
      return success({});
    },
  }),
  createTool({
    name: "browser_go_forward",
    description: "Go forward in history.",
    schema: {},
    handler: async ({ session }) => {
      await (await getPage(session)).goForward();
      return success({});
    },
  }),
  createTool({
    name: "browser_reload",
    description: "Reload the current page.",
    schema: {},
    handler: async ({ session }) => {
      await (await getPage(session)).reload();
      return success({});
    },
  }),
  createTool({
    name: "browser_run_flow",
    description: "PREFERRED for ANY browser task of 2+ steps — use it instead of chaining single-action tools. Runs ordered actions in one call: navigation, forms, uploads, dialogs, downloads, mouse drag/draw, assertions, snapshot/styles/audit. It is also the only place for wait, press, hover, scroll, viewport and tab control. Open an unfamiliar page with a `snapshot` step, then act on its refs (selector \"e5\"). A step's `session` runs it in another isolated browser, so one flow can drive several users. Every string field supports ${var} from a prior step's `variable`; `frame` scopes into an iframe. A screenshot of each state-changing step lands in the returned `evidence` dir. Passing steps report only a count, so use `variable` or an extract* step for anything you need back.",
    schema: {
      steps: z.array(automationStepSchema).min(1).describe("Ordered actions to run"),
      stopOnError: z.boolean().default(true).describe("Stop at the first failing step"),
      evidence: z
        .enum(["steps", "failures", "off"])
        .default("steps")
        .describe("steps: a screenshot after every state-changing step, target outlined; failures: only on failure"),
    },
    handler: async ({ steps, stopOnError, evidence, session }) => runBrowserFlow(steps, stopOnError, session, evidence),
  }),
  createTool({
    name: "browser_session",
    description: "Manage isolated browser sessions, e.g. one per test user. open: start one (isolation browser = own process and fingerprint, context = cheap shared process, or attach to a running Chrome via cdpUrl). Any tool's `session` also auto-opens with defaults. list, use (make active), close (returns video/HAR paths).",
    sessioned: false,
    schema: {
      action: z.enum(["open", "list", "use", "close"]).describe("What to do"),
      id: z.string().optional().describe("Session id. Default: the active one"),
      isolation: z.enum(["browser", "context"]).default("browser").describe("browser: own process; context: shared process, separate cookies"),
      headless: z.boolean().optional().describe("Default: browser_set_headless setting"),
      cdpUrl: z.string().optional().describe("Attach to a running Chrome, e.g. http://127.0.0.1:9222. Closing only detaches"),
      userDataDir: z.string().optional().describe("Persistent profile dir; logins survive restarts"),
      storageState: z.string().optional().describe("Load cookies/localStorage from a file saved by browser_storage save"),
      proxy: z.string().optional().describe("http://user:pass@host:port"),
      userAgent: z.string().optional(),
      locale: z.string().optional().describe("e.g. vi-VN"),
      timezone: z.string().optional().describe("e.g. Asia/Ho_Chi_Minh"),
      colorScheme: z.enum(["light", "dark", "no-preference"]).optional(),
      humanize: z.boolean().default(true).describe("Human-like mouse curves and typing"),
      cursor: z.boolean().default(true).describe("Draw the cursor, trail and clicks on the page"),
      video: z.boolean().default(false).describe("Record video until close"),
      har: z.boolean().default(false).describe("Record a HAR file until close"),
    },
    handler: async ({ action, id, ...options }) => {
      if (action === "list") return { active: activeSessionId(), sessions: listSessions() };
      if (action === "use") {
        useSession(id ?? "default");
        return success({ active: activeSessionId() });
      }
      if (action === "close") {
        const artifacts = await closeSession(id);
        return artifacts ? success(artifacts) : { success: false, error: `no open session "${id ?? activeSessionId()}"` };
      }
      const opened = await openSession(id ?? activeSessionId(), options);
      return success({ id: opened.id, isolation: opened.isolation, headless: opened.headless, evidenceDir: opened.evidenceDir });
    },
  }),
  createTool({
    name: "browser_evidence",
    description: "Test evidence for a session. report: write report.html with every flow's step screenshots, pass/fail, console errors and failed requests. traceStart/traceStop: Playwright trace.zip (open with `npx playwright show-trace`). dir: where evidence is saved.",
    schema: {
      action: z.enum(["report", "traceStart", "traceStop", "dir"]).describe("What to do"),
    },
    handler: async ({ action, session }) => {
      const current = await getSession(session);
      if (action === "report") return success({ report: await writeReport(current) });
      if (action === "traceStart") {
        await startTrace(current);
        return success({ tracing: true });
      }
      if (action === "traceStop") return success({ trace: await stopTrace(current) });
      return { dir: current.evidenceDir };
    },
  }),
  createTool({
    name: "browser_devtools",
    description: "Chrome DevTools data for a session. console: messages and uncaught errors. network: request log (filter by url/status/type); response: headers and body of request #id from that log. performance: Web Vitals (TTFB, FCP, LCP, CLS), long tasks, heap, DOM size. cdp: send any Chrome DevTools Protocol command to the current tab.",
    schema: {
      action: z.enum(["console", "network", "response", "performance", "cdp"]).describe("What to read"),
      level: z.enum(["all", "error", "warning"]).default("all").describe("console: minimum level"),
      url: z.string().optional().describe("network: substring filter"),
      status: z.enum(["all", "failed", "error"]).default("all").describe("network: error = 4xx/5xx or failed"),
      type: z.string().optional().describe("network: resource type, e.g. xhr, fetch, document, script"),
      id: z.number().optional().describe("response: request id from the network log"),
      method: z.string().optional().describe("cdp: e.g. DOM.getDocument, Network.getCookies"),
      params: z.record(z.string(), z.unknown()).optional().describe("cdp: command params"),
      limit: z.number().default(50).describe("Max rows"),
      clear: z.boolean().default(false).describe("Clear the log after reading"),
      maxLength: z.number().default(8000).describe("Max chars returned"),
    },
    handler: async ({ action, level, url, status, type, id, method, params, limit, clear, maxLength, session }) => {
      const current = await getSession(session);
      switch (action) {
        case "console":
          return { console: clamp(readConsole(current, level, limit, clear), maxLength) };
        case "network":
          return { network: clamp(readNetwork(current, { url, status, type, limit, clear }), maxLength) };
        case "response":
          if (id === undefined) throw new Error("id is required for response");
          return readResponse(current, id, maxLength);
        case "performance":
          return readPerformance(current);
        case "cdp":
          if (!method) throw new Error("method is required for cdp");
          return { result: clampValue(await sendCdp(current, method, params), maxLength) };
      }
    },
  }),
  createTool({
    name: "browser_emulate",
    description: "Emulate conditions in the current tab: network (offline, slow-3g, fast-3g, 4g, none), CPU slowdown, geolocation, dark mode, reduced motion, timezone, user agent, extra headers. Viewport is browser_set_viewport.",
    schema: {
      network: z.enum(["none", "offline", "slow-3g", "fast-3g", "4g"]).optional().describe("none resets"),
      cpu: z.number().optional().describe("Slowdown factor, 1 resets, 4 = mid-range phone"),
      geolocation: z
        .object({ latitude: z.number(), longitude: z.number(), accuracy: z.number().optional() })
        .nullable()
        .optional()
        .describe("null clears"),
      colorScheme: z.enum(["light", "dark", "no-preference"]).optional(),
      reducedMotion: z.enum(["reduce", "no-preference"]).optional(),
      timezone: z.string().optional().describe("IANA id; empty string resets"),
      userAgent: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional().describe("Extra HTTP headers for every request"),
    },
    handler: async ({ session, ...args }) => success({ applied: await emulate(await getSession(session), args) }),
  }),
  createTool({
    name: "browser_mock",
    description: "Intercept requests in every tab of a session. add: answer a URL with a canned status/body/JSON, delay it, or abort it. url is a glob like **/api/users* or a /regex/. remove (by url) or clear all; list.",
    schema: {
      action: z.enum(["add", "remove", "clear", "list"]).describe("What to do"),
      url: z.string().optional().describe("Glob or /regex/"),
      status: z.number().optional().describe("Default 200"),
      json: z.unknown().optional().describe("JSON body; sets content-type"),
      body: z.string().optional().describe("Raw body"),
      contentType: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      abort: z.boolean().default(false).describe("Fail the request instead"),
      delay: z.number().optional().describe("Delay before answering, ms"),
      times: z.number().optional().describe("Only intercept this many times"),
    },
    handler: async ({ action, session, ...rule }) => {
      const current = await getSession(session);
      if (action === "list") return { mocks: listMocks(current) };
      if (action === "clear") return success({ mocks: await removeMock(current) });
      if (!rule.url) throw new Error(`url is required for ${action}`);
      if (action === "remove") return success({ mocks: await removeMock(current, rule.url) });
      return success({ mocks: await addMock(current, { ...rule, url: rule.url }) });
    },
  }),
  createTool({
    name: "browser_storage",
    description: "Cookies and web storage. cookies: list (filter by domain); setCookies; clearCookies; local/session: read localStorage/sessionStorage of the current origin; setLocal: write keys; save: write cookies+storage to a file that browser_session open storageState can load to skip a login.",
    schema: {
      action: z.enum(["cookies", "setCookies", "clearCookies", "local", "session", "setLocal", "save"]).describe("What to do"),
      domain: z.string().optional().describe("cookies: substring filter"),
      cookies: z
        .array(z.object({ name: z.string(), value: z.string(), domain: z.string().optional(), path: z.string().optional(), url: z.string().optional(), httpOnly: z.boolean().optional(), secure: z.boolean().optional() }))
        .optional()
        .describe("setCookies: each needs url, or domain+path"),
      values: z.record(z.string(), z.string()).optional().describe("setLocal: key/value pairs"),
      filepath: z.string().optional().describe("save: target .json. Default: the evidence dir"),
    },
    handler: async ({ action, domain, cookies, values, filepath, session }) => {
      const current = await getSession(session);
      const page = await current.activePage();
      switch (action) {
        case "cookies": {
          const all = await current.context.cookies();
          return { cookies: all.filter((c) => !domain || c.domain.includes(domain)).map(({ name, value, domain, path, expires, httpOnly, secure }) => ({ name, value: clamp(value, 200), domain, path, expires, httpOnly, secure })) };
        }
        case "setCookies":
          if (!cookies?.length) throw new Error("cookies is required for setCookies");
          await current.context.addCookies(cookies);
          return success({ added: cookies.length });
        case "clearCookies":
          await current.context.clearCookies(domain ? { domain: new RegExp(domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) } : undefined);
          return success({});
        case "local":
        case "session":
          return { origin: new URL(page.url()).origin, [action]: await page.evaluate((kind) => ({ ...(kind === "local" ? localStorage : sessionStorage) }), action) };
        case "setLocal":
          if (!values) throw new Error("values is required for setLocal");
          await page.evaluate((entries) => entries.forEach(([k, v]) => localStorage.setItem(k, v)), Object.entries(values));
          return success({ set: Object.keys(values).length });
        case "save": {
          const path = filepath || join(current.evidenceDir, "storage-state.json");
          await current.context.storageState({ path });
          return success({ filepath: path });
        }
      }
    },
  }),
];

function toResult(value: unknown, isError = false): CallToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return { content: [{ type: "text", text }], ...(isError && { isError }) };
}

// A single-action tool that fails leaves the page in the state that explains
// the failure; capture it before the next call changes it.
async function failureShot(name: string, args: { session?: string }) {
  const current = findSession(args.session);
  if (!current || name === "browser_run_flow" || current.page.isClosed()) return {};
  const path = join(current.evidenceDir, `${name}-FAILED-${Date.now()}.jpg`);
  return screenshot(current.page, path).then((shot) => ({ failureShot: shot }), () => ({}));
}

export function registerTools(server: McpServer): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.sessioned === false ? tool.schema : { ...tool.schema, session: sessionField },
      },
      async (args) => {
        try {
          return toResult(await tool.handler(args as never));
        } catch (err) {
          return toResult({ error: shortError(err), ...(await failureShot(tool.name, args)) }, true);
        }
      },
    );
  }
}
