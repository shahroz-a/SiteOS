---
name: Full-corpus render scan surfaces tail-only broken shapes
description: Why the sampled article-formatting gate misses real broken pages, and a known stripSummaryWidget gap it exposes.
---

The article-formatting check (`article-render-corpus.real-data.test.ts`) has a
SAMPLE gate (fixed slugs + per-marker floor + random sweep) and a FULL mode
(`CORPUS_RENDER_FULL=1`, run via `verify:corpus-render:full`) that scans every
published post in batches. The sample gate is fast but the un-sampled tail hides
real broken shapes — a FULL run is the only thing that proves the whole corpus.

**Known transform gap surfaced by the full scan:** `stripSummaryWidget`
(`lib/blog-renderer/src/parse.ts`) only removes `<div ... summary-wrapper-mobile>`
(via `removeBalancedDivsWithTag`). Some migrated pages carry the Thrive
`summary-wrapper-mobile` widget on a NON-`div` element, so its residue survives
into the rendered body. Examples in the corpus: `/blog/climb-o2-arena-london/`,
`/blog/empire-state-building/`.

**Why this matters:** when adding/auditing a `prepareArticleHtml` transform,
trust a FULL-corpus run over the sample gate — passing the gate does NOT mean the
shape is gone corpus-wide. The transforms are tag-specific by design, so a new
markup variant on a different tag slips past them silently.
