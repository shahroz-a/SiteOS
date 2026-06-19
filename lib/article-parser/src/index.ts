/**
 * Article-body parsing — the single source of truth for turning a WordPress
 * article's content HTML into the intermediate block tree, the Payload-style
 * componentTree, the derived richText, and the element tallies used by the
 * content-fidelity validator. It is shared by BOTH:
 *
 *  - the offline migration importer (`scripts/src/import/parse.ts`), which feeds
 *    it the selected, cleaned content subtree, and
 *  - the CMS read/write API (the held-back review "re-parse / hand-edit"
 *    action), which feeds it the stored source HTML directly.
 *
 * Keeping the walker (`buildBlocks`), the cleanup (`stripNonContent`), and the
 * URL absolutiser in ONE place means the importer and the in-app re-parse can
 * never drift on how an article body becomes a component tree.
 *
 * cheerio is a Node-only dep, so this lib must only ever be imported from
 * server/script code — never from a browser bundle.
 */
import * as cheerio from "cheerio";
import type { CheerioAPI, Cheerio } from "cheerio";
import type { Element } from "domhandler";
import {
  buildComponentTree,
  buildRichText,
  type BlockNode,
} from "@workspace/content";

export type { BlockNode } from "@workspace/content";

/** Raw element tallies the content-fidelity validator compares. */
export interface ArticleCounts {
  headings: number;
  paragraphs: number;
  images: number;
  links: number;
  tables: number;
  lists: number;
  /** Total nodes in the parsed component tree (only set on parsed counts). */
  components?: number;
}

export interface ParsedArticleBody {
  /** Intermediate block tree (anchors allocated, nested under sections). */
  blocks: BlockNode[];
  /** Payload-compatible nested component tree (renderer input). */
  componentTree: unknown;
  /** Derived Lexical/Payload richText document. */
  richText: unknown;
  /** Whitespace-collapsed HTML of the cleaned content subtree. */
  cleanedHtml: string;
  /** Element tallies of the SOURCE content (what was available to extract). */
  sourceCounts: ArticleCounts;
  /** Element tallies of the PARSED tree (what was actually extracted). */
  parsedCounts: ArticleCounts;
}

/** Stable slug from arbitrary text. Kept in lockstep with the importer util. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Collapse runs of whitespace to single spaces and trim. */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Stateful allocator for unique anchor ids within a single page. Source HTML
 * frequently repeats the same element `id`, so anchors are derived from heading
 * text and disambiguated with a numeric suffix on collision (`base`, `base-2`).
 * Create one per page and call it for each heading in document order.
 */
export function createAnchorAllocator(): (preferred?: string | null) => string {
  const used = new Set<string>();
  return (preferred?: string | null): string => {
    const base = (preferred ?? "").trim() || "section";
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    let i = 2;
    while (used.has(`${base}-${i}`)) i += 1;
    const id = `${base}-${i}`;
    used.add(id);
    return id;
  };
}

/** Remove non-content cruft from a cloned content subtree. */
export function stripNonContent(
  _$: CheerioAPI,
  container: Cheerio<Element>,
): void {
  container
    .find(
      "script, style, noscript, ins, iframe, .saswp-schema-markup-output, .sharedaddy, .jp-relatedposts, .code-block, .adsbygoogle, .post-tags, .post-share, [class*='advert'], [class*='newsletter']",
    )
    .remove();
}

/** Resolve a possibly-relative URL against a base; null on failure. */
export function absolutize(
  src: string | undefined,
  base: string,
): string | null {
  if (!src) return null;
  try {
    return new URL(src, base).toString();
  } catch {
    return null;
  }
}

/**
 * Walk the cleaned content's top-level children into an ordered, nested block
 * tree. Headings (h1-h3) open a section; following paragraphs/lists/images/
 * quotes nest inside it. Content before the first heading sits at the root.
 */
