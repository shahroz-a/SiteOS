---
name: Supabase pooler connection
description: How to connect Drizzle/pg to a Supabase Postgres in this environment
---

Connect via the **Session Pooler** connection string (host `*.pooler.supabase.com`, port 5432), NOT the direct `db.<ref>.supabase.co` host.

**Why:** the direct host resolves to IPv6 only and is unreachable here (ENOTFOUND). The Session Pooler is reachable over IPv4.

**How to apply:**
- The pooler cert does not chain to a public CA, so the pg `Pool` needs `ssl: { rejectUnauthorized: false }` (gated on host matching `supabase\.(co|com)`).
- `drizzle.config.ts` must append `sslmode=no-verify` to the URL. Do NOT use `sslmode=require` — newer `pg-connection-string` treats `require` as verify-full and fails on the pooler cert.
- Run schema sync with `pnpm --filter @workspace/db run push-force`; the interactive `push` hangs with no TTY.

**Statement timeout on large/wholesale selects:** the pooler enforces a server-side statement timeout and has high per-query latency here. A single wholesale select of a large table (especially JSONB-heavy ones like `jsonld`, ~8k rows) is cancelled mid-flight with a Postgres error whose `routine` is `ProcessInterrupts`. Fetch large datasets in bounded `inArray` id-batches (~200) and sort/group in memory instead of one big query with `ORDER BY`. Treat enrichment data (e.g. JSON-LD) as best-effort: catch per-batch failures and degrade rather than failing the whole job.
