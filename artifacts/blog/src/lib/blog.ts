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

export interface TocItem {
  id: string;
  label: string;
}

/** Extract anchor sections from a componentTree for the table of contents. */
export function tocFromComponentTree(tree: CTRoot | null): TocItem[] {
  if (!tree) return [];
  const items: TocItem[] = [];
  for (const node of tree.children) {
    if (node.blockType === "section" && node.anchorId) {
      items.push({ id: node.anchorId, label: node.data.heading });
    }
  }
  return items;
}
