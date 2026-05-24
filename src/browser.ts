import { launch } from "cloakbrowser";

type Browser = Awaited<ReturnType<typeof launch>>;
type Page = Awaited<ReturnType<Browser["newPage"]>>;

let browserInstance: Browser | null = null;
let pageInstance: Page | null = null;

function createBrowser(): Promise<Browser> {
  return launch({ headless: true, humanize: true });
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

export async function closeBrowser(): Promise<void> {
  await pageInstance?.close().catch(() => {});
  await browserInstance?.close().catch(() => {});
  pageInstance = null;
  browserInstance = null;
}
