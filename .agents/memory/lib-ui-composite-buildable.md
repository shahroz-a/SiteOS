---
name: lib/ui composite buildable
description: Why lib/ui can be a composite project-reference library and how its declaration emit is kept stable against the hoisted @types/react flipping to mobile's 19.1.x.
---

# lib/ui as a composite buildable library

`lib/ui` (the shared shadcn design system extracted from the blog) is composite
(`composite/declarationMap/emitDeclarationOnly`, emits `dist`), listed in root
`tsconfig.json` references, and built by `tsc --build` (root `typecheck:libs`).
It is NOT in the root `typecheck` script's `--filter` list and has no standalone
`typecheck` package script — same shape as every other composite lib.

## The dual `@types/react` identity hazard (the important one)

`lib/ui` resolves its own `@types/react` to the workspace 19.2.x (via the global
override). The hazard is a handful of its React-typed deps that **do not declare
`@types/react` as a peer at all** — `react-day-picker`, `lucide-react`,
`input-otp`, `react-hook-form`, `react-resizable-panels`. (NB: `@radix-ui/*`,
`vaul`, `cmdk` DO declare the optional peer, so pnpm resolves it from the
consuming lib and pins a `…(@types/react@19.2.14)…` variant — they were never the
problem.) Because the five no-peer packages declare nothing, pnpm creates no
variant; their bundled `.d.ts` `import "react"` falls back to whichever
`@types/react` is **hoisted** into `node_modules/.pnpm/node_modules/@types/react`.

The hoisted version is non-deterministic: the global override pins everything to
19.2.x EXCEPT the mobile scoped override (`@workspace/thanksgiving-mobile>@types/react: ~19.1.10`),
so 19.1.17 also exists, and **any `pnpm install` can flip which one lands in the
hoist slot**. When it flips to 19.1.17, it no longer matches `lib/ui`'s own
19.2.14 → two unrelated `@types/react` identities → declaration emit fails with
`TS2742` across many components (command, drawer, form, input-otp, resizable, …)
plus `TS2322` ref mismatches. This stays latent because `tsc --build` caches a
green `lib/ui/tsconfig.tsbuildinfo`; the next install invalidates the cache and
the failure surfaces all at once.

**Fix (durable, workspace-level):** a `packageExtensions` block in
`pnpm-workspace.yaml` that declares `@types/react` (and `@types/react-dom` for
`input-otp`/`react-resizable-panels`) as an **optional peer** on those five
packages. pnpm then resolves the peer from the consuming package — lib/ui
provides 19.2.x — and pins a deterministic `react-day-picker@…(@types/react@19.2.14)…`
variant into the lockfile, exactly how `@radix-ui/*` already stay stable. The
hoist slot becomes irrelevant for these deps, so the failure can no longer flip
in. Verified: stable across repeated `pnpm install`, and `tsc --build --force`
emits clean WITHOUT any `lib/ui` `paths` redirect (that earlier per-lib workaround
was removed — `packageExtensions` is the single source of truth now).
**`auto-install-peers=true` does NOT fix this** — it only auto-installs
*non-optional, undeclared* peers; an optional peer (or, here, a peer the package
never declares) is skipped, so it just re-rolls the non-deterministic hoist.
**Maintenance:** if a NEW React-typed dep that does not declare an `@types/react`
peer is added to lib/ui (or any composite lib), add it to that
`packageExtensions` block — otherwise it reintroduces the hoist fallback.

## chart.tsx / input-otp.tsx type-only fixes (still needed independently)

These two also need behavior-preserving *type-only* fixes that are unrelated to
the hoist:
- `chart.tsx`: replace `React.ComponentProps<typeof RechartsPrimitive.Tooltip>`
  with an explicit prop object (`active?`, `payload?: any[]`, `label?: any`,
  `labelFormatter`, `formatter`, …) — `typeof Tooltip` is a class that doesn't
  satisfy `JSXElementConstructor`, cascading TS2339 on every destructured prop.
- `input-otp.tsx`: cast `OTPInputContext` to a concrete `{ slots: … }` shape
  instead of leaving it `unknown` (TS18046).

## CMS now consumes @workspace/ui (no more dup copies)

`artifacts/cms` previously kept its own UNFIXED duplicate `components/ui/*`
(plus `lib/utils`, `hooks/use-toast`, `hooks/use-mobile`). These are removed;
the CMS imports primitives from `@workspace/ui`, `cn`/`useToast`/`toast` from the
`@workspace/ui` barrel, and its `index.css` `@import`s `lib/ui/src/styles/theme.css`
with `@source "../../../lib/ui/src"` for Tailwind v4 class scanning (same shape
as the blog). CMS is a leaf (`noEmit`) so it never hit TS2742 itself.
