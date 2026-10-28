#!/usr/bin/env node
import * as dotenv from "dotenv";
dotenv.config();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

const INSTRUCTIONS = `Stateful browser sessions, kept alive until closed. Every tool takes an optional \`session\` id: each id is an isolated browser (own cookies, storage and fingerprint), opened on first use, so two users of the same site are just session "alice" and session "bob". browser_session open sets isolation, a persistent profile, saved login state, proxy, video/HAR, or attaches to a running Chrome via cdpUrl.

Evidence is automatic: browser_run_flow screenshots every state-changing step with the target outlined and the cursor drawn, and returns the folder; a failing tool returns failureShot. browser_evidence report turns a session's flows into report.html; traceStart/traceStop records a Playwright trace. Video only when asked, via browser_session open video:true.

For DevTools work use browser_devtools (console, network log, response bodies, Web Vitals, raw CDP), browser_emulate (throttling, offline, geolocation, dark mode), browser_mock (stub or fail API calls) and browser_storage (cookies, localStorage, save a login).

Use browser_run_flow for any task of 2+ steps: it runs the whole sequence in one call on the same page, with \${var} passing, iframe scoping, tabs, network waits and assertions. Chaining the single-action tools instead is slower and costs far more tokens — reserve them for a genuine one-off.

Scope and cap what you read back: pass a selector to browser_get_text (cheaper than browser_get_content), and lower maxLength when you only need a fragment.

To see a page, use browser_inspect, not a screenshot: mode snapshot lists the interactive elements and stamps each with a data-ref that any selector field accepts as e5, mode audit reports contrast, overflow, clipped text, covered controls and broken images, mode styles gives computed style and geometry. All three cost a fraction of an image and state exact numbers. Screenshot only when the question is genuinely visual - aesthetics, imagery, animation.`;

async function main() {
  const server = new McpServer(
    { name: "simple-browser", version: "1.0.0" },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server);
  console.error("SimpleBrowser MCP Server running on stdio");
  await server.connect(new StdioServerTransport());
  // The client closing stdin is the end of the session; an open CDP socket
  // would otherwise keep this process, and its browsers, alive.
  process.stdin.once("close", () => process.exit(0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
