/**
 * Pure (DB-free) mapping from the migration schema's row shapes into
 * Payload CMS collection documents. These functions take plain objects so they
 * can be unit-tested and reused without a database connection.
 *
 * Payload conventions used here:
 * - Each document keeps its original migration UUID as `id`. Relationship
 *   fields therefore reference related documents by that same UUID string,
 *   which is exactly the shape Payload expects for a relationship value
 *   (the related document's id). The example loader remaps these to freshly
 *   generated Payload ids when seeding via the Local API.
 * - `media` is an upload collection: `url`/`sourceUrl` point at the original
 *   CDN asset that must be fetched/uploaded when loading into Payload.
 * - `posts.layout` is a Payload "blocks" field assembled from the page's
 *   `componentTree`; `content` keeps the lossless rich-text JSON and
 *   `contentHtml` keeps the cleaned HTML.
 */

// ---------------------------------------------------------------------------
// Source shapes (subset of the migration DB rows we read)
// ---------------------------------------------------------------------------

export interface SourceAuthor {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  avatarUrl: string | null;
  role: string | null;
  email: string | null;
  social: Record<string, string> | null;
}

export interface SourceCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
}

export interface SourceTag {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface SourceImage {
  id: string;
  pageId: string | null;
  originalUrl: string;
  url: string;
  alt: string | null;
  title: string | null;
  caption: string | null;
  credit: string | null;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  fileSize: number | null;
  role: string | null;
  position: number;
}

export interface SourceBreadcrumb {
  label: string;
  url: string | null;
  position: number;
}

export interface SourceFaq {
  id: string;
  question: string;
  answer: string;
  position: number;
}

export interface SourceJsonld {
  type: string | null;
  data: unknown;
}

export interface SourceSeo {
  metaTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  robots: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  twitterCard: string | null;
  twitterTitle: string | null;
  twitterDescription: string | null;
  twitterImage: string | null;
  keywords: string[] | null;
}

export interface SourcePage {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  excerpt: string | null;
  status: string;
  language: string;
  canonicalUrl: string;
  pathname: string;
  parentPath: string | null;
  featuredImageUrl: string | null;
  featuredImageAlt: string | null;
  cleanedHtml: string | null;
  richText: unknown;
  componentTree: unknown;
  readingTimeMinutes: number | null;
  wordCount: number | null;
  publishedAt: Date | string | null;
  modifiedAt: Date | string | null;
  authorId: string | null;
  primaryCategoryId: string | null;
}

export interface SourcePageBundle {
  page: SourcePage;
  authorId: string | null;
  categoryIds: string[];
  tagIds: string[];
  images: SourceImage[];
  breadcrumbs: SourceBreadcrumb[];
  faq: SourceFaq[];
  jsonld: SourceJsonld[];
  seo: SourceSeo | null;
}

// ---------------------------------------------------------------------------
// Payload document shapes
// ---------------------------------------------------------------------------

export interface PayloadAuthorDoc {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  role: string | null;
  email: string | null;
  /** Relationship to the `media` collection (avatar). */
  avatar: string | null;
  social: Record<string, string> | null;
}

export interface PayloadCategoryDoc {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  /** Self-relationship to `categories`. */
  parent: string | null;
}

export interface PayloadTagDoc {
  id: string;
  title: string;
  slug: string;
  description: string | null;
}

export interface PayloadMediaDoc {
  id: string;
  alt: string | null;
  caption: string | null;
  credit: string | null;
  filename: string;
  mimeType: string | null;
  filesize: number | null;
  width: number | null;
  height: number | null;
  /** Source asset that must be fetched/uploaded when loading into Payload. */
  sourceUrl: string;
  url: string;
}

export type PayloadBlock =
  | { blockType: "heading"; level: number; text: string; anchorId?: string }
  | { blockType: "paragraph"; text: string }
  | { blockType: "list"; title?: string; ordered: boolean; items: string[] }
  | {
      blockType: "section";
      heading?: string;
      anchorId?: string;
      content: PayloadBlock[];
    }
  | { blockType: "html"; html: string };

export interface PayloadPostDoc {
  id: string;
  title: string;
  slug: string;
  subtitle: string | null;
  excerpt: string | null;
  _status: "published" | "draft";
  language: string;
  publishedAt: string | null;
  /** Relationship to `authors`. */
  author: string | null;
  /** Relationships to `categories`. */
  categories: string[];
  primaryCategory: string | null;
  /** Relationships to `tags`. */
  tags: string[];
  /** Relationship to `media` (hero / featured image). */
  heroImage: string | null;
  /** Payload blocks field assembled from the page's componentTree. */
  layout: PayloadBlock[];
  /** Lossless rich-text JSON preserved from the migration. */
  content: unknown;
  /** Cleaned HTML preserved from the migration. */
  contentHtml: string | null;
  meta: {
    title: string | null;
    description: string | null;
    image: string | null;
    canonicalUrl: string | null;
    robots: string | null;
    keywords: string[] | null;
    ogTitle: string | null;
    ogDescription: string | null;
    twitterCard: string | null;
  };
  url: {
    canonicalUrl: string;
    pathname: string;
    parentPath: string | null;
  };
  readingTimeMinutes: number | null;
  wordCount: number | null;
  breadcrumbs: Array<{ label: string; url: string | null }>;
  faq: Array<{ question: string; answer: string }>;
  structuredData: Array<{ type: string | null; data: unknown }>;
}

export interface PayloadExport {
  /** Metadata about how/when this export was produced. */
  exportedAt: string;
  schemaVersion: string;
  /** Insertion order matters: load collections top-to-bottom. */
  collections: {
    media: PayloadMediaDoc[];
    authors: PayloadAuthorDoc[];
    categories: PayloadCategoryDoc[];
    tags: PayloadTagDoc[];
    posts: PayloadPostDoc[];
  };
}

// ---------------------------------------------------------------------------
// Block-tree mapping
// ---------------------------------------------------------------------------

interface RawBlockNode {
  blockType?: string;
  text?: string;
  anchorId?: string;
  data?: Record<string, unknown> | null;
  children?: RawBlockNode[];
}

function headingLevel(node: RawBlockNode): number {
  const data = node.data ?? {};
  const raw = data.level ?? data.tag;
  if (typeof raw === "number") return Math.min(6, Math.max(1, raw));
  if (typeof raw === "string") {
    const n = Number.parseInt(raw.replace(/^h/i, ""), 10);
    if (Number.isFinite(n)) return Math.min(6, Math.max(1, n));
  }
  return 2;
}

/** Convert a single migration block node into a Payload block (if mappable). */
function mapBlockNode(node: RawBlockNode): PayloadBlock | null {
  const type = node.blockType;
  const data = node.data ?? {};

  switch (type) {
    case "heading": {
      const text = node.text ?? (typeof data.text === "string" ? data.text : "");
      const block: PayloadBlock = {
        blockType: "heading",
        level: headingLevel(node),
        text,
      };
      if (node.anchorId) block.anchorId = node.anchorId;
      return block;
    }
    case "paragraph": {
      const text = node.text ?? (typeof data.text === "string" ? data.text : "");
      return { blockType: "paragraph", text };
    }
    case "list": {
      const items = Array.isArray(data.items)
        ? data.items.filter((i): i is string => typeof i === "string")
        : [];
      const block: PayloadBlock = {
        blockType: "list",
        ordered: data.ordered === true,
        items,
      };
      if (typeof data.title === "string") block.title = data.title;
      return block;
    }
    case "section": {
      const content = mapBlockNodes(node.children ?? []);
      const block: PayloadBlock = { blockType: "section", content };
      if (typeof data.heading === "string") block.heading = data.heading;
      if (node.anchorId) block.anchorId = node.anchorId;
      return block;
    }
    case "html": {
      const html =
        typeof data.html === "string"
          ? data.html
          : typeof node.text === "string"
            ? node.text
            : "";
      return { blockType: "html", html };
    }
    default:
      // Unknown block types are preserved as text paragraphs when they carry
      // text, otherwise dropped (they have no renderable payload).
      if (typeof node.text === "string" && node.text.length > 0) {
        return { blockType: "paragraph", text: node.text };
      }
      return null;
  }
}

function mapBlockNodes(nodes: RawBlockNode[]): PayloadBlock[] {
  const out: PayloadBlock[] = [];
  for (const node of nodes) {
    const mapped = mapBlockNode(node);
    if (mapped) out.push(mapped);
  }
  return out;
}

/**
 * Turn a stored `componentTree` (either `{ children: [...] }` /
 * `{ root: { children } }` or a bare array of nodes) into a Payload blocks
 * layout. Returns an empty array when no usable tree exists.
 */
export function componentTreeToLayout(tree: unknown): PayloadBlock[] {
  if (!tree) return [];
  if (Array.isArray(tree)) return mapBlockNodes(tree as RawBlockNode[]);
  if (typeof tree === "object") {
    const obj = tree as { children?: unknown; root?: { children?: unknown } };
    if (Array.isArray(obj.children)) {
      return mapBlockNodes(obj.children as RawBlockNode[]);
    }
    if (obj.root && Array.isArray(obj.root.children)) {
      return mapBlockNodes(obj.root.children as RawBlockNode[]);
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Document mapping
// ---------------------------------------------------------------------------

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function filenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const base = u.pathname.split("/").filter(Boolean).pop();
    if (base) return base;
  } catch {
    // not an absolute URL; fall through
  }
  const parts = url.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "asset";
}

export function mapAuthor(
  author: SourceAuthor,
  avatarMediaId: string | null,
): PayloadAuthorDoc {
  return {
    id: author.id,
    name: author.name,
    slug: author.slug,
    bio: author.bio,
    role: author.role,
    email: author.email,
    avatar: avatarMediaId,
    social: author.social,
  };
}

export function mapCategory(category: SourceCategory): PayloadCategoryDoc {
  return {
    id: category.id,
    title: category.name,
    slug: category.slug,
    description: category.description,
    parent: category.parentId,
  };
}

export function mapTag(tag: SourceTag): PayloadTagDoc {
  return {
    id: tag.id,
    title: tag.name,
    slug: tag.slug,
    description: tag.description,
  };
}

export function mapImage(image: SourceImage): PayloadMediaDoc {
  return {
    id: image.id,
    alt: image.alt,
    caption: image.caption,
    credit: image.credit,
    filename: filenameFromUrl(image.url || image.originalUrl),
    mimeType: image.mimeType,
    filesize: image.fileSize,
    width: image.width,
    height: image.height,
    sourceUrl: image.originalUrl,
    url: image.url,
  };
}

// ---------------------------------------------------------------------------
// Reverse mapping (Payload documents -> migration row shapes)
//
// These mirror the forward mappers above so editors can round-trip content
// edited in Payload back into the migration database. They are pure: they take
// Payload documents (plus any pre-resolved relationship URLs/ids) and return
// plain objects ready to upsert. Relationship resolution (slug/url lookups)
// happens in the import script, not here, so these stay DB-free and testable.
// ---------------------------------------------------------------------------

export interface ReverseAuthorRow {
  name: string;
  slug: string;
  bio: string | null;
  role: string | null;
  email: string | null;
  avatarUrl: string | null;
  social: Record<string, string> | null;
}

export interface ReverseCategoryRow {
  name: string;
  slug: string;
  description: string | null;
}

export interface ReverseTagRow {
  name: string;
  slug: string;
  description: string | null;
}

export interface ReverseSeoRow {
  metaTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  robots: string | null;
  keywords: string[] | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  twitterCard: string | null;
}

/** Reverse {@link mapAuthor}. `avatarUrl` is resolved from the avatar media doc. */
export function payloadAuthorToRow(
  doc: PayloadAuthorDoc,
  avatarUrl: string | null,
): ReverseAuthorRow {
  return {
    name: doc.name,
    slug: doc.slug,
    bio: doc.bio,
    role: doc.role,
    email: doc.email,
    avatarUrl,
    social: doc.social,
  };
}

/** Reverse {@link mapCategory}. Parent is resolved separately (by slug). */
export function payloadCategoryToRow(doc: PayloadCategoryDoc): ReverseCategoryRow {
  return {
    name: doc.title,
    slug: doc.slug,
    description: doc.description,
  };
}

/** Reverse {@link mapTag}. */
export function payloadTagToRow(doc: PayloadTagDoc): ReverseTagRow {
  return {
    name: doc.title,
    slug: doc.slug,
    description: doc.description,
  };
}

/** Reverse the SEO portion of {@link mapPost} (`post.meta` -> seo row). */
export function payloadMetaToSeoRow(doc: PayloadPostDoc): ReverseSeoRow {
  const meta = doc.meta;
  return {
    metaTitle: meta.title,
    metaDescription: meta.description,
    canonicalUrl: meta.canonicalUrl ?? doc.url.canonicalUrl,
    robots: meta.robots,
    keywords: meta.keywords,
    ogTitle: meta.ogTitle,
    ogDescription: meta.ogDescription,
    ogImage: meta.image,
    twitterCard: meta.twitterCard,
  };
}

/** Reverse a single Payload block into a stored component-tree node. */
function payloadBlockToNode(block: PayloadBlock): RawBlockNode {
  switch (block.blockType) {
    case "heading": {
      const node: RawBlockNode = {
        blockType: "heading",
        text: block.text,
        data: { level: block.level },
      };
      if (block.anchorId) node.anchorId = block.anchorId;
      return node;
    }
    case "paragraph":
      return { blockType: "paragraph", text: block.text };
    case "list": {
      const data: Record<string, unknown> = {
        ordered: block.ordered,
        items: block.items,
      };
      if (block.title != null) data.title = block.title;
      return { blockType: "list", data };
    }
    case "section": {
      const node: RawBlockNode = {
        blockType: "section",
        data: block.heading != null ? { heading: block.heading } : {},
        children: block.content.map(payloadBlockToNode),
      };
      if (block.anchorId) node.anchorId = block.anchorId;
      return node;
    }
    case "html":
      return { blockType: "html", data: { html: block.html } };
  }
}

/**
 * Reverse {@link componentTreeToLayout}: rebuild the stored `componentTree`
 * (the importer's `{ type: "root", schemaVersion, children }` envelope) from a
 * Payload `layout` blocks array. Round-trips through `componentTreeToLayout`
 * back to the same layout.
 */
export function layoutToComponentTree(layout: PayloadBlock[]): {
  type: "root";
  schemaVersion: string;
  children: RawBlockNode[];
} {
  return {
    type: "root",
    schemaVersion: "1",
    children: layout.map(payloadBlockToNode),
  };
}

export function mapPost(
  bundle: SourcePageBundle,
  heroImageId: string | null,
): PayloadPostDoc {
  const { page, seo } = bundle;
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    subtitle: page.subtitle,
    excerpt: page.excerpt,
    _status: page.status === "published" ? "published" : "draft",
    language: page.language,
    publishedAt: toIso(page.publishedAt),
    author: bundle.authorId,
    categories: bundle.categoryIds,
    primaryCategory: page.primaryCategoryId,
    tags: bundle.tagIds,
    heroImage: heroImageId,
    layout: componentTreeToLayout(page.componentTree),
    content: page.richText ?? null,
    contentHtml: page.cleanedHtml,
    meta: {
      title: seo?.metaTitle ?? null,
      description: seo?.metaDescription ?? null,
      image: seo?.ogImage ?? null,
      canonicalUrl: seo?.canonicalUrl ?? page.canonicalUrl,
      robots: seo?.robots ?? null,
      keywords: seo?.keywords ?? null,
      ogTitle: seo?.ogTitle ?? null,
      ogDescription: seo?.ogDescription ?? null,
      twitterCard: seo?.twitterCard ?? null,
    },
    url: {
      canonicalUrl: page.canonicalUrl,
      pathname: page.pathname,
      parentPath: page.parentPath,
    },
    readingTimeMinutes: page.readingTimeMinutes,
    wordCount: page.wordCount,
    breadcrumbs: bundle.breadcrumbs
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((b) => ({ label: b.label, url: b.url })),
    faq: bundle.faq
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((f) => ({ question: f.question, answer: f.answer })),
    structuredData: bundle.jsonld.map((j) => ({ type: j.type, data: j.data })),
  };
}
