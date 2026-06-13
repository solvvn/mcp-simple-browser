import { launch } from "cloakbrowser";

type Browser = Awaited<ReturnType<typeof launch>>;
type Page = Awaited<ReturnType<Browser["newPage"]>>;

let browserInstance: Browser | null = null;
let pageInstance: Page | null = null;
let headlessOption = true;

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
  return launch({ headless: headlessOption, humanize: true });
}

export async function getPage(): Promise<Page> {
  if (!browserInstance) {
    browserInstance = await createBrowser();
  }
  if (!pageInstance) {
    pageInstance = await browserInstance.newPage();
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

export async function pressKey(key: string): Promise<void> {
  const page = await getPage();
  await page.press("body", key);
}

export async function scrollPage(x: number, y: number): Promise<void> {
  const page = await getPage();
  await page.evaluate(({ x, y }) => window.scrollBy(x, y), { x, y });
}

export async function scrollToTop(): Promise<void> {
  const page = await getPage();
  await page.evaluate(() => window.scrollTo(0, 0));
}

export async function scrollToBottom(): Promise<void> {
  const page = await getPage();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
}

export async function hoverElement(selector: string): Promise<void> {
  const page = await getPage();
  await page.hover(selector);
}

export async function goBack(): Promise<void> {
  const page = await getPage();
  await page.goBack();
}

export async function goForward(): Promise<void> {
  const page = await getPage();
  await page.goForward();
}

export async function reload(): Promise<void> {
  const page = await getPage();
  await page.reload();
}
