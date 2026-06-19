import { test, expect, type Page } from "@playwright/test";

/**
 * Covers the editor's importer diff drawer (`ImportDiffSheet` in
 * `src/pages/editor.tsx`, rendering `SourceDiff` from
 * `src/components/source-diff.tsx`). For both a published and a freshly
 * duplicated draft article we open the editor, click "Import diff", and assert
 * the two panes — the original source ("Original article") and the importer's
 * parsed output ("What the importer extracted") — both render real content.
 */

// A known published post in the seeded corpus.
const PUBLISHED_ID = "4d2c1aa8-a78c-4fa8-ba33-ed59f971132f";
const PUBLISHED_TITLE = "The top 10 Louvre paintings every visitor should see";

const titleInput = (page: Page) =>
  page.locator('input[placeholder="Untitled article"]');

async function openDiffAndAssertPanes(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Import diff" }).click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Importer diff")).toBeVisible();

  // Both pane headings render.
  await expect(
    sheet.getByRole("heading", { name: /Original article/ }),
  ).toBeVisible();
  await expect(
    sheet.getByRole("heading", { name: "What the importer extracted" }),
  ).toBeVisible();

  // The error fallback must NOT be shown.
  await expect(
    sheet.getByText("Couldn't load the source preview for this article."),
  ).toHaveCount(0);

  // Both panes render their HTML into a `.blog-prose` container with content.
  const panes = sheet.locator(".blog-prose");
  await expect(panes).toHaveCount(2);
  await expect(panes.first()).toBeVisible();
  await expect(panes.last()).toBeVisible();

  const sourceText = (await panes.first().innerText()).trim();
  const parsedText = (await panes.last().innerText()).trim();
  expect(sourceText.length).toBeGreaterThan(50);
  expect(parsedText.length).toBeGreaterThan(50);

  // The diff controls resolve to a real state (markers found OR none).
  await expect(
    sheet
      .getByRole("button", { name: "Next difference" })
      .or(sheet.getByText("No differences detected", { exact: false })),
  ).toBeVisible();
}

/**
 * When the article actually has differences, the left source pane must visually
 * highlight them (`.diff-marker`) and those highlights must *persist* — the bug
 * this guards against is the classes being added then immediately wiped by a
 * React re-render of the `dangerouslySetInnerHTML` source pane. Clicking "Next
 * difference" must ring (`.ring-2`) the active element and scroll it into view.
 */
async function assertHighlightsPersistAndNavigate(page: Page): Promise<void> {
  const sheet = page.getByRole("dialog");
  const nextBtn = sheet.getByRole("button", { name: "Next difference" });

  // Some seeded articles legitimately have no differences — nothing to assert.
  if ((await nextBtn.count()) === 0) return;

  const sourcePane = sheet.locator(".blog-prose").first();
  // The scroll container is the `.blog-prose`'s parent (the `h-[60vh]
  // overflow-y-auto` pane); `scrollIntoView` moves that, not `.blog-prose`.
  const sourceScroller = sourcePane.locator("xpath=..");
  const markers = sourcePane.locator(".diff-marker");

  // Highlights appear...
  await expect(markers.first()).toBeVisible();
  const markerCount = await markers.count();
  expect(markerCount).toBeGreaterThan(0);

  // ...and PERSIST across re-renders (the original bug wiped them ~immediately).
  await page.waitForTimeout(750);
  expect(await markers.count()).toBe(markerCount);

  // Clicking "Next difference" rings exactly one source element and scrolls it
  // into the viewport. We click through enough markers to force a scroll away
  // from the top (the first marker may already be at scrollTop 0).
  const startScroll = await sourceScroller.evaluate((el) => el.scrollTop);
  let sawRing = false;
  let sawScroll = false;
  for (let i = 0; i < markerCount && i < 8; i++) {
    await nextBtn.click();
    // Exactly one element carries the active ring, and it is a diff marker.
    await expect(sheet.locator(".diff-marker.ring-2")).toHaveCount(1);
    // The ring must survive the re-render that the click triggers.
    await page.waitForTimeout(400);
    await expect(sheet.locator(".diff-marker.ring-2")).toHaveCount(1);
    sawRing = true;
    if ((await sourceScroller.evaluate((el) => el.scrollTop)) !== startScroll) {
      sawScroll = true;
      break;
    }
  }
  expect(sawRing).toBe(true);
  expect(sawScroll).toBe(true);
}

test("import diff drawer renders both panes for a published article", async ({
  page,
}) => {
  await page.goto(`/cms/content/${PUBLISHED_ID}`);
  await expect(titleInput(page)).toHaveValue(/Louvre/);
  await openDiffAndAssertPanes(page);
  await assertHighlightsPersistAndNavigate(page);
});

test("import diff drawer renders both panes for a draft article", async ({
  page,
}) => {
  let draftId: string | undefined;
  try {
    // Duplicate the published post to get a draft, then open its editor.
    await page.goto("/cms/content");
    await page
      .getByPlaceholder("Search by title or slug…")
      .fill(PUBLISHED_TITLE);

    const row = page.getByText(PUBLISHED_TITLE).first();
    await expect(row).toBeVisible();
    await row.hover();
    await page.getByRole("button", { name: "Duplicate" }).first().click();

    await page.waitForURL(/\/cms\/content\/[0-9a-f-]+$/);
    draftId = page.url().split("/").pop();
    await expect(titleInput(page)).toHaveValue(/\(Copy\)/);

    await openDiffAndAssertPanes(page);
  } finally {
    // Clean up the duplicated draft so reruns stay deterministic. The
    // storageState cookie authenticates this request as the seeded admin.
    if (draftId) {
      await page.request.delete(`/api/cms/posts/${draftId}`);
    }
  }
});
