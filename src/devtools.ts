import type { Route } from "playwright-core";
import type { Session } from "./session.js";
import { clamp } from "./util.js";

const time = (t: number) => new Date(t).toISOString().slice(11, 23);

export async function readConsole(session: Session, level: "all" | "error" | "warning", limit: number, clear: boolean) {
  await session.syncConsole();
  const wanted = (type: string) =>
    level === "all" || (level === "error" ? /error/.test(type) : /error|warn/.test(type));
  const rows = session.consoleLog.filter((entry) => wanted(entry.type)).slice(-limit);
  if (clear) session.consoleLog.length = 0;
  return rows.map((e) => `${time(e.t)} [${e.type}] ${clamp(e.text, 400)}${e.url ? ` (${e.url})` : ""}`).join("\n") || "(no console messages)";
}

export function readNetwork(
  session: Session,
  { url, status, type, limit, clear }: { url?: string; status: "all" | "failed" | "error"; type?: string; limit: number; clear: boolean },
) {
  const rows = session.networkLog
    .filter((e) => !url || e.url.includes(url))
    .filter((e) => !type || e.type === type)
    .filter((e) => status === "all" || (status === "failed" ? !!e.failure : !!e.failure || (e.status ?? 0) >= 400))
    .slice(-limit);
  if (clear) session.networkLog.length = 0;
  return rows
    .map((e) => `#${e.id} ${e.method} ${e.status ?? e.failure ?? "pending"} ${e.type} ${e.ms ?? "-"}ms ${clamp(e.url, 200)}`)
    .join("\n") || "(no matching requests)";
}

export async function readResponse(session: Session, id: number, maxLength: number) {
  const res = session.response(id);
  if (!res) throw new Error(`no response stored for request #${id}; it may be pending, failed, or evicted`);
  const req = res.request();
  const body = await res.text().catch((err: Error) => `(body unavailable: ${err.message})`);
  return {
    url: res.url(),
    status: res.status(),
    request: { method: req.method(), headers: await req.allHeaders(), body: req.postData() ? clamp(req.postData()!, 2000) : undefined },
    headers: await res.allHeaders(),
    body: clamp(body, maxLength),
  };
}

export async function readPerformance(session: Session) {
  const page = await session.activePage();
  const cdp = await session.cdp(page);
  await cdp.send("Performance.enable");
  const { metrics } = await cdp.send("Performance.getMetrics");
  const pick = Object.fromEntries(metrics.map((m: { name: string; value: number }) => [m.name, m.value]));
  const web = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const vitals = window.__mcpVitals;
    return {
      ttfb: nav ? Math.round(nav.responseStart - nav.startTime) : null,
      fcp: fcp ? Math.round(fcp.startTime) : null,
      lcp: vitals?.lcp || null,
      cls: vitals ? Number(vitals.cls.toFixed(4)) : null,
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd - nav.startTime) : null,
      load: nav ? Math.round(nav.loadEventEnd - nav.startTime) : null,
      longTasks: vitals?.longTasks ?? null,
      longTaskMs: vitals?.longTaskMs ?? null,
      resources: resources.length,
      transferKB: Math.round(resources.reduce((n, r) => n + (r.transferSize || 0), 0) / 1024),
    };
  });
  const mb = (bytes: number) => Math.round((bytes / 1048576) * 10) / 10;
  return {
    url: page.url(),
    vitals: web,
    runtime: {
      jsHeapUsedMB: mb(pick.JSHeapUsedSize ?? 0),
      jsHeapTotalMB: mb(pick.JSHeapTotalSize ?? 0),
      domNodes: pick.Nodes,
      listeners: pick.JSEventListeners,
      layouts: pick.LayoutCount,
      styleRecalcs: pick.RecalcStyleCount,
      scriptMs: Math.round((pick.ScriptDuration ?? 0) * 1000),
      layoutMs: Math.round((pick.LayoutDuration ?? 0) * 1000),
      taskMs: Math.round((pick.TaskDuration ?? 0) * 1000),
    },
  };
}

export async function sendCdp(session: Session, method: string, params: Record<string, unknown> = {}) {
  const cdp = await session.cdp(await session.activePage());
  return cdp.send(method as never, params as never);
}

// Throughput is in bytes per second, as CDP expects it.
const NETWORK_PRESETS = {
  "slow-3g": { latency: 400, downloadThroughput: 50_000, uploadThroughput: 50_000 },
  "fast-3g": { latency: 150, downloadThroughput: 200_000, uploadThroughput: 94_000 },
  "4g": { latency: 20, downloadThroughput: 1_125_000, uploadThroughput: 187_000 },
} as const;

