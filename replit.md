# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- DB schema (source of truth): `lib/db/src/schema/*.ts` (enums, taxonomy, pages, content, media, structured, seo, links, crawl) re-exported via `lib/db/src/schema/index.ts`. DB client: `lib/db/src/index.ts`.
- Blog SEO tag logic (source of truth): `lib/blog-seo/src/index.ts` — `buildSeoTagList` plus `renderSeoTags` (static HTML) and `applySeoTags` (live DOM). Imported by BOTH the prerender path (`scripts/src/prerender/seo.ts`) and the runtime hook (`artifacts/blog/src/hooks/use-seo.ts`) so crawler-visible and JS-rendered head tags can't drift. Parity is enforced by `scripts/src/prerender/__tests__/seo-parity.test.ts`. Never reimplement tag logic in the hook or prerender helper — edit the lib.
- API contract (source of truth): `lib/api-spec/openapi.yaml`. Generated zod → `@workspace/api-zod`; generated React Query hooks → `@workspace/api-client-react`. Regenerate with `pnpm --filter @workspace/api-spec run codegen`.
- API server routes: `artifacts/api-server/src/routes/` (posts, categories, authors, search, health). Shared post serializers/list logic: `artifacts/api-server/src/lib/posts.ts`.
- Seed fixtures: `scripts/src/seed.ts` (run `pnpm --filter @workspace/scripts run seed`).
- Blog crawler & extraction engine: `scripts/src/crawler/*.ts` + CLI `scripts/src/crawl.ts`. Run discovery with `pnpm --filter @workspace/scripts run discover`; bounded crawl with `pnpm --filter @workspace/scripts run crawl -- --crawl --limit=N --no-browser`. Migration reports are written to `./reports/`.
- Payload CMS export: `scripts/src/export-payload.ts` + pure mapping in `scripts/src/payload/mapping.ts` (run `pnpm --filter @workspace/scripts run export:payload`; writes `scripts/out/payload-export.json`, gitignored). See `scripts/src/payload/README.md` for the export shape and an example Local-API loader. `buildExport({ pageIds })` restricts the export to a sample of pages, pruning media/authors/categories (incl. ancestors)/tags to only referenced docs; default (no opts) is unchanged full export. `importExport(collections, executor?)` accepts an injected DB executor (e.g. a transaction) for non-destructive imports.
- Real-data round-trip verification (opt-in): `scripts/src/payload/__tests__/roundtrip-real-data.test.ts` — runs the REAL exporter against the live DB on a small interesting page sample (most + fewest images), loads it into an ephemeral Payload, and re-imports inside a rolled-back transaction, asserting no inline-image/link/metadata loss at each hop. Gated on `VERIFY_REAL_DATA=1` so the normal suite skips it. Run with `pnpm --filter @workspace/scripts run verify:roundtrip`.

## Read API (migration foundation)

All under `/api`. Slugs are the public identifier — internal UUIDs never appear in routing.
- `GET /posts` — paginated list; filters `?category=`, `?author=`, `?tag=` (slugs), `?page=`, `?limit=`.
- `GET /posts/{slug}` — full post: original/cleaned HTML, richText JSON, Payload-style componentTree, breadcrumbs, faq, images, seo, jsonld, categories, tags, author.
- `GET /categories`, `GET /categories/{slug}`, `GET /authors`, `GET /authors/{slug}`, `GET /search?q=`.

## Architecture decisions

