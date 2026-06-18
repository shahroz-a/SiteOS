import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { tagsTable, pageTagsTable, pagesTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { ListTagsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/tags", async (_req, res) => {
  const rows = await db
    .select({
      id: tagsTable.id,
      name: tagsTable.name,
      slug: tagsTable.slug,
      postCount: sql<number>`count(${pagesTable.id})::int`,
    })
    .from(tagsTable)
    .leftJoin(pageTagsTable, eq(pageTagsTable.tagId, tagsTable.id))
    .leftJoin(
      pagesTable,
      and(
        eq(pagesTable.id, pageTagsTable.pageId),
        eq(pagesTable.status, "published"),
        eq(pagesTable.pageType, "post"),
      ),
    )
    .groupBy(tagsTable.id, tagsTable.name, tagsTable.slug)
    .orderBy(tagsTable.name);

  res.json(ListTagsResponse.parse(rows));
});

export default router;
