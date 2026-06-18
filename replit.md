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
- API contract (source of truth): `lib/api-spec/openapi.yaml`. Generated zod → `@workspace/api-zod`; generated React Query hooks → `@workspace/api-client-react`. Regenerate with `pnpm --filter @workspace/api-spec run codegen`.
- API server routes: `artifacts/api-server/src/routes/` (posts, categories, authors, search, health). Shared post serializers/list logic: `artifacts/api-server/src/lib/posts.ts`.
- Seed fixtures: `scripts/src/seed.ts` (run `pnpm --filter @workspace/scripts run seed`).
- Blog crawler & extraction engine: `scripts/src/crawler/*.ts` + CLI `scripts/src/crawl.ts`. Run discovery with `pnpm --filter @workspace/scripts run discover`; bounded crawl with `pnpm --filter @workspace/scripts run crawl -- --crawl --limit=N --no-browser`. Migration reports are written to `./reports/`.

## Read API (migration foundation)

All under `/api`. Slugs are the public identifier — internal UUIDs never appear in routing.
- `GET /posts` — paginated list; filters `?category=`, `?author=`, `?tag=` (slugs), `?page=`, `?limit=`.
- `GET /posts/{slug}` — full post: original/cleaned HTML, richText JSON, Payload-style componentTree, breadcrumbs, faq, images, seo, jsonld, categories, tags, author.
- `GET /categories`, `GET /categories/{slug}`, `GET /authors`, `GET /authors/{slug}`, `GET /search?q=`.

## Architecture decisions

- **DB connection uses the Supabase Session Pooler URL** (port 5432, `*.pooler.supabase.com`), not the direct `db.*.supabase.co` host which is IPv6-only and unreachable here. SSL uses `rejectUnauthorized:false` (pooler cert doesn't chain to a public CA); `drizzle.config.ts` appends `sslmode=no-verify` (NOT `require`).
- **Lossless page storage**: `pages` keeps `originalHtml`, `cleanedHtml`, `richText` (JSON) and `componentTree` (Payload-compatible nested blocks) so future parser changes never require recrawling.
- **No nested `/{slug}/posts` endpoints**: orval names the zod value and TS type identically for path+query operations (TS2308). "A category's posts" is served by `GET /posts?category={slug}` instead.
- **Schema push**: use `pnpm --filter @workspace/db run push-force` — interactive `push` hangs without a TTY.

## Product

- **Thanksgiving Family Destination Guide** (`artifacts/thanksgiving-guide`, served at `/`): a premium, fully responsive single-page editorial recreation of the Headout blog article "Thanksgiving Vacation Ideas for Families." Presentation-only (no backend). Covers 12 family destinations, each with a hero image, intro, restaurant list, and attractions list, plus a table of contents, author block, share links, newsletter CTA, and footer.
- Content is 100% preserved from the source article and centralized in `artifacts/thanksgiving-guide/src/data/content.ts` (the single source of truth). The UI components render that data verbatim — never edit copy in the components; edit `content.ts`.
- Destination images are hotlinked from `cdn-imgix.headout.com`; some `alt` values intentionally match the source's quirks and should not be "corrected."

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **`componentTree` has two shapes.** The crawler (`crawler/assemble.ts`) stores `pages.componentTree` as a top-level JSON **array** of blocks; the importer (`import/parse.ts`) stores a single root **object**. The `componentTree` field in `openapi.yaml` must stay a `oneOf` (object/array/null) or `GET /posts/{slug}` 500s on every crawler-ingested page. Regenerate zod after any contract change.
- **`GET /posts/{slug}` fires ~8 sequential DB queries.** Load-testing it at high concurrency against the Supabase session pooler (especially while the crawler runs) exhausts the pool and returns transient 500s. Verify functional correctness at low concurrency.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
