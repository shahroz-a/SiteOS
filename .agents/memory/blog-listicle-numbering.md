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

# A global `.blog-prose svg` size cap is intentional and corpus-safe

Migrated inline `<svg>`s often carry `width="100%"`/large viewBoxes and render
as huge gray "blobs". A broad `.blog-prose svg { width/height: 1.25em }` cap is
deliberate: SQL across the whole corpus confirmed **every** inline prose svg is
an icon (no content-bearing illustration/chart exists). Do not remove the cap.

**Why / how to apply:** the safety rests on a corpus-wide fact not visible in
code. If a future CMS introduces rich inline SVG, add an opt-out class rather
than dropping the global cap.
