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
import { and, asc, eq, inArray, ilike, or, desc, sql, type SQL } from "drizzle-orm";

export interface ListParams {
  page: number;
  limit: number;
  categorySlug?: string;
  authorSlug?: string;
  /**
   * One or more tag slugs. A post matches if it carries ANY of the given tags
   * (OR semantics), so multiple slugs broaden the result set.
   */
  tagSlugs?: string[];
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

async function tagPageIds(slugs: string[]): Promise<string[]> {
  if (slugs.length === 0) return [];
  const rows = await db
    .select({ pageId: pageTagsTable.pageId })
    .from(pageTagsTable)
    .innerJoin(tagsTable, eq(pageTagsTable.tagId, tagsTable.id))
    .where(inArray(tagsTable.slug, slugs));
  return Array.from(new Set(rows.map((r) => r.pageId)));
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
    // Defence in depth: only genuine blog articles live under `/blog/`. Even if a
    // non-blog commerce/main-site page were ever (re)stored as `pageType='post'`,
    // this keeps it out of the article feed. See `classifyUrl` in the crawler.
    ilike(pagesTable.canonicalUrl, "%/blog/%"),
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

  if (params.tagSlugs && params.tagSlugs.length > 0) {
    const ids = await tagPageIds(params.tagSlugs);
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

// ---------------------------------------------------------------------------
// CMS global search
// ---------------------------------------------------------------------------

export type CmsSearchSort =
  | "relevance"
  | "title"
  | "published"
  | "updated"
  | "created";

export interface CmsSearchParams {
  page: number;
  limit: number;
  q?: string;
  /** Restrict to a single page status (draft/published/archived). */
  status?: "draft" | "published" | "archived";
  /** Restrict to a single page type (post/page/category/...). */
  pageType?:
    | "post"
    | "page"
    | "category"
    | "author"
    | "tag"
    | "landing"
    | "web-story";
  language?: string;
  categorySlug?: string;
  authorSlug?: string;
  tagSlugs?: string[];
  sort?: CmsSearchSort;
}

/** Escape ILIKE wildcards so a literal query term matches verbatim. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Build the multi-field fuzzy match predicate for a search term. Matches the
 * page's own columns plus EXISTS sub-queries into every related content table
 * (SEO, FAQ, breadcrumbs, JSON-LD, internal/external links, body+CTA blocks,
 * author, categories, tags). Substring ILIKE is accelerated by pg_trgm GIN
 * indexes; the trailing `%` operator adds typo-tolerant fuzzy matching on the
 * title/slug.
 */
function buildSearchPredicate(q: string): SQL {
  const pattern = `%${escapeLike(q)}%`;
  return sql`(
    ${pagesTable.title} ILIKE ${pattern}
    OR ${pagesTable.slug} ILIKE ${pattern}
    OR ${pagesTable.subtitle} ILIKE ${pattern}
    OR ${pagesTable.excerpt} ILIKE ${pattern}
    OR ${pagesTable.canonicalUrl} ILIKE ${pattern}
    OR ${pagesTable.pathname} ILIKE ${pattern}
    OR ${pagesTable.title} % ${q}
    OR ${pagesTable.slug} % ${q}
    OR EXISTS (
      SELECT 1 FROM seo s WHERE s.page_id = ${pagesTable.id} AND (
        s.meta_title ILIKE ${pattern} OR s.meta_description ILIKE ${pattern}
        OR s.focus_keyword ILIKE ${pattern} OR s.og_title ILIKE ${pattern}
        OR s.og_description ILIKE ${pattern}
      )
    )
    OR EXISTS (
      SELECT 1 FROM faq f WHERE f.page_id = ${pagesTable.id} AND (
        f.question ILIKE ${pattern} OR f.answer ILIKE ${pattern}
      )
    )
    OR EXISTS (
      SELECT 1 FROM breadcrumbs b
      WHERE b.page_id = ${pagesTable.id} AND b.label ILIKE ${pattern}
    )
    OR EXISTS (
      SELECT 1 FROM jsonld j
      WHERE j.page_id = ${pagesTable.id} AND j.data::text ILIKE ${pattern}
    )
    OR EXISTS (
      SELECT 1 FROM internal_links il WHERE il.page_id = ${pagesTable.id} AND (
        il.anchor_text ILIKE ${pattern} OR il.href ILIKE ${pattern}
      )
    )
    OR EXISTS (
      SELECT 1 FROM external_links el WHERE el.page_id = ${pagesTable.id} AND (
        el.anchor_text ILIKE ${pattern} OR el.href ILIKE ${pattern}
      )
    )
    OR EXISTS (
      SELECT 1 FROM blocks bl
      WHERE bl.page_id = ${pagesTable.id} AND bl.text ILIKE ${pattern}
    )
    OR EXISTS (
      SELECT 1 FROM authors a
      WHERE a.id = ${pagesTable.authorId} AND a.name ILIKE ${pattern}
    )
    OR EXISTS (
      SELECT 1 FROM categories c
      WHERE (
        c.id = ${pagesTable.primaryCategoryId}
        OR c.id IN (
          SELECT pc.category_id FROM page_categories pc
          WHERE pc.page_id = ${pagesTable.id}
        )
      ) AND c.name ILIKE ${pattern}
    )
    OR EXISTS (
      SELECT 1 FROM tags tg
      JOIN page_tags pt ON pt.tag_id = tg.id
      WHERE pt.page_id = ${pagesTable.id} AND tg.name ILIKE ${pattern}
    )
  )`;
}

/**
 * Global CMS search over all content fields, with filters, sort and pagination.
 * Unlike the public `/search`, this spans every page status/type so staff can
 * find drafts and non-post pages too.
 */
export async function searchCmsPosts(params: CmsSearchParams) {
  const { page, limit } = params;
  const conditions: SQL[] = [];

  if (params.status) conditions.push(eq(pagesTable.status, params.status));
  if (params.pageType) conditions.push(eq(pagesTable.pageType, params.pageType));
  if (params.language) conditions.push(eq(pagesTable.language, params.language));

  if (params.authorSlug) {
    const authorId = await authorIdBySlug(params.authorSlug);
    if (!authorId) return emptyCmsList(page, limit);
    conditions.push(eq(pagesTable.authorId, authorId));
  }

  if (params.categorySlug) {
    const ids = await categoryPageIds(params.categorySlug);
    if (ids.length === 0) return emptyCmsList(page, limit);
    conditions.push(inArray(pagesTable.id, ids));
  }

  if (params.tagSlugs && params.tagSlugs.length > 0) {
    const ids = await tagPageIds(params.tagSlugs);
    if (ids.length === 0) return emptyCmsList(page, limit);
    conditions.push(inArray(pagesTable.id, ids));
  }

  const q = params.q?.trim();
  if (q) conditions.push(buildSearchPredicate(q));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pagesTable)
    .where(where);

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const offset = (page - 1) * limit;

  const sort: CmsSearchSort = params.sort ?? (q ? "relevance" : "updated");
  const orderBy: SQL[] = [];
  if (sort === "relevance" && q) {
    const pattern = `%${escapeLike(q)}%`;
    orderBy.push(
      sql`(
        (CASE WHEN ${pagesTable.title} ILIKE ${pattern} THEN 4 ELSE 0 END)
        + (CASE WHEN ${pagesTable.slug} ILIKE ${pattern} THEN 2 ELSE 0 END)
        + (CASE WHEN ${pagesTable.excerpt} ILIKE ${pattern} THEN 1 ELSE 0 END)
        + (CASE WHEN ${pagesTable.canonicalUrl} ILIKE ${pattern} THEN 1 ELSE 0 END)
        + similarity(${pagesTable.title}, ${q}) * 2
      ) DESC`,
    );
    orderBy.push(desc(pagesTable.updatedAt));
  } else if (sort === "title") {
    orderBy.push(asc(pagesTable.title));
  } else if (sort === "published") {
    orderBy.push(sql`${pagesTable.publishedAt} desc nulls last`);
    orderBy.push(desc(pagesTable.createdAt));
  } else if (sort === "created") {
    orderBy.push(desc(pagesTable.createdAt));
  } else {
    orderBy.push(desc(pagesTable.updatedAt));
  }

  // Explicit projection — never select the lossless HTML blobs here.
  const rows = await db
    .select({
      id: pagesTable.id,
      slug: pagesTable.slug,
      title: pagesTable.title,
      subtitle: pagesTable.subtitle,
      excerpt: pagesTable.excerpt,
      canonicalUrl: pagesTable.canonicalUrl,
      pathname: pagesTable.pathname,
      status: pagesTable.status,
      pageType: pagesTable.pageType,
      language: pagesTable.language,
      featuredImageUrl: pagesTable.featuredImageUrl,
      featuredImageAlt: pagesTable.featuredImageAlt,
      readingTimeMinutes: pagesTable.readingTimeMinutes,
      wordCount: pagesTable.wordCount,
      publishedAt: pagesTable.publishedAt,
      modifiedAt: pagesTable.modifiedAt,
      updatedAt: pagesTable.updatedAt,
      authorId: pagesTable.authorId,
      primaryCategoryId: pagesTable.primaryCategoryId,
    })
    .from(pagesTable)
    .where(where)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset);

  const items = await buildCmsSearchItems(rows);

  return { items, pagination: { page, limit, total, totalPages } };
}

function emptyCmsList(page: number, limit: number) {
  return { items: [], pagination: { page, limit, total: 0, totalPages: 1 } };
}

type CmsSearchRow = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  excerpt: string | null;
  canonicalUrl: string;
  pathname: string;
  status: Page["status"];
  pageType: Page["pageType"];
  language: string;
  featuredImageUrl: string | null;
  featuredImageAlt: string | null;
  readingTimeMinutes: number | null;
  wordCount: number | null;
  publishedAt: Date | null;
  modifiedAt: Date | null;
  updatedAt: Date;
  authorId: string | null;
  primaryCategoryId: string | null;
};

