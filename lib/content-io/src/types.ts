/**
 * The canonical, format-agnostic content bundle. Every serializer/parser in
 * this lib reads or writes this shape, and the API server reads it from / writes
 * it to the database. It is keyed entirely by natural keys (author/category/tag
 * `slug`, page `canonicalUrl`/`slug`) — internal UUIDs never appear, so a bundle
 * round-trips across databases without leaking or depending on row ids.
 *
 * DB-free and dependency-light so it is safe to import from any package,
 * including browser bundles (the CMS imports the mapping registry + types).
 */

export const BUNDLE_VERSION = "1";

export interface BundleAuthor {
  name: string;
  slug: string;
  bio?: string | null;
  avatarUrl?: string | null;
  role?: string | null;
  email?: string | null;
  social?: Record<string, string> | null;
}

export interface BundleCategory {
  name: string;
  slug: string;
  description?: string | null;
  parentSlug?: string | null;
}

export interface BundleTag {
  name: string;
  slug: string;
  description?: string | null;
}

export interface BundleImage {
  originalUrl: string;
  url: string;
  alt?: string | null;
  title?: string | null;
  caption?: string | null;
  credit?: string | null;
  width?: number | null;
  height?: number | null;
  mimeType?: string | null;
  fileSize?: number | null;
  role?: string | null;
  position: number;
}

export interface BundleLink {
  href: string;
  anchorText?: string | null;
  rel?: string | null;
  domain?: string | null;
  position: number;
}

export interface BundleFaq {
  question: string;
  answer: string;
  position: number;
}

export interface BundleBreadcrumb {
  label: string;
  url?: string | null;
  position: number;
}

export interface BundleJsonLd {
  type?: string | null;
  data: unknown;
  position: number;
}

export interface BundleSeo {
  metaTitle?: string | null;
  metaDescription?: string | null;
  canonicalUrl?: string | null;
  robots?: string | null;
  focusKeyword?: string | null;
  keywords?: string[] | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImage?: string | null;
  ogType?: string | null;
  twitterCard?: string | null;
  twitterTitle?: string | null;
  twitterDescription?: string | null;
  twitterImage?: string | null;
}

export interface BundleMetadata {
  metaTags?: Array<{
    name?: string;
    property?: string;
    content?: string;
  }> | null;
  httpHeaders?: Record<string, string> | null;
  openGraph?: Record<string, unknown> | null;
  twitter?: Record<string, unknown> | null;
  custom?: Record<string, unknown> | null;
}

export interface BundlePost {
  slug: string;
  title: string;
  subtitle?: string | null;
  excerpt?: string | null;
  status: string;
  language: string;
  canonicalUrl: string;
  originalUrl?: string | null;
  pathname: string;
  parentPath?: string | null;
  authorSlug?: string | null;
  primaryCategorySlug?: string | null;
  categorySlugs: string[];
  tagSlugs: string[];
  featuredImageUrl?: string | null;
  featuredImageAlt?: string | null;
  contentHtml?: string | null;
  richText?: unknown;
  componentTree?: unknown;
  readingTimeMinutes?: number | null;
  wordCount?: number | null;
  publishedAt?: string | null;
  modifiedAt?: string | null;
  seo?: BundleSeo | null;
  breadcrumbs: BundleBreadcrumb[];
  faq: BundleFaq[];
  jsonld: BundleJsonLd[];
  images: BundleImage[];
  links: { internal: BundleLink[]; external: BundleLink[] };
  metadata?: BundleMetadata | null;
}

export interface ContentBundle {
  bundleVersion: string;
  exportedAt: string;
  source?: string | null;
  counts?: {
    authors: number;
    categories: number;
    tags: number;
    posts: number;
  };
  authors: BundleAuthor[];
  categories: BundleCategory[];
  tags: BundleTag[];
  posts: BundlePost[];
}

/** Supported serialization formats. */
export type ExportFormat = "json" | "csv" | "markdown" | "sql" | "payload";
/** Formats that can be parsed back into a bundle. SQL is export-only. */
export type ImportFormat = "json" | "csv" | "markdown" | "payload";

export const EXPORT_FORMATS: readonly ExportFormat[] = [
  "json",
  "csv",
  "markdown",
  "sql",
  "payload",
] as const;

export const IMPORT_FORMATS: readonly ImportFormat[] = [
  "json",
  "csv",
  "markdown",
  "payload",
] as const;

export interface SerializedFile {
  filename: string;
  contentType: string;
  content: string;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Coerce an arbitrary parsed object into a well-formed `ContentBundle`, filling
 * required arrays/objects with safe defaults so downstream consumers never have
 * to null-check the structural fields.
 */
export function normalizeBundle(raw: unknown): ContentBundle {
  const data = (raw ?? {}) as Partial<ContentBundle>;
  return {
    bundleVersion: asString(data.bundleVersion, BUNDLE_VERSION),
    exportedAt: asString(data.exportedAt, new Date(0).toISOString()),
    source: data.source ?? null,
    counts: data.counts,
    authors: asArray<BundleAuthor>(data.authors),
    categories: asArray<BundleCategory>(data.categories),
    tags: asArray<BundleTag>(data.tags),
    posts: asArray<Partial<BundlePost>>(data.posts).map(normalizePost),
  };
}

function normalizePost(raw: Partial<BundlePost>): BundlePost {
  return {
    slug: asString(raw.slug),
    title: asString(raw.title),
    subtitle: raw.subtitle ?? null,
    excerpt: raw.excerpt ?? null,
    status: asString(raw.status, "draft"),
    language: asString(raw.language, "en"),
    canonicalUrl: asString(raw.canonicalUrl),
    originalUrl: raw.originalUrl ?? null,
    pathname: asString(raw.pathname),
    parentPath: raw.parentPath ?? null,
    authorSlug: raw.authorSlug ?? null,
    primaryCategorySlug: raw.primaryCategorySlug ?? null,
    categorySlugs: asArray<string>(raw.categorySlugs),
    tagSlugs: asArray<string>(raw.tagSlugs),
    featuredImageUrl: raw.featuredImageUrl ?? null,
    featuredImageAlt: raw.featuredImageAlt ?? null,
    contentHtml: raw.contentHtml ?? null,
    richText: raw.richText,
    componentTree: raw.componentTree,
    readingTimeMinutes: raw.readingTimeMinutes ?? null,
    wordCount: raw.wordCount ?? null,
    publishedAt: raw.publishedAt ?? null,
    modifiedAt: raw.modifiedAt ?? null,
    seo: raw.seo ?? null,
    breadcrumbs: asArray<BundleBreadcrumb>(raw.breadcrumbs),
    faq: asArray<BundleFaq>(raw.faq),
    jsonld: asArray<BundleJsonLd>(raw.jsonld),
    images: asArray<BundleImage>(raw.images),
    links: {
      internal: asArray<BundleLink>(raw.links?.internal),
      external: asArray<BundleLink>(raw.links?.external),
    },
    metadata: raw.metadata ?? null,
  };
}

/** Recompute the `counts` summary from the bundle's collections. */
export function withCounts(bundle: ContentBundle): ContentBundle {
  return {
    ...bundle,
    counts: {
      authors: bundle.authors.length,
      categories: bundle.categories.length,
      tags: bundle.tags.length,
      posts: bundle.posts.length,
    },
  };
}
