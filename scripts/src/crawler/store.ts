import { eq, desc } from "drizzle-orm";
import {
  db,
  pagesTable,
  pageVersionsTable,
  pageCategoriesTable,
  pageTagsTable,
  authorsTable,
  categoriesTable,
  tagsTable,
  blocksTable,
  componentTreeTable,
  galleriesTable,
  imagesTable,
  videosTable,
  faqTable,
  accordionsTable,
  breadcrumbsTable,
  jsonldTable,
  seoTable,
  metadataTable,
  internalLinksTable,
  externalLinksTable,
  redirectsTable,
  crawlLogsTable,
  validationReportsTable,
} from "@workspace/db";
import type { ComponentNode, ExtractedPage } from "./types";
import type { ValidationResult } from "./validate";
import { pathnameOf, domainOf } from "./util";

export interface StoreResult {
  pageId: string;
  created: boolean;
  changed: boolean;
  versionNumber: number;
}

async function upsertAuthor(page: ExtractedPage): Promise<string | null> {
  if (!page.author) return null;
  const a = page.author;
  const [row] = await db
    .insert(authorsTable)
    .values({
      name: a.name,
      slug: a.slug,
      bio: a.bio,
      avatarUrl: a.avatarUrl,
      role: a.role,
      originalUrl: a.url,
    })
    .onConflictDoUpdate({
      target: authorsTable.slug,
      set: { name: a.name, bio: a.bio, avatarUrl: a.avatarUrl, role: a.role },
    })
    .returning({ id: authorsTable.id });
  return row?.id ?? null;
}

async function upsertCategories(page: ExtractedPage): Promise<string[]> {
  const ids: string[] = [];
  for (const c of page.categories) {
    const [row] = await db
      .insert(categoriesTable)
      .values({ name: c.name, slug: c.slug, originalUrl: c.url, path: c.url ? pathnameOf(c.url) : null })
      .onConflictDoUpdate({ target: categoriesTable.slug, set: { name: c.name } })
      .returning({ id: categoriesTable.id });
    if (row) ids.push(row.id);
  }
  return ids;
}

async function upsertTags(page: ExtractedPage): Promise<string[]> {
  const ids: string[] = [];
  for (const t of page.tags) {
    const [row] = await db
      .insert(tagsTable)
      .values({ name: t.name, slug: t.slug, originalUrl: t.url })
      .onConflictDoUpdate({ target: tagsTable.slug, set: { name: t.name } })
      .returning({ id: tagsTable.id });
    if (row) ids.push(row.id);
  }
  return ids;
}

/** Flatten the nested component tree into ordered block rows with parent links. */
function flattenBlocks(
  pageId: string,
  nodes: ComponentNode[],
): Array<{
  id: string;
  pageId: string;
  parentId: string | null;
  blockType: string;
  position: number;
  depth: number;
  anchorId: string | null;
  data: unknown;
  text: string | null;
}> {
  const rows: ReturnType<typeof flattenBlocks> = [];
  const walk = (list: ComponentNode[], parentId: string | null, depth: number): void => {
    list.forEach((node, index) => {
      const id = crypto.randomUUID();
      rows.push({
        id,
        pageId,
        parentId,
        blockType: node.type,
        position: index,
        depth,
        anchorId: node.anchorId ?? null,
        data: node.data ?? null,
        text: node.text ?? null,
      });
      if (node.children?.length) walk(node.children, id, depth + 1);
    });
  };
  walk(nodes, null, 0);
  return rows;
}

/** Delete all derived child rows for a page so a re-crawl never duplicates. */
async function clearPageChildren(pageId: string): Promise<void> {
  await Promise.all([
    db.delete(blocksTable).where(eq(blocksTable.pageId, pageId)),
    db.delete(imagesTable).where(eq(imagesTable.pageId, pageId)),
    db.delete(galleriesTable).where(eq(galleriesTable.pageId, pageId)),
    db.delete(videosTable).where(eq(videosTable.pageId, pageId)),
    db.delete(faqTable).where(eq(faqTable.pageId, pageId)),
    db.delete(accordionsTable).where(eq(accordionsTable.pageId, pageId)),
    db.delete(breadcrumbsTable).where(eq(breadcrumbsTable.pageId, pageId)),
    db.delete(jsonldTable).where(eq(jsonldTable.pageId, pageId)),
    db.delete(internalLinksTable).where(eq(internalLinksTable.pageId, pageId)),
    db.delete(externalLinksTable).where(eq(externalLinksTable.pageId, pageId)),
    db.delete(pageCategoriesTable).where(eq(pageCategoriesTable.pageId, pageId)),
    db.delete(pageTagsTable).where(eq(pageTagsTable.pageId, pageId)),
  ]);
}

