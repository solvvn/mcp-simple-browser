#!/usr/bin/env node
import * as dotenv from "dotenv";
dotenv.config();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

const INSTRUCTIONS = `One stateful browser session, kept alive until browser_close.

Use browser_run_flow for any task of 2+ steps: it runs the whole sequence in one call on the same page, with \${var} passing, iframe scoping, tabs, network waits and assertions. Chaining the single-action tools instead is slower and costs far more tokens — reserve them for a genuine one-off.

Scope and cap what you read back: pass a selector to browser_get_text (cheaper than browser_get_content), and lower maxLength when you only need a fragment.

To see a page, use browser_inspect, not a screenshot: mode snapshot lists the interactive elements and stamps each with a data-ref you can click as [data-ref="e5"], mode audit reports contrast, overflow, clipped text, covered controls and broken images, mode styles gives computed style and geometry. All three cost a fraction of an image and state exact numbers. Screenshot only when the question is genuinely visual - aesthetics, imagery, animation.`;

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
