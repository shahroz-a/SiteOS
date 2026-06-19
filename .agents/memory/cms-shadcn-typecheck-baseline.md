---
name: CMS UI import convention + typecheck baseline
description: artifacts/cms imports shared UI from @workspace/ui; some files wrongly use @/components/ui/* and fail TS2307 pre-existing.
---

`pnpm --filter @workspace/cms run typecheck` (i.e. `tsc -p tsconfig.json --noEmit`)
emits pre-existing errors in vendored shadcn components that are NOT caused by
typical feature work:
- `src/components/ui/chart.tsx` — recharts `Tooltip` JSX-constructor + payload prop errors (TS2344/TS2339/TS7006)
- `src/components/ui/input-otp.tsx` — `inputOTPContext` is `unknown` (TS18046)
- `src/pages/held-back.tsx` — imports `@/components/ui/{badge,table,skeleton}` which were never vendored into cms (TS2307); the held-back review-queue screen shipped referencing UI primitives that don't exist in `artifacts/cms/src/components/ui/`. Pre-existing, unrelated to scripts/db work.

The CMS shares its UI primitives from the `@workspace/ui` lib (lib/ui), NOT a
local `src/components/ui/` dir — that directory does NOT exist on disk. The
correct import forms (see `App.tsx`, `pages/users.tsx`, `pages/home.tsx`):
- components: `@workspace/ui/<name>` (e.g. `@workspace/ui/sheet`, `/textarea`, `/label`, `/spinner`)
- `cn`: `@workspace/ui/lib/utils`
- toast hook: `import { useToast } from "@workspace/ui"`

**Pre-existing breakage:** several CMS files were authored with the wrong
`@/components/ui/*` (and `@/lib/utils`, `@/hooks/use-toast`) convention and fail
`pnpm --filter @workspace/cms run typecheck` with TS2307 "Cannot find module".
Because `App.tsx` imports these pages EAGERLY, a broken page can take down the
whole CMS dev bundle (Vite overlay + 500s) until fixed. The media-feature files
(`media-details-sheet.tsx`, `media-grid.tsx`, `media-picker.tsx`, `pages/media.tsx`)
shared the same bug and were corrected to `@workspace/ui/*`. Still-broken as of
this writing: `src/pages/held-back.tsx` and `src/pages/import-export.tsx`.
When editing a CMS page, fix only your file's imports to `@workspace/ui/*`;
don't get pulled into completing unrelated in-progress pages.

**Why:** `tsconfig`/vite only alias `@` → `src`; there is no path for
`@/components/ui`. So `@/components/ui/x` resolves nowhere. Real local files
like `@/lib/media-utils` and `@/components/media-grid` DO exist and resolve.

**How to apply:** before assuming your change broke the cms typecheck, filter
the output to your files (or `rg -v "held-back.tsx|import-export.tsx"`). When
adding shared-UI imports, always use `@workspace/ui/*`, never `@/components/ui/*`.
Don't "fix" the unrelated held-back/import-export files as part of unrelated work
(they may be owned by sibling tasks).

Also: the full-repo `pnpm run typecheck` and full `vitest run` can be SIGKILLed
(exit -1, no output) from the bash tool — run per-package typechecks and
targeted test files instead.
