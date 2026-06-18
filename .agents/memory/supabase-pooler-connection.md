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
