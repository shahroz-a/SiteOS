import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, ilike, ne, or, sql, type SQL } from "drizzle-orm";
import {
  db,
  pagesTable,
  pageVersionsTable,
  pageCategoriesTable,
  pageTagsTable,
  blocksTable,
  componentTreeTable,
  imagesTable,
  galleriesTable,
  faqTable,
  breadcrumbsTable,
  jsonldTable,
  seoTable,
  internalLinksTable,
  externalLinksTable,
  authorsTable,
  categoriesTable,
  tagsTable,
  type Page,
} from "@workspace/db";
import { componentTreeChildren, flattenBlocks } from "@workspace/content";
import { resolveImageServingUrl } from "./image-source";
import {
  CreateCmsPostBody,
  ScaffoldCmsPostBody,
  DuplicateCmsPostBody,
} from "@workspace/api-zod";
import { z } from "zod";

/**
 * The DB executor: either the module-level pool or an open transaction. Every
 * nested write helper MUST receive this so that, inside a transaction, no helper
 * reaches for the global `db` pool (which would open a second connection and
 * self-deadlock against the still-open transaction's uncommitted writes).
 */
export type Executor = typeof db;

export type CmsPostInput = z.infer<typeof CreateCmsPostBody>;
export type CmsScaffoldInput = z.infer<typeof ScaffoldCmsPostBody>;
export type CmsDuplicateInput = z.infer<typeof DuplicateCmsPostBody>;

// ---------------------------------------------------------------------------
// Pure builders (no I/O) — unit-testable in isolation.
// ---------------------------------------------------------------------------

/**
 * Convert arbitrary text into a URL-safe slug: lowercase, ASCII-folded,
 * non-alphanumerics collapsed to single hyphens, trimmed of leading/trailing
 * hyphens. Returns `""` for empty/symbol-only input (callers uniquify/fallback).
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Append a numeric suffix to `base` until it is not present in `taken`.
 * `base-2`, `base-3`, … Used to keep generated slugs / canonical URLs unique.
 */