async function writeChildren(
  page: ExtractedPage,
  pageId: string,
  categoryIds: string[],
  tagIds: string[],
): Promise<void> {
  // Component tree (one row) + flattened blocks.
  await db
    .insert(componentTreeTable)
    .values({ pageId, tree: page.componentTree, schemaVersion: "1" })
    .onConflictDoUpdate({
      target: componentTreeTable.pageId,
      set: { tree: page.componentTree, updatedAt: new Date() },
    });

  const blockRows = flattenBlocks(pageId, page.componentTree);
  if (blockRows.length) await db.insert(blocksTable).values(blockRows);

  if (page.images.length)
    await db.insert(imagesTable).values(
      page.images.map((img) => ({
        pageId,
        originalUrl: img.originalUrl,
        url: img.url,
        alt: img.alt,
        title: img.title,
        caption: img.caption,
        width: img.width,
        height: img.height,
        role: img.role,
        position: img.position,
      })),
    );

  if (page.videos.length)
    await db.insert(videosTable).values(
      page.videos.map((v) => ({
        pageId,
        provider: v.provider,
        originalUrl: v.originalUrl,
        embedUrl: v.embedUrl,
        title: v.title,
        position: v.position,
      })),
    );

  if (page.faqs.length)
    await db.insert(faqTable).values(
      page.faqs.map((f) => ({ pageId, question: f.question, answer: f.answer, position: f.position })),
    );

  if (page.accordions.length)
    await db.insert(accordionsTable).values(
      page.accordions.map((a) => ({ pageId, title: a.title, content: a.content, position: a.position })),
    );

  if (page.breadcrumbs.length)
    await db.insert(breadcrumbsTable).values(
      page.breadcrumbs.map((b) => ({ pageId, label: b.label, url: b.url, position: b.position })),
    );

  if (page.jsonld.length)
    await db.insert(jsonldTable).values(
      page.jsonld.map((j, i) => ({ pageId, type: j.type, data: j.data, position: i })),
    );

  if (page.internalLinks.length)
    await db.insert(internalLinksTable).values(
      page.internalLinks.map((l) => ({
        pageId,
        href: l.href,
        anchorText: l.anchorText,
        rel: l.rel,
        position: l.position,
      })),
    );

  if (page.externalLinks.length)
    await db.insert(externalLinksTable).values(
      page.externalLinks.map((l) => ({
        pageId,
        href: l.href,
        anchorText: l.anchorText,
        rel: l.rel,
        domain: domainOf(l.href),
        position: l.position,
      })),
    );

  // SEO + metadata (one row each).
  await db
    .insert(seoTable)
    .values({ pageId, ...page.seo })
    .onConflictDoUpdate({ target: seoTable.pageId, set: { ...page.seo, updatedAt: new Date() } });

  await db
    .delete(metadataTable)
    .where(eq(metadataTable.pageId, pageId));
  await db.insert(metadataTable).values({
    pageId,
    metaTags: page.metadata.metaTags,
    openGraph: page.metadata.openGraph,
    twitter: page.metadata.twitter,
    custom: page.metadata.custom,
  });

  // Taxonomy join rows.
  if (categoryIds.length)
    await db
      .insert(pageCategoriesTable)
      .values(categoryIds.map((categoryId) => ({ pageId, categoryId })))
      .onConflictDoNothing();
  if (tagIds.length)
    await db
      .insert(pageTagsTable)
      .values(tagIds.map((tagId) => ({ pageId, tagId })))
      .onConflictDoNothing();
}

/**
 * Idempotently persist an extracted page. Upserts by canonical URL; when the
 * content hash changes (or it's new), a new immutable `page_versions` row is
 * appended and all derived child rows are rebuilt. Unchanged pages only touch
 * `crawledAt`, so re-running is safe and never duplicates.
 */