export interface EmulateArgs {
  network?: "none" | "offline" | keyof typeof NETWORK_PRESETS;
  cpu?: number;
  geolocation?: { latitude: number; longitude: number; accuracy?: number } | null;
  colorScheme?: "light" | "dark" | "no-preference";
  reducedMotion?: "reduce" | "no-preference";
  timezone?: string;
  userAgent?: string;
  headers?: Record<string, string>;
}

export async function emulate(session: Session, args: EmulateArgs) {
  const page = await session.activePage();
  const cdp = await session.cdp(page);
  const applied: string[] = [];

  if (args.network) {
    await session.context.setOffline(args.network === "offline");
    await cdp.send("Network.enable");
    const preset = args.network in NETWORK_PRESETS ? NETWORK_PRESETS[args.network as keyof typeof NETWORK_PRESETS] : null;
    await cdp.send("Network.emulateNetworkConditions", {
      offline: args.network === "offline",
      latency: preset?.latency ?? 0,
      downloadThroughput: preset?.downloadThroughput ?? -1,
      uploadThroughput: preset?.uploadThroughput ?? -1,
    });
    applied.push(`network=${args.network}`);
  }
  if (args.cpu !== undefined) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: Math.max(1, args.cpu) });
    applied.push(`cpu=${args.cpu}x`);
  }
  if (args.geolocation !== undefined) {
    if (args.geolocation) {
      await session.context.grantPermissions(["geolocation"]);
      await session.context.setGeolocation(args.geolocation);
    } else {
      await session.context.setGeolocation(null);
    }
    applied.push("geolocation");
  }
  if (args.colorScheme || args.reducedMotion) {
    await page.emulateMedia({ ...(args.colorScheme ? { colorScheme: args.colorScheme } : {}), ...(args.reducedMotion ? { reducedMotion: args.reducedMotion } : {}) });
    applied.push("media");
  }
  if (args.timezone !== undefined) {
    await cdp.send("Emulation.setTimezoneOverride", { timezoneId: args.timezone });
    applied.push(`timezone=${args.timezone || "reset"}`);
  }
  if (args.userAgent !== undefined) {
    await cdp.send("Network.setUserAgentOverride", { userAgent: args.userAgent });
    applied.push("userAgent");
  }
  if (args.headers) {
    await session.context.setExtraHTTPHeaders(args.headers);
    applied.push("headers");
  }
  return applied;
}

export interface MockRule {
  url: string;
  status?: number;
  body?: string;
  json?: unknown;
  contentType?: string;
  headers?: Record<string, string>;
  abort?: boolean;
  delay?: number;
  times?: number;
}

const mocks = new WeakMap<Session, Map<string, (route: Route) => Promise<void>>>();

// A `/.../` pattern is a regex, anything else a Playwright glob.
function pattern(url: string): string | RegExp {
  const m = /^\/(.+)\/([a-z]*)$/.exec(url);
  return m ? new RegExp(m[1], m[2]) : url;
}

export async function addMock(session: Session, rule: MockRule) {
  const registry = mocks.get(session) ?? new Map();
  mocks.set(session, registry);
  if (registry.has(rule.url)) await removeMock(session, rule.url);
  const handler = async (route: Route) => {
    if (rule.delay) await new Promise((resolve) => setTimeout(resolve, rule.delay));
    if (rule.abort) return route.abort();
    await route.fulfill({
      status: rule.status ?? 200,
      headers: rule.headers,
      contentType: rule.contentType ?? (rule.json !== undefined ? "application/json" : undefined),
      body: rule.json !== undefined ? JSON.stringify(rule.json) : rule.body ?? "",
    });
  };
  registry.set(rule.url, handler);
  await session.context.route(pattern(rule.url), handler, rule.times ? { times: rule.times } : undefined);
  return [...registry.keys()];
}

export async function removeMock(session: Session, url?: string) {
  const registry = mocks.get(session);
  if (!registry) return [];
  for (const [key, handler] of [...registry]) {
    if (url && key !== url) continue;
    await session.context.unroute(pattern(key), handler);
    registry.delete(key);
  }
  return [...registry.keys()];
}

export function listMocks(session: Session) {
  return [...(mocks.get(session)?.keys() ?? [])];
}
