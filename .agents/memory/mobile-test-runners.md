---
name: thanksgiving-mobile test-runner split
description: Why mobile tests fail under the "wrong" runner — jest vs vitest glob overlap
---

The `thanksgiving-mobile` package has two test styles that must each run under
their own runner, but the glob configs overlap so each runner also picks up
(and fails) the other's files. These failures are expected/pre-existing, not
regressions:

- `artifacts/thanksgiving-mobile/__tests__/*.test.tsx` are **jest + @testing-library/react-native** tests (use `jest.mock`, render RN components). Run them with `pnpm --filter @workspace/thanksgiving-mobile run test` (jest).
- `artifacts/thanksgiving-mobile/hooks/__tests__/*.test.tsx` are **vitest node** tests (`import { ... } from "vitest"`, top-level `await import`, `@vitest-environment node`). Run them with root `pnpm exec vitest run` (root `vitest.config.ts` includes `artifacts/thanksgiving-mobile/**/*.test.{ts,tsx}`).

Cross-runner symptoms to ignore:
- jest on the vitest file → `SyntaxError: await is only valid in async functions` (top-level await import).
- vitest on the RTL file → `SyntaxError: Unexpected token 'typeof'` / "0 test" (esbuild can't parse the RN/jest test).

**How to apply:** when verifying mobile changes, judge each test by its intended
runner. A jest-RTL suite failing under vitest (or vice-versa) is the glob
overlap, not your change. Verify component/screen render via jest
(`favorites.test.tsx`) and hook logic via vitest (`useFavorites.test.tsx`).
