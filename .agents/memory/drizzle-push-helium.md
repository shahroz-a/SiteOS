---
name: drizzle-kit push silently fails on Replit Helium Postgres
description: drizzle-kit push dies during introspection on the Replit-managed Postgres; generate SQL and apply it via executeSql instead.
---

# drizzle-kit push silent-fail on Replit-managed Postgres (Helium)

Against the Replit-managed Postgres (`DATABASE_URL`, the "Helium" DB),
`drizzle-kit push` / `push-force` **silently dies during the "Pulling schema
from database..." introspection step** — no error, no migration applied, exit
without writing anything. Interactive `push` also hangs without a TTY (separate
issue).

**Workaround that works (full schema, 25 public tables):**
1. Temporarily add an `out` dir to `drizzle.config.ts`.
2. `drizzle-kit generate --config ./drizzle.config.ts` (no extra flags — extra
   flags get rejected) to emit the CREATE SQL.
3. Apply the generated SQL against the DB via `executeSql` (the code-execution
   callback), which connects fine.
4. Revert the temp `out` line and remove the generated dir.

**Why:** `executeSql` and a raw `pg` Pool both connect and run the app's exact
queries successfully against Helium — only drizzle-kit's introspection path
breaks here. So treat `generate` + manual apply as the schema-push path on
Helium, not `push`.
