#!/usr/bin/env node
import * as dotenv from "dotenv";
dotenv.config();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

async function main() {
  const server = new McpServer({ name: "simple-browser", version: "1.0.0" });
  registerTools(server);
  console.error("SimpleBrowser MCP Server running on stdio");
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
