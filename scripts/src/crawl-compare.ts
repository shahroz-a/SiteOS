/**
 * DB-free rendering comparison: HTTP fetch vs Playwright (Chromium) render.
 *
 * Fetches a handful of representative Headout blog URLs both ways, runs the
 * SAME extraction engine (`assemblePage`) on each, and diffs the structured
 * output (component tree, images, FAQs, links, word counts) plus fetch timing.
 *
 * This intentionally bypasses the crawler's queue/store layer so it needs NO
 * database — it only answers: "does JS rendering capture materially more/
 * different content than plain HTTP for this site, and at what time cost?"
 *
 * Chromium binary is provided by Nix; pass its path via CHROMIUM_PATH so
 * Playwright uses it instead of its (uninstalled) bundled download.
 */
import { chromium, type Page } from "playwright";
import { fetchPage } from "./crawler/fetcher";
import { assemblePage } from "./crawler/assemble";
import { DEFAULT_CONFIG } from "./crawler/config";
import type { ExtractedPage, FetchResult } from "./crawler/types";

const UA = DEFAULT_CONFIG.userAgent;
const EXEC = process.env.CHROMIUM_PATH;

async function autoScroll(page: Page): Promise<void> {
  // Bounded: stop when the bottom is reached OR after a hard cap on steps/time,
  // so infinite-scroll / lazy-ad pages (whose scrollHeight keeps growing) can't
  // loop forever.
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let total = 0;
      let steps = 0;
      const step = 800;
      const maxSteps = 40;
      const start = Date.now();
      const timer = setInterval(() => {
        const { scrollHeight } = document.body;
        window.scrollBy(0, step);
        total += step;
        steps += 1;
        const done =
          total >= scrollHeight ||
          steps >= maxSteps ||
          Date.now() - start > 12000;
        if (done) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 100);
    });
  });
}

async function expandHiddenContent(page: Page): Promise<void> {
  await page.evaluate(() => {
    document
      .querySelectorAll<HTMLDetailsElement>("details:not([open])")
      .forEach((d) => (d.open = true));
    document
      .querySelectorAll<HTMLElement>(
        '[aria-expanded="false"], .accordion-header, [data-accordion], button.read-more, .show-more',
      )
      .forEach((el) => {
        try {
          el.click();
        } catch {
          /* ignore */
        }
      });
  });
}

/** Render a page with the Nix Chromium, mirroring crawler/browser.ts logic. */
async function renderWithChromium(
  url: string,
  log: (m: string) => void,
): Promise<FetchResult> {
  if (!EXEC) throw new Error("CHROMIUM_PATH not set");
  const browser = await chromium.launch({
    executablePath: EXEC,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    const context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1366, height: 900 },
    });
    const page = await context.newPage();
    log("    [browser] goto…");
    // Server-rendered site: domcontentloaded is the reliable signal.
    // networkidle frequently never fires (ads/analytics), so we only wait for
    // it briefly, best-effort, after load.
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    });
    log("    [browser] settle…");
    // Give client JS a fixed window to run/inject content. networkidle is
    // unreliable here (ad/analytics stacks keep the network busy indefinitely).
    await page.waitForTimeout(2500);
    log("    [browser] scroll…");
    await autoScroll(page);
    log("    [browser] expand…");
    await expandHiddenContent(page);
    await page.waitForTimeout(500);
    log("    [browser] content…");
    const html = await page.content();
    return {
      requestedUrl: url,
      finalUrl: page.url(),
      httpStatus: response?.status() ?? 0,
      html,
      redirectChain: [],
      via: "browser",
      httpHeaders: response?.headers() ?? {},
    };
  } finally {
    await browser.close();
  }
}

async function locsFrom(url: string): Promise<string[]> {
  try {
    const xml = await fetch(url, { headers: { "user-agent": UA } }).then((r) =>
      r.text(),
    );
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  } catch {
    return [];
  }
}

