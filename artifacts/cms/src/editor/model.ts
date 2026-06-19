/**
 * Editor block model + conversion to/from the API's `componentTree`.
 *
 * The editor's block tree is the source of truth. On save we emit the crawler
 * ARRAY shape of `componentTree` (each node keyed by `type`) — the exact shape
 * the shared `@workspace/blog-renderer` consumes — and set `contentHtml: null`
 * so both the public blog and the live preview render from `componentTree`.
 *
 * On load we reverse the mapping. An article that only has legacy `contentHtml`
 * (e.g. a crawled/imported post) is wrapped in a single rich-text block so it
 * stays fully editable without a lossy Lexical round-trip.
 */
import type { CTNode } from "@workspace/blog-renderer";
import { asComponentTree } from "@workspace/blog-renderer";
import type { CmsPostDetail, CmsPostInput } from "@workspace/api-client-react";
import type { SeoValidationInput, HeadingNode } from "@workspace/seo-validation";
import { buildCmsPostInput } from "@workspace/cms-post-input";

export type BlockType =
  | "hero"
  | "richText"
  | "heading"
  | "image"
  | "gallery"
  | "quote"
  | "table"
  | "accordion"
  | "faq"
  | "cta"
  | "newsletter"
  | "related"
  | "video"
  | "divider"
  | "section";

export interface GalleryImage {
  src: string;
  alt?: string;
}

export interface BlockEntry {
  title?: string;
  body?: string;
  question?: string;
  answer?: string;
  href?: string;
  imageUrl?: string;
  eyebrow?: string;
}

export interface BlockData {
  level?: number;
  html?: string;
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  imageUrl?: string;
  imageAlt?: string;
  src?: string;
  alt?: string;
  caption?: string;
  cite?: string;
  rows?: string[][];
  hasHeader?: boolean;
  heading?: string;
  body?: string;
  buttonLabel?: string;
  buttonHref?: string;
  placeholder?: string;
  url?: string;
  layout?: string;
  images?: GalleryImage[];
  entries?: BlockEntry[];
  /** Preserved Lexical rich text for lossless round-trip of legacy nodes. */
  richText?: unknown;
}

export interface EditorBlock {
  id: string;
  type: BlockType;
  /** Plain text body for `heading` and `quote` blocks (rendered as node.text). */
  text?: string;
  data: BlockData;
  /** Only `section` blocks nest children. */
  children?: EditorBlock[];
}

export interface BlockDef {
  type: BlockType;
  label: string;
  /** lucide-react icon name; resolved in the palette UI. */
  icon: string;
  description: string;
  /** Container blocks accept nested children. */
  container?: boolean;
}

export const BLOCK_DEFS: BlockDef[] = [
  { type: "hero", label: "Hero", icon: "LayoutTemplate", description: "Title, subtitle and banner image" },
  { type: "richText", label: "Rich text", icon: "Type", description: "Formatted paragraph content" },
  { type: "heading", label: "Heading", icon: "Heading", description: "Section heading (H1–H6)" },
  { type: "image", label: "Image", icon: "Image", description: "Single image with caption" },
  { type: "gallery", label: "Gallery", icon: "Images", description: "Grid of images" },
  { type: "quote", label: "Quote", icon: "Quote", description: "Pull quote with citation" },
  { type: "table", label: "Table", icon: "Table", description: "Rows and columns of cells" },
  { type: "accordion", label: "Accordion", icon: "ChevronsUpDown", description: "Collapsible title / body rows" },
  { type: "faq", label: "FAQ", icon: "HelpCircle", description: "Question and answer list" },
  { type: "cta", label: "Call to action", icon: "MousePointerClick", description: "Heading, body and button" },
  { type: "newsletter", label: "Newsletter", icon: "Mail", description: "Email signup prompt" },
  { type: "related", label: "Related articles", icon: "Link2", description: "Cards linking to other posts" },
  { type: "video", label: "Video", icon: "Video", description: "YouTube, Vimeo or file embed" },
  { type: "divider", label: "Divider", icon: "Minus", description: "Horizontal rule" },
  { type: "section", label: "Section", icon: "Rows", description: "Group blocks together", container: true },
];

