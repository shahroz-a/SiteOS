import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * Proves the REAL cross-tab sync of the bulk alt-text suggestion pass
 * (`src/components/use-alt-review.ts` + `src/lib/bulk-alt-progress.ts`) in an
 * actual browser. The unit tests for this flow drive the `storage` event and
 * the persistence channel through mocks; the real mechanism relies on the
 * browser firing a `localStorage` `storage` event ONLY in *other* same-origin
 * tabs. That can only be exercised with two real pages sharing one context.
 *
 * We open two CMS media tabs, start the bulk pass in both, then:
 *   - approve an image in tab 1 and assert tab 2 reflects it as handled (with
 *     the exact alt text tab 1 saved) without re-suggesting or double-counting;
 *   - skip an image in tab 1 and assert tab 2 reflects it as skipped likewise.
 *
 * Only the media API boundary is stubbed (the list, the AI suggest batch, and
 * the alt save) so the test is deterministic and never mutates the seeded DB or
 * depends on the live AI vision model. The system under test — the real React
 * hooks, the real `bulk-alt-progress` localStorage writes, and the browser's
 * real cross-tab `storage` event — is NOT mocked. Auth (`/api/auth/*`,
 * `/api/cms/me`) still hits the real server, validated against the session the
 * global setup seeded.
 */

interface MockImage {
  url: string;
  fileName: string;
}

const IMAGES: MockImage[] = [
  { url: "https://cdn.example.test/img-a.jpg", fileName: "img-a.jpg" },
  { url: "https://cdn.example.test/img-b.jpg", fileName: "img-b.jpg" },
  { url: "https://cdn.example.test/img-c.jpg", fileName: "img-c.jpg" },
];

/** The deterministic suggestion the stubbed AI batch returns for a URL. */
function suggestionFor(url: string): string {
  return `AI draft for ${url}`;
}

/** A full MediaItem matching the OpenAPI contract, all flagged "missing". */
function mediaItem(img: MockImage) {
  return {
    url: img.url,
    originalUrl: img.url,
    alt: null,
    title: null,
    caption: null,
    credit: null,
    width: 800,
    height: 600,
    mimeType: "image/jpeg",
    role: null,
    usageCount: 1,
    pageCount: 1,
    altStatus: "missing" as const,
    altIssues: ["No alt text at all."],
    pages: [],
  };
}

/**
 * Stub the media API boundary on the shared context so BOTH tabs see the same
 * deterministic corpus. Real auth + everything else passes through.
 */
async function stubMediaApi(context: BrowserContext): Promise<void> {
  // Fail image loads fast so the <img> tiles fall back to the placeholder
  // instead of hanging on a non-existent CDN host.
  await context.route("https://cdn.example.test/**", (route) => route.abort());

  await context.route(/\/api\/cms\/media\/suggest-alt-batch$/, async (route) => {
    const body = route.request().postDataJSON() as { urls: string[] };
    const results = body.urls.map((url) => ({
      url,
      suggestion: suggestionFor(url),
    }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results }),
    });
  });

  await context.route(/\/api\/cms\/media\/alt$/, async (route) => {
    const body = route.request().postDataJSON() as { url: string; alt: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: body.url, alt: body.alt, updatedUsages: 1 }),
    });
  });

  // The list endpoint (also paged by the gather + fetchNext). Client-side code
  // does its own exclude filtering, so we always return the full corpus.
  await context.route(/\/api\/cms\/media(\?.*)?$/, async (route) => {
    const items = IMAGES.map(mediaItem);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items,
        pagination: { page: 1, limit: 100, total: items.length, totalPages: 1 },
        summary: { totalImages: items.length, withAltIssues: items.length },
      }),
    });
  });
}

/** Open /cms/media, start the bulk pass, and wait for suggestions to settle. */
async function openBulkPass(page: Page): Promise<void> {
  await page.goto("/cms/media");
  const startButton = page.getByRole("button", { name: /Suggest alt for/ });
  await expect(startButton).toBeVisible();
  await startButton.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Suggest alt text")).toBeVisible();

  // All three suggestions resolve to editable textareas (the "ready" state).
  await expect(dialog.getByRole("textbox")).toHaveCount(IMAGES.length);
}

/** The review row (scoped to the dialog) showing a given filename. */
function row(page: Page, fileName: string) {
  return page
    .getByRole("dialog")
    .locator("div.rounded-lg.border")
    .filter({ hasText: fileName });
}

test("approval in one tab syncs to another tab without re-suggesting or double-counting", async ({
  page,
  context,
}) => {
  await stubMediaApi(context);

  const page2 = await context.newPage();
  await openBulkPass(page);
  await openBulkPass(page2);

  const target = IMAGES[0]!;
  const editedAlt = "A purpose-written cross-tab alt description";

  // Tab 1: edit then approve image A. Editing proves the EXACT saved text — not
  // tab 2's own suggestion — is what propagates across the channel.
  const rowA1 = row(page, target.fileName);
  await rowA1.getByRole("textbox").fill(editedAlt);
  await rowA1.getByRole("button", { name: "Approve" }).click();

  // Tab 1 shows it saved.
  await expect(rowA1.getByText("Saved")).toBeVisible();
  await expect(rowA1.getByText(editedAlt)).toBeVisible();

  // Tab 2: the same image flips to "Saved" with the EXACT alt tab 1 saved,
  // driven purely by the real cross-tab `storage` event.
  const rowA2 = row(page2, target.fileName);
  await expect(rowA2.getByText("Saved")).toBeVisible();
  await expect(rowA2.getByText(editedAlt)).toBeVisible();

  // Reflected as handled exactly once: the approved tally is 1, not 2.
  const dialog2 = page2.getByRole("dialog");
  await expect(dialog2.getByText("1 approved")).toBeVisible();
  await expect(dialog2.getByText(/1 of \d+ handled/)).toBeVisible();

  // Not re-suggested in tab 2: no "Generating suggestion…" spinner for A, and
  // its textarea is gone (replaced by the saved state).
  await expect(rowA2.getByText("Generating suggestion…")).toHaveCount(0);
  await expect(rowA2.getByRole("textbox")).toHaveCount(0);

  await page2.close();
});

test("skip in one tab syncs to another tab without re-suggesting", async ({
  page,
  context,
}) => {
  await stubMediaApi(context);

  const page2 = await context.newPage();
  await openBulkPass(page);
  await openBulkPass(page2);

  const target = IMAGES[0]!;

  // Tab 1: skip image A.
  const rowA1 = row(page, target.fileName);
  await rowA1.getByRole("button", { name: "Skip" }).click();
  await expect(rowA1.getByText("Skipped")).toBeVisible();

  // Tab 2: the same image flips to "Skipped" via the real cross-tab event,
  // and the skipped tally surfaces the "Review 1 skipped" control.
  const rowA2 = row(page2, target.fileName);
  await expect(rowA2.getByText("Skipped")).toBeVisible();

  const dialog2 = page2.getByRole("dialog");
  await expect(
    dialog2.getByRole("button", { name: /Review 1 skipped/ }),
  ).toBeVisible();
  await expect(dialog2.getByText(/1 of \d+ handled/)).toBeVisible();

  // Not re-suggested in tab 2: no spinner and no editable textarea for A.
  await expect(rowA2.getByText("Generating suggestion…")).toHaveCount(0);
  await expect(rowA2.getByRole("textbox")).toHaveCount(0);

  await page2.close();
});
