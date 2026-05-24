# MCP Simple Browser

An MCP (Model Context Protocol) server that provides browser automation tools powered by CloakBrowser.

## Features

- **Headless Browser**: Automatically launches a stealth browser via CloakBrowser

## Quick Start

### Claude Code / Claude Desktop

```bash
claude mcp add simple-browser npx @solvvn/mcp-simple-browser
```

Or add manually to your Claude Desktop config:

```json
{
  "mcpServers": {
    "simple-browser": {
      "command": "npx",
      "args": ["-y", "@solvvn/mcp-simple-browser@latest"]
    }
  }
}
```

### Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.simple-browser]
command = "npx"
args = ["-y", "@solvvn/mcp-simple-browser@latest"]
```

### Global Installation

```bash
npm install -g @solvvn/mcp-simple-browser
mcp-simple-browser
```

## Installation (Manual)

```bash
npm install
# or
yarn install
```

## Usage

### As MCP Server

```bash
# Development
yarn dev

# Production
yarn build
yarn start
```

The server runs on stdio and can be connected to any MCP-compatible client (Claude Desktop, etc.).

### Claude Desktop Configuration

Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "simple-browser": {
      "command": "node",
      "args": ["/path/to/mcp-simple-browser/dist/index.js"]
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL and wait for it to load |
| `browser_save_screenshot` | Take a screenshot and save to file |
| `browser_click` | Click an element by CSS selector |
| `browser_type` | Type text into an input field |
| `browser_get_content` | Get HTML content of the page |
| `browser_get_text` | Get text content from page or element |
| `browser_evaluate` | Execute JavaScript in page context |
| `browser_search` | Search the web (Google, DuckDuckGo, Bing) |
| `browser_wait` | Wait for specified milliseconds |
| `browser_print_to_pdf` | Print page to PDF |
| `browser_close` | Close browser and cleanup |

## Examples

### Navigate and Screenshot

```javascript
// Navigate to a page
await browser_navigate({ url: "https://example.com" })

// Take screenshot
await browser_screenshot({ fullPage: true })
```

### Search

```javascript
// Search with default engine (DuckDuckGo)
await browser_search({ query: "TypeScript MCP" })

// Search with specific engine
await browser_search({ query: "CloakBrowser", engine: "google" })
```

### Interact with Elements

```javascript
// Type in search box
await browser_type({ selector: "input[name='q']", text: "hello" })

// Click a button
await browser_click({ selector: "button[type='submit']" })
```

## Development

```bash
# Type check
yarn typecheck

# Build
yarn build
```

## License

MIT
