import { z } from "zod";

export function collapse(text: string): string {
  return text.replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

export function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated, ${text.length - max} more chars]`;
}

export function clampValue(value: unknown, max: number): unknown {
  if (typeof value === "string") return clamp(value, max);
  if (value === null || typeof value !== "object") return value;
  const json = JSON.stringify(value);
  return json.length <= max ? value : clamp(json, max);
}

// Drop parts of the markup that carry no information for the model: scripts,
// styles, inline SVG paths, comments, the cursor overlay, and the whitespace
// between tags.
export function compactHtml(html: string): string {
  return html
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "<svg/>")
    .replace(/<mcp-overlay\b[^>]*>[\s\S]*?<\/mcp-overlay>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/>\s+</g, "><")
    .trim();
}

// Playwright appends a multi-line "Call log:" to most errors; the first line
// is what identifies the failure, the rest is retry noise.
export function shortError(err: unknown): string {
  if (err instanceof z.ZodError) {
    return clamp(err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "), 300);
  }
  const message = err instanceof Error ? err.message : String(err);
  return clamp(collapse(message.split(/\n?Call log:/)[0]), 300);
}

// A bare snapshot ref ("e5") is shorthand for the data-ref it stamped.
export function ref(selector: string): string {
  return /^e\d+$/.test(selector) ? `[data-ref="${selector}"]` : selector;
}
