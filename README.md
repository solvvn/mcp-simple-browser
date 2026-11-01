# MCP Simple Browser

An MCP (Model Context Protocol) server that provides browser automation tools powered by CloakBrowser.

## Features

- **Stealth browser**: CloakBrowser with human-like mouse curves and typing
- **Multiple sessions**: one isolated browser per test user, driven from one flow
- **Evidence by default**: a screenshot of every step with the target outlined and the cursor drawn, an HTML report, Playwright traces, video and HAR on request
- **Chrome DevTools**: console, network log with response bodies, Web Vitals, raw CDP, throttling, mocks, cookies and storage
- **Attach to your own Chrome** over the DevTools port, logins included

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
| `browser_close` | Close every session and browser |
| `browser_session` | Open, list, switch and close isolated sessions; attach to a running Chrome |
| `browser_evidence` | HTML report of a session's flows, Playwright trace start/stop |
| `browser_devtools` | Console, network log, response bodies, performance, raw CDP |
| `browser_emulate` | Network/CPU throttling, offline, geolocation, dark mode, timezone, UA |
| `browser_mock` | Stub, delay or fail requests by glob or regex |
| `browser_storage` | Cookies, localStorage/sessionStorage, save a login state |

Every tool except `browser_session`, `browser_close` and `browser_set_headless`
takes an optional `session`.

## Sessions

A session is an isolated browser: own cookies, storage and fingerprint. Naming
one is enough to start it, so two users of a chat or a checkout are one flow:

```json
{ "steps": [
  { "action": "navigate", "session": "alice", "url": "https://app.test/login" },
  { "action": "fill", "session": "alice", "selector": "#email", "text": "alice@test.io" },
  { "action": "click", "session": "alice", "selector": "button[type=submit]" },
  { "action": "navigate", "session": "bob", "url": "https://app.test/login" },
  { "action": "fill", "session": "bob", "selector": "#email", "text": "bob@test.io" },
  { "action": "click", "session": "bob", "selector": "button[type=submit]" },
  { "action": "fill", "session": "alice", "selector": "#message", "text": "hi bob" },
  { "action": "press", "session": "alice", "key": "Enter" },
  { "action": "assertText", "session": "bob", "selector": ".chat", "text": "hi bob", "timeout": 10000 }
] }
```

Open one explicitly for anything beyond the defaults:

```
browser_session { action: "open", id: "admin", headless: false, video: true }
browser_session { action: "open", id: "load", isolation: "context" }      // shared process, cheap
browser_session { action: "open", id: "me", userDataDir: "/tmp/profile" }  // persistent profile
browser_session { action: "open", id: "u1", storageState: "/tmp/u1.json" } // skip the login
browser_session { action: "open", id: "vpn", proxy: "http://user:pass@host:8080", locale: "vi-VN", timezone: "Asia/Ho_Chi_Minh" }
browser_session { action: "list" }
browser_session { action: "use", id: "admin" }    // make it the default for later calls
browser_session { action: "close", id: "admin" }  // returns the video/HAR paths
```

`isolation: "browser"` (default) launches a process per session; `"context"`
shares one process per headless mode and only separates cookies and storage.

### Watching without losing focus

Input goes to the page over the DevTools protocol, never through the OS, so
your own mouse and keyboard are never touched. On macOS a headed browser is
also launched in the background: its windows appear, but opening them, popups
and tab switches never take focus from the app you are working in. Set
`BROWSER_ALLOW_FOCUS=1` to launch it in the foreground instead.

### Attach to your own Chrome

