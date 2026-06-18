import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { categoriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ListCategoriesResponse,
  GetCategoryBySlugParams,
  GetCategoryBySlugResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/categories", async (_req, res) => {
  const rows = await db
    .select({
      id: categoriesTable.id,
      name: categoriesTable.name,
      slug: categoriesTable.slug,
      description: categoriesTable.description,
      parentId: categoriesTable.parentId,
      path: categoriesTable.path,
    })
    .from(categoriesTable);

  res.json(ListCategoriesResponse.parse(rows));
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
