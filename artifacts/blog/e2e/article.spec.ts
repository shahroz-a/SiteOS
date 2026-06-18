import { test, expect } from "@playwright/test";
import { expectNoUuidLinks } from "./helpers";

test.describe("Article pages", () => {
  test("renders a componentTree article (TOC + FAQ + body)", async ({
    page,
  }) => {
    await page.goto("/blog/barcelona-aquarium");

    await expect(
      page
        .getByRole("heading", {
          name: "Barcelona Aquarium: Visitor's guide to Europe's top aquarium",
          level: 1,
        })
        .first(),
    ).toBeVisible();

    // Author block.
    await expect(page.getByText("Rohit Jadhav").first()).toBeVisible();

    // Breadcrumbs start at the blog root.
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb.getByText("Blog")).toBeVisible();

    // Body renders real content via the componentTree renderer.
    const body = page.locator(".blog-content");
    await expect(body).toBeVisible();
    expect((await body.innerText()).length).toBeGreaterThan(200);
    expect(await body.locator("h3, h2, p").count()).toBeGreaterThan(3);

    // Table of contents (desktop + mobile both render this landmark).
    await expect(
      page.getByRole("navigation", { name: "Table of contents" }).first(),
    ).toBeVisible();

    // FAQ section.
    await expect(
      page.getByRole("heading", { name: "Frequently asked questions" }),
    ).toBeVisible();

    await expectNoUuidLinks(page);
  });

  test("renders a richText-only article with related articles", async ({
    page,
  }) => {
    await page.goto("/blog/weekend-in-san-francisco-with-kids");

    await expect(
      page
        .getByRole("heading", {
          name: "A Weekend in San Francisco with Kids",
          level: 1,
        })
        .first(),
    ).toBeVisible();

    await expect(page.getByText("Marcus Vaughn").first()).toBeVisible();

    const body = page.locator(".blog-content");
    await expect(body).toBeVisible();
    expect((await body.innerText()).length).toBeGreaterThan(100);

    // Related-articles strip with at least one card.
    const related = page.getByRole("heading", { name: "More reads" });
    await expect(related).toBeVisible();
    await expect(page.locator('article a[href^="/blog/"]').first()).toBeVisible();

    await expectNoUuidLinks(page);
  });
});
