---
name: internal-link resolution is shared
description: Where internal-link targetPageId resolution lives and who must call it
---

Internal-link `targetPageId` resolution lives in ONE place: `resolveInternalLinks()` in `scripts/src/import/persist.ts`. It reads every page + every internal link globally and matches by canonical href.

**Why:** both the crawler pipeline (`scripts/src/import.ts`) and the Payload round-trip importer (`scripts/src/payload/import.ts`) must reconnect links after import. The Payload export intentionally drops `targetPageId` (links round-trip by `href` only), so on insert it is always null; the resolution pass re-populates it.

**How to apply:** any new ingest path that inserts `internal_links` rows must call `resolveInternalLinks()` once after all pages exist (not per-page). Do not reimplement href→page matching — reuse the function so crawler and importer can't drift.
