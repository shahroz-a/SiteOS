import { test, expect } from "@playwright/test";
import { expectNoUuidLinks } from "./helpers";

test.describe("Category & author pages", () => {
  test("category page lists its posts", async ({ page }) => {
    await page.goto("/blog/category/destinations");

    await expect(
      page.getByRole("heading", { name: "Destinations", level: 1 }),
    ).toBeVisible();

    // At least one post card, and the known SF guide is listed.
    await expect(page.locator("article").first()).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: "A Weekend in San Francisco with Kids",
      }),
    ).toBeVisible();

    await expectNoUuidLinks(page);
  });

  test("author page lists the author's posts", async ({ page }) => {
    await page.goto("/blog/author/marcus-vaughn");

    await expect(
      page.getByRole("heading", { name: "Marcus Vaughn", level: 1 }),
    ).toBeVisible();

    const cards = page.locator('article a[href^="/blog/"]');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(0);

    await expectNoUuidLinks(page);
  });

  test("clicking an author from an article opens the author page", async ({
    page,
  }) => {
    await page.goto("/blog/weekend-in-san-francisco-with-kids");
    await page.getByRole("link", { name: "Marcus Vaughn" }).first().click();
    await expect(page).toHaveURL(/\/blog\/author\/marcus-vaughn$/);
    await expect(
      page.getByRole("heading", { name: "Marcus Vaughn", level: 1 }),
    ).toBeVisible();
  });
});
