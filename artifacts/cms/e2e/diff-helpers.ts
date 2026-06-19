import { expect, type Page } from "@playwright/test";

/**
 * Shared assertions for the `SourceDiff` component
 * (`src/components/source-diff.tsx`), which is reused by BOTH the editor's
 * "Import diff" drawer and the held-back review queue drawer. Keeping the
 * highlight/navigation checks in one place means the two e2e surfaces
 * (`import-diff.spec.ts`, `held-back-diff.spec.ts`) can't drift.
 *
 * Pass the open drawer's `dialog` so the locators stay scoped to it.
 */

/**
 * When the article actually has differences, the left source pane must visually
 * highlight them (`.diff-marker`) and those highlights must *persist* — the bug
 * this guards against is the classes being added then immediately wiped by a
 * React re-render of the `dangerouslySetInnerHTML` source pane. Clicking "Next
 * difference" must ring (`.ring-2`) the active element and scroll it into view.
 */
export async function assertHighlightsPersistAndNavigate(
  page: Page,
): Promise<void> {
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
