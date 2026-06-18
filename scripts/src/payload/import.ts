/**
 * Round-trip Payload CMS collection documents back into the migration database.
 * This is the reverse of `export-payload.ts` / `mapping.ts`: it consumes the
 * same JSON shape the export produces (and that a Payload instance can re-emit
 * after editors change content) and upserts it into the migration DB.
 *
 * DB-touching but CLI-free so it can be unit-tested with a fake `db`. The thin
 * CLI wrapper lives in `../import-payload.ts`.
 *
 * Idempotent: pages upsert on canonical URL, taxonomy on slug. Re-running with
 * unchanged content adds no version snapshot and no duplicate rows.
 * Relationships are resolved through the export's own collections (by slug/url),
 * so the JSON may carry either the original migration UUIDs or Payload-generated
 * ids — round-tripping works either way.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  authorsTable,
  categoriesTable,
  tagsTable,
  pagesTable,
  pageVersionsTable,
  pageCategoriesTable,
  pageTagsTable,
  blocksTable,
  componentTreeTable,
  imagesTable,
  faqTable,
  breadcrumbsTable,
  jsonldTable,
  seoTable,
} from "@workspace/db";
import {
  layoutToComponentTree,
  payloadAuthorToRow,
  payloadCategoryToRow,
  payloadMetaToSeoRow,
  payloadTagToRow,
  type PayloadAuthorDoc,
  type PayloadCategoryDoc,
  type PayloadExport,
  type PayloadMediaDoc,
  type PayloadPostDoc,
  type PayloadTagDoc,
} from "./mapping.js";
import { flattenBlocks } from "../import/transform.js";
import type { BlockNode } from "../import/types.js";

type ExportShape = Partial<PayloadExport> & {
  collections?: Partial<PayloadExport["collections"]>;
};

/** Validate + normalize a parsed export into a complete `collections` object. */
export function loadCollections(raw: unknown): PayloadExport["collections"] {
  const data = raw as ExportShape;
  const c = data?.collections;
  if (!c || typeof c !== "object") {
    throw new Error(
      "Invalid Payload export: expected a top-level `collections` object.",
    );
  }
  return {
    media: c.media ?? [],
    authors: c.authors ?? [],
    categories: c.categories ?? [],
    tags: c.tags ?? [],
    posts: c.posts ?? [],
  };
}

/** Stable hash of the editable content of a post, for change detection. */
export function postContentHash(post: PayloadPostDoc): string {
  const material = JSON.stringify({
    title: post.title,
    subtitle: post.subtitle,
    excerpt: post.excerpt,
    status: post._status,
    slug: post.slug,
    layout: post.layout,
    content: post.content,
    contentHtml: post.contentHtml,
    meta: post.meta,
    breadcrumbs: post.breadcrumbs,
    faq: post.faq,
    structuredData: post.structuredData,
  });
  return createHash("sha256").update(material).digest("hex");
}

export interface ImportStats {
  authors: number;
  categories: number;
  tags: number;
  media: number;
  postsCreated: number;
  postsUpdated: number;
  postsUnchanged: number;
}

