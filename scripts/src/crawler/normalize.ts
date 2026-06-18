import type { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type { ComponentNode, RichTextNode } from "./types";
import { normalizeWhitespace } from "./util";

/** Inline tags mapped to rich-text format marks. */
const INLINE_FORMAT: Record<string, string> = {
  strong: "bold",
  b: "bold",
  em: "italic",
  i: "italic",
  u: "underline",
  sup: "superscript",
  sub: "subscript",
  code: "code",
  mark: "highlight",
  s: "strikethrough",
  del: "strikethrough",
};

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function tagName(el: AnyNode): string | null {
  return el.type === "tag" ? (el as Element).tagName.toLowerCase() : null;
}

/**
 * Convert an inline DOM subtree into rich-text nodes, accumulating active
 * format marks (bold/italic/links/etc.) so formatting is never flattened.
 */
function inlineToRichText(
  $: CheerioAPI,
  nodes: AnyNode[],
  marks: string[],
): RichTextNode[] {
  const out: RichTextNode[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      const text = node.data ?? "";
      if (text.trim() === "" && !/\s/.test(text)) continue;
      if (text.length === 0) continue;
      out.push({ type: "text", text, ...(marks.length ? { format: [...marks] } : {}) });
      continue;
    }
    const tag = tagName(node);
    if (!tag) continue;
    const $node = $(node as Element);

    if (tag === "br") {
      out.push({ type: "linebreak" });
      continue;
    }
    if (tag === "a") {
      const href = $node.attr("href") ?? "";
      out.push({
        type: "link",
        url: href,
        children: inlineToRichText($, $node.contents().toArray(), marks),
      });
      continue;
    }
    if (tag === "img") {
      out.push({
        type: "inlineImage",
        url: $node.attr("src") ?? $node.attr("data-src") ?? "",
        alt: $node.attr("alt") ?? "",
      });
      continue;
    }
    const mark = INLINE_FORMAT[tag];
    const nextMarks = mark ? [...marks, mark] : marks;
    out.push(...inlineToRichText($, $node.contents().toArray(), nextMarks));
  }
  return out;
}

function richHeading($: CheerioAPI, el: Element): RichTextNode {
  return {
    type: "heading",
    tag: el.tagName.toLowerCase(),
    children: inlineToRichText($, $(el).contents().toArray(), []),
  };
}

function richParagraph($: CheerioAPI, el: Element): RichTextNode {
  return { type: "paragraph", children: inlineToRichText($, $(el).contents().toArray(), []) };
}

function richList($: CheerioAPI, el: Element): RichTextNode {
  const tag = el.tagName.toLowerCase();
  const items: RichTextNode[] = [];
  $(el)
    .children("li")
    .each((_, li) => {
      const $li = $(li);
      // Split nested lists from inline content to preserve nesting.
      const nested = $li.children("ul, ol").toArray();
      const inlineNodes = $li
        .contents()
        .toArray()
        .filter((n) => !(n.type === "tag" && /^(ul|ol)$/i.test((n as Element).tagName)));
      const children: RichTextNode[] = inlineToRichText($, inlineNodes, []);
      for (const n of nested) children.push(richList($, n as Element));
      items.push({ type: "listitem", children });
    });
  return { type: "list", tag: tag === "ol" ? "ol" : "ul", children: items };
}

function richTable($: CheerioAPI, el: Element): RichTextNode {
  const rows: RichTextNode[] = [];
  $(el)
    .find("tr")
    .each((_, tr) => {
      const cells: RichTextNode[] = [];
      $(tr)
        .find("th, td")
        .each((__, cell) => {
          cells.push({
            type: (cell as Element).tagName.toLowerCase() === "th" ? "tableheader" : "tablecell",
            children: inlineToRichText($, $(cell).contents().toArray(), []),
          });
        });
      rows.push({ type: "tablerow", children: cells });
    });
  return { type: "table", children: rows };
}

function richQuote($: CheerioAPI, el: Element): RichTextNode {
  return { type: "quote", children: inlineToRichText($, $(el).contents().toArray(), []) };
}

/**
 * Build the structured rich-text document (Lexical/Slate-style root) from the
 * page's content root, walking block-level elements in document order.
 */
export function buildRichText($: CheerioAPI, root: Cheerio<Element>): RichTextNode {
  const children: RichTextNode[] = [];
  walkBlocks($, root.toArray()[0], children);
  return { type: "root", children };
}

function walkBlocks($: CheerioAPI, parent: AnyNode | undefined, out: RichTextNode[]): void {
  if (!parent || parent.type !== "tag") return;
  for (const node of (parent as Element).children) {
    const tag = tagName(node);
    if (!tag) continue;
    const el = node as Element;
    if (HEADING_TAGS.has(tag)) out.push(richHeading($, el));
    else if (tag === "p") {
      const rt = richParagraph($, el);
      if ((rt.children?.length ?? 0) > 0) out.push(rt);
    } else if (tag === "ul" || tag === "ol") out.push(richList($, el));
    else if (tag === "table") out.push(richTable($, el));
    else if (tag === "blockquote") out.push(richQuote($, el));
    else if (tag === "figure" || tag === "img") {
      const $img = tag === "img" ? $(el) : $(el).find("img").first();
      if ($img.length)
        out.push({
          type: "image",
          url: $img.attr("src") ?? $img.attr("data-src") ?? "",
          alt: $img.attr("alt") ?? "",
        });
    } else if (
      tag === "div" ||
      tag === "section" ||
      tag === "article" ||
      tag === "main"
    ) {
      // Recurse into structural containers to reach their block content.
      walkBlocks($, el, out);
    }
  }
}

