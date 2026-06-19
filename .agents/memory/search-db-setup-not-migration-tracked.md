---
name: Raw-DDL DB objects aren't migration-tracked; pg_trgm search was removed
description: Extensions/indexes/tables applied via raw executeSql aren't in any drizzle migration, so a dev rollback wipes them and prod gets them only via re-publish. Separately, CMS search no longer uses pg_trgm — never reintroduce it.
---

## Raw-executeSql DB objects are not migration-tracked
Some DB objects are applied as raw DDL (drizzle-kit `push` is broken on Helium and never emits `CREATE EXTENSION`), so they are NOT part of any migration journal. A dev DB **rollback / checkpoint restore** wipes them while leaving the rest of the schema intact.

**Why:** nothing replays raw-executeSql DDL after a restore; `db:push`/post-merge won't recreate it.

**How to apply:**
- A note saying "applied to DEV via executeSql" is NOT proof it still exists. Re-verify with explicit booleans before trusting prior notes, e.g. `SELECT to_regclass('public.<table>') IS NOT NULL`, `SELECT count(*) FROM pg_indexes WHERE indexname LIKE '...'`. Header-only output (no row) = ABSENT.
- Production schema is publish-managed: the agent must NOT run DDL against prod (`executeSql` prod is read-only). Apply to dev, then have the user **re-publish**.

**Still-live example — page_views analytics.** `page_views` + `page_view_daily` + `page_view_referrer_daily` and their indexes (`lib/db/src/schema/analytics.ts`) are applied via raw executeSql, are NOT migration-tracked, and vanish from dev after a rollback. Self-heal: `pnpm --filter @workspace/scripts run ensure:analytics` (`scripts/src/ensure-analytics.ts`, idempotent, wired into `scripts/post-merge.sh`). Match drizzle's constraint/FK names in the raw DDL so the publish diff stays clean. Prod still needs a re-publish.

## pg_trgm / trigram search was REMOVED — do not reintroduce
CMS `/cms/search` used to depend on the `pg_trgm` extension + ~18 trigram GIN indexes (`*_trgm`, `gin_trgm_ops`). **A GIN index declared on a text column without the trigram operator class made the Replit publish dev→prod diff fail** ("GIN index created on a text column without the required operator class"), which blocked publishing entirely.

**Decision:** pg_trgm was removed entirely. CMS search is now **pure case-insensitive ILIKE** (`buildSearchPredicate` + relevance `CASE` in `artifacts/api-server/src/lib/posts.ts`) — no extension, no trigram indexes, no `%`/`similarity()`. Deleted along with it: the search-readiness probe (`/api/healthz/search`, `search-readiness.ts`), the `ensure:search-indexes` self-heal script, and `lib/db/src/search-indexes.ts`; `SqlExecutor` moved to `lib/db/src/sql-executor.ts`.

**Why:** keep the dev→prod publish diff clean and identical, and make search need zero DB setup so it can't silently break after a dev rollback.

**Do not** re-add pg_trgm / trigram GIN indexes / `ensure:search-indexes` / a search-readiness probe to "speed up" or "fuzzy-match" search — it re-breaks publishing. If fuzzier search is ever needed, solve it without a GIN-on-text index that lacks an operator class.