export function uniquify(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Derive the canonical blog URL for a slug. Mirrors the migrated `/blog/<slug>/` shape. */
export function canonicalUrlForSlug(slug: string): string {
  return `https://www.headout.com/blog/${slug}/`;
}

/** Derive the pathname for a slug. */
export function pathnameForSlug(slug: string): string {
  return `/blog/${slug}/`;
}

/**
 * Build the `pages` column values from validated input. Pure — slug/canonical
 * uniqueness is resolved by the caller (which knows what's already taken).
 */
export function buildPageValues(
  input: CmsPostInput,
  resolved: { slug: string; canonicalUrl: string; pathname: string },
): Omit<typeof pagesTable.$inferInsert, "id" | "createdAt" | "updatedAt"> {
  const status = input.status ?? "draft";
  const blocks = componentTreeChildren(input.componentTree ?? null);
  return {
    slug: resolved.slug,
    title: input.title,
    subtitle: input.subtitle ?? null,
    excerpt: input.excerpt ?? null,
    pageType: "post",
    status,
    language: input.language ?? "en",
    originalUrl: resolved.canonicalUrl,
    canonicalUrl: resolved.canonicalUrl,
    pathname: resolved.pathname,
    parentPath: input.parentPath ?? null,
    authorId: input.authorId ?? null,
    primaryCategoryId: input.primaryCategoryId ?? null,
    featuredImageUrl: input.featuredImageUrl ?? null,
    featuredImageAlt: input.featuredImageAlt ?? null,
    cleanedHtml: input.contentHtml ?? null,
    richText: input.richText ?? null,
    componentTree: input.componentTree ?? null,
    readingTimeMinutes: input.readingTimeMinutes ?? null,
    wordCount: input.wordCount ?? null,
    publishedAt: input.publishedAt ? new Date(input.publishedAt) : null,
    modifiedAt: new Date(),
    crawledAt: null,
    // unused crawl/source fields default to null
    permalink: null,
    canonicalTag: null,
    redirectTarget: null,
    httpStatus: null,
    sitemapSource: null,
    sitemapLastmod: null,
  };
}

/**
 * Build the input for a blank-draft scaffold: a titled draft with empty
 * content. The slug is resolved/uniquified by the DB op.
 */
export function scaffoldToInput(scaffold: CmsScaffoldInput): CmsPostInput {
  return {
    title: scaffold.title,
    slug: scaffold.slug,
    status: "draft",
    language: "en",
    categoryIds: [],
    tagIds: [],
    faq: [],
    breadcrumbs: [],
    jsonld: [],
    images: [],
    galleries: [],
    internalLinks: [],
    externalLinks: [],
  } as CmsPostInput;
}

/**
 * Clone a fully-serialized post into a fresh `CmsPostInput` for duplication:
 * new title/slug, forced to draft, SEO marked `needsReview`, identity ids
 * stripped from nested rows (DB regenerates them).
 */
export function cloneForDuplicate(
  source: CmsPostDetail,
  opts: { title: string; slug?: string },
): CmsPostInput {
  return {
    title: opts.title,
    slug: opts.slug,
    subtitle: source.subtitle ?? null,
    excerpt: source.excerpt ?? null,
    status: "draft",
    language: source.language,
    parentPath: source.parentPath ?? null,
    authorId: source.author?.id ?? null,
    primaryCategoryId: source.primaryCategory?.id ?? null,
    categoryIds: source.categories.map((c) => c.id),
    tagIds: source.tags.map((t) => t.id),
    featuredImageUrl: source.featuredImageUrl ?? null,
    featuredImageAlt: source.featuredImageAlt ?? null,
    contentHtml: source.contentHtml ?? null,
    richText: source.richText ?? null,
    componentTree: source.componentTree ?? null,
    readingTimeMinutes: source.readingTimeMinutes ?? null,
    wordCount: source.wordCount ?? null,
    publishedAt: null,
    seo: source.seo
      ? {
          metaTitle: source.seo.metaTitle ?? null,
          metaDescription: source.seo.metaDescription ?? null,
          canonicalUrl: null,
          robots: source.seo.robots ?? null,
          focusKeyword: source.seo.focusKeyword ?? null,
          keywords: source.seo.keywords ?? null,
          ogTitle: source.seo.ogTitle ?? null,
          ogDescription: source.seo.ogDescription ?? null,
          ogImage: source.seo.ogImage ?? null,
          ogType: source.seo.ogType ?? null,
          twitterCard: source.seo.twitterCard ?? null,
          twitterTitle: source.seo.twitterTitle ?? null,
          twitterDescription: source.seo.twitterDescription ?? null,
          twitterImage: source.seo.twitterImage ?? null,
          needsReview: true,
        }
      : { needsReview: true },
    faq: source.faq.map((f) => ({
      question: f.question,
      answer: f.answer,
      position: f.position,
    })),
    breadcrumbs: source.breadcrumbs.map((b) => ({
      label: b.label,
      url: b.url ?? null,
      position: b.position,
    })),
    jsonld: source.jsonld.map((j) => ({ type: j.type ?? null, data: j.data })),
    images: source.images.map((img) => ({
      url: img.url,
      originalUrl: img.originalUrl ?? null,
      alt: img.alt ?? null,
      title: img.title ?? null,
      caption: img.caption ?? null,
      credit: img.credit ?? null,
      width: img.width ?? null,
      height: img.height ?? null,
      mimeType: img.mimeType ?? null,
      role: img.role ?? null,
      position: img.position,
    })),
    galleries: source.galleries.map((g) => ({
      title: g.title ?? null,
      layout: g.layout ?? null,
      position: g.position,
      images: g.images.map((img) => ({
        url: img.url,
        originalUrl: img.originalUrl ?? null,
        alt: img.alt ?? null,
        title: img.title ?? null,
        caption: img.caption ?? null,
        credit: img.credit ?? null,
        width: img.width ?? null,
        height: img.height ?? null,
        mimeType: img.mimeType ?? null,
        role: img.role ?? null,
        position: img.position,
      })),
    })),
    internalLinks: source.internalLinks.map((l) => ({
      href: l.href,
      anchorText: l.anchorText ?? null,
      rel: l.rel ?? null,
      domain: l.domain ?? null,
      position: l.position,
    })),
    externalLinks: source.externalLinks.map((l) => ({
      href: l.href,
      anchorText: l.anchorText ?? null,
      rel: l.rel ?? null,
      domain: l.domain ?? null,
      position: l.position,
    })),
    changeSummary: `Duplicated from "${source.title}"`,
  } as CmsPostInput;
}

// ---------------------------------------------------------------------------
// Serialized detail shape (matches CmsPostDetail in the OpenAPI contract).
// ---------------------------------------------------------------------------

export interface CmsPostDetail {
  id: string;
  slug: string;
  status: "draft" | "published" | "archived";
  pageType: string;
  title: string;
  subtitle: string | null;
  excerpt: string | null;
  canonicalUrl: string;
  pathname: string;
  parentPath: string | null;
  featuredImageUrl: string | null;
  featuredImageAlt: string | null;
  readingTimeMinutes: number | null;
  wordCount: number | null;
  language: string;
  publishedAt: string | null;
  modifiedAt: string | null;
  updatedAt: string | null;
  contentHtml: string | null;
  richText: Record<string, unknown> | null;
  componentTree: unknown;
  author: { id: string; name: string; slug: string; avatarUrl: string | null; role: string | null } | null;
  primaryCategory: { id: string; name: string; slug: string } | null;
  categories: { id: string; name: string; slug: string }[];
  tags: { id: string; name: string; slug: string }[];
  breadcrumbs: { label: string; url: string | null; position: number }[];
  faq: { id: string; question: string; answer: string; position: number }[];
  images: CmsImageOut[];
  galleries: { id: string; title: string | null; layout: string | null; position: number; images: CmsImageOut[] }[];
  seo: CmsSeoOut | null;
  jsonld: { type: string | null; data: unknown }[];
  internalLinks: CmsLinkOut[];
  externalLinks: CmsLinkOut[];
  latestVersion: number | null;
}

interface CmsImageOut {
  id: string;
  url: string;
  originalUrl: string | null;
  alt: string | null;
  title: string | null;
  caption: string | null;
  credit: string | null;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  role: string | null;
  position: number;
}

interface CmsLinkOut {
  id: string;
  href: string;
  anchorText: string | null;
  rel: string | null;
  domain: string | null;
  position: number;
}

interface CmsSeoOut {
  metaTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  robots: string | null;
  focusKeyword: string | null;
  keywords: string[] | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  ogType: string | null;
  twitterCard: string | null;
  twitterTitle: string | null;
  twitterDescription: string | null;
  twitterImage: string | null;
  needsReview: boolean;
}

// ---------------------------------------------------------------------------
// DB operations (transactional). Every nested write threads `exec`.
// ---------------------------------------------------------------------------

function mapImageOut(img: typeof imagesTable.$inferSelect): CmsImageOut {
  return {
    id: img.id,
    // Migrated images always serve straight from the original Headout CDN —
    // never a re-hosted self-hosted storage path. See lib/image-source.ts.
    url: resolveImageServingUrl(img),
    originalUrl: img.originalUrl,
    alt: img.alt,
    title: img.title,
    caption: img.caption,
    credit: img.credit,
    width: img.width,
    height: img.height,
    mimeType: img.mimeType,
    role: img.role,
    position: img.position,
  };
}

export interface CmsPostSummaryOut {
  id: string;
  slug: string;
  title: string;
  status: "draft" | "published" | "archived";
  pageType: string;
  excerpt: string | null;
  pathname: string;
  featuredImageUrl: string | null;
  author: { id: string; name: string; slug: string; avatarUrl: string | null; role: string | null } | null;
  primaryCategory: { id: string; name: string; slug: string } | null;
  publishedAt: string | null;
  updatedAt: string | null;
}

export interface CmsPostListResult {
  items: CmsPostSummaryOut[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * Paginated CMS article list across every status (no published filter). Backs
 * the content list AND the internal-linking assistant — the latter relies on
 * `status` to warn when linking to a draft/archived target. Restricted to
 * `pageType = "post"` (the article surface the editor manages). Projects only
 * summary columns — never `select *` of the lossless `originalHtml` blob.
 */
export async function listCmsPosts(
  opts: {
    q?: string;
    status?: "draft" | "published" | "archived";
    page: number;
    limit: number;
  },
  exec: Executor = db,
): Promise<CmsPostListResult> {
  const conditions: SQL[] = [eq(pagesTable.pageType, "post")];
  if (opts.status) conditions.push(eq(pagesTable.status, opts.status));
  const q = opts.q?.trim();
  if (q) {
    const pattern = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    const search = or(
      ilike(pagesTable.title, pattern),
      ilike(pagesTable.slug, pattern),
    );
    if (search) conditions.push(search);
  }
  const where = and(...conditions);

  const [{ count } = { count: 0 }] = await exec
    .select({ count: sql<number>`count(*)::int` })
    .from(pagesTable)
    .where(where);
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / opts.limit));
  const offset = (opts.page - 1) * opts.limit;

  const rows = await exec
    .select({
      id: pagesTable.id,
      slug: pagesTable.slug,
      title: pagesTable.title,
      status: pagesTable.status,
      pageType: pagesTable.pageType,
      excerpt: pagesTable.excerpt,
      pathname: pagesTable.pathname,
      featuredImageUrl: pagesTable.featuredImageUrl,
      publishedAt: pagesTable.publishedAt,
      updatedAt: pagesTable.updatedAt,
      authorId: authorsTable.id,
      authorName: authorsTable.name,
      authorSlug: authorsTable.slug,
      authorAvatarUrl: authorsTable.avatarUrl,
      authorRole: authorsTable.role,
      categoryId: categoriesTable.id,
      categoryName: categoriesTable.name,
      categorySlug: categoriesTable.slug,
    })
    .from(pagesTable)
    .leftJoin(authorsTable, eq(pagesTable.authorId, authorsTable.id))
    .leftJoin(
      categoriesTable,
      eq(pagesTable.primaryCategoryId, categoriesTable.id),
    )
    .where(where)
    .orderBy(desc(pagesTable.updatedAt))
    .limit(opts.limit)
    .offset(offset);

  const items: CmsPostSummaryOut[] = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    status: r.status,
    pageType: r.pageType,
    excerpt: r.excerpt,
    pathname: r.pathname,
    featuredImageUrl: r.featuredImageUrl,
    author:
      r.authorId != null
        ? {
            id: r.authorId,
            name: r.authorName ?? "",
            slug: r.authorSlug ?? "",
            avatarUrl: r.authorAvatarUrl ?? null,
            role: r.authorRole ?? null,
          }
        : null,
    primaryCategory:
      r.categoryId != null
        ? {
            id: r.categoryId,
            name: r.categoryName ?? "",
            slug: r.categorySlug ?? "",
          }
        : null,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
  }));

  return { items, pagination: { page: opts.page, limit: opts.limit, total, totalPages } };
}

