// Both scripts run as context init scripts, so they are serialized and must be
// self-contained: no imports, no closures over module scope.

declare global {
  interface Window {
    __mcpOverlay?: {
      highlight(rect: { x: number; y: number; width: number; height: number }, label?: string): void;
      clear(): void;
    };
    __mcpVitals?: { lcp: number; cls: number; longTasks: number; longTaskMs: number };
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
    .cursor{position:fixed;left:0;top:0;width:18px;height:18px;margin:-2px 0 0 -2px;pointer-events:none;transition:transform .02s linear;display:none}
    .ripple{position:fixed;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;border:3px solid #ff2d55;pointer-events:none;animation:r .5s ease-out forwards}
    .box{position:fixed;border:2px solid #ff2d55;background:rgba(255,45,85,.08);border-radius:3px;pointer-events:none;box-sizing:border-box}
    .tag{position:absolute;left:-2px;bottom:100%;background:#ff2d55;color:#fff;font:600 11px/16px system-ui,sans-serif;padding:0 5px;border-radius:3px 3px 0 0;white-space:nowrap}
    @keyframes r{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}
  </style><canvas></canvas><svg class="cursor" viewBox="0 0 18 18"><path d="M1 1l6.5 15 2.2-6.3L16 7.5z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
  const canvas = root.querySelector("canvas")!;
  const cursor = root.querySelector<SVGElement>(".cursor")!;
  const ctx = canvas.getContext("2d")!;
  const trail: Array<{ x: number; y: number; t: number }> = [];
  const TRAIL_MS = 700;
  let drawing = false;
  let down = false;

  const mount = () => {
    if (!host.isConnected) document.documentElement.appendChild(host);
  };
  const resize = () => {
    canvas.width = innerWidth * devicePixelRatio;
    canvas.height = innerHeight * devicePixelRatio;
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
  };

  const frame = () => {
    const now = performance.now();
    while (trail.length && now - trail[0].t > TRAIL_MS) trail.shift();
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.lineCap = "round";
    for (let i = 1; i < trail.length; i++) {
      const age = Math.max(0, (now - trail[i].t) / TRAIL_MS);
      ctx.strokeStyle = `rgba(255,45,85,${(1 - age) * 0.8})`;
      ctx.lineWidth = 3 * (1 - age) + 1;
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }
    drawing = trail.length > 0;
    if (drawing) requestAnimationFrame(frame);
  };

  addEventListener("mousemove", (e) => {
    mount();
    cursor.style.display = "block";
    cursor.style.transform = `translate(${e.clientX}px,${e.clientY}px)`;
    // While a button is held the trail is kept longer, so a drag or a drawn
    // stroke stays readable in the screenshot taken right after it.
    trail.push({ x: e.clientX, y: e.clientY, t: performance.now() + (down ? 800 : 0) });
    if (!drawing) {
      drawing = true;
      requestAnimationFrame(frame);
    }
  }, true);
  addEventListener("mousedown", (e) => {
    down = true;
    mount();
    const ripple = document.createElement("div");
    ripple.className = "ripple";
    ripple.style.left = `${e.clientX}px`;
    ripple.style.top = `${e.clientY}px`;
    root.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  }, true);
  addEventListener("mouseup", () => { down = false; }, true);
  addEventListener("resize", resize);
  resize();

  window.__mcpOverlay = {
    highlight(rect, label) {
      mount();
      const box = document.createElement("div");
      box.className = "box";
      box.style.cssText = `left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px`;
      if (label) {
        const tag = document.createElement("div");
        tag.className = "tag";
        tag.textContent = label;
        box.appendChild(tag);
      }
      root.appendChild(box);
    },
    clear() {
      root.querySelectorAll(".box").forEach((el) => el.remove());
    },
  };
  Object.defineProperty(window, "__mcpOverlay", { enumerable: false });

  if (document.documentElement) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
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
