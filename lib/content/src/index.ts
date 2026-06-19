/**
 * Pure, DB-agnostic block/content transforms shared between the migration
 * scripts (crawler/import) and the CMS write API. No I/O, no Drizzle, no
 * runtime deps — safe to import from any package (libs, server, scripts).
 *
 * Source of truth for: the intermediate block-tree shape (`BlockNode`), the
 * flattened `blocks`-table rows (`flattenBlocks`), the Payload-compatible
 * nested component tree (`buildComponentTree`), the derived Lexical richText
 * document (`buildRichText`), and helpers to read either component-tree shape.
 */

export interface BlockNode {
  blockType: string;
  text?: string;
  data?: unknown;
  anchorId?: string;
  children?: BlockNode[];
}

/** A single row in the flat `blocks` table. */
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
    ...(node.children?.length ? { children: node.children.map(toNode) } : {}),
  });
  return {
    type: "root",
    schemaVersion: "1",
    children: blocks.map(toNode),
  };
}

/** Flatten the nested block tree into rows for the `blocks` table. */
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

/** Normalize a single stored component-tree node into a `BlockNode`. */
function normalizeBlockNode(node: unknown): BlockNode {
  const n = (node ?? {}) as Record<string, unknown>;
  const children = Array.isArray(n.children)
    ? n.children.map(normalizeBlockNode)
    : undefined;
  // `blockType` is the unified discriminator emitted by the crawler, importer
  // and CMS editor. `type` is a defensive fallback for any legacy stored tree
  // that predates the unification and hasn't been migrated yet (e.g. a prod
  // corpus before a re-publish).
  const blockType =
    typeof n.blockType === "string"
      ? n.blockType
      : typeof n.type === "string"
        ? n.type
        : "";
  return {
    blockType,
    ...(typeof n.text === "string" ? { text: n.text } : {}),
    ...(n.data != null ? { data: n.data } : {}),
    ...(typeof n.anchorId === "string" ? { anchorId: n.anchorId } : {}),
    ...(children && children.length ? { children } : {}),
  };
}

/**
 * Read the top-level block list out of a stored `componentTree`, normalized to
 * `BlockNode[]`. The corpus holds two shapes: the importer stores a single root
 * **object** (`{ type:"root", children:[...] }`) whose blocks key the
 * discriminator as `blockType`, while the crawler stores a bare top-level
 * **array** of blocks that key it as `type`. Nodes are normalized recursively so
 * the crawler's `type` is mapped onto `blockType` — otherwise re-flattening a
 * crawler page (e.g. on a CMS export -> import round-trip) emits `blocks` rows
 * with a null `blockType`. Returns `[]` for null/unknown shapes.
 */
export function componentTreeChildren(tree: unknown): BlockNode[] {
  const raw = Array.isArray(tree)
    ? tree
    : tree &&
        typeof tree === "object" &&
        Array.isArray((tree as { children?: unknown }).children)
      ? (tree as { children: unknown[] }).children
      : [];
  return raw.map(normalizeBlockNode);
}