export interface PostSource {
  id: string;
  slug: string;
  title: string | null;
  url: string | null;
  sourceHtml: string | null;
  sourceKind: "cleaned" | "original" | null;
  componentTree: unknown;
  richText: unknown;
}

/**
 * Load the source-vs-parsed bodies for one article (any status), powering the
 * importer-diff preview. Returns the faithful source body (cleaned article
 * HTML, falling back to the raw original HTML) next to the parsed structured
 * trees (componentTree + richText) the importer extracted. Restricted to posts
 * (page_type="post"). Returns null when the id is not a post.
 *
 * `original_html` is large (~500KB/row), so it is fetched only as a fallback in
 * a second query when the cleaned body is empty — never eagerly.
 */
export async function loadPostSource(
  id: string,
  exec: Executor = db,
): Promise<PostSource | null> {
  const [page] = await exec
    .select({
      id: pagesTable.id,
      slug: pagesTable.slug,
      title: pagesTable.title,
      url: pagesTable.canonicalUrl,
      cleanedHtml: pagesTable.cleanedHtml,
      componentTree: pagesTable.componentTree,
      richText: pagesTable.richText,
    })
    .from(pagesTable)
    .where(and(eq(pagesTable.id, id), eq(pagesTable.pageType, "post")))
    .limit(1);

  if (!page) return null;

  const cleaned = page.cleanedHtml?.trim() ? page.cleanedHtml : null;
  let sourceHtml: string | null = cleaned;
  let sourceKind: "cleaned" | "original" | null = cleaned ? "cleaned" : null;

  if (!sourceHtml) {
    const [raw] = await exec
      .select({ originalHtml: pagesTable.originalHtml })
      .from(pagesTable)
      .where(eq(pagesTable.id, id))
      .limit(1);
    if (raw?.originalHtml?.trim()) {
      sourceHtml = raw.originalHtml;
      sourceKind = "original";
    }
  }

  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    url: page.url,
    sourceHtml,
    sourceKind,
    componentTree: page.componentTree ?? null,
    richText: page.richText ?? null,
  };
}

