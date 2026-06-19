/**
 * Re-exported from the shared `@workspace/article-parser` lib so the importer,
 * the in-app re-parse action, and any anchor-related tests all share a single
 * allocator implementation. See that lib for the full rationale.
 */
export { createAnchorAllocator } from "@workspace/article-parser";
