---
name: Mobile (Expo) React hook test harness
description: How to unit-test Expo/React-Native hooks under the repo's node vitest, and gotchas hit along the way.
---

Testing a React hook from the `thanksgiving-mobile` Expo artifact under the repo's single root vitest:

- **Renderer: `react-test-renderer`, not a DOM lib.** `happy-dom`/`jsdom` tarballs are blocked by the package firewall here (403 "No authorization header"), and `@testing-library/react` needs a DOM env + `@testing-library/dom` peer. `react-test-renderer` (pin to the artifact's React version, e.g. `19.1.0`, plus `@types/react-test-renderer`) runs in vitest's default `environment: "node"` with no DOM. Drive state via its `act`, capture the hook value with a `Probe` child that calls the hook and assigns to an outer var exposed through a getter (so it always reflects the latest render).
- **esbuild JSX must be automatic.** The root `vitest.config.ts` needed `esbuild: { jsx: "automatic" }`; without it `.tsx` compiles to classic `React.createElement` and the provider throws `ReferenceError: React is not defined` (the source uses the automatic runtime, no `import React`). Also add the mobile glob to `test.include`.
- **Mock AsyncStorage with an in-memory Map** via `vi.mock("@react-native-async-storage/async-storage", () => ({ default: {getItem,setItem,removeItem} }))` — the real module is a native module. This exercises the hydrate-on-mount and persist-on-change effects.
- **Effect timing:** wrap the initial `create()` in `await act(async () => …)` so the async hydrate IIFE resolves (sets the `hydrated`/`collectionsHydrated` refs) before assertions; the persist effects are guarded on those refs so no write happens during hydration.

**Why:** future mobile hook tests should reuse this harness instead of rediscovering the firewall/JSX/native-module pitfalls.

## Gotcha: setState-updater return values are stale synchronously
`useFavorites.toggleFavorite` returns a boolean computed *inside* the `setFavorites` updater. React does not run that updater synchronously, so the function's synchronous return is stale (in tests it returns the initial value, not the post-toggle state). Both app call sites ignore the return, so it's a soft contract. Assert the **observable resulting state** (`isFavorite`, membership) after `act`, not the synchronous return value.