/**
 * Load and serialize a page and all nested content into the CmsPostDetail
 * shape (no published/pageType filter — the CMS sees drafts and every type).
 * Returns null when the id doesn't exist. Never `select *` of crawl columns we
 * don't need beyond the page row (originalHtml is read but not emitted).
 */
export async function serializeCmsPostDetail(
  id: string,
  exec: Executor = db,
): Promise<CmsPostDetail | null> {
  const [page] = await exec
    .select()
    .from(pagesTable)
    .where(eq(pagesTable.id, id))
    .limit(1);
  if (!page) return null;

  const author = page.authorId
    ? (
        await exec
          .select()
          .from(authorsTable)
          .where(eq(authorsTable.id, page.authorId))
          .limit(1)
      )[0]
    : undefined;

  const primaryCategory = page.primaryCategoryId
    ? (
        await exec
          .select()
          .from(categoriesTable)
          .where(eq(categoriesTable.id, page.primaryCategoryId))
          .limit(1)
      )[0]
    : undefined;

  const categories = await exec
    .select({
      id: categoriesTable.id,
      name: categoriesTable.name,
      slug: categoriesTable.slug,
    })
    .from(pageCategoriesTable)
    .innerJoin(
      categoriesTable,
      eq(pageCategoriesTable.categoryId, categoriesTable.id),
    )
    .where(eq(pageCategoriesTable.pageId, page.id));

  const tags = await exec
    .select({
      id: tagsTable.id,
      name: tagsTable.name,
      slug: tagsTable.slug,
    })
    .from(pageTagsTable)
    .innerJoin(tagsTable, eq(pageTagsTable.tagId, tagsTable.id))
    .where(eq(pageTagsTable.pageId, page.id));

  const breadcrumbs = await exec
    .select()
    .from(breadcrumbsTable)
    .where(eq(breadcrumbsTable.pageId, page.id))
    .orderBy(asc(breadcrumbsTable.position));

  const faq = await exec
    .select()
    .from(faqTable)
    .where(eq(faqTable.pageId, page.id))
    .orderBy(asc(faqTable.position));

  const allImages = await exec
    .select()
    .from(imagesTable)
    .where(eq(imagesTable.pageId, page.id))
    .orderBy(asc(imagesTable.position));

  const galleries = await exec
    .select()
    .from(galleriesTable)
    .where(eq(galleriesTable.pageId, page.id))
    .orderBy(asc(galleriesTable.position));

  const jsonld = await exec
    .select()
    .from(jsonldTable)
    .where(eq(jsonldTable.pageId, page.id))
    .orderBy(asc(jsonldTable.position));

  const [seo] = await exec
    .select()
    .from(seoTable)
    .where(eq(seoTable.pageId, page.id))
    .limit(1);

  const internalLinks = await exec
    .select()
    .from(internalLinksTable)
    .where(eq(internalLinksTable.pageId, page.id))
    .orderBy(asc(internalLinksTable.position));

  const externalLinks = await exec
    .select()
    .from(externalLinksTable)
    .where(eq(externalLinksTable.pageId, page.id))
    .orderBy(asc(externalLinksTable.position));

  const [latest] = await exec
    .select({ versionNumber: pageVersionsTable.versionNumber })
    .from(pageVersionsTable)
    .where(eq(pageVersionsTable.pageId, page.id))
    .orderBy(desc(pageVersionsTable.versionNumber))
    .limit(1);

  const galleryImages = galleries.length
    ? allImages.filter((img) => img.galleryId != null)
    : [];
  const directImages = allImages.filter((img) => img.galleryId == null);

  return {
    id: page.id,
    slug: page.slug,
    status: page.status,
    pageType: page.pageType,
    title: page.title,
    subtitle: page.subtitle,
    excerpt: page.excerpt,
    canonicalUrl: page.canonicalUrl,
    pathname: page.pathname,
    parentPath: page.parentPath,
    featuredImageUrl: page.featuredImageUrl,
    featuredImageAlt: page.featuredImageAlt,
    readingTimeMinutes: page.readingTimeMinutes,
    wordCount: page.wordCount,
    language: page.language,
    publishedAt: page.publishedAt ? page.publishedAt.toISOString() : null,
    modifiedAt: page.modifiedAt ? page.modifiedAt.toISOString() : null,
    updatedAt: page.updatedAt ? page.updatedAt.toISOString() : null,
    contentHtml: page.cleanedHtml,
    richText: (page.richText as Record<string, unknown> | null) ?? null,
    componentTree: page.componentTree ?? null,
    author: author
      ? {
          id: author.id,
          name: author.name,
          slug: author.slug,
          avatarUrl: author.avatarUrl,
          role: author.role,
        }
      : null,
    primaryCategory: primaryCategory
      ? {
          id: primaryCategory.id,
          name: primaryCategory.name,
          slug: primaryCategory.slug,
        }
      : null,
    categories,
    tags,
    breadcrumbs: breadcrumbs.map((b) => ({
      label: b.label,
      url: b.url,
      position: b.position,
    })),
    faq: faq.map((f) => ({
      id: f.id,
      question: f.question,
      answer: f.answer,
      position: f.position,
    })),
    images: directImages.map(mapImageOut),
    galleries: galleries.map((g) => ({
      id: g.id,
      title: g.title,
      layout: g.layout,
      position: g.position,
      images: galleryImages
        .filter((img) => img.galleryId === g.id)
        .map(mapImageOut),
    })),
    seo: seo
      ? {
          metaTitle: seo.metaTitle,
          metaDescription: seo.metaDescription,
          canonicalUrl: seo.canonicalUrl,
          robots: seo.robots,
          focusKeyword: seo.focusKeyword,
          keywords: seo.keywords,
          ogTitle: seo.ogTitle,
          ogDescription: seo.ogDescription,
          ogImage: seo.ogImage,
          ogType: seo.ogType,
          twitterCard: seo.twitterCard,
          twitterTitle: seo.twitterTitle,
          twitterDescription: seo.twitterDescription,
          twitterImage: seo.twitterImage,
          needsReview: seo.needsReview,
        }
      : null,
    jsonld: jsonld.map((j) => ({ type: j.type, data: j.data })),
    internalLinks: internalLinks.map((l) => ({
      id: l.id,
      href: l.href,
      anchorText: l.anchorText,
      rel: l.rel,
      domain: null,
      position: l.position,
    })),
    externalLinks: externalLinks.map((l) => ({
      id: l.id,
      href: l.href,
      anchorText: l.anchorText,
      rel: l.rel,
      domain: l.domain,
      position: l.position,
    })),
    latestVersion: latest?.versionNumber ?? null,
  };
}

