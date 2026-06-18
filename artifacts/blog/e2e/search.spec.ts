import { test, expect } from "@playwright/test";
import { expectNoUuidLinks } from "./helpers";

test.describe("Search", () => {
  test("returns matching articles for a query", async ({ page }) => {
    await page.goto("/blog/search?q=christmas");

    // Result count summary renders for a query with matches.
    await expect(page.getByText(/result(s)? for/i)).toBeVisible();

    // Real article cards are rendered in the results grid.
    const resultLinks = page.locator('article a[href^="/blog/"]');
    await expect(resultLinks.first()).toBeVisible();
    expect(await resultLinks.count()).toBeGreaterThan(0);

    await expectNoUuidLinks(page);
  });

  test("searching from the input navigates to results", async ({ page }) => {
    await page.goto("/blog/search");
    const input = page
      .getByRole("main")
      .getByRole("searchbox", { name: "Search articles" });
    await input.fill("christmas");
    await input.press("Enter");

    await expect(page).toHaveURL(/\/blog\/search\?q=christmas/);
    await expect(page.getByText(/result(s)? for/i)).toBeVisible();
    await expect(
      page.locator('article a[href^="/blog/"]').first(),
    ).toBeVisible();
  });
});
