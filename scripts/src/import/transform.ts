import type { BlockNode } from "./types";

/**
 * Build a Lexical/Payload-style richText document from the block tree. This is a
 * derived, queryable representation — the verbatim source lives in
 * `originalHtml`, so this can be regenerated at any time.
 */
export function buildRichText(blocks: BlockNode[], title: string): unknown {
  const children: unknown[] = [];
  if (title) {
    children.push({
      type: "heading",
      tag: "h1",
      children: [{ type: "text", text: title }],
    });
  }
  const walk = (nodes: BlockNode[]) => {
    for (const node of nodes) {
      switch (node.blockType) {
        case "section": {
          const data = node.data as { heading?: string; level?: number };
          if (data?.heading)
            children.push({
              type: "heading",
              tag: `h${data.level ?? 2}`,
              children: [{ type: "text", text: data.heading }],
            });
          if (node.children?.length) walk(node.children);
          break;
        }
        case "heading": {
          const data = node.data as { level?: number };
          children.push({
            type: "heading",
            tag: `h${data?.level ?? 3}`,
            children: [{ type: "text", text: node.text ?? "" }],
          });
          break;
        }
        case "paragraph":
          children.push({
            type: "paragraph",
            children: [{ type: "text", text: node.text ?? "" }],
          });
          break;
        case "quote":
          children.push({
            type: "quote",
            children: [{ type: "text", text: node.text ?? "" }],
          });
          break;
        case "list": {
          const data = node.data as { ordered?: boolean; items?: string[] };
          children.push({
            type: "list",
            listType: data?.ordered ? "number" : "bullet",
            children: (data?.items ?? []).map((item) => ({
              type: "listitem",
              children: [{ type: "text", text: item }],
            })),
          });
          break;
        }
        case "image": {
          const data = node.data as { url?: string; alt?: string | null };
          children.push({
            type: "image",
            src: data?.url ?? "",
            altText: data?.alt ?? "",
          });
          break;
        }
        default:
          if (node.text)
            children.push({
              type: "paragraph",
              children: [{ type: "text", text: node.text }],
            });
          if (node.children?.length) walk(node.children);
      }
    }
  };
  walk(blocks);
  return { root: { type: "root", children } };
}

/**
 * Build the Payload-compatible nested component tree (one JSON document per
 * page) used directly by the renderer. Mirrors the block tree shape with a
 * schema version envelope.
 */
export function buildComponentTree(blocks: BlockNode[]): unknown {
  const toNode = (node: BlockNode): unknown => ({
    blockType: node.blockType,
    ...(node.anchorId ? { anchorId: node.anchorId } : {}),
    ...(node.text != null ? { text: node.text } : {}),
    ...(node.data != null ? { data: node.data } : {}),
    ...(node.children?.length
      ? { children: node.children.map(toNode) }
      : {}),
  });
  return {
    type: "root",
    schemaVersion: "1",
    children: blocks.map(toNode),
  };
}

/** Flatten the nested block tree into rows for the `blocks` table. */
export interface FlatBlockRow {
  id: string;
  parentId: string | null;
  blockType: string;
  position: number;
  depth: number;
  anchorId: string | null;
  data: unknown;
  text: string | null;
}

export function flattenBlocks(
  blocks: BlockNode[],
  makeId: () => string,
): FlatBlockRow[] {
  const rows: FlatBlockRow[] = [];
  const walk = (
    list: BlockNode[],
    parentId: string | null,
    depth: number,
  ): void => {
    list.forEach((node, index) => {
      const id = makeId();
      rows.push({
        id,
        parentId,
        blockType: node.blockType,
        position: index,
        depth,
        anchorId: node.anchorId ?? null,
        data: node.data ?? null,
        text: node.text ?? null,
      });
      if (node.children?.length) walk(node.children, id, depth + 1);
    });
  };
  walk(blocks, null, 0);
  return rows;
}