/** Delete every child row owned by a page so it can be rewritten wholesale. */
async function clearPageChildren(
  pageId: string,
  exec: Executor,
): Promise<void> {
  await exec.delete(internalLinksTable).where(eq(internalLinksTable.pageId, pageId));
  await exec.delete(externalLinksTable).where(eq(externalLinksTable.pageId, pageId));
  await exec.delete(jsonldTable).where(eq(jsonldTable.pageId, pageId));
  await exec.delete(breadcrumbsTable).where(eq(breadcrumbsTable.pageId, pageId));
  await exec.delete(faqTable).where(eq(faqTable.pageId, pageId));
  await exec.delete(imagesTable).where(eq(imagesTable.pageId, pageId));
  await exec.delete(galleriesTable).where(eq(galleriesTable.pageId, pageId));
  await exec.delete(blocksTable).where(eq(blocksTable.pageId, pageId));
  await exec.delete(componentTreeTable).where(eq(componentTreeTable.pageId, pageId));
  await exec.delete(seoTable).where(eq(seoTable.pageId, pageId));
  await exec.delete(pageCategoriesTable).where(eq(pageCategoriesTable.pageId, pageId));
  await exec.delete(pageTagsTable).where(eq(pageTagsTable.pageId, pageId));
}

/** Insert all nested content rows for a page from validated input. */
async function writePageChildren(
  pageId: string,
  input: CmsPostInput,
  exec: Executor,
): Promise<void> {
  // Taxonomy joins
  const categoryIds = unique(input.categoryIds ?? []);
  if (categoryIds.length) {
    await exec
      .insert(pageCategoriesTable)
      .values(categoryIds.map((categoryId) => ({ pageId, categoryId })));
  }
  const tagIds = unique(input.tagIds ?? []);
  if (tagIds.length) {
    await exec
      .insert(pageTagsTable)
      .values(tagIds.map((tagId) => ({ pageId, tagId })));
  }

  // SEO (one row)
  if (input.seo) {
    await exec.insert(seoTable).values({
      pageId,
      metaTitle: input.seo.metaTitle ?? null,
      metaDescription: input.seo.metaDescription ?? null,
      canonicalUrl: input.seo.canonicalUrl ?? null,
      robots: input.seo.robots ?? null,
      focusKeyword: input.seo.focusKeyword ?? null,
      keywords: input.seo.keywords ?? null,
      ogTitle: input.seo.ogTitle ?? null,
      ogDescription: input.seo.ogDescription ?? null,
      ogImage: input.seo.ogImage ?? null,
      ogType: input.seo.ogType ?? null,
      twitterCard: input.seo.twitterCard ?? null,
      twitterTitle: input.seo.twitterTitle ?? null,
      twitterDescription: input.seo.twitterDescription ?? null,
      twitterImage: input.seo.twitterImage ?? null,
      needsReview: input.seo.needsReview ?? false,
    });
  }

  // Breadcrumbs
  if (input.breadcrumbs?.length) {
    await exec.insert(breadcrumbsTable).values(
      input.breadcrumbs.map((b, i) => ({
        pageId,
        label: b.label,
        url: b.url ?? null,
        position: b.position ?? i,
      })),
    );
  }

  // Blocks + component tree (derived from the supplied componentTree)
  const blocks = componentTreeChildren(input.componentTree ?? null);
  if (blocks.length) {
    const rows = flattenBlocks(blocks, randomUUID).map((r) => ({
      ...r,
      pageId,
    }));
    await exec.insert(blocksTable).values(rows);
  }
  if (input.componentTree != null) {
    await exec.insert(componentTreeTable).values({
      pageId,
      tree: input.componentTree,
      schemaVersion: "1",
    });
  }

  // Direct images
  if (input.images?.length) {
    await exec.insert(imagesTable).values(
      input.images.map((img, i) => ({
        pageId,
        galleryId: null,
        originalUrl: img.originalUrl ?? img.url,
        url: img.url,
        alt: img.alt ?? null,
        title: img.title ?? null,
        caption: img.caption ?? null,
        credit: img.credit ?? null,
        width: img.width ?? null,
        height: img.height ?? null,
        mimeType: img.mimeType ?? null,
        role: img.role ?? null,
        position: img.position ?? i,
      })),
    );
  }

  // Galleries + their images
  if (input.galleries?.length) {
    for (const [gi, gallery] of input.galleries.entries()) {
      const [galleryRow] = await exec
        .insert(galleriesTable)
        .values({
          pageId,
          title: gallery.title ?? null,
          layout: gallery.layout ?? null,
          position: gallery.position ?? gi,
        })
        .returning({ id: galleriesTable.id });
      if (galleryRow && gallery.images.length) {
        await exec.insert(imagesTable).values(
          gallery.images.map((img, i) => ({
            pageId,
            galleryId: galleryRow.id,
            originalUrl: img.originalUrl ?? img.url,
            url: img.url,
            alt: img.alt ?? null,
            title: img.title ?? null,
            caption: img.caption ?? null,
            credit: img.credit ?? null,
            width: img.width ?? null,
            height: img.height ?? null,
            mimeType: img.mimeType ?? null,
            role: img.role ?? null,
            position: img.position ?? i,
          })),
        );
      }
    }
  }

  // FAQ
  if (input.faq?.length) {
    await exec.insert(faqTable).values(
      input.faq.map((f, i) => ({
        pageId,
        question: f.question,
        answer: f.answer,
        answerRichText: null,
        position: f.position ?? i,
      })),
    );
  }

  // JSON-LD
  if (input.jsonld?.length) {
    await exec.insert(jsonldTable).values(
      input.jsonld.map((j, i) => ({
        pageId,
        type: j.type ?? null,
        data: j.data,
        position: i,
      })),
    );
  }

  // External links
  if (input.externalLinks?.length) {
    await exec.insert(externalLinksTable).values(
      input.externalLinks.map((l, i) => ({
        pageId,
        href: l.href,
        anchorText: l.anchorText ?? null,
        rel: l.rel ?? null,
        domain: l.domain ?? null,
        position: l.position ?? i,
      })),
    );
  }

  // Internal links (targets resolved lazily; not on the write path)
  if (input.internalLinks?.length) {
    await exec.insert(internalLinksTable).values(
      input.internalLinks.map((l, i) => ({
        pageId,
        targetPageId: null,
        href: l.href,
        anchorText: l.anchorText ?? null,
        rel: l.rel ?? null,
        position: l.position ?? i,
      })),
    );
  }
}

