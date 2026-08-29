import { launch } from "cloakbrowser";

type Browser = Awaited<ReturnType<typeof launch>>;
type Page = Awaited<ReturnType<Browser["newPage"]>>;

let browserInstance: Browser | null = null;
let pageInstance: Page | null = null;
let headlessOption = true;

// Viewport used in headless mode, where there is no real OS window to size against.
const HEADLESS_VIEWPORT = { width: 1920, height: 1080 };

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
  }
  return pageInstance;
}

// Update the active page so that tab switching inside a flow keeps subsequent
// single-action tools pointed at the same tab.
export function setPage(page: Page): void {
  pageInstance = page;
}

export async function closeBrowser(): Promise<void> {
  await pageInstance?.close().catch(() => {});
  await browserInstance?.close().catch(() => {});
  pageInstance = null;
  browserInstance = null;
}
