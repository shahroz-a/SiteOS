---
name: CMS vendored shadcn typecheck baseline
description: artifacts/cms has pre-existing tsc errors in vendored shadcn UI files, unrelated to feature work.
---

`pnpm --filter @workspace/cms run typecheck` (i.e. `tsc -p tsconfig.json --noEmit`)
emits pre-existing errors in vendored shadcn components that are NOT caused by
typical feature work:
- `src/components/ui/chart.tsx` — recharts `Tooltip` JSX-constructor + payload prop errors (TS2344/TS2339/TS7006)
- `src/components/ui/input-otp.tsx` — `inputOTPContext` is `unknown` (TS18046)
- `src/pages/held-back.tsx` — imports `@/components/ui/{badge,table,skeleton}` which were never vendored into cms (TS2307); the held-back review-queue screen shipped referencing UI primitives that don't exist in `artifacts/cms/src/components/ui/`. Pre-existing, unrelated to scripts/db work.

Also (separately): the **media library + import/export** pages
(`src/pages/media.tsx`, `src/pages/import-export.tsx`, `src/components/media-*.tsx`)
import from a NON-EXISTENT vendored `@/components/ui/*` dir (the CMS migrated UI
to `@workspace/ui/*` — see `users.tsx`/`audit-log.tsx`) AND reference api-client
exports that don't exist (`MediaItem`, `useListCmsMedia`, `getListCmsMediaQueryKey`,
`MediaAltStatus`). Because `App.tsx` imports these pages EAGERLY, the whole CMS
**dev bundle fails to load** (Vite overlay + 500s) until those pages are
completed. This is in-progress media work, not yours. When editing other CMS
pages, fix only your file's imports to `@workspace/ui/*`; don't get pulled into
completing the media feature. `@workspace/ui/*` maps to `lib/ui/src/components/*`.

**Why:** these ship with the shadcn scaffold and the recharts/@types/react
versions in this repo; they predate individual features.

**How to apply:** before assuming your change broke the cms typecheck, run a
baseline by temporarily moving your new/edited files aside (or filter the output
with `rg -v "chart.tsx|input-otp.tsx"`). If only those two files remain, your
code is clean. Don't "fix" these vendored files as part of unrelated work.

Also: the full-repo `pnpm run typecheck` and full `vitest run` can be SIGKILLed
(exit -1, no output) from the bash tool — run per-package typechecks and
targeted test files instead; bump `NODE_OPTIONS=--max-old-space-size=4096` for
the cms tsc.