/**
 * Append an immutable version snapshot of the page's current full state. The
 * snapshot is the serialized detail so a future restore has everything.
 */
async function snapshotVersion(
  pageId: string,
  changeSummary: string | null,
  exec: Executor,
): Promise<number> {
  const [last] = await exec
    .select({ versionNumber: pageVersionsTable.versionNumber })
    .from(pageVersionsTable)
    .where(eq(pageVersionsTable.pageId, pageId))
    .orderBy(desc(pageVersionsTable.versionNumber))
    .limit(1);
  const versionNumber = (last?.versionNumber ?? 0) + 1;
  const snapshot = await serializeCmsPostDetail(pageId, exec);
  await exec.insert(pageVersionsTable).values({
    pageId,
    versionNumber,
    snapshot: snapshot as unknown,
    changeSummary: changeSummary ?? null,
    crawledAt: null,
  });
  return versionNumber;
}

/** Set of canonical URLs already in use, optionally excluding one page id. */
async function takenCanonicalUrls(
  exec: Executor,
  excludeId?: string,
): Promise<Set<string>> {
  const rows = excludeId
    ? await exec
        .select({ canonicalUrl: pagesTable.canonicalUrl })
        .from(pagesTable)
        .where(ne(pagesTable.id, excludeId))
    : await exec.select({ canonicalUrl: pagesTable.canonicalUrl }).from(pagesTable);
  return new Set(rows.map((r) => r.canonicalUrl));
}

