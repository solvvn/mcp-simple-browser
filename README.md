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
| `browser_press` | Press a keyboard key |
| `browser_scroll` | Scroll page by pixel offset |
| `browser_scroll_to_top` | Scroll to the top of the page |
| `browser_scroll_to_bottom` | Scroll to the bottom of the page |
| `browser_hover` | Hover over an element |
| `browser_go_back` | Navigate back in browser history |
| `browser_go_forward` | Navigate forward in browser history |
| `browser_reload` | Reload the current page |
| `browser_run_flow` | Run a complete multi-step browser workflow in one call |
| `browser_run_automation` | Backward-compatible alias of `browser_run_flow` |
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

### One-call Browser Workflow

```javascript
await browser_run_flow({
  steps: [
    { action: "navigate", url: "https://example.com/login" },
    { action: "waitForSelector", selector: "form" },
    { action: "type", selector: "input[name='email']", text: "demo@example.com" },
    { action: "type", selector: "input[name='password']", text: "secret123" },
    { action: "click", selector: "button[type='submit']" },
    { action: "assertVisible", selector: ".dashboard", timeout: 10000 },
    { action: "assertText", selector: "body", text: "Welcome", match: "includes" },
    { action: "extractText", selector: ".dashboard h1", variable: "heading" },
    { action: "screenshot", filepath: "/tmp/login-success.png", fullPage: true }
  ]
})
```

Supported `action` values:

- `navigate`
- `click`
- `type`
- `clear`
- `focus`
- `selectOption`
- `check`
- `uncheck`
- `press`
- `wait`
- `waitForSelector`
- `waitForNavigation`
- `hover`
- `scroll`
- `scrollToTop`
- `scrollToBottom`
- `waitForURL`
- `waitForResponse`
- `extractText`
- `extractHtml`
- `extractAttribute`
- `assertText`
- `assertVisible`
- `assertNotVisible`
- `assertUrl`
- `assertCount`
- `assertAttribute`
- `assertValue`
- `assertChecked`
- `switchTab`
- `waitForTab`
- `closeTab`
- `evaluate`
- `screenshot`

### Variable interpolation between steps

Store any step result with `variable`, then reference it as `${name}` (or `${name.path}` for nested values) in any string field of later steps: `selector`, `frame`, `url`, `text`, `key`, `script`, `attribute`, `selectedValue`, `filepath`.

```javascript
await browser_run_flow({
  steps: [
    { action: "navigate", url: "https://example.com" },
    { action: "extractAttribute", selector: ".item a", attribute: "href", variable: "link" },
    { action: "navigate", url: "${link}" },
    { action: "assertUrl", text: "${link}", match: "includes" }
  ]
})
```

### iframe, tabs and network waits

```javascript
await browser_run_flow({
  steps: [
    { action: "navigate", url: "https://example.com" },
    // Scope an action inside an <iframe> with `frame`
    { action: "click", frame: "iframe#payment", selector: "button.pay" },
    // Wait for a new tab/popup and switch to it
    { action: "waitForTab", timeout: 10000 },
    // Wait for a specific network response
    { action: "waitForResponse", url: "/api/checkout", match: "includes" },
    // Switch between open tabs by index, or close the current one
    { action: "switchTab", tabIndex: 0 },
    { action: "closeTab" }
  ]
})
```

### Extended assertions

```javascript
await browser_run_flow({
  steps: [
    { action: "navigate", url: "https://example.com/cart" },
    { action: "assertCount", selector: ".cart-item", count: 3 },
    { action: "assertValue", selector: "#coupon", text: "SAVE10", match: "equals" },
    { action: "assertChecked", selector: "#agree", checked: true },
    { action: "assertAttribute", selector: ".badge", attribute: "data-status", text: "active" },
    { action: "assertNotVisible", selector: ".loading-spinner" },
    { action: "waitForURL", url: "/checkout", match: "includes" }
  ]
})
```

### Example: Scraping in One Call

```javascript
await browser_run_flow({
  steps: [
    { action: "navigate", url: "https://example.com/products" },
    { action: "waitForSelector", selector: ".product-card" },
    { action: "extractText", selector: "h1", variable: "pageTitle" },
    { action: "extractAttribute", selector: ".product-card a", attribute: "href", variable: "firstProductUrl" },
    { action: "screenshot", filepath: "/tmp/products.png", fullPage: true }
  ]
})
```

### Example: Form Flow in One Call

```javascript
await browser_run_flow({
  steps: [
    { action: "navigate", url: "https://example.com/signup" },
    { action: "type", selector: "#name", text: "Jane Doe" },
    { action: "type", selector: "#email", text: "jane@example.com" },
    { action: "selectOption", selector: "#country", selectedValue: "us" },
    { action: "check", selector: "#terms" },
    { action: "click", selector: "button[type='submit']" },
    { action: "waitForNavigation", waitUntil: "networkidle", timeout: 10000 },
    { action: "assertUrl", text: "/welcome", match: "includes" }
  ]
})
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
