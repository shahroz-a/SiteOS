---
name: Bulk alt skip persistence shrink trap
description: saveSkipped is union/grow-only; shrinking the persisted skip set needs a separate replace channel or the clear/review/promotion silently no-ops.
---

# Bulk alt-text review: skip-set persistence is grow-only by default

The CMS bulk alt-text review flow persists the per-filter skipped-URL set to
localStorage so a pass survives close/reopen and syncs across tabs.

**Trap:** `saveSkipped(filter, urls)` UNIONs with what's already stored (so
concurrent tabs each adding a skip converge). That means it can only ever
*grow* the set. Any action that *shrinks* the set — review-skipped, clear, or a
cross-tab promotion of a skipped image to approved — cannot be expressed via
`saveSkipped`: it silently merges the smaller set back into the old larger one,
so the persisted skips never actually clear.

**Rule:** reductions must go through `replaceSkipped(filter, urls)` (authoritative
overwrite; `removeItem` when empty, else exact set), wired in the hook as a
separate `onSkippedReset` callback distinct from the grow-only `onSkippedChange`.
Keep new-skip writes on `onSkippedChange`/`saveSkipped`; route every shrink/clear
on `onSkippedReset`/`replaceSkipped`.

**Why:** tests that only assert the callback fired with `[]` are green over this
bug — the callback firing proves nothing if the parent maps it to a union op.
Assert end-to-end that `loadSkipped` returns the shrunken/empty set.

**How to apply:** when touching skip/approve persistence in
`use-alt-review.ts` / `bulk-alt-progress.ts` / `media.tsx`, check whether the
write is a grow or a shrink and pick the matching channel.
