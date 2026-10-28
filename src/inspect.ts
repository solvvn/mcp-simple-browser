import type { Page, Session, Viewport } from "./session.js";

// ---------------------------------------------------------------------------
// Viewport: the width a responsive layout is measured at.
// ---------------------------------------------------------------------------

// At or below this width the page is being looked at as a touch device, which
// is what makes `pointer: coarse` and `hover: none` match and hides or exposes
// hover-only affordances.
const TOUCH_MAX_WIDTH = 768;

export function viewportFor(width: number, height?: number, mobile?: boolean, scale = 1): Viewport {
  const touch = mobile ?? width <= TOUCH_MAX_WIDTH;
  return { width, height: height || (touch ? 844 : 900), scale, mobile: touch };
}

// ---------------------------------------------------------------------------
// Page inspection: text descriptions of the UI that stand in for a screenshot
// everywhere except aesthetic judgement.
// ---------------------------------------------------------------------------

const INTERACTIVE_SELECTOR =
  "a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=checkbox],[role=radio],[role=menuitem],[role=switch],[contenteditable=true]";

const STYLE_KEYS = [
  "display", "position", "width", "height", "margin", "padding", "color", "backgroundColor",
  "fontSize", "fontWeight", "fontFamily", "lineHeight", "borderRadius", "border", "boxShadow",
  "flexDirection", "justifyContent", "alignItems", "gap", "gridTemplateColumns", "opacity", "zIndex",
];

export interface InspectArgs {
  mode: "snapshot" | "styles" | "audit";
  selector: string;
  interactive: string;
  keys: string[];
  max: number;
}

function inspectPage({ mode, selector, interactive, keys, max }: InspectArgs): string {
  const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
  const box = (el: Element) => el.getBoundingClientRect();

  const hidden = (el: Element) => {
    const r = box(el);
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) <= 0.05) return true;
    // Screen-reader-only patterns: clipped to nothing, or parked off-canvas.
    if (r.width <= 1 && r.height <= 1) return true;
    return r.bottom < -500 || r.right < -500;
  };

  const named = (el: Element) => {
    const cls = typeof el.className === "string" && el.className.trim()
      ? `.${el.className.trim().split(/\s+/)[0]}`
      : "";
    return el.tagName.toLowerCase() + (el.id ? `#${el.id}` : cls);
  };

  const label = (el: Element) => {
    const input = el as HTMLInputElement;
    const candidates = [
      el.getAttribute("aria-label"),
      input.labels?.[0]?.textContent,
      el.getAttribute("placeholder"),
      /^(submit|button|reset)$/.test(input.type ?? "") ? input.value : "",
      (el as HTMLElement).innerText,
      el.getAttribute("title"),
      el.getAttribute("alt"),
      el.getAttribute("name"),
      el.id ? `#${el.id}` : "",
    ];
    for (const candidate of candidates) {
      const value = clean(candidate);
      if (value) return value.slice(0, 80);
    }
    return "";
  };

  const scope = selector ? document.querySelector(selector) : document.body;
  if (!scope) throw new Error(`${mode}: no element matches ${selector}`);

  if (mode === "styles") {
    const out: string[] = [];
    for (const el of [...document.querySelectorAll(selector || "body")].slice(0, max)) {
      const style = getComputedStyle(el) as unknown as Record<string, string>;
      const r = box(el);
      const pairs = keys
        .map((key) => [key, style[key]] as const)
        .filter(([, value]) => value && !["none", "normal", "auto", "0px", "static", "rgba(0, 0, 0, 0)"].includes(value));
      out.push(
        `${named(el)} [${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.x)},${Math.round(r.y)}] `
        + pairs.map(([key, value]) => `${key}:${value}`).join("; "),
      );
    }
    return out.join("\n") || `(no element matches ${selector})`;
  }

  if (mode === "snapshot") {
    const lines: string[] = [];
    scope.querySelectorAll("[data-ref]").forEach((el) => el.removeAttribute("data-ref"));

    for (const heading of scope.querySelectorAll("h1,h2,h3")) {
      if (hidden(heading)) continue;
      const text = clean((heading as HTMLElement).innerText);
      if (text) lines.push(`${heading.tagName.toLowerCase()} ${text.slice(0, 100)}`);
    }
    if (lines.length) lines.push("--");

    let count = 0;
    for (const el of scope.querySelectorAll(interactive)) {
      if (count >= max) break;
      if (hidden(el)) continue;
      const ref = `e${++count}`;
      el.setAttribute("data-ref", ref);
      const input = el as HTMLInputElement;
      const tag = el.tagName.toLowerCase();
      const kind = tag === "input" ? `input:${input.type || "text"}` : tag;
      const state: string[] = [];
      if (input.disabled) state.push("disabled");
      if (input.checked) state.push("checked");
      if (input.value && !/^(submit|button|reset|checkbox|radio)$/.test(input.type ?? "")) {
        state.push(`="${clean(input.value).slice(0, 40)}"`);
      }
      lines.push(`${ref} ${kind} "${label(el)}"${state.length ? ` ${state.join(" ")}` : ""}`);
    }
    return lines.join("\n") || "(no visible interactive elements)";
  }

  const channels = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
  const luminance = (c: number[]) => {
    const f = (x: number) => (x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const backdrop = (el: Element) => {
    for (let node: Element | null = el; node && node !== document.documentElement; node = node.parentElement) {
      const c = channels(getComputedStyle(node).backgroundColor);
      if (c.length >= 3 && (c[3] === undefined || c[3] > 0.5)) return c;
    }
    return [255, 255, 255];
  };
  const contrast = (el: Element) => {
    const [light, dark] = [luminance(channels(getComputedStyle(el).color)), luminance(backdrop(el))].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
  };

  const issues: string[] = [];
  const report = (message: string) => { if (issues.length < max) issues.push(message); };

  if (document.documentElement.scrollWidth > window.innerWidth + 1) {
    report(`overflow-x: page is ${document.documentElement.scrollWidth}px wide vs viewport ${window.innerWidth}px`);
  }

  for (const el of scope.querySelectorAll("*")) {
    if (issues.length >= max) break;
    if (hidden(el)) continue;
    const style = getComputedStyle(el);
    const r = box(el);

    if ([...el.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim())) {
      const ratio = contrast(el);
      const size = parseFloat(style.fontSize) || 16;
      const floor = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700) ? 3 : 4.5;
      if (ratio < floor) report(`contrast ${named(el)}: ${ratio.toFixed(2)}:1 below ${floor} (${style.color})`);
      if (el.scrollWidth > el.clientWidth + 1 && !/auto|scroll/.test(style.overflowX + style.overflow)) {
        report(`clipped ${named(el)}: content ${el.scrollWidth}px in a ${el.clientWidth}px box`);
      }
    }
    if (r.right > window.innerWidth + 1) {
      report(`offscreen ${named(el)}: ${Math.round(r.right - window.innerWidth)}px past the right edge`);
    }

    const role = el.getAttribute("role") ?? "";
    if (/^(a|button|input|select|textarea)$/.test(el.tagName.toLowerCase()) || /^(button|link|tab|checkbox)$/.test(role)) {
      // Inline links inside running text are not tap targets; only standalone
      // controls are measured against the 24px floor.
      if (style.display !== "inline" && Math.min(r.width, r.height) < 24) {
        report(`tap-target ${named(el)}: ${Math.round(r.width)}x${Math.round(r.height)}px under 24x24`);
      }
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
        report(`covered ${named(el)}: obscured by ${named(hit)}`);
      }
    }
    const img = el as HTMLImageElement;
    if (el.tagName === "IMG" && img.complete && img.naturalWidth === 0) {
      report(`broken-img ${el.getAttribute("src")}`);
    }
  }
  return issues.length ? issues.join("\n") : "(no layout or contrast issues found)";
}

