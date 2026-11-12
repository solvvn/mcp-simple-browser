// Both scripts run as context init scripts, so they are serialized and must be
// self-contained: no imports, no closures over module scope.

export type MarkKind = "action" | "assert" | "fail";

export interface CaptionFace {
  data: string;
  weight: string;
  unicodeRange: string;
}

declare global {
  interface Window {
    __mcpOverlay?: {
      highlight(rect: { x: number; y: number; width: number; height: number }, label?: string, kind?: MarkKind): void;
      caption(text: string, detail: string, kind?: MarkKind): void;
      fontReady(): boolean;
      loadFont(faces: CaptionFace[]): Promise<void>;
      clear(): void;
    };
    __mcpVitals?: { lcp: number; cls: number; longTasks: number; longTaskMs: number };
    __mcpConsole?: { drain(): Array<{ t: number; type: string; text: string; url?: string }> };
  }
}

// A visible cursor with a fading trail and click ripples, drawn in a closed
// shadow root that ignores pointer events. Real CDP input reaches the page as
// ordinary mouse events, so listening to them is enough to follow every move,
// including the humanized Bezier paths.
export function overlayScript(): void {
  if (window !== window.top || window.__mcpOverlay) return;

  const host = document.createElement("mcp-overlay");
  host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>
    canvas{position:fixed;inset:0;pointer-events:none}
    .cursor{position:fixed;left:0;top:0;width:24px;height:24px;margin:-2px 0 0 -3px;transform-origin:3px 2px;pointer-events:none;overflow:visible;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.4));display:none}
    .ripple{position:fixed;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;border:2px solid rgba(255,45,85,.9);background:rgba(255,45,85,.18);box-sizing:border-box;pointer-events:none;animation:r .55s cubic-bezier(.2,.7,.3,1) forwards}
    .mark{position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:2px solid #ff2d55;background:rgba(255,45,85,.2);box-sizing:border-box;pointer-events:none}
    .mark::after{content:"";position:absolute;inset:5px;border-radius:50%;background:#ff2d55;box-shadow:0 0 0 1.5px #fff}
    .box{--c:47,111,235;position:fixed;border:2px solid rgb(var(--c));background:rgba(var(--c),.07);border-radius:4px;pointer-events:none;box-sizing:border-box}
    .box.assert{--c:26,127,55}
    .box.fail{--c:207,34,46}
    .tag{position:absolute;left:-2px;bottom:100%;max-width:520px;overflow:hidden;text-overflow:ellipsis;background:rgb(var(--c));color:#fff;font:600 12px/18px "mcp-caption",system-ui,sans-serif;font-feature-settings:"calt" 0;padding:0 6px;border-radius:4px 4px 0 0;white-space:nowrap}
    .tag.below{bottom:auto;top:100%;border-radius:0 0 4px 4px}
    .cap{--c:47,111,235;position:fixed;left:0;right:0;bottom:0;background:rgba(17,20,24,.88);border-top:3px solid rgb(var(--c));color:#fff;padding:6px 12px 7px;font:600 14px/1.4 "mcp-caption",system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif;font-feature-settings:"calt" 0}
    .cap.assert{--c:26,127,55}
    .cap.fail{--c:207,34,46}
    .cap small{display:block;font-weight:400;font-size:12px;color:rgba(255,255,255,.72);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    @keyframes r{from{transform:scale(.2);opacity:1}to{transform:scale(1.5);opacity:0}}
  </style><canvas></canvas><svg class="cursor" viewBox="0 0 24 24"><path d="M3 2v17.5l4.6-4.1 3 6.6 3-1.3-3-6.5h6.2z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  const canvas = root.querySelector("canvas")!;
  const cursor = root.querySelector<SVGElement>(".cursor")!;
  const ctx = canvas.getContext("2d")!;
  const trail: Array<{ x: number; y: number; t: number }> = [];
  const TRAIL_MS = 700;
  const TRAIL_WIDTH = 6;
  let drawing = false;
  let down = false;
  let x = 0;
  let y = 0;

  const mount = () => {
    if (!host.isConnected) document.documentElement.appendChild(host);
  };
  const resize = () => {
    canvas.width = innerWidth * devicePixelRatio;
    canvas.height = innerHeight * devicePixelRatio;
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
  };

  // The trail is one filled ribbon rather than a stroke per segment: stroked
  // translucent segments overlap at every joint and leave visible beads.
  const ribbon = (side: Array<{ x: number; y: number }>) => {
    ctx.lineTo(side[0].x, side[0].y);
    for (let i = 1; i < side.length - 1; i++) {
      ctx.quadraticCurveTo(side[i].x, side[i].y, (side[i].x + side[i + 1].x) / 2, (side[i].y + side[i + 1].y) / 2);
    }
    ctx.lineTo(side[side.length - 1].x, side[side.length - 1].y);
  };

  const frame = () => {
    const now = performance.now();
    while (trail.length && now - trail[0].t > TRAIL_MS) trail.shift();
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const n = trail.length;
    if (n > 1) {
      const left: Array<{ x: number; y: number }> = [];
      const right: Array<{ x: number; y: number }> = [];
      let nx = 0;
      let ny = 0;
      for (let i = 0; i < n; i++) {
        const a = trail[Math.max(0, i - 1)];
        const b = trail[Math.min(n - 1, i + 1)];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len > 0) {
          nx = -(b.y - a.y) / len;
          ny = (b.x - a.x) / len;
        }
        const age = Math.min(1, Math.max(0, (now - trail[i].t) / TRAIL_MS));
        const half = (TRAIL_WIDTH / 2) * (i / (n - 1)) * (1 - age);
        left.push({ x: trail[i].x + nx * half, y: trail[i].y + ny * half });
        right.push({ x: trail[i].x - nx * half, y: trail[i].y - ny * half });
      }
      const tail = trail[0];
      const head = trail[n - 1];
      const gradient = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
      gradient.addColorStop(0, "rgba(255,45,85,0)");
      gradient.addColorStop(1, "rgba(255,45,85,.7)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ribbon(left);
      ribbon(right.reverse());
      ctx.closePath();
      ctx.fill();
    }
    drawing = n > 0;
    if (drawing) requestAnimationFrame(frame);
  };

  const place = () => {
    cursor.style.transform = `translate(${x}px,${y}px) scale(${down ? 0.85 : 1})`;
  };

  addEventListener("mousemove", (e) => {
    mount();
    cursor.style.display = "block";
    x = e.clientX;
    y = e.clientY;
    place();
    // While a button is held the trail is kept longer, so a drag or a drawn
    // stroke stays readable in the screenshot taken right after it.
    const t = performance.now() + (down ? 800 : 0);
    const last = trail[trail.length - 1];
    if (last && last.x === x && last.y === y) last.t = t;
    else trail.push({ x, y, t });
    if (!drawing) {
      drawing = true;
      requestAnimationFrame(frame);
    }
  }, true);
  addEventListener("mousedown", (e) => {
    down = true;
    mount();
    place();
    const ripple = document.createElement("div");
    ripple.className = "ripple";
    ripple.style.left = `${e.clientX}px`;
    ripple.style.top = `${e.clientY}px`;
    root.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
    // Evidence screenshots fast-forward CSS animations to their last frame,
    // where the ripple is invisible, so a static mark records the click.
    root.querySelectorAll(".mark").forEach((el) => el.remove());
    const mark = document.createElement("div");
    mark.className = "mark";
    mark.style.left = `${e.clientX}px`;
    mark.style.top = `${e.clientY}px`;
    root.appendChild(mark);
    setTimeout(() => mark.remove(), 3000);
  }, true);
  addEventListener("mouseup", () => {
    down = false;
    place();
  }, true);
  addEventListener("resize", resize);
  resize();

  // Captions are set in Inter shipped with the server, so a shot reads the
  // same on any machine. The faces live under their own family name and sit
  // in document.fonts only while a caption is up, so the page under test
  // neither picks them up nor sees them otherwise. Built from bytes, they need
  // no fetch for a CSP to block.
  let faces: FontFace[] = [];
  const showFont = () => faces.forEach((face) => document.fonts.add(face));

  window.__mcpOverlay = {
    fontReady() {
      return faces.length > 0;
    },
    async loadFont(sources) {
      const loaded = sources.map(({ data, weight, unicodeRange }) => {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        return new FontFace("mcp-caption", bytes, { weight, unicodeRange });
      });
      await Promise.all(loaded.map((face) => face.load()));
      faces = loaded;
    },
    highlight(rect, label, kind = "action") {
      mount();
      showFont();
      // Padded so the outline does not sit on the element's own border or text.
      const pad = 4;
      const top = rect.y - pad;
      const box = document.createElement("div");
      box.className = `box ${kind}`;
      box.style.cssText = `left:${rect.x - pad}px;top:${top}px;width:${rect.width + pad * 2}px;height:${rect.height + pad * 2}px`;
      if (label) {
        const tag = document.createElement("div");
        tag.className = top < 20 ? "tag below" : "tag";
        tag.textContent = label.normalize("NFC");
        box.appendChild(tag);
      }
      root.appendChild(box);
    },
    // A step with nothing to outline still says what it shows. Decomposed
    // text (as macOS file names give) loses its stacked Vietnamese marks in
    // many fonts, so it is composed first.
    caption(text, detail, kind = "action") {
      mount();
      showFont();
      const bar = document.createElement("div");
      bar.className = `cap ${kind}`;
      bar.textContent = text.normalize("NFC");
      const line = document.createElement("small");
      line.textContent = detail.normalize("NFC");
      bar.appendChild(line);
      root.appendChild(bar);
    },
    clear() {
      root.querySelectorAll(".box, .cap, .mark, .ripple").forEach((el) => el.remove());
      faces.forEach((face) => document.fonts.delete(face));
    },
  };
  Object.defineProperty(window, "__mcpOverlay", { enumerable: false });

  if (document.documentElement) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
}

// CloakBrowser's Chromium never reports console messages or uncaught errors
// over CDP, nor binding calls, so the page keeps them itself until the session
// drains them with an evaluate.
export function consoleScript(): void {
  if (window !== window.top || window.__mcpConsole) return;
  const buffer: Array<{ t: number; type: string; text: string; url?: string }> = [];
  const push = (type: string, text: string, url?: string) => {
    buffer.push({ t: Date.now(), type, text, ...(url ? { url } : {}) });
    if (buffer.length > 500) buffer.shift();
  };
  const show = (value: unknown) => {
    if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  };
  const levels = { log: "log", info: "info", debug: "debug", warn: "warning", error: "error" } as const;
  for (const [method, type] of Object.entries(levels)) {
    const original = console[method as keyof typeof levels];
    const wrapped = function (this: Console, ...args: unknown[]) {
      push(type, args.map(show).join(" "));
      return original.apply(this, args);
    };
    // Pages that fingerprint console methods read their source text.
    Object.defineProperty(wrapped, "toString", { value: () => original.toString(), enumerable: false });
    Object.defineProperty(wrapped, "name", { value: original.name });
    console[method as keyof typeof levels] = wrapped;
  }
  // The message alone, as Playwright's own pageerror carries, so the two match.
  addEventListener("error", (e) => {
    if (e.error !== undefined || e.message) push("pageerror", e.error instanceof Error ? e.error.message : e.message, e.filename ? `${e.filename}:${e.lineno}` : undefined);
  });
  addEventListener("unhandledrejection", (e) => push("pageerror", `Unhandled rejection: ${show(e.reason)}`));
  Object.defineProperty(window, "__mcpConsole", { value: { drain: () => buffer.splice(0) }, enumerable: false });
}

// LCP and CLS are only observable from inside the page, and only from load
// onwards, so the observers are installed before any page script runs.
export function vitalsScript(): void {
  if (window !== window.top || window.__mcpVitals) return;
  const vitals = { lcp: 0, cls: 0, longTasks: 0, longTaskMs: 0 };
  Object.defineProperty(window, "__mcpVitals", { value: vitals, enumerable: false });
  const observe = (type: string, fn: (entry: PerformanceEntry & Record<string, any>) => void) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach((e) => fn(e as never))).observe({ type, buffered: true });
    } catch {}
  };
  observe("largest-contentful-paint", (e) => { vitals.lcp = Math.round(e.startTime); });
  observe("layout-shift", (e) => { if (!e.hadRecentInput) vitals.cls += e.value; });
  observe("longtask", (e) => { vitals.longTasks++; vitals.longTaskMs += Math.round(e.duration); });
}
