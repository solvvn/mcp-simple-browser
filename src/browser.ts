import { launch } from "cloakbrowser";

type Browser = Awaited<ReturnType<typeof launch>>;
type Page = Awaited<ReturnType<Browser["newPage"]>>;
type CDPSession = Awaited<ReturnType<ReturnType<Page["context"]>["newCDPSession"]>>;

let browserInstance: Browser | null = null;
let pageInstance: Page | null = null;
let headlessOption = true;

// Viewport used in headless mode, where there is no real OS window to size against.
const HEADLESS_VIEWPORT = { width: 1920, height: 1080 };

export interface Viewport {
  width: number;
  height: number;
  scale: number;
  mobile: boolean;
}

let viewportOverride: Viewport | null = null;

// Emulation is per page and reverts when its last CDP client detaches, so the
// session is kept alive for as long as the page is.
const cdpSessions = new WeakMap<Page, CDPSession>();

async function cdpFor(page: Page): Promise<CDPSession> {
  let session = cdpSessions.get(page);
  if (!session) {
    session = await page.context().newCDPSession(page);
    cdpSessions.set(page, session);
  }
  return session;
}

// Device metrics go through CDP rather than page.setViewportSize: the CDP
// override is the one that can be cleared again afterwards, and it carries
// deviceScaleFactor, which setViewportSize does not.
async function applyViewport(page: Page): Promise<void> {
  const cdp = await cdpFor(page);
  if (viewportOverride) {
    const { width, height, scale, mobile } = viewportOverride;
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: scale,
      // Deliberately not `mobile`: that hands the meta viewport control of the
      // layout width, so a page that overflows silently gets a wider viewport
      // instead of overflowing — hiding the exact bug this is used to find.
      // Touch emulation below is what `pointer`/`hover` queries actually read.
      mobile: false,
    });
    // maxTouchPoints must stay in 1..16 even when disabling.
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
    return;
  }

  // Headed has a real window to fall back to. Headless does not: clearing there
  // leaves the page a few px off, so the launch viewport is restated instead.
  if (headlessOption) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      ...HEADLESS_VIEWPORT,
      deviceScaleFactor: 1,
      mobile: false,
    });
  } else {
    await cdp.send("Emulation.clearDeviceMetricsOverride");
  }
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 });
}

export async function setViewport(next: Viewport | null): Promise<void> {
  viewportOverride = next;
  if (pageInstance) {
    await applyViewport(pageInstance);
  }
}

export function getViewport(): Viewport | null {
  return viewportOverride;
}

export async function setHeadless(headless: boolean): Promise<boolean> {
  const changed = headlessOption !== headless;
  headlessOption = headless;
  // Browser reads headlessOption only at launch time. If an instance is already
  // running with a different mode, close it so the new setting applies on next use.
  const restarted = changed && browserInstance !== null;
  if (restarted) {
    await closeBrowser();
  }
  return restarted;
}

export function isHeadless(): boolean {
  return headlessOption;
}

function createBrowser(): Promise<Browser> {
  // In headed mode, open the window maximized so the page can use the full screen.
  const args = headlessOption ? [] : ["--start-maximized"];
  return launch({ headless: headlessOption, humanize: true, args });
}

export async function getPage(): Promise<Page> {
  if (!browserInstance) {
    browserInstance = await createBrowser();
  }
  if (!pageInstance) {
    // headless: pin a large viewport since there is no OS window.
    // headed: viewport null lets the page fill the actual (maximized) window —
    // otherwise Playwright locks it to 1280x720 and content gets clipped.
    pageInstance = await browserInstance.newPage({
      viewport: headlessOption ? HEADLESS_VIEWPORT : null,
    });
    // A viewport set earlier is a session setting: carry it onto the new page
    // so it survives a tab close or a headless toggle.
    if (viewportOverride) {
      await applyViewport(pageInstance);
    }
  }
  return pageInstance;
}

// Update the active page so that tab switching inside a flow keeps subsequent
// single-action tools pointed at the same tab.
export async function setPage(page: Page): Promise<void> {
  pageInstance = page;
  if (viewportOverride) {
    await applyViewport(page);
  }
}

export async function closeBrowser(): Promise<void> {
  await pageInstance?.close().catch(() => {});
  await browserInstance?.close().catch(() => {});
  pageInstance = null;
  browserInstance = null;
}
