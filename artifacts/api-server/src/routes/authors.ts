import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { authorsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ListAuthorsResponse,
  GetAuthorBySlugParams,
  GetAuthorBySlugResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/authors", async (_req, res) => {
  const rows = await db
    .select({
      id: authorsTable.id,
      name: authorsTable.name,
      slug: authorsTable.slug,
      bio: authorsTable.bio,
      avatarUrl: authorsTable.avatarUrl,
      role: authorsTable.role,
      email: authorsTable.email,
      originalUrl: authorsTable.originalUrl,
      social: authorsTable.social,
    })
    .from(authorsTable);

  res.json(ListAuthorsResponse.parse(rows));
});

router.get("/authors/:slug", async (req, res) => {
  const { slug } = GetAuthorBySlugParams.parse(req.params);

  const [author] = await db
    .select({
      id: authorsTable.id,
      name: authorsTable.name,
      slug: authorsTable.slug,
      bio: authorsTable.bio,
      avatarUrl: authorsTable.avatarUrl,
      role: authorsTable.role,
      email: authorsTable.email,
      originalUrl: authorsTable.originalUrl,
      social: authorsTable.social,
    })
    .from(authorsTable)
    .where(eq(authorsTable.slug, slug))
    .limit(1);

  if (!author) {
    res.status(404).json({ error: "Author not found" });
    return;
  }

  res.json(GetAuthorBySlugResponse.parse(author));
});

export default router;
