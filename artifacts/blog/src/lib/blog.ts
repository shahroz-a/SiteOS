import { format } from "date-fns";

/** Internal route helpers (relative to the wouter base `/blog`). */
export function postPath(slug: string): string {
  return `/${slug}/`;
}

export function categoryPath(slug: string): string {
  return `/category/${slug}`;
}

export function authorPath(slug: string): string {
  return `/author/${slug}`;
}

export function searchPath(q: string): string {
  return `/search?q=${encodeURIComponent(q)}`;
}

export function formatDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return format(d, "MMMM d, yyyy");
}

export function readingTimeLabel(minutes?: number | null): string | null {
  if (!minutes) return null;
  return `${minutes} min read`;
}

/* ------------------------------------------------------------------ */
/* Content tree (Payload-style componentTree) types                    */
/* ------------------------------------------------------------------ */

export interface CTListData {
  title?: string;
  ordered?: boolean;
  items: string[];
}

export type CTNode =
  | { blockType: "heading"; text: string; anchorId?: string }
  | { blockType: "paragraph"; text: string }
  | { blockType: "list"; data: CTListData }
  | {
      blockType: "section";
      data: { heading: string };
      anchorId?: string;
      children: CTNode[];
    };

export interface CTRoot {
  type: "root";
  children: CTNode[];
  schemaVersion?: string;
}

export function asComponentTree(value: unknown): CTRoot | null {
  if (
    value &&
    typeof value === "object" &&
    "children" in value &&
    Array.isArray((value as CTRoot).children)
  ) {
    return value as CTRoot;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Lexical richText types                                              */
/* ------------------------------------------------------------------ */

export interface LexNode {
  type: string;
  tag?: string;
  text?: string;
  format?: number;
  listType?: string;
  url?: string;
  fields?: { url?: string; newTab?: boolean };
  children?: LexNode[];
}

export interface LexRoot {
  root: LexNode;
}

export function asRichText(value: unknown): LexRoot | null {
  if (
    value &&
    typeof value === "object" &&
    "root" in value &&
    (value as LexRoot).root &&
    Array.isArray((value as LexRoot).root.children)
  ) {
    return value as LexRoot;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Raw HTML sanitization (for dangerouslySetInnerHTML)                  */
/* ------------------------------------------------------------------ */

/**
 * Strip inline event-handler attributes (`onload`, `onerror`, `onclick`, …)
 * from migrated HTML before it is injected via `dangerouslySetInnerHTML`.
 *
 * The source WordPress markup was served through Google's mod_pagespeed, which
 * rewrites `<img>` tags with handlers like
 * `onload="pagespeed.CriticalImages.checkImageForCriticality(this)"`. Once that
 * markup is parsed into the live DOM the handler fires against a `pagespeed`
 * global that doesn't exist here and throws `ReferenceError: pagespeed is not
 * defined` on every image. Inline handlers are also an XSS vector, so dropping
 * every `on*` attribute hardens rendering as a side benefit.
 *
 * NOTE: this strips inline event-handler attributes only — it is intentionally
 * not a full HTML sanitizer (it does not touch `javascript:` URLs, iframes,
 * `srcdoc`, etc.). If the source HTML ever becomes genuinely untrusted, swap in
 * a vetted allowlist sanitizer (e.g. DOMPurify) at the ingest/API boundary.
 */
export function sanitizeContentHtml(html: string): string {
  if (!html) return html;
  if (typeof DOMParser === "undefined") {
    // Non-browser fallback (SSR/tests): textual strip of `on*="..."` handlers.
    return html.replace(
      /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
      "",
    );
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith("on")) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return doc.body.innerHTML;
}

export interface TocItem {
  id: string;
  label: string;
}

/**
 * Extract anchor sections from a componentTree for the table of contents.
 *
 * Crawled articles can repeat the same `anchorId` across several sections
 * (e.g. a recurring `3a`). A duplicate id can only ever resolve to the first
 * matching element, so later entries are dead anchors. We keep the first
 * occurrence of each id and drop the rest — this also guarantees every TocItem
 * id is unique, which the table of contents relies on for stable React keys.
 */
export function tocFromComponentTree(tree: CTRoot | null): TocItem[] {
  if (!tree) return [];
  const items: TocItem[] = [];
  const seen = new Set<string>();
  for (const node of tree.children) {
    if (node.blockType === "section" && node.anchorId && !seen.has(node.anchorId)) {
      seen.add(node.anchorId);
      items.push({ id: node.anchorId, label: node.data.heading });
    }
  }
  return items;
}
