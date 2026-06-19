---
name: SourceDiff highlight persistence
description: Why SourceDiff must re-apply out-of-band highlight classes on every commit, not just on diff/active changes.
---

# SourceDiff highlight persistence

`SourceDiff` (artifacts/cms) highlights diff markers by adding classes
**out-of-band** onto the `dangerouslySetInnerHTML` source pane (React doesn't
own those classes). React can reset OR remount that subtree on any later
re-render, wiping the classes.

**Rule:** the layout effect that calls `applyHighlights` must run on **every
commit** (no dependency array), not scoped to `[diff, active]`.

**Why:** scoping to `[diff, active]` works in the editor's isolated
`ImportDiffSheet` (it doesn't re-commit the pane after the initial paint), but
fails in large host surfaces like the held-back review drawer
(`held-back.tsx` `ArticleDrawer`). That drawer has sibling async state (audit-log
query, reextract) that re-commits/remounts the source pane *after* the initial
two `applyHighlights` calls — without changing `diff` or `active` — so the
freshly-remounted pane never gets re-highlighted and the markers silently
vanish. Symptom: the diff *list* (`<ol>` markers) populates correctly but
`.diff-marker` classes are never present in the DOM; no JS error.

**How to apply:** running `applyHighlights` unconditionally is safe because it
only reads/writes DOM (never sets state) → no render loop. Scroll is gated by
`scrollPendingRef` so incidental re-commits don't hijack scroll. Both diff
surfaces (editor + held-back) are covered by e2e specs that share
`artifacts/cms/e2e/diff-helpers.ts` (`assertHighlightsPersistAndNavigate`).

**Debugging note:** Playwright `page.on("console")` only fires for messages
emitted *after* the listener attaches — register it BEFORE the action that opens
the surface, and remember `console.log` is type `"log"` not `"error"`.
