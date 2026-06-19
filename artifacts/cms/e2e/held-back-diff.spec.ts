import { test, expect } from "@playwright/test";
import { assertHighlightsPersistAndNavigate } from "./diff-helpers";

/**
 * Covers the held-back review queue drawer (`ArticleDrawer` in
 * `src/pages/held-back.tsx`, route `/cms/review-queue`), which renders the SAME
 * `SourceDiff` component as the editor's "Import diff" drawer. The editor
 * surface is already covered by `import-diff.spec.ts`; this guards the held-back
 * surface so a regression in EITHER place is caught.
 *
 * We need a deterministic article that is actually in the held-back queue
 * (`pages.status="draft"` + `page_type="post"`) AND has real source-vs-parsed
 * differences. Rather than depend on a fragile seeded row, we create one: a
 * fresh draft post whose faithful source body (`contentHtml` → `cleanedHtml`)
 * is rich (many paragraphs + an image + a link) but whose parsed tree is empty.
 * That is the canonical "the importer extracted nothing" held-back case, so the
 * diff flags every source paragraph as dropped plus the missing image and
 * dropped link — producing the `.diff-marker` highlights this test asserts. The
 * post is deleted in `finally` so reruns stay deterministic.
 */

/**
 * Build a rich source body. Many longish paragraphs (so the 60vh source pane
 * actually scrolls) plus an image and a link partway down, so the diff produces
 * dropped-paragraph, missing-image, and dropped-link markers spread top-to-bottom.
 */
function buildSourceHtml(): string {
  const blocks = Array.from(
    { length: 16 },
    (_, i) =>
      `<p>Source paragraph ${i + 1}: this faithful sentence describes part of ` +
      `the original article body that the importer failed to carry across into ` +
      `the structured parse, so the diff must flag it as a dropped paragraph in ` +
      `the held-back review drawer.</p>`,
  );
  // Drop an image and a link partway down so they become markers too.
  blocks.splice(
    8,
    0,
    '<figure><img src="https://images.example.com/held-back-diff-fixture.jpg" alt="A dropped fixture image"></figure>',
    '<p>See our <a href="https://example.com/held-back-diff-fixture-guide">full visitor guide</a> for more details about this fixture.</p>',
  );
  return blocks.join("\n");
}

test("held-back review drawer highlights and navigates source diffs", async ({
  page,
}) => {
  let draftId: string | undefined;
  const slug = `e2e-held-back-diff-${Date.now()}`;

  try {
    // Create a held-back draft post via the API. The storageState cookie
    // authenticates this request as the seeded admin. An empty parsed tree
    // (componentTree []/richText null) means EVERY source block is "dropped".
    const res = await page.request.post(`/api/cms/posts`, {
      data: {
        title: `E2E Held-Back Diff Fixture ${slug}`,
        slug,
        status: "draft",
        contentHtml: buildSourceHtml(),
        componentTree: [],
        richText: null,
      },
    });
    expect(res.ok()).toBe(true);
    const created = (await res.json()) as { id: string; slug: string };
    draftId = created.id;
    expect(draftId).toBeTruthy();
    expect(created.slug).toBe(slug);

    // Open the review queue and narrow to our freshly created draft by slug
    // (unique), so we click the right row even if other drafts are present.
    await page.goto("/cms/review-queue");
    await expect(
      page.getByRole("heading", { name: "Review queue" }),
    ).toBeVisible();
    await page.getByPlaceholder("Search by title or slug…").fill(slug);

    const row = page.getByRole("row").filter({ hasText: slug });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Review" }).click();

    // The drawer opens with the side-by-side source-vs-parsed diff.
    const sheet = page.getByRole("dialog");
    await expect(
      sheet.getByRole("heading", { name: "Source vs. parsed content" }),
    ).toBeVisible();

    // The error fallback must NOT be shown.
    await expect(
      sheet.getByText("Couldn't load the source preview for this article."),
    ).toHaveCount(0);

    // The source pane renders the faithful body into a `.blog-prose` container.
    // The parsed pane is intentionally empty, so it shows the "extracted no
    // structured content" message instead of a second `.blog-prose`.
    const sourcePane = sheet.locator(".blog-prose").first();
    await expect(sourcePane).toBeVisible();
    await expect(
      sheet.getByText("The importer extracted no structured content", {
        exact: false,
      }),
    ).toBeVisible();

    // The diff controls resolve to a real "differences found" state.
    await expect(
      sheet.getByRole("button", { name: "Next difference" }),
    ).toBeVisible();

    // Real diffs are present, so highlights must render, persist, and Next/Prev
    // must ring + scroll the active marker into view.
    await assertHighlightsPersistAndNavigate(page);
  } finally {
    // Clean up the created draft so reruns stay deterministic.
    if (draftId) {
      await page.request.delete(`/api/cms/posts/${draftId}`);
    }
  }
});
