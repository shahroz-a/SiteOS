import type { PostDetail } from "@workspace/api-client-react";

/**
 * Minimal structural types for the Payload-style `componentTree` returned by
 * `GET /api/posts/{slug}`. The API types it loosely as a JSON object, so we
 * narrow it here for rendering. Unknown block types are rendered generically.
 */
export interface TreeNode {
  blockType?: string;
  text?: string;
  anchorId?: string;
  data?: {
    heading?: string;
    title?: string;
    items?: string[];
    ordered?: boolean;
    [key: string]: unknown;
  };
  children?: TreeNode[];
}

export interface ComponentTree {
  type?: string;
  children?: TreeNode[];
  schemaVersion?: string;
}

export function getComponentTree(post: PostDetail): ComponentTree | null {
  const tree = post.componentTree as ComponentTree | null | undefined;
  if (!tree || !Array.isArray(tree.children)) return null;
  return tree;
}

export interface TocEntry {
  id: string;
  label: string;
}

/**
 * Collect top-level `section` blocks (the navigable headings) for a table of
 * contents. Uses each section's `anchorId` as the public anchor target.
 */
export function buildToc(tree: ComponentTree | null): TocEntry[] {
  if (!tree?.children) return [];
  const entries: TocEntry[] = [];
  for (const node of tree.children) {
    if (node.blockType === "section" && node.anchorId) {
      const label = node.data?.heading?.trim();
      if (label) entries.push({ id: node.anchorId, label });
    }
  }
  return entries;
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export function formatDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return dateFormatter.format(date);
}
