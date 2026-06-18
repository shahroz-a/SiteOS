import { format } from "date-fns";

/**
 * Absolute URL for the default brand Open Graph / Twitter share image, used by
 * listing and filtered views that have no post-specific hero image. Built from
 * the current origin + Vite base path so the file in `public/` resolves both in
 * the `/blog/` preview and in production.
 */
export function defaultOgImage(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    return `${window.location.origin}${base}/og-default.png`;
  }
  return `${base}/og-default.png`;
}

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
