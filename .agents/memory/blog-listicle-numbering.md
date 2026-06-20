---
name: Blog listicle numbering & inline-svg icon cap
description: Migrated-corpus numbered-heading markup shapes and why a corpus-wide .blog-prose svg size cap is safe — for blog-renderer parse + lib/ui theme.css work.
---

# Numbered listicle headings (migrated WP/Thrive corpus)

The migrated article corpus glues the listicle number to the title with no
separator ("2Title"). It is NOT one format — at least three shapes exist, all
normalised to "N. Title" by `mergeNumberedHeadings` in `lib/blog-renderer/src/parse.ts`:

1. **Attraction list** — `<h2 class="attr-list-title"><span id="attr-1">2</span>Title>`.
   The span **has attributes** (`id="attr-N"`) and its content is the **bare digit
   with NO "#"**. A regex requiring a bare `<span>` silently misses every real page
   (this exact trap cost a debug cycle). Must match `<span\b[^>]*>\s*#?\s*(\d+)`.
2. **Legacy variant** — `<span>#2 </span>Title` (no attrs, has "#").
3. **Timeline list** — orphaned `<p class="number">2</p>` sibling immediately before
   `<h… class="card-title">Title` (the number-circle/connector CSS never migrated).

**Why / how to apply:** these run inside `prepareArticleHtml` (pure isomorphic
string rewrites, SSR byte-parity) and BEFORE TOC/heading-id extraction, so the
"N. " prefix flows into both the rendered heading and the TOC label. When touching
this, never re-narrow the span regex to a bare `<span>` and never assume a single
numbered format — verify against real pages (e.g. `/blog/best-road-trips-world/`,
`/blog/most-beautiful-islands-in-the-world/`).

# Inline `<svg>` icon cap is corpus-wide safe

Every inline `<svg>` in the corpus prose is an **icon** (tcb-icon carets, FontAwesome
glyphs, a bookmark glyph) — verified by SQL across all pages. Migrated svgs often
carry `width="100%"`/large viewBoxes, so they render as huge gray "blobs". A base
`.blog-prose svg { width/height: 1.25em }` cap in `lib/ui/src/styles/theme.css` is
therefore safe and intended — do not remove it.

**Why / how to apply:** the cap is deliberately broad because no legit content-bearing
SVG (illustration/chart) exists in the current corpus. If a future CMS introduces rich
inline SVG, add an opt-out class rather than dropping the global cap.
