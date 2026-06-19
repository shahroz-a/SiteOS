---
name: Published app empty — separate empty prod DB
description: Deployed app shows no data while dev is full because Replit prod DB is separate and was never seeded; how to diagnose and the supported fix.
---

# Published app is empty but dev has data

**Symptom:** The deployed/published app renders blank or "no data" while the dev preview is full of content.

**Root cause (most common):** Replit managed Postgres gives the deployment a **separate production database**. The publish flow syncs the *schema* (tables exist in prod) but does **not** copy *data*. If content was only ever written to the dev database (crawl, seed, CMS edits), prod is schema-complete but 0 rows → the app's API returns empty lists → blank page.

**Why it's easy to misdiagnose:**
- A `304 Not Modified` on an API endpoint (e.g. `/api/posts`) does **NOT** prove data exists — an empty `[]` response has a stable ETag and returns 304 on every repeat. Don't read 304 as "data present."
- A **private** deployment puts a `__replshield` 307 in front of everything, so `curl` and the external-URL screenshot bot get bounced to a Replit login page. External agent tools can't see prod; only the logged-in user can. This blocks the obvious "just look at it" diagnostic.

**Authoritative diagnostic:** `executeSql({ environment: "production" })` is READ-ONLY but works against the prod read replica. Count rows directly:
`SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC` — if every table is 0, prod was never seeded. Compare with the same counts in `development`.

**Fix (user action — agent cannot do it):** The agent's prod access is read-only and **must not** write prod data or script a prod data migration (see database-migrations-on-publish reference). The supported path is the Publish UI's **"overwrite data"** option, which copies/replaces prod data with dev data wholesale at publish time. Tell the user to re-publish and pick that option. Do NOT: set the deployment `DATABASE_URL` to the dev DB (couples prod to dev rollbacks), add deploy-build/startup DDL, or write a migrate-prod script.

**Why:** Replit publish = schema diff only, never automatic data copy. First real publish of a data-heavy app surfaces this.
