import type { Browser } from "playwright";
import { DEFAULT_CONFIG } from "./config";
import type { FetchResult, RedirectHop } from "./types";

/**
 * Optional Playwright rendering layer. Rendering is the preferred path
 * (executes JS, triggers lazy-loading, expands hidden sections). When a
 * browser cannot be launched in the current environment, callers fall back to
 * the plain HTTP fetcher — extraction works on either rendered output.
 */
let browserPromise: Promise<Browser | null> | null = null;
let browserUnavailable = false;

async function getBrowser(): Promise<Browser | null> {
  if (browserUnavailable) return null;
  if (!browserPromise) {
    browserPromise = (async () => {
      try {
        const { chromium } = await import("playwright");
        return await chromium.launch({
          args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        });
      } catch {
        browserUnavailable = true;
        return null;
      }
    })();
  }
  return browserPromise;
}

export async function isBrowserAvailable(): Promise<boolean> {
  return (await getBrowser()) !== null;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    await b?.close();
    browserPromise = null;
  }
}

/**
 * Fully render a page: navigate, wait for network idle + hydration, scroll the
 * whole document to trigger lazy-loaded media, expand accordions/`<details>`
 * and any "read more" toggles, then return the settled HTML and redirect data.
 *
 * Returns `null` if no browser is available so the caller can fall back.
 */
export async function renderPage(url: string): Promise<FetchResult | null> {
  const browser = await getBrowser();
  if (!browser) return null;

  const context = await browser.newContext({
    userAgent: DEFAULT_CONFIG.userAgent,
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  const redirectChain: RedirectHop[] = [];

  try {
    const response = await page.goto(url, {
      waitUntil: "networkidle",
      timeout: DEFAULT_CONFIG.requestTimeoutMs,
    });

    // Reconstruct the redirect chain from Playwright's request history.
    let req = response?.request();
    const hops: RedirectHop[] = [];
    while (req) {
      const redirectedFrom = req.redirectedFrom();
      if (!redirectedFrom) break;
      const prevRes = await redirectedFrom.response();
      hops.unshift({
        from: redirectedFrom.url(),
        to: req.url(),
        status: prevRes?.status() ?? 0,
      });
      req = redirectedFrom;
    }
    redirectChain.push(...hops);

    // Scroll the full page in steps to trigger lazy-loading.
    await autoScroll(page);

    // Expand collapsible content so it is present in the DOM.
    await expandHiddenContent(page);

    // Allow late hydration / deferred content to settle.
    await page.waitForTimeout(500);
    await page
      .waitForLoadState("networkidle", { timeout: 5000 })
      .catch(() => undefined);

    const html = await page.content();
    const headers = response?.headers() ?? {};

    return {
      requestedUrl: url,
      finalUrl: page.url(),
      httpStatus: response?.status() ?? 0,
      html,
      redirectChain,
      via: "browser",
      httpHeaders: headers,
    };
  } finally {
    await context.close();
  }
}

async function autoScroll(page: import("playwright").Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let total = 0;
      const step = 600;
      const timer = setInterval(() => {
        const { scrollHeight } = document.body;
        window.scrollBy(0, step);
        total += step;
        if (total >= scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 100);
    });
  });
}

async function expandHiddenContent(page: import("playwright").Page): Promise<void> {
  await page.evaluate(() => {
    document
      .querySelectorAll<HTMLDetailsElement>("details:not([open])")
      .forEach((d) => (d.open = true));
    const toggles = document.querySelectorAll<HTMLElement>(
      '[aria-expanded="false"], .accordion-header, [data-accordion], button.read-more, .show-more',
    );
    toggles.forEach((el) => {
      try {
        el.click();
      } catch {
        /* ignore */
      }
    });
  });
}
