#!/usr/bin/env node
import * as dotenv from "dotenv";
dotenv.config();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

const INSTRUCTIONS = `This server controls a single stateful browser session.

TOOL SELECTION — read before choosing a tool:
- PREFER browser_run_flow for ANY task with 2 or more browser steps. It runs an ordered list of actions in ONE call, sharing the same page, with variable passing (\${var}), assertions, iframe scoping, multi-tab control and network waits. This is the primary tool for navigation, form filling, scraping, and automation tests.
- Do NOT chain the single-action tools (browser_navigate, browser_click, browser_type, ...) for a multi-step task. One tool call per step is slower, loses result-passing between steps, and is the wrong default. Use single-action tools ONLY for a genuine one-off action or quick interactive inspection.
- For automation tests, build the whole scenario as one browser_run_flow with assert* steps and stopOnError: true.

The browser persists across calls until browser_close. Set visibility with browser_set_headless (false shows the window).`;

async function main() {
  const server = new McpServer(
    { name: "simple-browser", version: "1.0.0" },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server);
  console.error("SimpleBrowser MCP Server running on stdio");
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