Start Chrome with a debugging port and a separate profile (Chrome 136+ refuses
the port on the default profile), log in by hand, then attach:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-e2e"
```

```
browser_session { action: "open", id: "real", cdpUrl: "http://127.0.0.1:9222" }
```

Closing that session only detaches; your Chrome and its tabs stay open.

## Dashboard

While the server runs it also serves a small web page at
**http://127.0.0.1:9330/** (the URL is printed on stderr and returned by
`browser_session { action: "list" }` as `ui`).

- **Session**: every open session with a live screenshot, its tabs (click to
  switch), request and console-error counts, and recording state. Open a new
  session, navigate, go back, reload, make one the default, write its report,
  or close it.
- **Assets**: the evidence folders under `BROWSER_EVIDENCE_DIR`, newest first,
  with step screenshots grouped per run, failed steps marked, filters by type
  and name, and a viewer for images, videos, PDFs and `report.html`. Download,
  copy the path, delete a file or a closed session's folder, or prune all
  closed folders older than N days. Files the tools saved elsewhere
  (`filepath` outside the evidence dir, PDFs, downloads, storage state) are
  listed under their own entry.

| Variable | Effect |
|---|---|
| `BROWSER_UI=0` | Do not start the dashboard |
| `BROWSER_UI_PORT=9400` | First port to try (default 9330); a busy port moves to the next, up to 10 |

It listens on 127.0.0.1 only and has no login. Requests with a non-loopback
`Host` are refused, and anything that changes state needs an `X-MCP-UI`
header a cross-site page cannot send. It cannot delete or serve files outside
the evidence dir, apart from the files the tools saved in this process.

## Evidence

Every `browser_run_flow` writes a screenshot after each state-changing step to
`/tmp/mcp-browser-evidence/<session>-<time>/run-NN/`, named by step index and
action, with the target element outlined and labelled, and the cursor, its
trail and click ripples drawn on the page. The folder comes back as `evidence`,
and a failing step adds `failureShot` and the page's recent `pageErrors`.
Override the root with `BROWSER_EVIDENCE_DIR`.

- `evidence: "failures"` on a flow shoots only failing steps, `"off"` none.
- A failing single-action tool returns `failureShot` too.
- `browser_evidence { action: "report" }` writes `report.html`: each flow as a
  grid of step shots with pass/fail, timing and errors, plus console errors and
  failed requests.
- `browser_evidence { action: "traceStart" }` / `"traceStop"` records a
  Playwright trace; open it with `npx playwright show-trace <file>`.
- Video and HAR are recorded only when asked: `browser_session open` with
  `video: true` or `har: true`; the files are returned on close.

Pass `cursor: false` at open to keep the overlay off a site that inspects its DOM.

## Mouse

`type` types like a person (per-key timing, the occasional corrected typo),
which is what you want on camera. `fill` sets the value at once and fires
`input`/`change`, which is what you want in a test.

```json
{ "steps": [
  { "action": "drag", "selector": ".card:first-child", "target": ".column.done" },
  { "action": "draw", "selector": "canvas#signature", "points": [{"x":10,"y":40},{"x":60,"y":10},{"x":120,"y":50}] },
  { "action": "mouseMove", "x": 400, "y": 300 },
  { "action": "mouseClick", "x": 640, "y": 120 },
  { "action": "dblclick", "selector": ".cell" },
  { "action": "rightClick", "selector": ".file" }
] }
```

`draw` points are relative to the selector's box, or the viewport without one.

## DevTools

```
browser_devtools { action: "console", level: "error" }
browser_devtools { action: "network", status: "error", type: "fetch" }
  #14 POST 500 fetch 212ms https://app.test/api/order
browser_devtools { action: "response", id: 14 }          // request + response headers and body
browser_devtools { action: "performance" }               // TTFB, FCP, LCP, CLS, long tasks, heap, DOM size
browser_devtools { action: "cdp", method: "Network.getCookies" }

browser_emulate { network: "slow-3g", cpu: 4 }           // network: none resets, cpu: 1 resets
browser_emulate { network: "offline" }
browser_emulate { geolocation: { latitude: 21.03, longitude: 105.85 }, colorScheme: "dark" }

browser_mock { action: "add", url: "**/api/cart", json: { items: [] } }
browser_mock { action: "add", url: "/\\/api\\/pay/", status: 502, delay: 3000 }
browser_mock { action: "add", url: "**/analytics/**", abort: true }
browser_mock { action: "clear" }

browser_storage { action: "save", filepath: "/tmp/alice.json" }  // reuse via storageState
browser_storage { action: "cookies", domain: "app.test" }
```

Dialogs (`alert`, `confirm`, `prompt`) are accepted by default and logged to the
console log; a `dialog` step with `accept: false` dismisses the next one.

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
- `newTab`, `fill`, `dblclick`, `rightClick`, `upload` (`files`), `drag` (`target`)
- `mouseMove`, `mouseClick`, `mouseDown`, `mouseUp`, `draw` (`points`)
- `dialog` (`accept`, `text` for a prompt), `waitForDownload` (clicks `selector`, saves the file)
- `assertNoErrors`: fails on console errors, uncaught exceptions, 5xx or failed requests since the flow began; `text` is a regex of lines to ignore

Any `selector` also accepts a bare snapshot ref such as `e5`. A step's
`session` runs it in that session.

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

## Releasing

`.github/workflows/publish.yml` publishes to npm with provenance:

- **From GitHub**: Actions → *Publish to npm* → *Run workflow* on `main`, pick
  `patch`, `minor` or `major`. It bumps `package.json`, pushes the `x.y.z`
  commit and `vX.Y.Z` tag, then publishes.
- **From a terminal**: `npm version minor && git push --follow-tags`; the tag
  triggers the publish.

Authentication is npm trusted publishing: on npmjs.com, package *Settings* →
*Trusted Publisher* → GitHub Actions, organization `solvvn`, repository
`mcp-simple-browser`, workflow `publish.yml`. No token is needed. An
`NPM_TOKEN` repository secret (an npm automation token) works as a fallback.

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
