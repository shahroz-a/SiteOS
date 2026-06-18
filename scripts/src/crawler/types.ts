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
