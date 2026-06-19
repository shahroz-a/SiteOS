---
name: react-native class components vs @types/react 19.2 (RESOLVED)
description: Why mobile must stay on @types/react 19.1.x while web stays on 19.2.x, and the scoped-pnpm-override that keeps both green.
---

# react-native class components break under @types/react 19.2.x — pin mobile to 19.1.x

`react-native@0.81`'s class components (`Image`, `ImageBackground`, plus
expo-blur `BlurView`, expo-router `NativeTabs`, etc.) are typed with the
`Constructor<NativeMethods> & typeof XComponent` mixin pattern. Under a *single*
`@types/react@19.2.x` copy this fails to satisfy `JSXElementConstructor`
(`new(props, context) => Component<any,any>`): the instance type is reported
missing `context/setState/forceUpdate/props/state`, surfacing as
`'Image' cannot be used as a JSX component` / TS2607 / TS2786. It is **not** a
duplicate-`@types/react` problem — mobile and every RN package resolve the same
single copy; the version itself is the incompatibility. Knock-on effect: once the
component types are broken, prop-callback inference collapses too, producing
spurious TS7006/TS7031 implicit-`any` errors (e.g. `renderItem`/`onLayout`/
`onContentSizeChange`) that vanish once the types are fixed — don't "fix" those by
hand-annotating, fix the root types version.

**Fix (in `pnpm-workspace.yaml` `overrides`):** keep the global
`@types/react -> ^19.2.0` (web apps need it — see the duplicate-@types/react
gotcha in `replit.md`) but add a **scoped** override for the mobile subtree:

```
overrides:
  '@workspace/thanksgiving-mobile>@types/react': ~19.1.10
  '@workspace/thanksgiving-mobile>@types/react-dom': ~19.1.7
  '@types/react': ^19.2.0
  '@types/react-dom': ^19.2.0
```

The `parent>child` selector wins over the bare `@types/react` global for the
mobile dependency path only, so mobile + react-native + expo resolve 19.1.x while
blog/cms/mockup-sandbox keep 19.2.x.

**Why this is safe:** `pnpm install` will warn `unmet peer @types/react@^19.2.0:
found 19.1.17` for web's loose radix/react-remove-scroll deps because 19.1.17 is
now also hoisted — but those warnings are harmless. The web apps declare
`@types/react` 19.2.x directly (catalog + global override), so their `tsc`
resolves 19.2.14 and all web typechecks (incl. `button-group.tsx`/`calendar.tsx`)
still pass. Verified: full `pnpm run typecheck` exits 0 and mobile `expo export
--platform web` bundles clean. RN 0.81 peers `@types/react: ^19.1.0`, so 19.1.x is
its intended/expected version anyway.

**How to apply:** if mobile typecheck regresses on JSX class components after a
dependency bump, check the resolved `@types/react` under
`artifacts/thanksgiving-mobile/node_modules/@types/react` — it must be 19.1.x.
Don't drop the global 19.2.x override to "fix" mobile; that regresses the web apps.
