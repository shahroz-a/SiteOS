---
name: Annotating rendered preview DOM
description: Where it is safe to imperatively add CSS classes to React-rendered content (CMS source-vs-parsed diff).
---
When you imperatively annotate content rendered by a component (e.g. the CMS
held-back review diff highlighting dropped/changed paragraphs, missing images,
dropped links via `el.classList.add`), WHERE you annotate matters.

**Rule:** annotations on the children of a `dangerouslySetInnerHTML` container
persist across parent re-renders; annotations added to React-rendered (JSX)
nodes are reverted the next time React reconciles that subtree.

**Why:** React owns JSX nodes and resets their `className` from the render
output, so any class you add out-of-band disappears on the next setState. It
does NOT track the inner nodes of a `dangerouslySetInnerHTML` block, so classes
you add there survive until the `__html` string itself changes.

**How to apply:** in artifacts/cms (ContentRenderer from @workspace/blog-renderer),
the *source* pane renders raw cleaned/original HTML via dangerouslySetInnerHTML —
annotate it and run Prev/Next navigation against it. The *parsed* pane renders
componentTree/richText as real React elements — do NOT DOM-annotate it (surface
importer-only "added" content as a count/summary instead). Compute the diff in a
useEffect keyed on the loaded data; setState there won't wipe the source-pane
highlights. Pure diff logic lives in artifacts/cms/src/lib/content-diff.ts.
