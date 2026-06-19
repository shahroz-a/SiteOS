import { randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
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
  metadataTable,
  internalLinksTable,
  externalLinksTable,
} from "@workspace/db";
import type { ParsedPage, ParsedTaxonomy } from "./types";
import { flattenBlocks } from "./transform";
import { canonicalizeUrl } from "./util";

export interface PersistResult {
  pageId: string;
  changed: boolean;
  counts: Record<string, number>;
}

async function upsertAuthor(
  author: ParsedPage["author"],
): Promise<string | null> {
  if (!author) return null;
  const [row] = await db
    .insert(authorsTable)
    .values({
      name: author.name,
      slug: author.slug,
      bio: author.bio ?? null,
      avatarUrl: author.avatarUrl ?? null,
      role: author.role ?? null,
      originalUrl: author.originalUrl ?? null,
    })
    .onConflictDoUpdate({
      target: authorsTable.slug,
      set: {
        name: author.name,
        bio: author.bio ?? null,
        avatarUrl: author.avatarUrl ?? null,
        role: author.role ?? null,
        originalUrl: author.originalUrl ?? null,
        updatedAt: new Date(),
      },
    })
    .returning({ id: authorsTable.id });
  return row?.id ?? null;
}

async function upsertCategories(
  cats: ParsedTaxonomy[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const cat of cats) {
    const [row] = await db
      .insert(categoriesTable)
      .values({
        name: cat.name,
        slug: cat.slug,
        path: cat.originalUrl
          ? new URL(cat.originalUrl).pathname
          : `/blog/category/${cat.slug}/`,
        originalUrl: cat.originalUrl ?? null,
      })
      .onConflictDoUpdate({
        target: categoriesTable.slug,
        set: {
          name: cat.name,
          originalUrl: cat.originalUrl ?? null,
          updatedAt: new Date(),
        },
      })
      .returning({ id: categoriesTable.id });
    if (row) map.set(cat.slug, row.id);
  }
  return map;
}

async function upsertTags(
  tags: ParsedTaxonomy[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const tag of tags) {
    const [row] = await db
      .insert(tagsTable)
      .values({
        name: tag.name,
        slug: tag.slug,
        originalUrl: tag.originalUrl ?? null,
      })
      .onConflictDoUpdate({
        target: tagsTable.slug,
        set: { name: tag.name, originalUrl: tag.originalUrl ?? null },
      })
      .returning({ id: tagsTable.id });
    if (row) map.set(tag.slug, row.id);
  }
  return map;
}

/** Delete all child rows owned by a page so it can be re-imported cleanly. */
async function clearPageChildren(pageId: string): Promise<void> {
  await db.delete(internalLinksTable).where(eq(internalLinksTable.pageId, pageId));
  await db.delete(externalLinksTable).where(eq(externalLinksTable.pageId, pageId));
  await db.delete(jsonldTable).where(eq(jsonldTable.pageId, pageId));
  await db.delete(breadcrumbsTable).where(eq(breadcrumbsTable.pageId, pageId));
  await db.delete(faqTable).where(eq(faqTable.pageId, pageId));
  await db.delete(imagesTable).where(eq(imagesTable.pageId, pageId));
  await db.delete(blocksTable).where(eq(blocksTable.pageId, pageId));
  await db
    .delete(componentTreeTable)
    .where(eq(componentTreeTable.pageId, pageId));
  await db.delete(seoTable).where(eq(seoTable.pageId, pageId));
  await db.delete(metadataTable).where(eq(metadataTable.pageId, pageId));
  await db
    .delete(pageCategoriesTable)
    .where(eq(pageCategoriesTable.pageId, pageId));
  await db.delete(pageTagsTable).where(eq(pageTagsTable.pageId, pageId));
}

/**
 * Persist a parsed page and all related entities idempotently. The page is
 * upserted by its unique canonical URL; child rows are replaced wholesale; a
 * new version snapshot is appended only when the content hash changes.
 * Internal-link targets are resolved in a separate pass once every page exists.
 */
