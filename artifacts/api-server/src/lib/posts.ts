import { db } from "@workspace/db";
import {
  pagesTable,
  authorsTable,
  categoriesTable,
  tagsTable,
  pageTagsTable,
  pageCategoriesTable,
  type Page,
} from "@workspace/db";
import { and, eq, inArray, ilike, or, desc, sql, type SQL } from "drizzle-orm";

export interface ListParams {
  page: number;
  limit: number;
  categorySlug?: string;
  authorSlug?: string;
  tagSlug?: string;
  q?: string;
}

/**
 * Resolve the set of page ids linked to a category slug, via either the
 * many-to-many table or the page's primary category.
 */
async function categoryPageIds(slug: string): Promise<string[]> {
  const [category] = await db
    .select({ id: categoriesTable.id })
    .from(categoriesTable)
    .where(eq(categoriesTable.slug, slug))
    .limit(1);
  if (!category) return [];

  const linked = await db
    .select({ pageId: pageCategoriesTable.pageId })
    .from(pageCategoriesTable)
    .where(eq(pageCategoriesTable.categoryId, category.id));

  const primary = await db
    .select({ id: pagesTable.id })
    .from(pagesTable)
    .where(eq(pagesTable.primaryCategoryId, category.id));

  return Array.from(
    new Set([...linked.map((r) => r.pageId), ...primary.map((r) => r.id)]),
  );
}

async function tagPageIds(slug: string): Promise<string[]> {
  const rows = await db
    .select({ pageId: pageTagsTable.pageId })
    .from(pageTagsTable)
    .innerJoin(tagsTable, eq(pageTagsTable.tagId, tagsTable.id))
    .where(eq(tagsTable.slug, slug));
  return rows.map((r) => r.pageId);
}

async function authorIdBySlug(slug: string): Promise<string | null> {
  const [author] = await db
    .select({ id: authorsTable.id })
    .from(authorsTable)
    .where(eq(authorsTable.slug, slug))
    .limit(1);
  return author?.id ?? null;
}

/**
 * Build a paginated PostListResponse for the given filters. Returns a result
 * already shaped for the `PostListResponse` zod schema.
 */
export async function listPosts(params: ListParams) {
  const { page, limit } = params;
  const conditions: SQL[] = [
    eq(pagesTable.status, "published"),
    eq(pagesTable.pageType, "post"),
  ];

  if (params.authorSlug) {
    const authorId = await authorIdBySlug(params.authorSlug);
    if (!authorId) return emptyList(page, limit);
    conditions.push(eq(pagesTable.authorId, authorId));
  }

  if (params.categorySlug) {
    const ids = await categoryPageIds(params.categorySlug);
    if (ids.length === 0) return emptyList(page, limit);
    conditions.push(inArray(pagesTable.id, ids));
  }

  if (params.tagSlug) {
    const ids = await tagPageIds(params.tagSlug);
    if (ids.length === 0) return emptyList(page, limit);
    conditions.push(inArray(pagesTable.id, ids));
  }

  if (params.q) {
    const term = `%${params.q}%`;
    const search = or(
      ilike(pagesTable.title, term),
      ilike(pagesTable.excerpt, term),
      ilike(pagesTable.cleanedHtml, term),
    );
    if (search) conditions.push(search);
  }

  const where = and(...conditions);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pagesTable)
    .where(where);

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const offset = (page - 1) * limit;

  const rows = await db
    .select()
    .from(pagesTable)
    .where(where)
    .orderBy(sql`${pagesTable.publishedAt} desc nulls last`, desc(pagesTable.createdAt))
    .limit(limit)
    .offset(offset);

  const items = await buildSummaries(rows);

  return { items, pagination: { page, limit, total, totalPages } };
}

function emptyList(page: number, limit: number) {
  return { items: [], pagination: { page, limit, total: 0, totalPages: 1 } };
}

/**
 * Map a set of page rows to PostSummary objects, batch-loading their author,
 * primary category and tags.
 */
export async function buildSummaries(pages: Page[]) {
  if (pages.length === 0) return [];

  const pageIds = pages.map((p) => p.id);
  const authorIds = unique(
    pages.map((p) => p.authorId).filter((v): v is string => Boolean(v)),
  );
  const categoryIds = unique(
    pages
      .map((p) => p.primaryCategoryId)
      .filter((v): v is string => Boolean(v)),
  );

  const authors =
    authorIds.length > 0
      ? await db
          .select()
          .from(authorsTable)
          .where(inArray(authorsTable.id, authorIds))
      : [];
  const authorMap = new Map(authors.map((a) => [a.id, a]));

  const categories =
    categoryIds.length > 0
      ? await db
          .select()
          .from(categoriesTable)
          .where(inArray(categoriesTable.id, categoryIds))
      : [];
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  const tagRows = await db
    .select({
      pageId: pageTagsTable.pageId,
      id: tagsTable.id,
      name: tagsTable.name,
      slug: tagsTable.slug,
    })
    .from(pageTagsTable)
    .innerJoin(tagsTable, eq(pageTagsTable.tagId, tagsTable.id))
    .where(inArray(pageTagsTable.pageId, pageIds));

  const tagsByPage = new Map<string, { id: string; name: string; slug: string }[]>();
  for (const row of tagRows) {
    const list = tagsByPage.get(row.pageId) ?? [];
    list.push({ id: row.id, name: row.name, slug: row.slug });
    tagsByPage.set(row.pageId, list);
  }

  return pages.map((p) => {
    const author = p.authorId ? authorMap.get(p.authorId) : undefined;
    const category = p.primaryCategoryId
      ? categoryMap.get(p.primaryCategoryId)
      : undefined;
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      subtitle: p.subtitle,
      excerpt: p.excerpt,
      canonicalUrl: p.canonicalUrl,
      pathname: p.pathname,
      featuredImageUrl: p.featuredImageUrl,
      featuredImageAlt: p.featuredImageAlt,
      readingTimeMinutes: p.readingTimeMinutes,
      publishedAt: p.publishedAt,
      author: author
        ? {
            id: author.id,
            name: author.name,
            slug: author.slug,
            avatarUrl: author.avatarUrl,
            role: author.role,
          }
        : null,
      primaryCategory: category
        ? { id: category.id, name: category.name, slug: category.slug }
        : null,
      tags: tagsByPage.get(p.id) ?? [],
    };
  });
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
