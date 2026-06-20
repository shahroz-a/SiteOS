---
name: Blog migrated-corpus presentation gotchas
description: Two non-obvious durable facts for blog-renderer parse + lib/ui theme.css work on the migrated WP/Thrive corpus — verify these against real pages, not just synthetic tests.
---

# Numbered listicle headings come in MULTIPLE markup shapes

The migrated corpus glues the listicle number to the title ("2Title", no
separator) using several distinct markups (attraction-list span, legacy "#N"
span, orphaned timeline number paragraph). The non-obvious trap: in the
attraction-list case the number sits in a heading-internal `<span>` that
**carries attributes and has no "#"**, so a normaliser that assumes a bare
`<span>` (or a single format) silently matches nothing and ships glued numbers
to readers — passing synthetic unit tests the whole time.

**Why / how to apply:** the normalisation runs in `prepareArticleHtml` before
TOC/heading-id extraction (so it fixes both the heading and the TOC label).
When editing it, never assume one number format and never trust unit tests
alone — confirm against real pages (e.g. `/blog/best-road-trips-world/`,
`/blog/most-beautiful-islands-in-the-world/`). `add-to-summary` is a real
content-heading class, NOT part of the broken Summary widget — do not strip it.

The timeline-orphan (`<p class="number">N</p>`) fold has THREE title shapes in
the live corpus, and binding to only `card-title` ships broken pages: the title
after the orphan is an `<h2-6>` of any class (`card-title`, `add-to-summary`, or
NO class) OR a non-heading `<span class="card-title">` (e.g.
`/blog/paris-guide-things-to-do/`, `/blog/best-time-to-visit-paris/`). Bind to
"next heading OR span.card-title, whichever comes first" and guard the span with
`card-title(?![-\w])` so the sibling `card-title-subtext` span is never matched.
A `<p class="number">` orphan is unique to timeline items, so a class-agnostic
heading bind can't over-match ordinary content. (Empty `<p class="number"></p>`
with no digit is intentionally left alone.) The cheap deterministic way to find
all shapes: `regexp_matches` over the corpus for the element following the orphan
— do this rather than fixing one shape per failing test run.

# A global `.blog-prose svg` size cap is intentional and corpus-safe

Migrated inline `<svg>`s often carry `width="100%"`/large viewBoxes and render
as huge gray "blobs". A broad `.blog-prose svg { width/height: 1.25em }` cap is
deliberate: SQL across the whole corpus confirmed **every** inline prose svg is
an icon (no content-bearing illustration/chart exists). Do not remove the cap.

**Why / how to apply:** the safety rests on a corpus-wide fact not visible in
code. If a future CMS introduces rich inline SVG, add an opt-out class rather
than dropping the global cap.

# Review/verdict promotion is heading-based, not <strong>/<br> prose

The migrated corpus has almost no rich review markup: only the star-review
header is canonical (already carded by `renderReviewSpecCard`). The genuinely
recurring OTHER review/verdict shapes are HEADING-based —
`<h3><strong>The Good</strong></h3><p>`, `<h3>Verdict</h3><p>`,
`<h3>… - Verdict</h3><p>`, `<h3>Pros and Cons of…</h3><ul>`. There is NO
separate score/verdict-bar shape (the star rating IS the score). Don't go
looking for `<strong>`/`<br>` pros-cons blocks — they aren't in this corpus.

**Why / how to apply:** `renderVerdictCallouts` in `blog-renderer/src/parse.ts`
wraps a cue-heading + its run of following p/ul/ol siblings in a
`.verdict-callout` card, but KEEPS the heading element inside the wrapper so the
later heading-id/TOC pass still injects the id + TOC entry — promotion is
styling-only, never semantic. Cues are anchored and the heading must be
IMMEDIATELY followed (whitespace only) by p/ul/ol or it's skipped (leaves
separate-div "Verdict … <hr>" headers alone). Confirm on real pages
(`/blog/ferrari-world-abu-dhabi/` yields good+bad+proscons), not synthetic
tests alone.
