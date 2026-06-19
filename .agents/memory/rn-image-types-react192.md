---
name: react-native Image vs @types/react 19.2 typecheck failure
description: Pre-existing mobile typecheck failure on react-native Image under @types/react 19.2.x.
---

# `thanksgiving-mobile` typecheck fails on `<Image>` (react-native) under @types/react 19.2.x

`pnpm --filter @workspace/thanksgiving-mobile run typecheck` errors with
`'Image' cannot be used as a JSX component` / `TS2607` / `Type 'Image' is missing the
following properties from type 'Component<any, any, any>': context, setState,
forceUpdate, props, state` in mobile components that render react-native `<Image>`.

**Why:** react-native@0.81's class-component `Image` declaration is incompatible with
the stricter `React.Component` shape in `@types/react@19.2.x`. The workspace
`overrides` pin (`@types/react -> ^19.2.0`, in `pnpm-workspace.yaml`) forces mobile to
19.2.x, which is what surfaces this. It is **not** a duplicate-`@types/react` problem —
removing the stale `@types+react@19.1.17` store orphan does not change it, and mobile +
react-native both resolve the single `@types+react@19.2.14` copy.

**How to apply:** this is pre-existing and independent of the blog/web libs. Don't
chase it while doing blog/web work. The documented mobile verification path
(`expo export --platform web`) still bundles the app; only the strict `tsc` check trips.
A real fix would mean pinning mobile's `@types/react` lower or patching RN's types —
out of scope for web changes.
