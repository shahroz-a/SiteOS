---
name: Malformed itinerary .days cause mobile overflow
description: Migrated Thrive/WP day-by-day itinerary widgets have unbalanced .days divs that nest into a horizontal staircase; fix is a pre-parse string balance pass, not DOM reserialize.
---

# Malformed itinerary `.days` → mobile horizontal overflow

Some migrated WordPress/Thrive Architect articles contain a "day-by-day
itinerary" widget whose stored `cleaned_html` is **malformed at the source**:
the intended structure is `.page-card > .days+` (sibling day blocks), but from
roughly Day 3 onward each `<div class="days">` is **missing its closing
`</div>`**. Because `<div>` is not an HTML *formatting* element, the browser and
`DOMParser` nest the unclosed days verbatim (Day 4 becomes a child of Day 3,
Day 5 of Day 4, …). Each nested `.days` re-adds the fixed-width day column, so
the page grows a horizontal "staircase" — e.g. a 400px-viewport article reported
`document.documentElement.scrollWidth == 620`.

**Why parse-and-reserialize can't fix it:** round-tripping the markup through
`DOMParser` reproduces the exact same nesting (the bytes are already wrong before
parsing). The missing tags must be re-inserted into the *string* before any DOM
parse. The string prepare pipeline was proven NOT to corrupt tag balance — the
defect is in the source data, not the renderer.

**Fix:** `balanceItineraryDays(html)` in `lib/blog-renderer/src/parse.ts` — an
isomorphic (no-DOM) string pass that tokenizes `<div>`/`</div>`, tracks a nesting
stack, and whenever a `.days` div opens while an ancestor `.days` is still open,
emits closing `</div>`(s) down to and including the nearest open `.days` so the
new day becomes a sibling. Wired into `prepareArticleHtml` after the
script/style strip and before `<img>` repair, so SSR/prerender and client render
stay byte-identical.

**Why the repair is global, not scoped to `.page-card`:** `days` is a
Thrive-itinerary-specific class that is never *legitimately* nested in this
corpus, so flattening any nested `.days` is always the correct repair. Scoping
the pass to `.page-card` would MISS malformed itineraries wrapped in a different
container. Class match is exact (`split(/\s+/).includes("days")`) so it never
trips on look-alikes like `itn-day`.

**How to apply:** if a migrated article shows horizontal overflow / a staircase
of repeating columns, suspect unbalanced widget divs in the source HTML before
touching the parse pipeline. Verify with an SQL tag-count or a decoded-CSV
skeleton render. Keep `parse.ts` a pure no-DOM string pipeline (SSR byte-parity);
`lib/blog-renderer` is a composite lib, so run `pnpm run typecheck:libs` after
edits and restart `artifacts/blog: web`.
