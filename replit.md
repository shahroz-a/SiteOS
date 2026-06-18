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

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

- **Thanksgiving Family Destination Guide** (`artifacts/thanksgiving-guide`, served at `/`): a premium, fully responsive single-page editorial recreation of the Headout blog article "Thanksgiving Vacation Ideas for Families." Presentation-only (no backend). Covers 12 family destinations, each with a hero image, intro, restaurant list, and attractions list, plus a table of contents, author block, share links, newsletter CTA, and footer.
- Content is 100% preserved from the source article and centralized in `artifacts/thanksgiving-guide/src/data/content.ts` (the single source of truth). The UI components render that data verbatim — never edit copy in the components; edit `content.ts`.
- Destination images are hotlinked from `cdn-imgix.headout.com`; some `alt` values intentionally match the source's quirks and should not be "corrected."

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