async function pickUrls(): Promise<{ url: string; label: string }[]> {
  const posts = [
    ...(await locsFrom("https://www.headout.com/blog/post-sitemap.xml")),
    ...(await locsFrom("https://www.headout.com/blog/post-sitemap2.xml")),
  ].filter((u) => /\/blog\/.+/.test(u) && !/\/blog\/?$/.test(u));
  const cats = await locsFrom(
    "https://www.headout.com/blog/category-sitemap.xml",
  );

  const out: { url: string; label: string }[] = [];
  const tg = posts.find((u) => /thanksgiving/i.test(u));
  if (tg) out.push({ url: tg, label: "Thanksgiving listicle (north star)" });
  if (posts.length) {
    const a = posts[Math.floor(posts.length * 0.33)];
    const b = posts[Math.floor(posts.length * 0.66)];
    if (a && a !== tg) out.push({ url: a, label: "Article (sitemap sample A)" });
    if (b && b !== tg && b !== a)
      out.push({ url: b, label: "Article (sitemap sample B)" });
  }
  if (cats.length)
    out.push({
      url: cats[Math.floor(cats.length / 2)],
      label: "Category page",
    });
  return out.slice(0, 4);
}

const METRICS: (keyof ExtractedPage["counts"])[] = [
  "words",
  "components",
  "headings",
  "paragraphs",
  "images",
  "links",
  "faqs",
  "tables",
  "lists",
  "anchors",
  "ctas",
  "characters",
];

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

async function compareOne(url: string, label: string): Promise<void> {
  console.log("\n" + "=".repeat(78));
  console.log(`URL: ${url}`);
  console.log(`(${label})`);
  console.log("=".repeat(78));

  let http: ExtractedPage | null = null;
  let browser: ExtractedPage | null = null;
  let httpMs = 0;
  let browserMs = 0;

  try {
    const t0 = Date.now();
    const r = await fetchPage(url, { ...DEFAULT_CONFIG, useBrowser: false });
    httpMs = Date.now() - t0;
    http = assemblePage(r, null, DEFAULT_CONFIG);
  } catch (e) {
    console.log("  HTTP fetch FAILED:", (e as Error).message);
  }

  const t0 = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Hard guard: a stalled Headout page must never block the whole run.
    const renderP = renderWithChromium(url, (m) => console.log(m));
    renderP.catch(() => undefined); // suppress a late rejection if timeout wins
    const timeoutP = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error("hard timeout (45s)")), 45000);
    });
    timeoutP.catch(() => undefined); // suppress the loser of the race
    const r = await Promise.race([renderP, timeoutP]);
    browserMs = Date.now() - t0;
    browser = assemblePage(r, null, DEFAULT_CONFIG);
  } catch (e) {
    browserMs = Date.now() - t0;
    console.log("  BROWSER render FAILED:", (e as Error).message);
  } finally {
    if (timer) clearTimeout(timer);
  }

  console.log(
    `\n  fetch time:   HTTP ${httpMs} ms   |   BROWSER ${browserMs} ms   (${
      httpMs ? (browserMs / httpMs).toFixed(1) : "?"
    }x slower)`,
  );
  console.log(
    `  http status:  HTTP ${http?.httpStatus ?? "-"}        |   BROWSER ${
      browser?.httpStatus ?? "-"
    }`,
  );
  console.log(
    `  title match:  ${http?.title === browser?.title ? "yes" : "NO"}  (http="${(
      http?.title ?? ""
    ).slice(0, 50)}")`,
  );
  console.log(
    `  cleanedHtml:  HTTP ${http?.cleanedHtml.length ?? 0}  |  BROWSER ${
      browser?.cleanedHtml.length ?? 0
    } chars`,
  );

  console.log(
    `\n  ${pad("metric", 12)} ${pad("HTTP", 10)} ${pad("BROWSER", 10)} delta`,
  );
  console.log("  " + "-".repeat(44));
  for (const m of METRICS) {
    const h = http?.counts[m] ?? 0;
    const b = browser?.counts[m] ?? 0;
    const delta = b - h;
    const flag = delta === 0 ? "" : delta > 0 ? `  (+${delta} browser)` : `  (${delta})`;
    console.log(
      `  ${pad(m, 12)} ${pad(String(h), 10)} ${pad(String(b), 10)} ${flag}`,
    );
  }
}

async function main(): Promise<void> {
  console.log("Resolving representative URLs from sitemaps…");
  const urls = await pickUrls();
  if (urls.length === 0) {
    console.log("Could not resolve any URLs from sitemaps. Aborting.");
    return;
  }
  console.log(`Comparing ${urls.length} URLs (HTTP vs Playwright/Chromium):`);
  for (const u of urls) console.log(`  - ${u.label}: ${u.url}`);
  for (const { url, label } of urls) {
    await compareOne(url, label);
  }
  console.log("\nDone.");
  // Force exit: a leaked/hung browser from a hard-timed-out render would
  // otherwise keep the event loop alive.
  process.exit(0);
}

void main();