/** Resolve a unique slug + canonical URL for a new/updated page. */
async function resolveSlug(
  exec: Executor,
  desired: string | undefined,
  fallbackTitle: string,
  excludeId?: string,
): Promise<{ slug: string; canonicalUrl: string; pathname: string }> {
  const base = slugify(desired ?? "") || slugify(fallbackTitle) || "post";
  const takenCanon = await takenCanonicalUrls(exec, excludeId);
  // Uniquify against canonical URLs (the only UNIQUE column); slug follows it.
  let slug = base;
  let canonical = canonicalUrlForSlug(slug);
  let n = 2;
  while (takenCanon.has(canonical)) {
    slug = `${base}-${n}`;
    canonical = canonicalUrlForSlug(slug);
    n += 1;
  }
  return { slug, canonicalUrl: canonical, pathname: pathnameForSlug(slug) };
}

/**
 * Create a new post and all nested content in a single transaction, then append
 * an initial version snapshot. Returns the serialized detail.
 */
export async function createPost(
  input: CmsPostInput,
): Promise<CmsPostDetail> {
  const id = await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Executor;
    const resolved = await resolveSlug(tx, input.slug, input.title);
    const values = buildPageValues(input, resolved);
    const [pageRow] = await tx
      .insert(pagesTable)
      .values(values)
      .returning({ id: pagesTable.id });
    const pageId = pageRow!.id;
    await writePageChildren(pageId, input, tx);
    await snapshotVersion(pageId, input.changeSummary ?? "Created", tx);
    return pageId;
  });
  const detail = await serializeCmsPostDetail(id);
  return detail!;
}

/**
 * Replace an existing post wholesale (all nested content rewritten) in one
 * transaction and append a version snapshot. Returns null if the id is unknown.
 */
export async function updatePost(
  id: string,
  input: CmsPostInput,
): Promise<CmsPostDetail | null> {
  const ok = await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Executor;
    const [existing] = await tx
      .select({ id: pagesTable.id })
      .from(pagesTable)
      .where(eq(pagesTable.id, id))
      .limit(1);
    if (!existing) return false;

    const resolved = await resolveSlug(tx, input.slug, input.title, id);
    const values = buildPageValues(input, resolved);
    await tx
      .update(pagesTable)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(pagesTable.id, id));
    await clearPageChildren(id, tx);
    await writePageChildren(id, input, tx);
    await snapshotVersion(id, input.changeSummary ?? "Updated", tx);
    return true;
  });
  if (!ok) return null;
  return serializeCmsPostDetail(id);
}

