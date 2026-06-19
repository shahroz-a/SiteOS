/**
 * Block/content transforms. These pure functions now live in the shared
 * `@workspace/content` lib so the CMS write API can reuse them; this module
 * re-exports them for the migration scripts (parser/import/payload) that
 * already depend on `./transform`.
 */
export {
  buildRichText,
  buildComponentTree,
  flattenBlocks,
  componentTreeChildren,
} from "@workspace/content";
export type { FlatBlockRow, BlockNode } from "@workspace/content";
