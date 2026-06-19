---
name: pages-table bulk read OOM
description: original_html dominates the pages table (~500MB); any batch job must project columns, never select(*), or it OOMs the Node heap.
---

# pages-table bulk read OOM

The Payload export OOM'd the Node heap (~4GB) at "Reading migrated content…".
Cause: it did `db.select().from(pagesTable)` with **no projection**, pulling
`original_html` for all ~3,700 rows. `original_html` is the lossless raw HTML and
is by far the largest column (~500MB across the corpus; as UTF-16 JS strings
that's ~1GB, and the subsequent `JSON.stringify` roughly doubles peak). The
export never even uses it — it emits `cleanedHtml`. Projecting only the consumed
columns fixed it; the export then completes (~507MB output file) under the
default heap.

**Why it matters:** `pages` stores four large text/JSON blobs per row
(`originalHtml`, `cleanedHtml`, `richText`, `componentTree`) deliberately for
lossless re-parsing. Loading all of them for every row at once does not fit in
memory at full-corpus scale.

**How to apply:** any batch job that reads many `pages` rows (export, reports,
re-parse) must `db.select({ …explicit columns })` and exclude `originalHtml`
unless it specifically needs the raw HTML. Never `select(*)` the pages table in
a loop/bulk context. If a job genuinely needs every blob for every row, stream
in batches rather than materializing the whole table + a stringified copy.
