---
name: Annotating rendered preview DOM
description: Where it is safe to imperatively add CSS classes to React-rendered content (CMS source-vs-parsed diff).
---
When you imperatively annotate content rendered by a component (e.g. the CMS
held-back review diff highlighting dropped/changed paragraphs, missing images,
dropped links via `el.classList.add`), WHERE you annotate matters.

**Rule:** never store live element references and never assume out-of-band
classes you add to `dangerouslySetInnerHTML` children survive. Even with a stable
`__html`, React (esp. under dev Fast Refresh / @replit cartographer) re-commits
the subtree and wipes the classes. Instead: (1) compute the diff once and persist
a *re-findable plan* — each marker described by a stable document-order index
into the source pane's node list (leaf blocks / `img[src]` / `a[href]`), NOT an
element ref; (2) re-apply ALL highlight classes + the active ring from a
`useLayoutEffect` that re-queries the DOM by that index. A layout effect lands
the classes before paint, so even if a re-render momentarily wipes them the user
never sees a flicker. Do NOT DOM-annotate the *parsed* pane (it renders real JSX
from componentTree/richText) — surface importer-only "added" content as a count.

**Why:** React owns JSX nodes and resets their `className` from render output; it
also re-sets the `dangerouslySetInnerHTML` subtree on re-commit in this dev
setup, so any class added imperatively (including the `ring-2` active ring and
`scrollIntoView`) disappears unless re-applied every commit. Stored element refs
also go stale when the subtree is rebuilt.

**How to apply:** artifacts/cms `src/components/source-diff.tsx` is the reference
implementation — `Annotation` plan + `applyHighlights(active, scroll)` re-queried
from `useLayoutEffect`s; scroll is deferred to the apply effect via a
`scrollPendingRef` so it survives the navigation re-render. The source pane's
scroll container is the `.blog-prose`'s parent (`h-[60vh] overflow-y-auto`), not
`.blog-prose` itself — `scrollIntoView` moves the parent. Pure block/word/URL
diff math lives in `@workspace/content-diff`. e2e coverage (incl. `.diff-marker`
/ `.ring-2` persistence + scrollTop) is `artifacts/cms/e2e/import-diff.spec.ts`.
