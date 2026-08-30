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
| `browser_set_viewport` | Resize the page to a CSS-pixel width to check a breakpoint |
| `browser_save_screenshot` | Take a screenshot and save to file |
| `browser_click` | Click an element by CSS selector |
| `browser_type` | Type text into an input field |
| `browser_get_content` | Get page HTML, scripts/styles/comments stripped |
| `browser_get_text` | Get text content from page or element |
| `browser_inspect` | Read the UI as text: snapshot, styles, or audit |
| `browser_evaluate` | Execute JavaScript in page context |
| `browser_search` | Search the web (Google, DuckDuckGo, Bing) |
| `browser_print_to_pdf` | Print page to PDF |
| `browser_go_back` | Navigate back in browser history |
| `browser_go_forward` | Navigate forward in browser history |
| `browser_reload` | Reload the current page |
| `browser_run_flow` | Run a complete multi-step browser workflow in one call |
| `browser_close` | Close browser and cleanup |

## Seeing the Page Without a Screenshot

`browser_inspect` describes the interface as text. It is far cheaper than an
image and states exact numbers a screenshot can only imply.

### `mode: "snapshot"` — what is on the page and what can be acted on

```
h1 Sign in to GitHub
--
e1 input:text "Username or email address"
e2 input:password "Password"
e4 input:submit "Sign in"
e7 a "Create an account"
```

Each listed element is stamped with `data-ref` in the DOM, so the next step acts
on it through an ordinary CSS selector — no new selector syntax:

```javascript
await browser_run_flow({
  steps: [
    { action: "navigate", url: "https://github.com/login" },
    { action: "snapshot", variable: "ui" },
    { action: "type", selector: "[data-ref='e1']", text: "octocat" },
    { action: "click", selector: "[data-ref='e4']" }
  ]
})
```

Refs are re-assigned on every snapshot and wiped by navigation or a framework
re-render, so snapshot again after the page changes.

### `mode: "audit"` — what is visually broken

```
contrast div.hero: 1.43:1 below 4.5 (rgb(207, 207, 207))
covered button.btn: obscured by div.overlay
tap-target button.tiny: 14x14px under 24x24
clipped div.clip: content 346px in a 120px box
broken-img /missing.png
overflow-x: page is 1700px wide vs viewport 1440px
```

It reports WCAG contrast ratios, horizontal overflow, text clipped by its box,
controls covered by another element, targets under 24x24, and broken images. A
control hidden behind a nearly transparent overlay is invisible in a screenshot
but caught here.

### `widths` — the same audit at every breakpoint

```
browser_inspect { mode: "audit", widths: [320, 360, 390, 768, 1024, 1440] }
```

```
[all] contrast p.faint: 1.92:1 below 4.5 (rgb(187, 187, 187))
[all] tap-target button.tiny: 20x20px under 24x24
[320] overflow-x: page is 416px wide vs viewport 320px
[320] offscreen div.wide: 96px past the right edge
[360] overflow-x: page is 416px wide vs viewport 360px
[360] offscreen div.wide: 56px past the right edge
```

Each width is measured in turn and every line is tagged with where it occurs, so
`[all]` separates what is always broken from what only breaks on a phone. The
viewport in force before the call is restored afterwards.

It works for `snapshot` too, which answers a different question — what the layout
hides at each size:

```
[all]  a "Home"
[1440] a "Pricing"          (hidden under 800px)
[1440] a "Tooltip menu"     (hover-only, gone at touch widths)
```

### `mode: "styles"` — how an element is actually rendered

```
button.btn [200x44 @20,86] display:block; position:absolute; padding:1px 6px;
  color:rgb(255, 255, 255); backgroundColor:rgb(0, 102, 204); fontSize:13.33px
```

### Cost, measured

| Page | Raw HTML | Screenshot 1440x900 | `browser_inspect` |
|---|---|---|---|
| github.com/login | ~15,400 tok | ~1,730 tok | 120 tok (snapshot) / 57 tok (audit) |
| wikipedia.org | ~29,800 tok | ~1,730 tok | ~300 tok (snapshot) |

### When you still need a screenshot

Aesthetic judgement, imagery and icon content, animation and transitional
states, and anything drawn in canvas, WebGL or video. `browser_inspect` measures
the interface; it does not look at it.

## Responsive Widths

`browser_set_viewport` sets the CSS-pixel width the page lays out at. It sticks
across navigation, new tabs and headless toggles until reset with `width: 0`.

```
browser_set_viewport { width: 360 }              // 360x844, touch emulated
browser_set_viewport { width: 1440 }             // 1440x900
browser_set_viewport { width: 390, scale: 3 }    // devicePixelRatio 3
browser_set_viewport { width: 0 }                // back to the window size
```

Width at or below 768 also turns on touch emulation, so `pointer: coarse` and
`hover: none` match and hover-only affordances disappear the way they do on a
phone. Pass `mobile` to decide that explicitly.