export async function importExport(
  collections: PayloadExport["collections"],
): Promise<ImportStats> {
  const stats: ImportStats = {
    authors: 0,
    categories: 0,
    tags: 0,
    media: 0,
    postsCreated: 0,
    postsUpdated: 0,
    postsUnchanged: 0,
  };

  // Index documents by their export id so relationship values (which reference
  // related docs by id) can be resolved to a natural key (slug / url).
  const mediaById = new Map<string, PayloadMediaDoc>(
    collections.media.map((m) => [m.id, m]),
  );
  const authorById = new Map<string, PayloadAuthorDoc>(
    collections.authors.map((a) => [a.id, a]),
  );
  const categoryById = new Map<string, PayloadCategoryDoc>(
    collections.categories.map((c) => [c.id, c]),
  );
  const tagById = new Map<string, PayloadTagDoc>(
    collections.tags.map((t) => [t.id, t]),
  );

  const mediaUrl = (id: string | null): string | null =>
    id ? (mediaById.get(id)?.url ?? null) : null;

  // --- Authors (upsert by slug) ---------------------------------------------
  const dbAuthorIdBySlug = new Map<string, string>();
  for (const doc of collections.authors) {
    const row = payloadAuthorToRow(doc, mediaUrl(doc.avatar));
    const [res] = await db
      .insert(authorsTable)
      .values({
        name: row.name,
        slug: row.slug,
        bio: row.bio,
        avatarUrl: row.avatarUrl,
        role: row.role,
        email: row.email,
        social: row.social,
      })
      .onConflictDoUpdate({
        target: authorsTable.slug,
        set: {
          name: row.name,
          bio: row.bio,
          avatarUrl: row.avatarUrl,
          role: row.role,
          email: row.email,
          social: row.social,
          updatedAt: new Date(),
        },
      })
      .returning({ id: authorsTable.id });
    if (res) dbAuthorIdBySlug.set(row.slug, res.id);
    stats.authors++;
  }

  // --- Categories (upsert by slug, then resolve parents) --------------------
  const dbCategoryIdBySlug = new Map<string, string>();
  for (const doc of collections.categories) {
    const row = payloadCategoryToRow(doc);
    const [res] = await db
      .insert(categoriesTable)
      .values({ name: row.name, slug: row.slug, description: row.description })
      .onConflictDoUpdate({
        target: categoriesTable.slug,
        set: {
          name: row.name,
          description: row.description,
          updatedAt: new Date(),
        },
      })
      .returning({ id: categoriesTable.id });
    if (res) dbCategoryIdBySlug.set(row.slug, res.id);
    stats.categories++;
  }
  // Second pass: wire up parent relationships (resolved by slug).
  for (const doc of collections.categories) {
    if (!doc.parent) continue;
    const parentSlug = categoryById.get(doc.parent)?.slug;
    const parentId = parentSlug ? dbCategoryIdBySlug.get(parentSlug) : undefined;
    const childId = dbCategoryIdBySlug.get(doc.slug);
    if (parentId && childId) {
      await db
        .update(categoriesTable)
        .set({ parentId, updatedAt: new Date() })
        .where(eq(categoriesTable.id, childId));
    }
  }

  // --- Tags (upsert by slug) ------------------------------------------------
  const dbTagIdBySlug = new Map<string, string>();
  for (const doc of collections.tags) {
    const row = payloadTagToRow(doc);
    const [res] = await db
      .insert(tagsTable)
      .values({ name: row.name, slug: row.slug, description: row.description })
      .onConflictDoUpdate({
        target: tagsTable.slug,
        set: { name: row.name, description: row.description },
      })
      .returning({ id: tagsTable.id });
    if (res) dbTagIdBySlug.set(row.slug, res.id);
    stats.tags++;
  }

  // --- Posts ----------------------------------------------------------------
  for (const post of collections.posts) {
    const authorSlug = post.author ? authorById.get(post.author)?.slug : null;
    const authorId = authorSlug
      ? (dbAuthorIdBySlug.get(authorSlug) ?? null)
      : null;

    const categoryIds = post.categories
      .map((id) => categoryById.get(id)?.slug)
      .filter((s): s is string => Boolean(s))
      .map((slug) => dbCategoryIdBySlug.get(slug))
      .filter((id): id is string => Boolean(id));

    const primarySlug = post.primaryCategory
      ? categoryById.get(post.primaryCategory)?.slug
      : null;
    const primaryCategoryId = primarySlug
      ? (dbCategoryIdBySlug.get(primarySlug) ?? null)
      : (categoryIds[0] ?? null);

    const tagIds = post.tags
      .map((id) => tagById.get(id)?.slug)
      .filter((s): s is string => Boolean(s))
      .map((slug) => dbTagIdBySlug.get(slug))
      .filter((id): id is string => Boolean(id));

    const heroMedia = post.heroImage ? mediaById.get(post.heroImage) : undefined;
    const featuredImageUrl = heroMedia?.url ?? null;
    const featuredImageAlt = heroMedia?.alt ?? null;

    const componentTree = layoutToComponentTree(post.layout);
    const canonicalUrl = post.url.canonicalUrl;

    const pageValues = {
      slug: post.slug,
      title: post.title,
      subtitle: post.subtitle,
      excerpt: post.excerpt,
      pageType: "post" as const,
      status: (post._status === "published" ? "published" : "draft") as
        | "published"
        | "draft",
      language: post.language,
      originalUrl: canonicalUrl,
      canonicalUrl,
      pathname: post.url.pathname,
      parentPath: post.url.parentPath,
      authorId,
      primaryCategoryId,
      featuredImageUrl,
      featuredImageAlt,
      cleanedHtml: post.contentHtml,
      richText: post.content ?? null,
      componentTree,
      readingTimeMinutes: post.readingTimeMinutes,
      wordCount: post.wordCount,
      publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
      modifiedAt: new Date(),
    };

    // Was this page already present? (drives created/updated stats)
    const [existing] = await db
      .select({ id: pagesTable.id })
      .from(pagesTable)
      .where(eq(pagesTable.canonicalUrl, canonicalUrl))
      .limit(1);

    const [pageRow] = await db
      .insert(pagesTable)
      .values(pageValues)
      .onConflictDoUpdate({
        target: pagesTable.canonicalUrl,
        set: { ...pageValues, updatedAt: new Date() },
      })
      .returning({ id: pagesTable.id });
    const pageId = pageRow!.id;

    // Version snapshot only when the editable content actually changed.
    const contentHash = postContentHash(post);
    const [last] = await db
      .select({
        versionNumber: pageVersionsTable.versionNumber,
        contentHash: pageVersionsTable.contentHash,
      })
      .from(pageVersionsTable)
      .where(eq(pageVersionsTable.pageId, pageId))
      .orderBy(desc(pageVersionsTable.versionNumber))
      .limit(1);
    const changed = !last || last.contentHash !== contentHash;
    if (changed) {
      await db.insert(pageVersionsTable).values({
        pageId,
        versionNumber: (last?.versionNumber ?? 0) + 1,
        snapshot: { ...pageValues } as unknown,
        originalHtml: null,
        contentHash,
        changeSummary: last
          ? "Payload round-trip: content changed"
          : "Payload round-trip: initial import",
        crawledAt: new Date(),
      });
    }

    if (!existing) stats.postsCreated++;
    else if (changed) stats.postsUpdated++;
    else stats.postsUnchanged++;

    // Rewrite only the children the Payload export actually owns. Links and raw
    // metadata are NOT represented in the export, so they are left untouched.
    await rewritePostChildren({
      pageId,
      componentTree,
      categoryIds,
      tagIds,
      post,
      heroMedia: heroMedia ?? null,
    });
    if (heroMedia) stats.media++;
  }

  return stats;
}

