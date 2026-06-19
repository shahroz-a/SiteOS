---
name: Supabase write blocks (soft quota vs physical disk-full)
description: Two distinct reasons Supabase stops accepting writes and how to tell them apart; only one is overridable.
---

Supabase (free/small tier) can stop accepting writes for **two different reasons**, and they need
opposite responses. Diagnose before reacting.

1. **Soft storage quota → read-only lockdown.**
   - Symptom: writes fail but the session reports `SHOW default_transaction_read_only` = `on`, while
     `pg_is_in_recovery()` = `false` (so it is NOT a replica/failover).
   - This is a logical guard, not a disk limit. It is **overridable** per-session with
     `SET default_transaction_read_only = off`.
   - In this repo it is gated behind an opt-in: `lib/db/src/index.ts` runs that SET on each new
     pool connection **only when `DB_FORCE_WRITABLE=1`**. Prefix the workflow/CLI command with it.
     Reads work without the flag; status/report commands that only SELECT do not need it.

2. **Physical disk full → hard wall (NOT overridable).**
   - Symptom: Postgres error **`53100`**, `routine: 'mdzeroextend'`, `file: 'md.c'`,
     hint "Check free disk space." Fires the moment any statement must *extend* a relation/index
     file (even a tiny startup UPDATE like the stale-row recovery query).
   - `DB_FORCE_WRITABLE` does nothing here. You cannot free space from the agent side: `VACUUM FULL`
     needs *extra* temp space to rewrite, and `DELETE` does not return OS disk immediately. A lone
     small write may briefly succeed right at the edge (WAL rotation gives a sliver), but a real
     workload that extends files fails again instantly — do not mistake that sliver for headroom.
   - **Resolution requires the user**: expand/upgrade Supabase storage. This is a genuine infra
     blocker, not an agent-fixable bug.

**Order of failure observed:** soft read-only kicks in first (logical quota), gets overridden, writes
resume and the DB keeps physically growing until the actual disk fills and `53100` takes over. The
second wall is the real ceiling.

**Third stage — instance goes fully offline.** After the disk stays full, the Supabase pooler stops
accepting connections at all: `FATAL: the database system is not accepting connections` /
`DETAIL: Hot standby mode is disabled`. At this point you cannot even `pg_dump` to migrate the data
out — the rows are stranded until the user expands storage and it comes back. **Lesson: migrate/back
up BEFORE the disk fills.** Once it is fully offline, the only path to a working corpus is to
re-ingest from source, not to copy out of Supabase.

**Switching ingestion to Replit built-in Postgres.** Connection precedence in `lib/db/src/index.ts`
and `lib/db/drizzle.config.ts` now prefers `DATABASE_URL` (Replit Helium, internal host, `sslmode=disable`,
no TLS) and falls back to `SUPABASE_DATABASE_URL`. The supabase-only SSL `rejectUnauthorized:false`
path keys off a `/supabase/` regex on the URL, so Helium needs no SSL changes. To move back to
Supabase later, point `DATABASE_URL` at it (or re-flip the precedence). No `DB_FORCE_WRITABLE` is
needed on Replit Postgres — it is writable.

**Resuming after either block clears:** the blog crawl is fully resumable from its DB-backed queue
(`crawl_queue`). After space/quota is restored, just restart the `Blog Crawl` workflow
(`DB_FORCE_WRITABLE=1 pnpm --filter @workspace/scripts run crawl -- --crawl --no-browser --concurrency=N`);
it claims remaining `pending` rows and `recoverStaleInProgress` re-queues anything left `in_progress`.
Lower `--concurrency` reduces simultaneous file-extend pressure when near the edge.