export async function persistPage(page: ParsedPage): Promise<PersistResult> {
  const authorId = await upsertAuthor(page.author);
  const categoryMap = await upsertCategories(page.categories);
  const tagMap = await upsertTags(page.tags);
  const primaryCategoryId = page.primaryCategorySlug
    ? (categoryMap.get(page.primaryCategorySlug) ?? null)
    : null;

  const pageValues = {
    slug: page.slug,
    title: page.title,
    subtitle: page.subtitle,
    excerpt: page.excerpt,
    pageType: page.pageType,
    status: page.status,
    language: page.language,
    originalUrl: page.url,
    canonicalUrl: page.canonicalUrl,
    pathname: page.pathname,
    parentPath: page.parentPath,
    permalink: page.permalink,
    trailingSlash: page.trailingSlash,
    canonicalTag: page.canonicalTag,
    hreflang: page.hreflang,
    redirectTarget: null,
    httpStatus: page.httpStatus,
    sitemapSource: null,
    sitemapLastmod: page.sitemapLastmod,
    crawledAt: new Date(),
    authorId,
    primaryCategoryId,
    featuredImageUrl: page.featuredImageUrl,
    featuredImageAlt: page.featuredImageAlt,
    originalHtml: page.originalHtml,
    cleanedHtml: page.cleanedHtml,
    richText: page.richText,
    componentTree: page.componentTree,
    readingTimeMinutes: page.readingTimeMinutes,
    wordCount: page.wordCount,
    publishedAt: page.publishedAt,
    modifiedAt: page.modifiedAt,
  };

  const [pageRow] = await db
    .insert(pagesTable)
    .values(pageValues)
    .onConflictDoUpdate({
      target: pagesTable.canonicalUrl,
      set: { ...pageValues, updatedAt: new Date() },
    })
    .returning({ id: pagesTable.id });
  const pageId = pageRow!.id;

  // Version snapshot: only when content actually changed.
  const [last] = await db
    .select({
      versionNumber: pageVersionsTable.versionNumber,
      contentHash: pageVersionsTable.contentHash,
    })
    .from(pageVersionsTable)
    .where(eq(pageVersionsTable.pageId, pageId))
    .orderBy(desc(pageVersionsTable.versionNumber))
    .limit(1);
  const changed = !last || last.contentHash !== page.contentHash;
  if (changed) {
    await db.insert(pageVersionsTable).values({
      pageId,
      versionNumber: (last?.versionNumber ?? 0) + 1,
      snapshot: { ...pageValues, blocks: page.blocks } as unknown,
      originalHtml: page.originalHtml,
      contentHash: page.contentHash,
      changeSummary: last ? "Re-import: content changed" : "Initial import",
      crawledAt: new Date(),
    });
  }

  await clearPageChildren(pageId);

  // Taxonomy joins
  if (categoryMap.size) {
    await db.insert(pageCategoriesTable).values(
      [...categoryMap.values()].map((categoryId) => ({ pageId, categoryId })),
    );
  }
  if (tagMap.size) {
    await db
      .insert(pageTagsTable)
      .values([...tagMap.values()].map((tagId) => ({ pageId, tagId })));
  }

  // SEO + metadata (one row each)
  await db.insert(seoTable).values({ pageId, ...page.seo });
  await db.insert(metadataTable).values({ pageId, ...page.metadata });

  // Breadcrumbs
  if (page.breadcrumbs.length) {
    await db
      .insert(breadcrumbsTable)
      .values(page.breadcrumbs.map((b) => ({ pageId, ...b })));
  }

  // Blocks + component tree
  if (page.blocks.length) {
    const rows = flattenBlocks(page.blocks, randomUUID).map((r) => ({
      ...r,
      pageId,
    }));
    await db.insert(blocksTable).values(rows);
  }
  await db.insert(componentTreeTable).values({
    pageId,
    tree: page.componentTree,
    schemaVersion: "1",
  });

  // Images
  if (page.images.length) {
    await db.insert(imagesTable).values(
      page.images.map((img) => ({
        pageId,
        galleryId: null,
        originalUrl: img.originalUrl,
        url: img.url,
        storageKey: null,
        alt: img.alt ?? null,
        title: img.title ?? null,
        caption: img.caption ?? null,
        credit: img.credit ?? null,
        width: img.width ?? null,
        height: img.height ?? null,
        mimeType: img.mimeType ?? null,
        fileSize: null,
        role: img.role ?? null,
        position: img.position,
      })),
    );
  }

  // FAQ
  if (page.faq.length) {
    await db.insert(faqTable).values(
      page.faq.map((f) => ({
        pageId,
        question: f.question,
        answer: f.answer,
        answerRichText: null,
        position: f.position,
      })),
    );
  }

  // JSON-LD
  if (page.jsonld.length) {
    await db.insert(jsonldTable).values(
      page.jsonld.map((j, i) => ({
        pageId,
        type: j.type,
        data: j.data,
        position: i,
      })),
    );
  }

  // External links (no resolution needed)
  if (page.externalLinks.length) {
    await db.insert(externalLinksTable).values(
      page.externalLinks.map((l) => ({
        pageId,
        href: l.href,
        anchorText: l.anchorText ?? null,
        rel: l.rel ?? null,
        domain: l.domain ?? null,
        position: l.position,
      })),
    );
  }

  // Internal links (targets resolved later)
  if (page.internalLinks.length) {
    await db.insert(internalLinksTable).values(
      page.internalLinks.map((l) => ({
        pageId,
        targetPageId: null,
        href: l.href,
        anchorText: l.anchorText ?? null,
        rel: l.rel ?? null,
        position: l.position,
      })),
    );
  }

  return {
    pageId,
    changed,
    counts: {
      categories: categoryMap.size,
      tags: tagMap.size,
      breadcrumbs: page.breadcrumbs.length,
      blocks: page.blocks.length,
      images: page.images.length,
      faq: page.faq.length,
      jsonld: page.jsonld.length,
      internalLinks: page.internalLinks.length,
      externalLinks: page.externalLinks.length,
    },
  };
}

/**
 * Resolve internal-link targets across all imported pages by matching each
 * link's canonical href to a page's canonical URL. Returns the number of links
 * newly resolved.
 */
export async function resolveInternalLinks(
  executor: typeof db = db,
): Promise<number> {
  const pages = await executor
    .select({ id: pagesTable.id, canonicalUrl: pagesTable.canonicalUrl })
    .from(pagesTable);
  const byCanonical = new Map<string, string>();
  for (const p of pages) {
    byCanonical.set(p.canonicalUrl, p.id);
    const norm = canonicalizeUrl(p.canonicalUrl);
    if (norm) byCanonical.set(norm, p.id);
  }

  const links = await executor
    .select({ id: internalLinksTable.id, href: internalLinksTable.href })
    .from(internalLinksTable);

  let resolved = 0;
  // Group link ids by resolved target to minimize UPDATE statements.
  const byTarget = new Map<string, string[]>();
  for (const link of links) {
    const target =
      byCanonical.get(link.href) ??
      byCanonical.get(canonicalizeUrl(link.href) ?? link.href);
    if (!target) continue;
    (byTarget.get(target) ?? byTarget.set(target, []).get(target)!).push(
      link.id,
    );
  }
  for (const [targetPageId, ids] of byTarget) {
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      await executor
        .update(internalLinksTable)
        .set({ targetPageId })
        .where(inArray(internalLinksTable.id, batch));
      resolved += batch.length;
    }
  }
  return resolved;
}