export const BLOCK_LABELS: Record<BlockType, string> = BLOCK_DEFS.reduce(
  (acc, d) => {
    acc[d.type] = d.label;
    return acc;
  },
  {} as Record<BlockType, string>,
);

export function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `b-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/** A fresh block of `type` with sensible empty defaults. */
export function createBlock(type: BlockType): EditorBlock {
  const base: EditorBlock = { id: genId(), type, data: {} };
  switch (type) {
    case "heading":
      return { ...base, text: "", data: { level: 2 } };
    case "richText":
      return { ...base, data: { html: "" } };
    case "hero":
      return { ...base, data: { title: "", subtitle: "", eyebrow: "", imageUrl: "", imageAlt: "" } };
    case "image":
      return { ...base, data: { src: "", alt: "", caption: "" } };
    case "gallery":
      return { ...base, data: { images: [], layout: "grid" } };
    case "quote":
      return { ...base, text: "", data: { cite: "" } };
    case "table":
      return {
        ...base,
        data: {
          hasHeader: true,
          rows: [
            ["Column 1", "Column 2"],
            ["", ""],
          ],
        },
      };
    case "accordion":
      return { ...base, data: { entries: [{ title: "", body: "" }] } };
    case "faq":
      return { ...base, data: { heading: "", entries: [{ question: "", answer: "" }] } };
    case "cta":
      return { ...base, data: { heading: "", body: "", buttonLabel: "", buttonHref: "" } };
    case "newsletter":
      return { ...base, data: { heading: "", body: "", placeholder: "you@example.com", buttonLabel: "Subscribe" } };
    case "related":
      return { ...base, data: { heading: "Related articles", entries: [{ title: "", href: "" }] } };
    case "video":
      return { ...base, data: { url: "", caption: "" } };
    case "divider":
      return { ...base, data: {} };
    case "section":
      return { ...base, data: { heading: "" }, children: [] };
    default:
      return base;
  }
}

/* ------------------------------------------------------------------ */
/* blocks -> componentTree (array shape consumed by the renderer)      */
/* ------------------------------------------------------------------ */

function blockToNode(block: EditorBlock): CTNode {
  const d = block.data ?? {};
  switch (block.type) {
    case "heading":
      return { blockType: "heading", text: block.text ?? "", data: { level: d.level ?? 2 } };
    case "richText":
      return { blockType: "richText", data: { html: d.html ?? "" } };
    case "hero":
      return {
        blockType: "hero",
        data: {
          title: d.title ?? "",
          subtitle: d.subtitle ?? "",
          eyebrow: d.eyebrow ?? "",
          imageUrl: d.imageUrl ?? "",
          imageAlt: d.imageAlt ?? "",
        },
      };
    case "image":
      return { blockType: "image", data: { src: d.src ?? "", alt: d.alt ?? "", caption: d.caption ?? "" } };
    case "gallery":
      return { blockType: "gallery", data: { images: d.images ?? [], layout: d.layout ?? "grid" } };
    case "quote":
      return { blockType: "quote", text: block.text ?? "", data: { cite: d.cite ?? "" } };
    case "table":
      return { blockType: "table", data: { rows: d.rows ?? [], hasHeader: d.hasHeader ?? false } };
    case "accordion":
      return { blockType: "accordion", data: { entries: d.entries ?? [] } };
    case "faq":
      return { blockType: "faq", data: { heading: d.heading ?? "", entries: d.entries ?? [] } };
    case "cta":
      return {
        blockType: "cta",
        data: {
          heading: d.heading ?? "",
          body: d.body ?? "",
          buttonLabel: d.buttonLabel ?? "",
          buttonHref: d.buttonHref ?? "",
        },
      };
    case "newsletter":
      return {
        blockType: "newsletter",
        data: {
          heading: d.heading ?? "",
          body: d.body ?? "",
          placeholder: d.placeholder ?? "",
          buttonLabel: d.buttonLabel ?? "",
        },
      };
    case "related":
      return { blockType: "related", data: { heading: d.heading ?? "", entries: d.entries ?? [] } };
    case "video":
      return { blockType: "video", data: { url: d.url ?? "", caption: d.caption ?? "" } };
    case "divider":
      return { blockType: "divider" };
    case "section":
      return {
        blockType: "section",
        data: { heading: d.heading ?? "" },
        children: (block.children ?? []).map(blockToNode),
      };
    default:
      return { blockType: "richText", data: { html: d.html ?? "" } };
  }
}

export function blocksToComponentTree(blocks: EditorBlock[]): unknown[] {
  return blocks.map(blockToNode);
}

/* ------------------------------------------------------------------ */
/* componentTree -> blocks                                             */
/* ------------------------------------------------------------------ */

const KNOWN_TYPES = new Set<BlockType>(BLOCK_DEFS.map((d) => d.type));

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Minimal Lexical-node -> HTML serializer for editing legacy rich text. */
function lexToHtml(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as {
    type?: string;
    tag?: string;
    text?: string;
    format?: number;
    url?: string;
    listType?: string;
    children?: unknown[];
  };
  const kids = (n.children ?? []).map(lexToHtml).join("");
  switch (n.type) {
    case "text": {
      let t = escapeHtml(n.text ?? "");
      const f = n.format ?? 0;
      if (f & 1) t = `<strong>${t}</strong>`;
      if (f & 2) t = `<em>${t}</em>`;
      if (f & 8) t = `<u>${t}</u>`;
      if (f & 4) t = `<s>${t}</s>`;
      if (f & 16) t = `<code>${t}</code>`;
      return t;
    }
    case "linebreak":
      return "<br/>";
    case "link":
      return `<a href="${escapeHtml(n.url ?? "#")}">${kids}</a>`;
    case "heading":
      return `<${n.tag ?? "h2"}>${kids}</${n.tag ?? "h2"}>`;
    case "quote":
      return `<blockquote>${kids}</blockquote>`;
    case "list": {
      const tag = n.listType === "number" ? "ol" : "ul";
      return `<${tag}>${kids}</${tag}>`;
    }
    case "listitem":
      return `<li>${kids}</li>`;
    case "paragraph":
      return kids ? `<p>${kids}</p>` : "";
    case "root":
      return kids;
    default:
      return kids;
  }
}