- **Crawl mode = HTTP (no browser).** Headout's blog is server-rendered WordPress, so plain HTTP returns the full article HTML. An HTTP-vs-Playwright comparison over representative pages (`scripts/src/crawl-compare.ts`) found identical *editorial* content (text, headings, FAQs, links, images, component tree) at ~100–600× the speed, while a real browser was slow and fragile here (`networkidle` never settles; some pages stall). The only browser-only images are JS-injected commerce/recommendation widgets and social-share icons — not article content — so the full crawl runs with `config.useBrowser=false`. (Bundled Playwright Chromium can't download in this env; a Nix `chromium` via `executablePath` is required for any browser work.)
- **DB target defaults to the Replit-managed Postgres (`DATABASE_URL`).** `lib/db/src/index.ts` and `lib/db/drizzle.config.ts` use `DATABASE_URL` unless `USE_SUPABASE` is truthy *and* a non-empty `SUPABASE_DATABASE_URL` is set — only then do they use Supabase. This explicit opt-in (not the old implicit `SUPABASE_DATABASE_URL ?? DATABASE_URL`) prevents a **stale** `SUPABASE_DATABASE_URL` (which can linger in a long-running workflow's env even after the secret is deleted) from silently hijacking the connection to a paused database. To move to Supabase later: set `SUPABASE_DATABASE_URL` and `USE_SUPABASE=true`.
- **When using Supabase, use its Session Pooler URL** (port 5432, `*.pooler.supabase.com`), not the direct `db.*.supabase.co` host (IPv6-only, unreachable here). SSL detection keys off a `supabase.(co|com)` host in the chosen connection string: `rejectUnauthorized:false` (pooler cert doesn't chain to a public CA); `drizzle.config.ts` appends `sslmode=no-verify` (NOT `require`).
- **Lossless page storage**: `pages` keeps `originalHtml`, `cleanedHtml`, `richText` (JSON) and `componentTree` (Payload-compatible nested blocks) so future parser changes never require recrawling.
- **No nested `/{slug}/posts` endpoints**: orval names the zod value and TS type identically for path+query operations (TS2308). "A category's posts" is served by `GET /posts?category={slug}` instead.
- **Schema push**: use `pnpm --filter @workspace/db run push-force` — interactive `push` hangs without a TTY. **On the Replit-managed Postgres (Helium / `DATABASE_URL`), `drizzle-kit push` also silently dies during the "Pulling schema" introspection step** (no error, nothing applied). Workaround: temporarily add an `out` dir to `drizzle.config.ts`, run `drizzle-kit generate --config ./drizzle.config.ts` (no extra flags), apply the emitted SQL via `executeSql`, then revert the `out` line and delete the generated dir.

## Product

- **Thanksgiving Family Destination Guide** (`artifacts/thanksgiving-guide`, served at `/`): a premium, fully responsive single-page editorial recreation of the Headout blog article "Thanksgiving Vacation Ideas for Families." Presentation-only (no backend). Covers 12 family destinations, each with a hero image, intro, restaurant list, and attractions list, plus a table of contents, author block, share links, newsletter CTA, and footer.
- Content is 100% preserved from the source article and centralized in `artifacts/thanksgiving-guide/src/data/content.ts` (the single source of truth). The UI components render that data verbatim — never edit copy in the components; edit `content.ts`.
- Destination images are hotlinked from `cdn-imgix.headout.com`; some `alt` values intentionally match the source's quirks and should not be "corrected."
- **Headout Blog** (`artifacts/blog`, served at `/blog/`): a public blog that renders the migrated Headout content from the API (`/api`) via generated React Query hooks (`@workspace/api-client-react`), reusing the Thanksgiving design system (`index.css`, `components/ui`). Pages: article (`/blog/<slug>/`), paginated index (`/blog/`), category (`/blog/category/<slug>`), author (`/blog/author/<slug>`), and search (`/blog/search?q=`). Public slugs only — internal UUIDs never appear in routes. Article body renders from `componentTree` → `richText` → `contentHtml` fallback.
- **Headout Blog Mobile** (`artifacts/thanksgiving-mobile`, slug `thanksgiving-mobile`, Expo SDK 54): a native mobile companion mirroring the web blog's design language (Playfair Display headings, DM Sans body, warm palette). Flows: browse paginated posts, filter by category, search, read full article (recursive componentTree renderer + image gallery, FAQ accordion, author card). Talks to the same `/api` backend via the generated `@workspace/api-client-react` React Query hooks — no mobile-specific server work.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **`componentTree` has two shapes.** The crawler (`crawler/assemble.ts`) stores `pages.componentTree` as a top-level JSON **array** of blocks; the importer (`import/parse.ts`) stores a single root **object**. The `componentTree` field in `openapi.yaml` must stay a `oneOf` (object/array/null) or `GET /posts/{slug}` 500s on every crawler-ingested page. Regenerate zod after any contract change.
- **`GET /posts/{slug}` fires ~8 sequential DB queries.** Load-testing it at high concurrency against the Supabase session pooler (especially while the crawler runs) exhausts the pool and returns transient 500s. Verify functional correctness at low concurrency.
- **Payload (for the export loader integration test) drags peer-variant duplicates that only break `typecheck`, not runtime.** Installing `@payloadcms/db-sqlite` pulls `@libsql/client`, which makes the `scripts` package's `drizzle-orm` resolve to a *different* peer variant than `@workspace/db`'s pg-flavored one — so `eq()`/`asc()` on `@workspace/db` columns fail TS2769 (private `shouldInlineParams`/`config` mismatch) in `import.ts`/`export-payload.ts`/crawler files, even though every test passes at runtime. Fix is a typecheck-only redirect: `scripts/tsconfig.json` `paths` maps `drizzle-orm` → `../lib/db/node_modules/drizzle-orm` so both column and operator types share one identity. Do NOT "fix" this by switching source imports to `@workspace/db` — the existing tests `vi.mock("drizzle-orm")` and would silently stop intercepting. Separately, `payload` pins `tsx@4.22.4`, which forks `vite` into two peer variants and breaks `mockup-sandbox`'s typecheck; the `tsx: 4.21.0` override in `pnpm-workspace.yaml` collapses it back to one.
- **A newly-created artifact's dev workflow can't pass its port probe until the workspace reloads.** `.replit [[ports]]` is regenerated from each `artifact.toml` only at repl boot. An artifact created mid-session (e.g. `blog`) has no `[[ports]]` entry, so its dev workflow fails with `DIDNT_OPEN_A_PORT` even though Vite binds the port correctly — the probe can only see forwarded ports. There is no agent tool to add a `[[ports]]` entry (`createArtifact`/`verifyAndReplaceArtifactToml` don't, direct `.replit` edits are blocked, `configureWorkflow` can't override artifact-managed workflows). The app still builds and serves fine: reload the workspace, or publish (production uses a static build, not the dev probe), to see it.
- **Assigning a SQL `CASE`/expression to a `pgEnum` column needs an explicit `::<enum>` cast.** A bare `.set({status:'failed'})` literal coerces fine, but `sql\`CASE WHEN … THEN 'failed' ELSE 'pending' END\`` resolves to `text`, which Postgres refuses to assign to an enum column (error `42804`). This bit `markFailed` in `scripts/src/crawler/queue.ts`: it crashed the entire crawl the first time any page exhausted its retries (so short/bounded runs passed and only the full crawl surfaced it). Fix: cast the whole expression `(CASE … END)::crawl_status`. Applies to every enum column (`crawl_status`, `page_status`, `page_type`, `validation_status`, `log_level`).
- **A single binary response can kill the whole crawl (NUL byte, Postgres `22021`).** If the frontier follows an asset URL (e.g. `wp-content/uploads/.../*.jpg`) and the body is decoded as text, a `0x00` byte makes the text/json upsert throw `22021` (`report_invalid_encoding`); worse, the worker's `catch` then re-throws while *recording* the failure (the error string still holds the bytes), and that uncaught throw aborts the whole `Promise.all`. Defense is layered across every write sink: `fetcher.ts` gates on `content-type` and never decodes non-HTML (missing/empty content-type is treated as HTML); `pipeline.ts` skips `nonHtml` results and excludes `isAssetUrl()` from frontier expansion; `util.ts` provides `stripNul()`/`isAssetUrl()`; `queue.ts` (`markFailed`/`markSkipped`) and `store.ts` (`logCrawl`) `stripNul()` before writing, and `logCrawl` is wrapped in try/catch so a log write can **never** be fatal. Don't reintroduce a raw text write on the error path.
- **`recoverStaleInProgress` must respect the attempts ceiling.** It moves `in_progress` rows (from a crashed run) out of that state, but rows already at `attempts >= maxAttempts` must become `failed`, not `pending` — `claimBatch` only claims `attempts < maxAttempts`, so resetting exhausted rows to `pending` strands them un-reclaimable (stuck-pending), the symptom that once required a manual SQL flip.
- **Never `db.select().from(pagesTable)` (i.e. `select(*)`) in a batch/bulk job.** `original_html` (the lossless raw HTML, ~500MB across the corpus) dominates the table and OOMs the Node heap (~4GB) once materialized + `JSON.stringify`'d. The Payload export hit this; fix is explicit column projection excluding `originalHtml` (the export emits `cleanedHtml`, not the raw). Applies to reports/re-parse jobs too; stream in batches if every blob is genuinely needed.
- **Verifying the Expo mobile app**: the bash tool kills any backgrounded process on return and caps at 120s, so you can't keep `expo start` alive to curl/screenshot it. Verify code with `pnpm --filter @workspace/thanksgiving-mobile run typecheck` plus `pnpm exec expo export --platform web` (a clean `Exported: dist` means the full graph bundles without errors). Run from `artifacts/thanksgiving-mobile`; delete the throwaway `dist/` after.
- **Expo workflow `DIDNT_OPEN_A_PORT`**: the `thanksgiving-mobile` expo workflow can report `DIDNT_OPEN_A_PORT` even though Metro reaches a clean steady state ("Web is waiting on http://localhost:23396"). This is the dev-domain reachability probe, not a code/config bug (config matches the canonical Expo scaffold). reactCompiler toggling, cache warming, and removing `--localhost` do NOT fix it. The published/preview-pane path may still load the app. See `.agents/memory/expo-dev-server-reachability.md`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
