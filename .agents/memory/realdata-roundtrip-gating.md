---
name: Real-data round-trip verification gating
description: Why the opt-in real-DB export→load→import test gates on a dedicated env var, not DATABASE_URL, and how it stays non-destructive.
---

# Real-data round-trip verification gating

The export→load→import round-trip test that runs against the LIVE migration DB
(`scripts/src/payload/__tests__/roundtrip-real-data.test.ts`) is opt-in.

## Gate on a dedicated env var, never DATABASE_URL
Gate it with `describe.runIf(process.env.VERIFY_REAL_DATA === "1")`.

**Why:** `DATABASE_URL` is *always* set in this environment, so gating on it
would make the test run during every normal `vitest`/validation pass — hitting
the real Supabase pooler, slow, and flaky. The normal suite must skip it.

**How to apply:** Any test that must touch real infra/network and should be
excluded from CI/validation needs its own explicit opt-in flag. Run on demand
via `pnpm --filter @workspace/scripts run verify:roundtrip`.

## Non-destructive by construction
- Export leg only SELECTs.
- Load leg targets a throwaway SQLite Payload and stubs media fetch with a 1x1 PNG.
- Import leg runs `importExport(collections, tx)` inside `db.transaction(...)`
  that always throws a sentinel to ROLL BACK — the live DB is never mutated.
  This relies on `importExport` accepting an injected executor (default = real db).

## Hero normalization is expected, not a loss
On import, the hero image is always rewritten as role `featured` at position 0.
So the import leg must compare reimported rows against the EXPORT (its input),
while the export leg compares against the original DB. Don't compare reimported
rows directly to the original DB or hero role/position will look "changed".

## Live run can be environment-blocked
The Supabase DB periodically restarts (errors `57P03` "Hot standby mode is
disabled" / `08006` econnrefused). When it's down the test can't run; that's
infra, not a test bug. Typecheck + the skip path still verify the harness.
