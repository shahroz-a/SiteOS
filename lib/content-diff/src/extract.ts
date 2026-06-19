/**
 * DOM-free content extraction for the importer fidelity diff.
 *
 * The web SourceDiff extracts block text + image/link URLs from the *rendered*
 * DOM (querySelectorAll on ContentRenderer output), which only works in a
 * browser. To mirror the same diff on React Native — which has no DOM — these
 * pure helpers extract the equivalent block text and asset URLs directly from
 * the raw source HTML string and the parsed componentTree/richText JSON, so
 * both surfaces feed the identical block/URL diff math in `diff.ts`.
 */

export interface ExtractedImage {
  url: string;
  alt: string;
}

export interface ExtractedLink {
  url: string;
  text: string;
}

export interface ExtractedContent {
  /** Block-level text segments, in document order. */
  blocks: string[];
  images: ExtractedImage[];
  links: ExtractedLink[];
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
};

/** Decode the handful of HTML entities that survive into article text. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? m;
  });
}

/** Strip all tags and collapse whitespace from an HTML fragment. */
function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    // Inline tags are replaced with a space, which can leave a stray space
    // before punctuation (e.g. "link ." from "<a>link</a>."). Drop it so the
    // text matches the parsed side and doesn't read as a spurious change.
    .replace(/\s+([.,;:!?)\]}])/g, "$1")
    .trim();
}

// Block-level tags whose boundaries split the running text into separate
// blocks, so a nested list/heading reads as its own paragraph (mirrors the web
// diff's "leaf block" segmentation closely enough for the LCS alignment).
const BLOCK_BOUNDARY =
  /<\/?(?:p|div|section|article|header|footer|aside|figure|figcaption|ul|ol|li|table|thead|tbody|tr|th|td|dl|dt|dd|h[1-6]|blockquote|pre|summary|details|br)\b[^>]*>/gi;

export function extractHtmlContent(
  html: string | null | undefined,
): ExtractedContent {
  if (!html) return { blocks: [], images: [], links: [] };

  // Drop non-content elements entirely before extracting.
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  const images: ExtractedImage[] = [];
  for (const m of cleaned.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
    if (!src) continue;
    const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
    images.push({ url: src.trim(), alt: decodeEntities(alt).trim() });
  }

  const links: ExtractedLink[] = [];
  for (const m of cleaned.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1] ?? "";
    if (!href) continue;
    links.push({ url: href.trim(), text: stripTags(m[1]) });
  }

  // Split on block boundaries, then strip remaining inline tags per segment.
  const blocks = cleaned
    .replace(BLOCK_BOUNDARY, "\u0001")
    .split("\u0001")
    .map(stripTags)
    .filter((b) => b.length > 0);

  return { blocks, images, links };
}

type AnyNode = Record<string, unknown>;

function isObj(v: unknown): v is AnyNode {
  return typeof v === "object" && v !== null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function nodeType(node: AnyNode): string {
  const t = node.type ?? node.blockType;
  return typeof t === "string" ? t.toLowerCase() : "";
}

/**
 * Every child-bearing array a node may carry. Block children live under
 * `children`; the crawler nests Lexical roots under `data.richText` and some
 * blocks keep their own `data.children`.
 */
function childNodes(node: AnyNode): AnyNode[] {
  const out: AnyNode[] = [];
  const push = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const c of v) if (isObj(c)) out.push(c);
    } else if (isObj(v)) {
      out.push(v);
    }
  };
  push(node.children);
  const data = node.data;
  if (isObj(data)) {
    push(data.children);
    push(data.richText);
  }
  return out;
}

/** Concatenate every text/heading string under a node into one block string. */
function collectText(node: AnyNode): string {
  const parts: string[] = [];
  const walk = (n: AnyNode) => {
    if (typeof n.text === "string") parts.push(n.text);
    const data = isObj(n.data) ? n.data : null;
    if (data && typeof data.heading === "string") parts.push(data.heading);
    for (const c of childNodes(n)) walk(c);
  };
  walk(node);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// Node types that produce one block each. A `richText` wrapper is intentionally
// NOT a block — we descend into it so its inner paragraphs become the blocks.
const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "quote",
  "blockquote",
  "listitem",
  "li",
  "text",
]);

function isBlockNode(n: AnyNode): boolean {
  if (BLOCK_TYPES.has(nodeType(n))) return true;
  if (typeof n.text === "string" && n.text.trim().length > 0) return true;
  const data = isObj(n.data) ? n.data : null;
  if (data && typeof data.heading === "string" && data.heading.trim().length) {
    return true;
  }
  return false;
}

/**
 * Extract block text + image/link URLs from a parsed componentTree (crawler
 * array or importer root object) or a Lexical richText tree. Block segmentation
 * stops at the first block-producing ancestor so an inline-link paragraph stays
 * one block; image/link URLs are collected from a separate full walk.
 */
export function extractTreeContent(tree: unknown): ExtractedContent {
  const roots: AnyNode[] = Array.isArray(tree)
    ? tree.filter(isObj)
    : isObj(tree)
      ? [tree]
      : [];

  const blocks: string[] = [];
  const visitBlocks = (n: AnyNode) => {
    if (isBlockNode(n)) {
      const text = collectText(n);
      if (text) blocks.push(text);
      return;
    }
    for (const c of childNodes(n)) visitBlocks(c);
  };

  const images: ExtractedImage[] = [];
  const links: ExtractedLink[] = [];
  const visitAssets = (n: AnyNode) => {
    const t = nodeType(n);
    const data = isObj(n.data) ? n.data : {};
    if (t === "image" || t === "media") {
      const url = str(data.src) || str(data.url) || str(n.url) || str(n.src);
      if (url) images.push({ url, alt: str(data.alt) });
    }
    if (t === "link") {
      const url = str(n.url) || str(data.url);
      if (url) links.push({ url, text: collectText(n) });
    }
    for (const c of childNodes(n)) visitAssets(c);
  };

  for (const r of roots) {
    visitBlocks(r);
    visitAssets(r);
  }

  return { blocks, images, links };
}