/** Delete a post (cascades to all children). Returns false if not found. */
export async function deletePost(id: string): Promise<boolean> {
  const [deleted] = await db
    .delete(pagesTable)
    .where(eq(pagesTable.id, id))
    .returning({ id: pagesTable.id });
  return Boolean(deleted);
}

/** Create a blank draft scaffold. */
export async function scaffoldPost(
  scaffold: CmsScaffoldInput,
): Promise<CmsPostDetail> {
  return createPost(scaffoldToInput(scaffold));
}

/**
 * Duplicate an existing post: clone its content into a new draft with a fresh
 * slug and SEO flagged for review. Returns null if the source is unknown.
 */
export async function duplicatePost(
  sourceId: string,
  opts: CmsDuplicateInput,
): Promise<CmsPostDetail | null> {
  const source = await serializeCmsPostDetail(sourceId);
  if (!source) return null;
  const title = opts.title ?? `${source.title} (Copy)`;
  const input = cloneForDuplicate(source, {
    title,
    slug: opts.slug ?? undefined,
  });
  return createPost(input);
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

// Re-export the page type for route handlers that need it.
export type { Page };

export function snapshotToInput(source: CmsPostDetail): CmsPostInput {
  return {
    title: source.title,
    slug: source.slug,
    subtitle: source.subtitle ?? null,
    excerpt: source.excerpt ?? null,
    status: source.status,
    language: source.language,
    parentPath: source.parentPath ?? null,
    authorId: source.author?.id ?? null,
    primaryCategoryId: source.primaryCategory?.id ?? null,
    categoryIds: source.categories.map((c) => c.id),
    tagIds: source.tags.map((t) => t.id),
    featuredImageUrl: source.featuredImageUrl ?? null,
    featuredImageAlt: source.featuredImageAlt ?? null,
    contentHtml: source.contentHtml ?? null,
    richText: source.richText ?? null,
    componentTree: source.componentTree ?? null,
    readingTimeMinutes: source.readingTimeMinutes ?? null,
    wordCount: source.wordCount ?? null,
    publishedAt: source.publishedAt,
    seo: source.seo
      ? {
          metaTitle: source.seo.metaTitle ?? null,
          metaDescription: source.seo.metaDescription ?? null,
          canonicalUrl: source.seo.canonicalUrl ?? null,
          robots: source.seo.robots ?? null,
          focusKeyword: source.seo.focusKeyword ?? null,
          keywords: source.seo.keywords ?? null,
          ogTitle: source.seo.ogTitle ?? null,
          ogDescription: source.seo.ogDescription ?? null,
          ogImage: source.seo.ogImage ?? null,
          ogType: source.seo.ogType ?? null,
          twitterCard: source.seo.twitterCard ?? null,
          twitterTitle: source.seo.twitterTitle ?? null,
          twitterDescription: source.seo.twitterDescription ?? null,
          twitterImage: source.seo.twitterImage ?? null,
          needsReview: source.seo.needsReview,
        }
      : undefined,
    faq: source.faq.map((f) => ({
      question: f.question,
      answer: f.answer,
      position: f.position,
    })),
    breadcrumbs: source.breadcrumbs.map((b) => ({
      label: b.label,
      url: b.url ?? null,
      position: b.position,
    })),
    jsonld: source.jsonld.map((j) => ({ type: j.type ?? null, data: j.data })),
    images: source.images.map((img) => ({
      url: img.url,
      originalUrl: img.originalUrl ?? null,
      alt: img.alt ?? null,
      title: img.title ?? null,
      caption: img.caption ?? null,
      credit: img.credit ?? null,
      width: img.width ?? null,
      height: img.height ?? null,
      mimeType: img.mimeType ?? null,
      role: img.role ?? null,
      position: img.position,
    })),
    galleries: source.galleries.map((g) => ({
      title: g.title ?? null,
      layout: g.layout ?? null,
      position: g.position,
      images: g.images.map((img) => ({
        url: img.url,
        originalUrl: img.originalUrl ?? null,
        alt: img.alt ?? null,
        title: img.title ?? null,
        caption: img.caption ?? null,
        credit: img.credit ?? null,
        width: img.width ?? null,
        height: img.height ?? null,
        mimeType: img.mimeType ?? null,
        role: img.role ?? null,
        position: img.position,
      })),
    })),
    internalLinks: source.internalLinks.map((l) => ({
      href: l.href,
      anchorText: l.anchorText ?? null,
      rel: l.rel ?? null,
      domain: l.domain ?? null,
      position: l.position,
    })),
    externalLinks: source.externalLinks.map((l) => ({
      href: l.href,
      anchorText: l.anchorText ?? null,
      rel: l.rel ?? null,
      domain: l.domain ?? null,
      position: l.position,
    })),
  } as CmsPostInput;
}

