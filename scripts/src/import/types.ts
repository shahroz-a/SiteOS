/**
 * Intermediate, DB-agnostic shapes produced by the parser. Persistence maps
 * these onto Drizzle insert types. Keeping them separate means a parser change
 * never has to know about the storage layout (and vice-versa).
 */

export interface BlockNode {
  blockType: string;
  text?: string;
  data?: unknown;
  anchorId?: string;
  children?: BlockNode[];
}

export interface ParsedAuthor {
  name: string;
  slug: string;
  bio?: string | null;
  avatarUrl?: string | null;
  role?: string | null;
  originalUrl?: string | null;
}

export interface ParsedTaxonomy {
  name: string;
  slug: string;
  originalUrl?: string | null;
}

export interface ParsedImage {
  originalUrl: string;
  url: string;
  alt?: string | null;
  title?: string | null;
  caption?: string | null;
  credit?: string | null;
  width?: number | null;
  height?: number | null;
  mimeType?: string | null;
  role?: string | null;
  position: number;
}

export interface ParsedLink {
  href: string;
  anchorText?: string | null;
  rel?: string | null;
  domain?: string | null;
  position: number;
}

export interface ParsedFaq {
  question: string;
  answer: string;
  position: number;
}

export interface ParsedBreadcrumb {
  position: number;
  label: string;
  url?: string | null;
}

export interface ParsedJsonld {
  type: string | null;
  data: unknown;
}

export interface ParsedSeo {
  metaTitle?: string | null;
  metaDescription?: string | null;
  canonicalUrl?: string | null;
  robots?: string | null;
  focusKeyword?: string | null;
  keywords?: string[];
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImage?: string | null;
  ogType?: string | null;
  twitterCard?: string | null;
  twitterTitle?: string | null;
  twitterDescription?: string | null;
  twitterImage?: string | null;
}

export interface ParsedMetadata {
  metaTags: Array<{ name?: string; property?: string; content?: string }>;
  httpHeaders: Record<string, string>;
  openGraph: Record<string, unknown>;
  twitter: Record<string, unknown>;
  custom: Record<string, unknown> | null;
}

export interface ParsedPage {
  // Identity / URL
  url: string;
  canonicalUrl: string;
  slug: string;
  pathname: string;
  parentPath: string | null;
  permalink: string | null;
  trailingSlash: boolean;
  canonicalTag: string | null;
  hreflang: Array<{ lang: string; href: string }>;
  language: string;
  status: "draft" | "published" | "archived";
  pageType: "post" | "page" | "category" | "author" | "tag" | "landing" | "web-story";

  // Editorial
  title: string;
  subtitle: string | null;
  excerpt: string | null;

  // Relations
  author: ParsedAuthor | null;
  categories: ParsedTaxonomy[];
  primaryCategorySlug: string | null;
  tags: ParsedTaxonomy[];

  // Media
  featuredImageUrl: string | null;
  featuredImageAlt: string | null;
  images: ParsedImage[];

  // Content (lossless + derived)
  originalHtml: string;
  cleanedHtml: string;
  richText: unknown;
  componentTree: unknown;
  blocks: BlockNode[];

  // Derived stats
  readingTimeMinutes: number | null;
  wordCount: number | null;

  // Dates
  publishedAt: Date | null;
  modifiedAt: Date | null;
  sitemapLastmod: Date | null;

  // Structured / SEO
  breadcrumbs: ParsedBreadcrumb[];
  faq: ParsedFaq[];
  jsonld: ParsedJsonld[];
  internalLinks: ParsedLink[];
  externalLinks: ParsedLink[];
  seo: ParsedSeo;
  metadata: ParsedMetadata;

  // Crawl
  httpStatus: number;
  contentHash: string;
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  httpStatus: number;
  headers: Record<string, string>;
  html: string;
  durationMs: number;
}

export interface PageReport {
  url: string;
  ok: boolean;
  pageId?: string;
  title?: string;
  httpStatus?: number;
  changed?: boolean;
  counts?: Record<string, number>;
  error?: string;
}
