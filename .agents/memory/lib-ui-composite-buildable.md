---
name: lib/ui composite buildable
description: Why lib/ui can be a composite project-reference library and what makes chart.tsx/input-otp.tsx emit cleanly under @types/react 19.2.
---

# lib/ui as a composite buildable library

`lib/ui` (the shared shadcn design system extracted from the blog) is composite
(`composite/declarationMap/emitDeclarationOnly`, emits `dist`), listed in root
`tsconfig.json` references, and built by `tsc --build` (root `typecheck:libs`).
It is NOT in the root `typecheck` script's `--filter` list and has no standalone
`typecheck` package script — same shape as every other composite lib.

**Why it works without a version bump:** the two shadcn files that historically
fail composite emit under the `@types/react@19.2` workspace override —
`chart.tsx` and `input-otp.tsx` — only need behavior-preserving *type-only*
fixes, not a recharts/@types/react change:
- `chart.tsx`: replace `React.ComponentProps<typeof RechartsPrimitive.Tooltip>`
  with an explicit prop object (`active?`, `payload?: any[]`, `label?: any`,
  `labelFormatter`, `formatter`, …). `typeof Tooltip` is a class that doesn't
  satisfy `JSXElementConstructor` under 19.2, which cascades into TS2339 on every
  destructured prop.
- `input-otp.tsx`: cast `OTPInputContext` to a concrete `{ slots: … }` shape
  instead of leaving it `unknown` (TS18046).

**Gotcha — the CMS keeps its own UNFIXED duplicates.** `artifacts/cms/src/components/ui/chart.tsx`
and `input-otp.tsx` are separate copies that still use the old
`ComponentProps<typeof Tooltip>` / `unknown` context patterns, so
`pnpm --filter @workspace/cms run typecheck` (and thus the full `pnpm run typecheck`)
fails — this is PRE-EXISTING and independent of lib/ui. The real fix is to make
the CMS consume `@workspace/ui` (as the blog does) rather than re-fixing the dups.
