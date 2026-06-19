---
name: CMS vendored shadcn typecheck baseline
description: artifacts/cms has pre-existing tsc errors in vendored shadcn UI files, unrelated to feature work.
---

`pnpm --filter @workspace/cms run typecheck` (i.e. `tsc -p tsconfig.json --noEmit`)
emits pre-existing errors in vendored shadcn components that are NOT caused by
typical feature work:
- `src/components/ui/chart.tsx` — recharts `Tooltip` JSX-constructor + payload prop errors (TS2344/TS2339/TS7006)
- `src/components/ui/input-otp.tsx` — `inputOTPContext` is `unknown` (TS18046)

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
