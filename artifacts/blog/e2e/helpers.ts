import { expect, type Page } from "@playwright/test";

/** Matches an internal UUID anywhere in a string. */
export const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Assert that no link on the page leaks an internal UUID. Public routing must
 * use slugs only — internal UUIDs must never appear in any href.
 */
export async function expectNoUuidLinks(page: Page): Promise<void> {
  const hrefs = await page
    .locator("a[href]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) {
    expect(href, `href should not contain a UUID: ${href}`).not.toMatch(
      UUID_RE,
    );
  }
}

/**
 * Return the hrefs of in-app article/taxonomy links (those routed under the
 * blog base path `/blog/`).
 */
export async function blogLinkHrefs(page: Page): Promise<string[]> {
  return page
    .locator('a[href^="/blog/"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
}
