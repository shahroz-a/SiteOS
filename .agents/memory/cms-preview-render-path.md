---
name: CMS preview vs blog render-path divergence
description: Why the CMS editor preview can show different article body markup than the live blog, and the rule that keeps them in sync.
---

`ContentRenderer` (`@workspace/blog-renderer`) has two body render paths: the
`contentHtml` path runs the full `prepareArticleHtml` pipeline (verdict/pros-cons
promotion, cruft cleanup, heading ids); the `componentTree` path does not, unless
its rich-HTML body node is explicitly routed through `prepareArticleHtml`.

**Rule:** the CMS editor preview ALWAYS renders via `componentTree`
(`contentHtml: null`), and a migrated article loads as a single rich-text body
block — so the componentTree rich-HTML body node must run `prepareArticleHtml`,
or the preview silently drops promotions readers see on the live blog. Per-snippet
contexts (FAQ/accordion answers) should stay sanitize-only — article-level
processing doesn't belong on small Q&A fragments.

**Why:** preview and blog can only be guaranteed not to drift if both rich-HTML
body paths run the same prepare pipeline; never add preview-only render logic.

**How to apply:** verify parity by reproducing the preview pipeline in a test —
`blocksToComponentTree(blocks)` → `<ContentRenderer post={{ componentTree,
contentHtml: null }} />` — and asserting on the `dangerouslySetInnerHTML` payload.
The CMS test env is node (no jsdom), but `prepareArticleHtml` is pure string ops
so `react-test-renderer` works there.