export async function storePage(page: ExtractedPage): Promise<StoreResult> {
  const authorId = await upsertAuthor(page);
  const categoryIds = await upsertCategories(page);
  const tagIds = await upsertTags(page);

  const [existing] = await db
    .select({ id: pagesTable.id })
    .from(pagesTable)
    .where(eq(pagesTable.canonicalUrl, page.canonicalUrl))
    .limit(1);

  // Determine the latest stored version + its hash for change detection.
  let previousHash: string | null = null;
  let latestVersion = 0;
  if (existing) {
    const [v] = await db
      .select({ versionNumber: pageVersionsTable.versionNumber, contentHash: pageVersionsTable.contentHash })
      .from(pageVersionsTable)
      .where(eq(pageVersionsTable.pageId, existing.id))
      .orderBy(desc(pageVersionsTable.versionNumber))
      .limit(1);
    previousHash = v?.contentHash ?? null;
    latestVersion = v?.versionNumber ?? 0;
  }

  const changed = !existing || previousHash !== page.contentHash;

  const pageValues = {
    slug: page.slug,
    title: page.title,
    subtitle: page.subtitle,
    excerpt: page.excerpt,
    pageType: page.pageType,
    status: "published" as const,
    language: page.language,
    originalUrl: page.requestedUrl,
    canonicalUrl: page.canonicalUrl,
    pathname: page.pathname,
    parentPath: page.parentPath,
    permalink: page.finalUrl,
    trailingSlash: page.trailingSlash,
    canonicalTag: page.canonicalTag,
    hreflang: page.hreflang,
    redirectTarget: page.redirectTarget,
    httpStatus: page.httpStatus,
    sitemapSource: page.sitemapSource,
    sitemapLastmod: page.sitemapLastmod,
    crawledAt: new Date(),
    authorId,
    primaryCategoryId: categoryIds[0] ?? null,
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
    .onConflictDoUpdate({ target: pagesTable.canonicalUrl, set: pageValues })
    .returning({ id: pagesTable.id });
  const pageId = pageRow!.id;

  // Append an immutable version only when content actually changed.
  let versionNumber = latestVersion;
  if (changed) {
    versionNumber = latestVersion + 1;
    await db.insert(pageVersionsTable).values({
      pageId,
      versionNumber,
      snapshot: {
        title: page.title,
        componentTree: page.componentTree,
        richText: page.richText,
        seo: page.seo,
        counts: page.counts,
      },
      originalHtml: page.originalHtml,
      contentHash: page.contentHash,
      changeSummary: existing ? "content changed" : "initial capture",
      crawledAt: new Date(),
    });

    // Rebuild derived rows from scratch to stay idempotent.
    await clearPageChildren(pageId);
    await writeChildren(page, pageId, categoryIds, tagIds);
  }

  // Persist redirect chain (idempotent on from_path).
  for (const hop of page.redirectChain) {
    await db
      .insert(redirectsTable)
      .values({
        fromPath: pathnameOf(hop.from),
        toPath: pathnameOf(hop.to),
        statusCode: hop.status || 301,
        isActive: true,
      })
      .onConflictDoNothing({ target: redirectsTable.fromPath });
  }

  return { pageId, created: !existing, changed, versionNumber };
}

export async function logCrawl(opts: {
  url: string;
  pageId?: string | null;
  level: "debug" | "info" | "warn" | "error";
  httpStatus?: number | null;
  message: string;
  details?: unknown;
  durationMs?: number;
}): Promise<void> {
  await db.insert(crawlLogsTable).values({
    url: opts.url,
    pageId: opts.pageId ?? null,
    level: opts.level,
    httpStatus: opts.httpStatus ?? null,
    message: opts.message,
    details: opts.details ?? null,
    durationMs: opts.durationMs ?? null,
  });
}

export async function storeValidation(
  pageId: string,
  result: ValidationResult,
): Promise<void> {
  await db.insert(validationReportsTable).values({
    pageId,
    reportType: "content-fidelity",
    status: result.status,
    issues: { issues: result.issues, source: result.source, parsed: result.parsed },
    score: result.score,
  });
}
