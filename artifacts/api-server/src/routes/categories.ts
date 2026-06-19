import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { categoriesTable, pagesTable, pageCategoriesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  ListCategoriesResponse,
  GetCategoryBySlugParams,
  GetCategoryBySlugResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * Lists the navigable top-level categories: those with `parentId = null` that
 * actually carry at least one published post, ordered by post count (desc) then
 * name (asc). The scraped nav/footer "junk" categories remain in the table but
 * never surface here because they link only to category pages, not posts.
 *
 * Counts are derived in JS from two simple SELECTs (a full category scan plus
 * the published-post links) rather than a SQL GROUP BY, keeping the query within
 * what the read path needs and the test harness models.
 */
router.get("/categories", async (_req, res) => {
  const categories = await db
    .select({
      id: categoriesTable.id,
      name: categoriesTable.name,
      slug: categoriesTable.slug,
      description: categoriesTable.description,
      parentId: categoriesTable.parentId,
      path: categoriesTable.path,
      archivedAt: categoriesTable.archivedAt,
    })
    .from(categoriesTable);

  const links = await db
    .select({
      categoryId: pageCategoriesTable.categoryId,
      pageId: pageCategoriesTable.pageId,
    })
    .from(pageCategoriesTable)
    .innerJoin(pagesTable, eq(pagesTable.id, pageCategoriesTable.pageId))
    .where(
      and(eq(pagesTable.status, "published"), eq(pagesTable.pageType, "post")),
    );

  const postsByCategory = new Map<string, Set<string>>();
  for (const link of links) {
    let set = postsByCategory.get(link.categoryId);
    if (!set) {
      set = new Set();
      postsByCategory.set(link.categoryId, set);
    }
    set.add(link.pageId);
  }

  const navigable = categories
    .filter(
      (c) =>
        c.archivedAt == null &&
        c.parentId == null &&
        (postsByCategory.get(c.id)?.size ?? 0) > 0,
    )
    .map((c) => ({ category: c, count: postsByCategory.get(c.id)!.size }))
    .sort((a, b) => b.count - a.count || a.category.name.localeCompare(b.category.name))
    .map((entry) => entry.category);

  res.json(ListCategoriesResponse.parse(navigable));
});

router.get("/categories/:slug", async (req, res) => {
  const { slug } = GetCategoryBySlugParams.parse(req.params);

  const [category] = await db
    .select({
      id: categoriesTable.id,
      name: categoriesTable.name,
      slug: categoriesTable.slug,
      description: categoriesTable.description,
      parentId: categoriesTable.parentId,
      path: categoriesTable.path,
    })
    .from(categoriesTable)
    .where(eq(categoriesTable.slug, slug))
    .limit(1);

  if (!category) {
    res.status(404).json({ error: "Category not found" });
    return;
  }

  res.json(GetCategoryBySlugResponse.parse(category));
});

export default router;