// ---------------------------------------------------------------------------
// Component / block tree (Payload-compatible)
// ---------------------------------------------------------------------------

function classifyComponent(
  $: CheerioAPI,
  el: Element,
): ComponentNode | null {
  const tag = el.tagName.toLowerCase();
  const $el = $(el);
  const anchorId = $el.attr("id") || undefined;
  const text = normalizeWhitespace($el.text());

  if (HEADING_TAGS.has(tag)) {
    return { type: "heading", anchorId, text, data: { level: Number(tag[1]) } };
  }
  if (tag === "p") {
    if (!text) return null;
    return {
      type: "richText",
      anchorId,
      text,
      data: { richText: { type: "paragraph", children: inlineToRichText($, $el.contents().toArray(), []) } },
    };
  }
  if (tag === "ul" || tag === "ol") {
    return {
      type: "list",
      anchorId,
      data: { ordered: tag === "ol", richText: richList($, el) },
    };
  }
  if (tag === "table") {
    return { type: "table", anchorId, data: { richText: richTable($, el) } };
  }
  if (tag === "blockquote") {
    return { type: "quote", anchorId, text, data: { richText: richQuote($, el) } };
  }
  if (tag === "figure") {
    const $img = $el.find("img").first();
    if ($img.length)
      return {
        type: "image",
        anchorId,
        data: {
          src: $img.attr("src") ?? $img.attr("data-src") ?? "",
          alt: $img.attr("alt") ?? "",
          caption: $el.find("figcaption").first().text().trim() || null,
        },
      };
    const $iframe = $el.find("iframe").first();
    if ($iframe.length)
      return {
        type: "embed",
        anchorId,
        data: { src: $iframe.attr("src") ?? "", title: $iframe.attr("title") ?? null },
      };
  }
  if (tag === "img") {
    return {
      type: "image",
      anchorId,
      data: { src: $el.attr("src") ?? $el.attr("data-src") ?? "", alt: $el.attr("alt") ?? "" },
    };
  }
  if (tag === "iframe") {
    return { type: "embed", anchorId, data: { src: $el.attr("src") ?? "" } };
  }
  if (tag === "details") {
    return {
      type: "accordion",
      anchorId,
      data: {
        title: $el.find("summary").first().text().trim(),
        content: normalizeWhitespace($el.clone().children("summary").remove().end().text()),
      },
    };
  }
  if (tag === "blockquote") {
    return { type: "quote", anchorId, text };
  }

  // Structural containers: detect higher-order patterns or descend.
  if (tag === "div" || tag === "section" || tag === "article" || tag === "main") {
    const cls = ($el.attr("class") ?? "").toLowerCase();
    if (/newsletter|subscribe/.test(cls) && text)
      return { type: "newsletter", anchorId, text };
    if (/\bcta\b|call-to-action/.test(cls) && text) return { type: "cta", anchorId, text };
    if (/banner|promo/.test(cls) && text) return { type: "banner", anchorId, text };
    if (/gallery/.test(cls)) {
      const imgs = $el
        .find("img")
        .toArray()
        .map((img) => ({
          src: $(img).attr("src") ?? $(img).attr("data-src") ?? "",
          alt: $(img).attr("alt") ?? "",
        }));
      if (imgs.length > 1) return { type: "gallery", anchorId, data: { images: imgs } };
    }
    if (/faq/.test(cls)) {
      return { type: "faqSection", anchorId, children: buildComponentChildren($, el) };
    }
    if (/related|read-more|more-stories/.test(cls)) {
      const links = $el
        .find("a[href]")
        .toArray()
        .map((a) => ({ href: $(a).attr("href") ?? "", text: $(a).text().trim() }))
        .filter((l) => l.text);
      if (links.length) return { type: "relatedArticles", anchorId, data: { links } };
    }
    // Generic container: descend so its children are captured in order.
    const children = buildComponentChildren($, el);
    if (children.length === 1) return children[0]!;
    if (children.length > 1) return { type: "section", anchorId, children };
    return null;
  }
  return null;
}

function buildComponentChildren($: CheerioAPI, parent: Element): ComponentNode[] {
  const out: ComponentNode[] = [];
  for (const node of parent.children) {
    if (node.type !== "tag") continue;
    const comp = classifyComponent($, node as Element);
    if (comp) out.push(comp);
  }
  return out;
}

/**
 * Build the ordered, nested component tree for a page from its content root.
 * Mirrors Payload block architecture: each node is a block with optional
 * children, preserving document order and nesting depth.
 */
export function buildComponentTree($: CheerioAPI, root: Cheerio<Element>): ComponentNode[] {
  const el = root.toArray()[0];
  if (!el || el.type !== "tag") return [];
  return buildComponentChildren($, el as Element);
}

/** Count component nodes recursively (used for validation). */
export function countComponents(nodes: ComponentNode[]): number {
  let n = 0;
  for (const node of nodes) {
    n += 1;
    if (node.children) n += countComponents(node.children);
  }
  return n;
}
