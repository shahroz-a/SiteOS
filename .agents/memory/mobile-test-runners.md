---
name: thanksgiving-mobile test-runner split
description: How mobile tests are split across jest vs vitest, scoped by config so neither picks up the other's files
---

The `thanksgiving-mobile` package has two test styles, each run under its own
runner. The runner configs are scoped so they no longer overlap (each runner
only sees its own files):

- `artifacts/thanksgiving-mobile/__tests__/*.test.tsx` are **jest + @testing-library/react-native** tests (use `jest.mock`, render RN components). Run them with `pnpm --filter @workspace/thanksgiving-mobile run test` (jest). Jest is scoped via `roots`/`testMatch` (`<rootDir>/__tests__/**`) so it does NOT pick up `hooks/__tests__`.
- `artifacts/thanksgiving-mobile/hooks/__tests__/*.test.tsx` are **vitest node** tests (`import { ... } from "vitest"`, `@vitest-environment node`). Run them with root `pnpm exec vitest run`. The root `vitest.config.ts` include is scoped to `artifacts/thanksgiving-mobile/hooks/**/*.test.{ts,tsx}` so vitest does NOT pick up the jest RTL test.

**Why the scoping matters:** before scoping, jest's `**/__tests__/**` glob also
grabbed the vitest hooks file (parse error: `await is only valid in async
functions`) and vitest's `**/*.test.{ts,tsx}` glob grabbed the jest RTL file
(parse error: `Unexpected token 'typeof'`). Each cross-runner pickup produced a
failed suite, so the test command could never be a clean green signal.

**How to apply:** keep jest's `roots`/`testMatch` pinned to `<rootDir>/__tests__`
and the vitest mobile include pinned to the `hooks/` subtree. If you add a new
hook-logic test put it under `hooks/__tests__`; if you add a component/screen
render test put it under the top-level `__tests__`. Do not widen either glob back
to a shared `**/__tests__/**` pattern or the cross-runner failures return.

**Gotcha — top-level await in vitest hook tests:** dynamic `await import("../useFavorites")`
must stay inside an async context (e.g. `beforeAll`), NOT at module top level.
A static import would run before the in-file AsyncStorage mock consts are
defined (ESM import hoisting), breaking vitest's hoisted `vi.mock` factory; a
top-level `await import` makes the file unparseable by babel. `beforeAll(async …)`
runs after the const mocks and needs no top-level await.

**Note — swipe-to-remove render gap:** the swipe-to-remove collection test in
`favorites.test.tsx` can fail under jest because `ReorderableList`/
`ReanimatedSwipeable` don't render their inline remove button in the test env —
that is a separate gesture-rendering issue, not a runner-split problem.