export async function runInspect(
  page: Page,
  mode: InspectArgs["mode"],
  selector: string,
  max: number,
): Promise<string> {
  return page.evaluate(inspectPage, {
    mode,
    selector,
    interactive: INTERACTIVE_SELECTOR,
    keys: STYLE_KEYS,
    max,
  });
}

// Reporting each width's findings in full is mostly repetition: an issue that
// holds at every width is one line, and the interesting ones are those tagged
// with the widths where they actually appear.
export async function inspectWidths(
  session: Session,
  page: Page,
  mode: InspectArgs["mode"],
  selector: string,
  max: number,
  widths: number[],
): Promise<string> {
  const targets = [...new Set(widths)].sort((a, b) => a - b);
  const previous = session.viewport;
  const seen = new Map<string, number[]>();

  try {
    for (const width of targets) {
      await session.setViewport(viewportFor(width));
      // Two frames: one for reflow, one for any ResizeObserver-driven relayout.
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))),
      );
      const report = await runInspect(page, mode, selector, max);
      for (const raw of report.split("\n")) {
        // snapshot numbers its refs per run, so the same control is e3 at one
        // width and e7 at another; drop the ref or nothing would ever group.
        const line = mode === "snapshot" ? raw.replace(/^e\d+ /, "") : raw;
        if (!line.trim()) continue;
        const at = seen.get(line);
        if (at) at.push(width);
        else seen.set(line, [width]);
      }
    }
  } finally {
    await session.setViewport(previous);
  }

  const everywhere = (at: number[]) => at.length === targets.length;
  return [...seen]
    .sort(([, a], [, b]) => Number(everywhere(b)) - Number(everywhere(a)) || a[0] - b[0])
    .map(([line, at]) => `[${everywhere(at) ? "all" : at.join(",")}] ${line}`)
    .join("\n");
}