export function buildBlocks(
  $: CheerioAPI,
  content: Cheerio<Element>,
  base: string,
): BlockNode[] {
  const roots: BlockNode[] = [];
  let current: BlockNode | null = null;
  const allocAnchor = createAnchorAllocator();

  const push = (node: BlockNode) => {
    if (current) (current.children ??= []).push(node);
    else roots.push(node);
  };

  const handle = (el: Element) => {
    const tag = el.tagName?.toLowerCase();
    const $el = $(el);
    if (!tag) return;
    if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4") {
      const text = normalizeWhitespace($el.text());
      if (!text) return;
      const level = Number(tag.slice(1));
      if (level <= 3) {
        current = {
          blockType: "section",
          anchorId: allocAnchor(slugify(text)),
          data: { heading: text, level },
          children: [],
        };
        roots.push(current);
      } else {
        push({
          blockType: "heading",
          text,
          anchorId: allocAnchor(slugify(text)),
          data: { level },
        });
      }
      return;
    }
    if (tag === "p") {
      const text = normalizeWhitespace($el.text());
      if (text) push({ blockType: "paragraph", text });
      return;
    }
    if (tag === "ul" || tag === "ol") {
      const items: string[] = [];
      $el.children("li").each((_, li) => {
        const t = normalizeWhitespace($(li).text());
        if (t) items.push(t);
      });
      if (items.length)
        push({ blockType: "list", data: { ordered: tag === "ol", items } });
      return;
    }
    if (tag === "blockquote") {
      const text = normalizeWhitespace($el.text());
      if (text) push({ blockType: "quote", text });
      return;
    }
    if (tag === "figure" || tag === "img") {
      const $img = tag === "img" ? $el : $el.find("img").first();
      const src = absolutize($img.attr("data-src") ?? $img.attr("src"), base);
      if (src)
        push({
          blockType: "image",
          data: {
            url: src,
            alt: $img.attr("alt") ?? null,
            caption: normalizeWhitespace($el.find("figcaption").text()) || null,
          },
        });
      return;
    }
    if (tag === "div" || tag === "section") {
      // Recurse into wrapper divs so nested content is not lost.
      $el.children().each((_, child) => handle(child as Element));
    }
  };

  content.children().each((_, el) => handle(el as Element));
  return roots;
}

/** Count raw source elements within a cleaned content subtree. */
function countSource(content: Cheerio<Element>): ArticleCounts {
  return {
    headings: content.find("h1,h2,h3,h4,h5,h6").length,
    paragraphs: content.find("p").length,
    images: content.find("img").length,
    links: content.find("a[href]").length,
    tables: content.find("table").length,
    lists: content.find("ul,ol").length,
  };
}

/** Count what the walker actually extracted into the block tree. */
function countParsed(blocks: BlockNode[]): ArticleCounts {
  const acc: ArticleCounts = {
    headings: 0,
    paragraphs: 0,
    images: 0,
    links: 0,
    tables: 0,
    lists: 0,
    components: 0,
  };
  const walk = (nodes: BlockNode[]): void => {
    for (const node of nodes) {
      acc.components = (acc.components ?? 0) + 1;
      switch (node.blockType) {
        case "section":
        case "heading":
          acc.headings += 1;
          break;
        case "paragraph":
        case "quote":
          acc.paragraphs += 1;
          break;
        case "list":
          acc.lists += 1;
          break;
        case "image":
          acc.images += 1;
          break;
        case "table":
          acc.tables += 1;
          break;
      }
      if (node.children?.length) walk(node.children);
    }
  };
  walk(blocks);
  return acc;
}

/**
 * Select the article content root from a loaded document, most-specific first.
 * Falls back to the whole document body so a bare cleaned-content fragment
 * (which has no `.entry-content` wrapper) is still parsed.
 */
function selectContentRoot($: CheerioAPI): Cheerio<Element> {
  const candidates = [".post-content.entry-content", ".entry-content", "article"];
  for (const sel of candidates) {
    const found = $(sel).first();
    if (found.length) return found as Cheerio<Element>;
  }
  const body = $("body").first();
  if (body.length) return body as Cheerio<Element>;
  return $.root() as unknown as Cheerio<Element>;
}

/**
 * Parse an article body HTML string into the block tree, component tree,
 * richText, cleaned HTML, and source/parsed element tallies. Accepts either a
 * full page's HTML (it selects the content root) or an already-cleaned content
 * fragment (it uses the whole body). Side-effect free.
 */
export function parseArticleBody(
  html: string,
  opts: { baseUrl: string; title?: string | null },
): ParsedArticleBody {
  const $ = cheerio.load(html);
  const content = selectContentRoot($).clone();
  stripNonContent($, content);

  const cleanedHtml = (content.html() ?? "")
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .trim();

  const sourceCounts = countSource(content);
  const blocks = buildBlocks($, content, opts.baseUrl);
  const parsedCounts = countParsed(blocks);
  const componentTree = buildComponentTree(blocks);
  const richText = buildRichText(blocks, opts.title ?? "");

  return {
    blocks,
    componentTree,
    richText,
    cleanedHtml,
    sourceCounts,
    parsedCounts,
  };
}
