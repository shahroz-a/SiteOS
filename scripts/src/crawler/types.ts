import type { pageTypeEnum } from "@workspace/db";

export type PageType = (typeof pageTypeEnum.enumValues)[number];

/** A URL discovered from a sitemap (or recursive nested sitemap). */
export interface DiscoveredUrl {
  url: string;
  sitemapSource: string;
  lastmod: Date | null;
  pageType: PageType;
  priority: number;
}

/** One hop in a redirect chain. */
export interface RedirectHop {
  from: string;
  to: string;
  status: number;
}

/**
 * Why a redirect hop was dropped at crawl time instead of being persisted as a
 * forwarding redirect. Mirrors the `RedirectSkipReason` pattern used by the
 * prerender's serving path, but covers the *capture* gate
 * (`isResolvableRedirectTarget` / `isCleanBlogUrl`) rather than the serving one.
 * Each reason maps one-to-one to the fix an editor would make to the source
 * markup:
 *  - `unserveable-from`: the OLD path (`from`) isn't a clean, blog-serveable URL
 *    (off-blog, an asset, or structurally malformed) so even a sound target
 *    couldn't be served from the migrated blog.
 *  - `foreign-host`: the destination points at a third-party host (e.g. a Google
 *    Maps link); storing it would strip the host and re-home it under
 *    headout.com, forwarding readers to a path that doesn't exist there.
 *  - `embedded-url`: the destination path carries an embedded protocol/quote
 *    left over from a concatenated href.
 *  - `bare-domain-segment`: a destination path segment is itself a hostname
 *    (`…/introducingathens.com`) — a bare domain mistakenly used as a link.
 *  - `leading-hyphen-segment`: a destination path segment is a botched `/-…`
 *    relative-link fragment.
 *  - `whitespace-segment`: a destination path segment carries whitespace —
 *    alt-text/label text captured as an href.
 *  - `malformed-encoding`: a destination path segment has invalid
 *    percent-encoding.
 *  - `unparseable-target`: the destination URL can't be parsed at all.
 *  - `malformed-blog-target`: an on-blog destination that's still junk (a
 *    non-page asset, mis-cased, or over-nested taxonomy path).
 */
export type RedirectDropReason =
  | "unserveable-from"
  | "foreign-host"
  | "embedded-url"
  | "bare-domain-segment"
  | "leading-hyphen-segment"
  | "whitespace-segment"
  | "malformed-encoding"
  | "unparseable-target"
  | "malformed-blog-target";

/**
 * A redirect hop dropped at crawl time, retained for operator visibility. The
 * `from`/`to` keep their FULL original URLs (host included) so an editor can see
 * exactly the junk link — the foreign host or embedded URL is the whole point.
 */
export interface DroppedRedirect {
  from: string;
  to: string;
  status: number;
  reason: RedirectDropReason;
}

/** Result of fetching/rendering a single URL. */
export interface FetchResult {
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number;
  html: string;
  redirectChain: RedirectHop[];
  /** "browser" when rendered with Playwright, "http" for the fallback. */
  via: "browser" | "http";
  httpHeaders: Record<string, string>;
  /** True when the response was a non-HTML resource (image, PDF, …) and must not be parsed/stored as a page. */
  nonHtml?: boolean;
}

/**
 * A node in the Payload-compatible component/block tree. `type` maps to a
 * Payload block type; `children` preserve nesting and ordering.
 */
export interface ComponentNode {
  type: string;
  anchorId?: string;
  text?: string;
  data?: Record<string, unknown>;
  children?: ComponentNode[];
}

/** Lexical/Slate-style structured rich-text node (never flattened to text). */
export interface RichTextNode {
  type: string;
  tag?: string;
  text?: string;
  format?: string[];
  url?: string;
  children?: RichTextNode[];
  [key: string]: unknown;
}

export interface ExtractedImage {
  originalUrl: string;
  url: string;
  alt: string | null;
  title: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
  loading: string | null;
  role: string | null;
  position: number;
}

export interface ExtractedLink {
  href: string;
  anchorText: string | null;
  rel: string | null;
  position: number;
}

export interface ExtractedFaq {
  question: string;
  answer: string;
  position: number;
}

export interface ExtractedAccordion {
  title: string;
  content: string;
  position: number;
}

export interface ExtractedBreadcrumb {
  label: string;
  url: string | null;
  position: number;
}

export interface ExtractedVideo {
  provider: string | null;
  originalUrl: string;
  embedUrl: string | null;
  title: string | null;
  position: number;
}

export interface ExtractedTocItem {
  label: string;
  anchor: string | null;
  position: number;
}

export interface ExtractedSeo {
  metaTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  robots: string | null;
  keywords: string[] | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  ogType: string | null;
  twitterCard: string | null;
  twitterTitle: string | null;
  twitterDescription: string | null;
  twitterImage: string | null;
}

export interface ExtractedMetadata {
  metaTags: Array<{ name?: string; property?: string; content?: string }>;
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
  custom: Record<string, unknown>;
}

/** Counts used to validate parsed output against the source DOM. */
export interface ContentCounts {
  headings: number;
  paragraphs: number;
  images: number;
  links: number;
  tables: number;
  lists: number;
  faqs: number;
  ctas: number;
  components: number;
  anchors: number;
  words: number;
  characters: number;
}

/** The complete, lossless extraction of a single page. */
export interface ExtractedPage {
  // identity / url preservation
  requestedUrl: string;
  finalUrl: string;
  canonicalUrl: string;
  canonicalTag: string | null;
  slug: string;
  pathname: string;
  parentPath: string | null;
  trailingSlash: boolean;
  pageType: PageType;
  language: string;
  httpStatus: number;
  redirectTarget: string | null;
  redirectChain: RedirectHop[];
  droppedRedirects: DroppedRedirect[];
  hreflang: Array<{ lang: string; href: string }>;
  sitemapSource: string | null;
  sitemapLastmod: Date | null;

  // primary content fields
  title: string;
  subtitle: string | null;
  excerpt: string | null;
  featuredImageUrl: string | null;
  featuredImageAlt: string | null;
  publishedAt: Date | null;
  modifiedAt: Date | null;
  readingTimeMinutes: number | null;
  wordCount: number;

  // taxonomy
  author: {
    name: string;
    slug: string;
    bio: string | null;
    avatarUrl: string | null;
    role: string | null;
    url: string | null;
  } | null;
  categories: Array<{ name: string; slug: string; url: string | null }>;
  tags: Array<{ name: string; slug: string; url: string | null }>;

  // lossless representations
  originalHtml: string;
  cleanedHtml: string;
  richText: RichTextNode;
  componentTree: ComponentNode[];

  // structured extras
  images: ExtractedImage[];
  videos: ExtractedVideo[];
  internalLinks: ExtractedLink[];
  externalLinks: ExtractedLink[];
  faqs: ExtractedFaq[];
  accordions: ExtractedAccordion[];
  breadcrumbs: ExtractedBreadcrumb[];
  toc: ExtractedTocItem[];
  jsonld: Array<{ type: string | null; data: unknown }>;
  seo: ExtractedSeo;
  metadata: ExtractedMetadata;

  // bookkeeping
  counts: ContentCounts;
  contentHash: string;
  via: "browser" | "http";
}