async function rewritePostChildren(opts: {
  pageId: string;
  componentTree: ReturnType<typeof layoutToComponentTree>;
  categoryIds: string[];
  tagIds: string[];
  post: PayloadPostDoc;
  heroMedia: PayloadMediaDoc | null;
}): Promise<void> {
  const { pageId, componentTree, categoryIds, tagIds, post, heroMedia } = opts;

  // Component tree (one row per page) + flattened blocks.
  await db
    .insert(componentTreeTable)
    .values({ pageId, tree: componentTree, schemaVersion: "1" })
    .onConflictDoUpdate({
      target: componentTreeTable.pageId,
      set: { tree: componentTree, updatedAt: new Date() },
    });
  await db.delete(blocksTable).where(eq(blocksTable.pageId, pageId));
  const blockRows = flattenBlocks(
    componentTree.children as BlockNode[],
    randomUUID,
  ).map((r) => ({ ...r, pageId }));
  if (blockRows.length) await db.insert(blocksTable).values(blockRows);

  // SEO (one row per page).
  const seo = payloadMetaToSeoRow(post);
  await db
    .insert(seoTable)
    .values({ pageId, ...seo })
    .onConflictDoUpdate({
      target: seoTable.pageId,
      set: { ...seo, updatedAt: new Date() },
    });

  // Taxonomy joins.
  await db
    .delete(pageCategoriesTable)
    .where(eq(pageCategoriesTable.pageId, pageId));
  if (categoryIds.length) {
    await db
      .insert(pageCategoriesTable)
      .values(categoryIds.map((categoryId) => ({ pageId, categoryId })))
      .onConflictDoNothing();
  }
  await db.delete(pageTagsTable).where(eq(pageTagsTable.pageId, pageId));
  if (tagIds.length) {
    await db
      .insert(pageTagsTable)
      .values(tagIds.map((tagId) => ({ pageId, tagId })))
      .onConflictDoNothing();
  }

  // Breadcrumbs.
  await db.delete(breadcrumbsTable).where(eq(breadcrumbsTable.pageId, pageId));
  if (post.breadcrumbs.length) {
    await db.insert(breadcrumbsTable).values(
      post.breadcrumbs.map((b, i) => ({
        pageId,
        label: b.label,
        url: b.url,
        position: i,
      })),
    );
  }

  // FAQ.
  await db.delete(faqTable).where(eq(faqTable.pageId, pageId));
  if (post.faq.length) {
    await db.insert(faqTable).values(
      post.faq.map((f, i) => ({
        pageId,
        question: f.question,
        answer: f.answer,
        answerRichText: null,
        position: i,
      })),
    );
  }

  // JSON-LD / structured data.
  await db.delete(jsonldTable).where(eq(jsonldTable.pageId, pageId));
  if (post.structuredData.length) {
    await db.insert(jsonldTable).values(
      post.structuredData.map((j, i) => ({
        pageId,
        type: j.type,
        data: j.data,
        position: i,
      })),
    );
  }

  // Media: rebuild only the featured image row from the hero relationship.
  // Inline images are not represented in the Payload export, so other image
  // rows are left untouched.
  await db
    .delete(imagesTable)
    .where(and(eq(imagesTable.pageId, pageId), eq(imagesTable.role, "featured")));
  if (heroMedia) {
    await db.insert(imagesTable).values({
      pageId,
      originalUrl: heroMedia.sourceUrl || heroMedia.url,
      url: heroMedia.url,
      alt: heroMedia.alt,
      title: null,
      caption: heroMedia.caption,
      credit: heroMedia.credit,
      width: heroMedia.width,
      height: heroMedia.height,
      mimeType: heroMedia.mimeType,
      fileSize: heroMedia.filesize,
      role: "featured",
      position: 0,
    });
  }
}