/** Map CMS search rows to richer result items (status/type aware). */
async function buildCmsSearchItems(rows: CmsSearchRow[]) {
  if (rows.length === 0) return [];

  const pageIds = rows.map((r) => r.id);
  const authorIds = unique(
    rows.map((r) => r.authorId).filter((v): v is string => Boolean(v)),
  );
  const categoryIds = unique(
    rows
      .map((r) => r.primaryCategoryId)
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

  return rows.map((r) => {
    const author = r.authorId ? authorMap.get(r.authorId) : undefined;
    const category = r.primaryCategoryId
      ? categoryMap.get(r.primaryCategoryId)
      : undefined;
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      subtitle: r.subtitle,
      excerpt: r.excerpt,
      canonicalUrl: r.canonicalUrl,
      pathname: r.pathname,
      status: r.status,
      pageType: r.pageType,
      language: r.language,
      featuredImageUrl: r.featuredImageUrl,
      featuredImageAlt: r.featuredImageAlt,
      readingTimeMinutes: r.readingTimeMinutes,
      wordCount: r.wordCount,
      publishedAt: r.publishedAt,
      modifiedAt: r.modifiedAt,
      updatedAt: r.updatedAt,
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
      tags: tagsByPage.get(r.id) ?? [],
    };
  });
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
