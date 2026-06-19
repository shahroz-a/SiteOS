---
name: Expo (React Native) jest testing in this pnpm monorepo
description: How to run component/hook tests for the Expo mobile artifact, and the three non-obvious gotchas that block a naive jest-expo setup here.
---

The repo's root test runner is **vitest in node env** and cannot render React Native
components, so the Expo artifact is tested with its own **jest-expo** setup
(`artifacts/thanksgiving-mobile/jest.config.js` + `jest.setup.js`), run via
`pnpm --filter @workspace/thanksgiving-mobile test`. It is NOT part of root
`pnpm test` (vitest `include` doesn't cover the mobile artifact). Tests live in
`artifacts/thanksgiving-mobile/__tests__/`.

**Why a separate runner:** vitest/esbuild can't parse React Native's untranspiled
Flow source; jest-expo ships the RN/Expo babel transforms and native-module mocks.

Three gotchas that each cost a run to discover:

1. **transformIgnorePatterns must be pnpm-aware.** pnpm installs packages at
   `node_modules/.pnpm/<pkg>@ver/node_modules/<pkg>/...`, so the stock
   `node_modules/(?!react-native|...)` never matches and RN's own `jest/setup.js`
   fails with "Cannot use import statement outside a module". Fix: allow an optional
   `(\.pnpm/)?` segment before the package-name alternation. Scoped names appear as
   `@scope+name@ver` under `.pnpm`, but a prefix like `@react-native` still matches.

2. **`jest.mock()` factory may only close over vars prefixed `mock`** (case-insensitive).
   A module-level holder for a mocked hook's return value must be named
   `mockSomething`, or babel throws "module factory ... not allowed to reference
   any out-of-scope variables".

3. **The PostCard heart calls `e.stopPropagation()`.** `fireEvent.press(node)` passes
   no event, so you must pass a synthetic one:
   `fireEvent.press(node, { stopPropagation: jest.fn() })`. The detail-screen toggle
   has no such call and presses fine bare.

**Pattern for "Saved tab reflects a toggle":** render `<FavoritesProvider>` wrapping
both a standalone `PostCard` (the browse surface) and `<SavedScreen/>`. They share
context, so favoriting the standalone card makes SavedScreen render a *second* card
with the same `post-card-<slug>` / `favorite-toggle-<slug>` testID — assert via
`getAllByTestId(...).toHaveLength(2)` and the header "N article(s) bookmarked" text,
not `getByTestId` (which throws on duplicates).

**Persistence-across-restart** is simulated by toggling in one render tree, awaiting
the AsyncStorage write, `unmount()`, then mounting a fresh provider and asserting it
rehydrates. The `@react-native-async-storage/.../jest/async-storage-mock` store is a
process-level singleton, so it survives the unmount within one test; `clear()` it in
`beforeEach`.