function listItemsToHtml(items: string[], ordered: boolean): string {
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${items.map((it) => `<li>${escapeHtml(it)}</li>`).join("")}</${tag}>`;
}

function nodeToBlock(node: CTNode): EditorBlock {
  // `blockType` is the canonical discriminator; `?? node.type` is a defensive
  // fallback for any legacy stored tree that still carries the crawler `type`.
  const type = (node.blockType ?? node.type ?? "") as string;
  const d = node.data ?? {};

  // Native editor block types (the unified `blockType` vocabulary).
  if (KNOWN_TYPES.has(type as BlockType)) {
    const t = type as BlockType;
    switch (t) {
      case "heading":
        return { id: genId(), type: t, text: node.text ?? "", data: { level: d.level ?? 2 } };
      case "quote":
        return { id: genId(), type: t, text: node.text ?? "", data: { cite: d.cite ?? "" } };
      case "richText":
        return {
          id: genId(),
          type: t,
          data: { html: d.html ?? (d.richText ? lexToHtml(d.richText) : node.text ? `<p>${escapeHtml(node.text)}</p>` : "") },
        };
      case "section":
        return {
          id: genId(),
          type: t,
          data: { heading: d.heading ?? d.title ?? "" },
          children: (node.children ?? []).map(nodeToBlock),
        };
      default:
        return { id: genId(), type: t, data: { ...(d as BlockData) } };
    }
  }

  // importer root shape (`blockType`) ------------------------------
  switch (node.blockType) {
    case "heading":
      return { id: genId(), type: "heading", text: node.text ?? "", data: { level: d.level ?? 2 } };
    case "paragraph":
      return { id: genId(), type: "richText", data: { html: node.text ? `<p>${escapeHtml(node.text)}</p>` : "" } };
    case "list":
      return {
        id: genId(),
        type: "richText",
        data: { html: listItemsToHtml(d.items ?? [], Boolean(d.ordered)) },
      };
    case "section":
      return {
        id: genId(),
        type: "section",
        data: { heading: d.heading ?? "" },
        children: (node.children ?? []).map(nodeToBlock),
      };
    case "quote":
      return { id: genId(), type: "quote", text: node.text ?? "", data: { cite: d.cite ?? "" } };
  }

  // Lexical-bearing or unknown node: keep it editable as rich text.
  if (d.richText) {
    return { id: genId(), type: "richText", data: { html: lexToHtml(d.richText) } };
  }
  return { id: genId(), type: "richText", data: { html: node.text ? `<p>${escapeHtml(node.text)}</p>` : "" } };
}

/**
 * Build the editor block list for an article.
 *
 * - Editor-authored articles (saved with `contentHtml: null`) load from
 *   `componentTree`.
 * - Legacy articles that still carry `contentHtml` load as a single rich-text
 *   block so the body is fully editable without a lossy Lexical round-trip.
 */
export function blocksFromDetail(detail: CmsPostDetail): EditorBlock[] {
  const tree = asComponentTree(detail.componentTree);
  const hasHtml = typeof detail.contentHtml === "string" && detail.contentHtml.trim().length > 0;

  if (!hasHtml && tree && tree.length > 0) {
    return tree.map(nodeToBlock);
  }
  if (hasHtml) {
    return [{ id: genId(), type: "richText", data: { html: detail.contentHtml as string } }];
  }
  if (tree && tree.length > 0) {
    return tree.map(nodeToBlock);
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* detail -> input (preserve nested collections on save)              */
/* ------------------------------------------------------------------ */

/** The SEO metadata block of a save payload. */
export type SeoMetaInput = NonNullable<CmsPostInput["seo"]>;

/** Editable post metadata surfaced by the editor's header fields. */
export interface PostMetaPatch {
  title: string;
  subtitle?: string | null;
  excerpt?: string | null;
  /**
   * The article's banner/hero image. When a key is omitted the loaded detail's
   * value is preserved; an explicit `null` clears the banner (no hero image).
   */
  featuredImageUrl?: string | null;
  featuredImageAlt?: string | null;
  /**
   * Page-level canonical URL override. Omitted → preserve the loaded detail's
   * value; explicit `null` clears it.
   */
  canonicalUrl?: string | null;
  /**
   * Full SEO meta block edited in the SEO panel. Omitted → round-trip the
   * loaded detail's `seo` unchanged; provided → replaces it wholesale.
   */
  seo?: SeoMetaInput | null;
}

/**
 * Build the full `CmsPostInput` for a save.
 *
 * PUT rewrites every nested collection wholesale, so we round-trip the loaded
 * detail's categories, tags, author, SEO, FAQ, images, galleries, links, etc.
 * back into the payload — only the block content (`componentTree`) and the
 * edited header metadata change. `contentHtml` is forced to `null` so both the
 * public blog and the live preview render from `componentTree`.
 */
export function detailToInput(
  detail: CmsPostDetail,
  blocks: EditorBlock[],
  meta: PostMetaPatch,
): CmsPostInput {
  // The block editor owns the body, so it rebuilds `componentTree` from its
  // blocks and nulls the legacy `contentHtml`/`richText` so both the public blog
  // and live preview render from `componentTree`. Everything else (nested
  // collections + the banner contract) is round-tripped by the shared lib.
  return buildCmsPostInput(detail, {
    meta,
    componentTree: blocksToComponentTree(blocks),
    contentHtml: null,
    richText: null,
  });
}

/* ------------------------------------------------------------------ */
/* live SEO validation input (client side)                            */
/* ------------------------------------------------------------------ */

function collectBlockHeadings(blocks: EditorBlock[], out: HeadingNode[]): void {
  for (const b of blocks) {
    if (b.type === "heading") {
      out.push({ level: b.data.level ?? 2, text: b.text ?? "" });
    }
    if (b.children) collectBlockHeadings(b.children, out);
  }
}

function countBlocks(blocks: EditorBlock[]): number {
  let n = 0;
  for (const b of blocks) {
    n += 1;
    if (b.children) n += countBlocks(b.children);
  }
  return n;
}

/** The live editor state the SEO panel validates against. */
export interface EditorSeoState {
  title: string;
  excerpt: string | null;
  featuredImageUrl: string | null;
  canonicalUrl: string | null;
  seo: SeoMetaInput | null;
}

/**
 * Build the pure engine's `SeoValidationInput` from the editor's LIVE state, so
 * the SEO panel can show instant field-level feedback as the editor types —
 * without a server round-trip. The non-edited collections (images, links,
 * jsonld, breadcrumbs) come from the loaded detail; the title/excerpt/banner/SEO
 * fields and the heading/block structure come from the live editor. This mirrors
 * the server's `buildValidationInput`, so client and server agree on the input
 * shape; the server folds in DB-derived duplicate refs the client can't compute.
 */
export function buildEditorValidationInput(
  detail: CmsPostDetail,
  blocks: EditorBlock[],
  state: EditorSeoState,
): SeoValidationInput {
  const headings: HeadingNode[] = [];
  collectBlockHeadings(blocks, headings);
  const componentCount = countBlocks(blocks);
  const images = [
    ...detail.images.map((i) => ({ alt: i.alt ?? null })),
    ...detail.galleries.flatMap((g) => g.images.map((i) => ({ alt: i.alt ?? null }))),
  ];
  return {
    pageType: detail.pageType,
    title: state.title,
    slug: detail.slug,
    pathname: detail.pathname ?? null,
    canonicalUrl: state.canonicalUrl,
    excerpt: state.excerpt,
    featuredImageUrl: state.featuredImageUrl,
    seo: state.seo
      ? {
          metaTitle: state.seo.metaTitle ?? null,
          metaDescription: state.seo.metaDescription ?? null,
          canonicalUrl: state.seo.canonicalUrl ?? null,
          robots: state.seo.robots ?? null,
          ogTitle: state.seo.ogTitle ?? null,
          ogDescription: state.seo.ogDescription ?? null,
          ogImage: state.seo.ogImage ?? null,
          ogType: state.seo.ogType ?? null,
          twitterCard: state.seo.twitterCard ?? null,
          twitterTitle: state.seo.twitterTitle ?? null,
          twitterDescription: state.seo.twitterDescription ?? null,
          twitterImage: state.seo.twitterImage ?? null,
        }
      : null,
    jsonldCount: detail.jsonld.length,
    breadcrumbCount: detail.breadcrumbs.length,
    headings,
    images,
    internalLinkCount: detail.internalLinks.length,
    externalLinks: detail.externalLinks.map((l) => ({ rel: l.rel ?? null })),
    componentCount,
    hasBody: componentCount > 0,
  };
}

/** A blank SEO meta block initialized from a loaded detail. */
export function initialSeoState(detail: CmsPostDetail): SeoMetaInput {
  const s = detail.seo;
  return {
    metaTitle: s?.metaTitle ?? null,
    metaDescription: s?.metaDescription ?? null,
    canonicalUrl: s?.canonicalUrl ?? null,
    robots: s?.robots ?? null,
    focusKeyword: s?.focusKeyword ?? null,
    keywords: s?.keywords ?? null,
    ogTitle: s?.ogTitle ?? null,
    ogDescription: s?.ogDescription ?? null,
    ogImage: s?.ogImage ?? null,
    ogType: s?.ogType ?? null,
    twitterCard: s?.twitterCard ?? null,
    twitterTitle: s?.twitterTitle ?? null,
    twitterDescription: s?.twitterDescription ?? null,
    twitterImage: s?.twitterImage ?? null,
    needsReview: s?.needsReview ?? false,
  };
}
