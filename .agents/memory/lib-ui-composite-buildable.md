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
override). But several of its deps declare `@types/react` only as an *optional*
peer and, with `.npmrc auto-install-peers=false`, pnpm leaves that peer
**uninjected** for them (lockfile shows e.g. `react-day-picker@…(react@19.1.0)`
with no `@types/react` in the variant key). Affected: `react-day-picker`,
`lucide-react`, `input-otp`, `react-hook-form`, `react-resizable-panels` (and
`vaul`/`cmdk` partially). When `tsc` compiles those `.d.ts` inside `lib/ui`,
their `import "react"` falls back to the **hoisted** `@types/react`.

The hoisted version is non-deterministic: the global override pins everything to
19.2.x EXCEPT the mobile scoped override (`@workspace/thanksgiving-mobile>@types/react: ~19.1.10`),
so 19.1.17 also exists, and **any `pnpm install` can flip which one lands in
`node_modules/.pnpm/node_modules/@types/react`**. When it flips to 19.1.17, it
no longer matches `lib/ui`'s own 19.2.14 → two unrelated `@types/react`
identities → declaration emit fails with `TS2742` ("cannot be named without a
reference to .pnpm/@types+react@19.1.17") across many components (command,
drawer, form, input-otp, resizable, …) plus `TS2322` ref mismatches in
`calendar.tsx`/`spinner.tsx`. This stays latent because `tsc --build` caches a
green `lib/ui/tsconfig.tsbuildinfo`; the next install invalidates the cache and
the failure surfaces all at once.

**Fix (durable):** a `paths` redirect in `lib/ui/tsconfig.json` forcing
`react` / `react/jsx-runtime` / `react/jsx-dev-runtime` / `react-dom` to
`lib/ui`'s own `./node_modules/@types/react(-dom)` symlink (which points at
19.2.x). Because `paths` is program-wide, every dependency `.d.ts` then resolves
`react` to the SAME identity, killing all the TS2742/TS2322 regardless of which
version is hoisted. Same single-identity trick as the `scripts`→`drizzle-orm`
`paths` redirect documented in `replit.md`.
**Why prefer this over per-file casts:** the cast/annotation approach is
whack-a-mole (every exported component needs an explicit type) and `input-otp`'s
forwardRef typing *still* failed; the `paths` redirect is one principled change.
Do NOT try to "fix" this by regenerating the lockfile to re-hoist 19.2.x — it's
not reliably reproducible and a clean reinstall here exceeds the 120s bash cap.

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
