<<<<<<< HEAD
- [Migrated HTML inline handlers](migrated-html-inline-handlers.md) — corpus HTML carries mod_pagespeed `onload="pagespeed…"`; any raw-HTML injection must strip inline `on*` or it throws `pagespeed is not defined`.
=======
- [Content-fidelity migrations](content-fidelity-migrations.md) — author source content yourself as a data file; design subagents paraphrase/drop/"fix" content if they transcribe it.
- [opacity-0 + animate-in hides content](animate-in-invisible-content.md) — always-visible content must NOT use an opacity-0 base with animate-in; it vanishes under reduced-motion / iframe contexts.
- [Supabase pooler connection](supabase-pooler-connection.md) — use Session Pooler URL (port 5432) not direct db host (IPv6-only); ssl no-verify, drizzle push-force not push.
- [Supabase write blocks](supabase-write-blocks.md) — soft quota read-only (overridable via DB_FORCE_WRITABLE=1) vs physical disk-full 53100/mdzeroextend (hard wall, needs user storage expansion); crawl resumable from crawl_queue.
- [Orval path+query param collision](orval-path-query-collision.md) — operations mixing a path param and query params emit a zod value + TS type of the same name → TS2308; avoid nesting.
- [Drizzle silent unknown keys](drizzle-silent-unknown-keys.md) — wrong-table column in .values()/.set() neither type-errors (via intermediate var) nor throws; it's silently dropped. Verify with SELECT.
- [Crawler content-hash idempotency](crawler-content-hash-idempotency.md) — re-crawl shows "changed" only vs older-code rows; prove idempotency via current-code double-store, not pre-existing rows.
>>>>>>> ac6f02c (Saved progress at the end of the loop)
