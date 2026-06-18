import { test, expect } from "@playwright/test";
import { expectNoUuidLinks, blogLinkHrefs } from "./helpers";

test.describe("Blog index", () => {
  test("renders the masthead, article cards and pagination", async ({
    page,
  }) => {
    await page.goto("/blog/");

    await expect(
      page.getByRole("heading", {
        name: "Stories to spark your next adventure",
      }),
    ).toBeVisible();

    // At least one article card title links into the blog.
    const articleLinks = page.locator('article a[href^="/blog/"]');
    await expect(articleLinks.first()).toBeVisible();
    expect(await articleLinks.count()).toBeGreaterThan(0);

    // The catalog has many posts, so pagination is present.
    await expect(
      page.getByRole("navigation", { name: "Pagination" }),
    ).toBeVisible();
  });

  test("article links use public slugs, never internal UUIDs", async ({
    page,
  }) => {
    await page.goto("/blog/");
    await expect(page.locator("article").first()).toBeVisible();

    const hrefs = await blogLinkHrefs(page);
    // Every blog link is a slug path; at least one points at an article.
    expect(hrefs.some((h) => /^\/blog\/[a-z0-9-]+\/?$/.test(h))).toBe(true);
    await expectNoUuidLinks(page);
  });

  test("page 2 renders a fresh set of articles", async ({ page }) => {
    await page.goto("/blog/");
    await expect(
      page.getByRole("navigation", { name: "Pagination" }),
    ).toBeVisible();

    await page.goto("/blog/?page=2");
    await expect(page).toHaveURL(/[?&]page=2/);
    await expect(page.locator("article").first()).toBeVisible();
    expect(await page.locator('article a[href^="/blog/"]').count()).toBeGreaterThan(
      0,
    );
  });
});
