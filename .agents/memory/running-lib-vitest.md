---
name: Running lib unit tests in this monorepo
description: How to actually run a lib's vitest tests; per-package filter does not work
---

Root `vitest.config.ts` owns the only working test setup; its `include` is
`lib/**/src/**/*.test.ts` (+ scripts/api-server/blog/cms/mobile-hooks globs).

**Rule:** run lib tests from the repo ROOT with an explicit path —
`pnpm exec vitest run lib/<pkg>/src/__tests__/<file>.test.ts`.

**Why:** two dead ends waste time otherwise:
- `pnpm --filter @workspace/<lib> run test` often succeeds with NO output because the
  lib has no `test` script — it runs nothing and exits 0 (false "tests pass").
- `pnpm --filter @workspace/<lib> exec vitest run` (or any vitest invoked with the
  package as cwd) reports "No test files found" — it does not pick up the root config's
  include, so it looks in the wrong place.

**How to apply:** when asked to verify a lib's unit tests, always invoke vitest from the
root with the test file path; never trust a silent `run test`. New lib test files belong
under `lib/<pkg>/src/__tests__/`.