The layout viewport is pinned to the width you ask for and is not handed to the
page's meta viewport tag. That matters: with mobile emulation on, Chrome widens
the viewport to fit content that overflows, which hides the overflow instead of
reporting it. Here a 400px block at 360px wide is a measured 56px overhang.

Inside a flow, `viewport` is a step:

```json
{ "steps": [
  { "action": "viewport", "width": 390 },
  { "action": "audit" },
  { "action": "viewport", "width": 1440 },
  { "action": "audit" },
  { "action": "viewport", "width": 0 }
] }
```

## Token Efficiency

The server is tuned to keep responses small, since browser output is usually the
largest thing an agent reads:

- `browser_get_content` strips `<script>`, `<style>`, comments and inline SVG,
  and collapses whitespace. Pass `selector` to scope it, `maxLength` to cap it
  (default 20000 chars), or `raw: true` for the untouched HTML.
- `browser_get_text` collapses whitespace and takes the same `maxLength`. Prefer
  it over `browser_get_content` when only the wording matters.
- `browser_evaluate` caps its return value with `maxLength` too.
- `browser_run_flow` reports passing steps as a `steps: "9/9"` count instead of
  echoing every step back. A step is listed individually only when it fails, is
  given a `name`, or returns data. Use `variable` (or an `extract*` step) for
  anything you need in the response; per-step output is capped by `maxLength`
  (default 2000 chars).
- `browser_inspect` replaces most screenshots, at a fraction of the tokens.
- Errors are shortened: Playwright's multi-line `Call log:` tail is dropped and
  the message is capped at 300 chars.
- Actions that only ever appear mid-sequence — `wait`, `press`, `hover`,
  `scroll`, `scrollToTop`, `scrollToBottom` — exist as `browser_run_flow` steps
  only. Inside a flow they cost nothing extra, whereas a dedicated tool would
  charge its schema every session whether used or not.

## Examples

### Navigate and Screenshot

```javascript
// Navigate to a page
await browser_navigate({ url: "https://example.com" })

// Take screenshot
await browser_save_screenshot({ filepath: "/tmp/shot.png", fullPage: true })
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
- `goBack`
- `goForward`
- `reload`
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
- `snapshot`
- `styles`
- `audit`
- `viewport`

### Flow result shape

```json
{
  "success": true,
  "steps": "9/9",
  "results": [{ "i": 7, "action": "extractText", "ok": true, "value": "..." }],
  "variables": { "link": "https://example.com/x" },
  "url": "https://example.com/x",
  "title": "Example"
}
```

`results` and `variables` are omitted when empty; `failedStep` is added when a
step fails.

### Variable interpolation between steps

Store any step result with `variable`, then reference it as `${name}` (or `${name.path}` for nested values) in any string field of later steps: `selector`, `frame`, `url`, `text`, `key`, `script`, `attribute`, `selectedValue`, `filepath`.

Add `maxLength` to any `extract*` or `evaluate` step to cap how much of its
result is returned (default 2000 chars).

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

## Migration to 2.0

Six single-action tools and the `browser_run_automation` alias were removed
because every one of them duplicated a `browser_run_flow` action while costing
schema tokens in every session. Replace them with a flow step:

| Removed tool | Replacement |
|---|---|
| `browser_wait` | `{ action: "wait", milliseconds: 500 }` |
| `browser_press` | `{ action: "press", key: "Enter" }` |
| `browser_hover` | `{ action: "hover", selector: "..." }` |
| `browser_scroll` | `{ action: "scroll", y: 400 }` |
| `browser_scroll_to_top` | `{ action: "scrollToTop" }` |
| `browser_scroll_to_bottom` | `{ action: "scrollToBottom" }` |
| `browser_run_automation` | `browser_run_flow` (identical arguments) |

`goBack`, `goForward` and `reload` were added as flow actions so a flow no
longer has to break out to a single-action tool.

### Fixed in 2.0

`browser_click`, `browser_type`, `browser_hover`, `browser_press` and the flow's
`press` action used Playwright's legacy `page.<action>(selector)` APIs, which
fail a `pointer_events check` on ordinary pages under CloakBrowser's `humanize`
mode — they were unusable in 1.2.x. They now use the locator and keyboard APIs.

`browser_search` returned an empty list on every engine: its selectors
(`div.g`, `div[data-srg]`, `.result`) no longer match any current SERP, and the
filter that dropped engine-domain URLs also dropped every Bing and Google
result, since both wrap targets in their own redirector. Each engine now has its
own result, title and snippet selectors, and Bing's base64 redirect is decoded
back to the real URL. DuckDuckGo and Bing return direct URLs; Google hands back
its `/goto?url=...` redirect, which resolves correctly when navigated but is not
readable — prefer DuckDuckGo (the default) when the URL itself matters.

`assertValue`, `assertText`, `assertUrl` and `assertAttribute` rejected an empty
expected value, so a flow could not assert that a field is blank. An empty
string is now accepted for assertions only; `type` still requires real text.
