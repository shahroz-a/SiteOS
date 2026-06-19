---
name: Codegen leaves composite lib dist stale for cross-package consumers
description: After api-spec codegen, packages that consume @workspace/api-client-react via project references see stale declarations until libs are rebuilt.
---

After `pnpm --filter @workspace/api-spec run codegen` regenerates
`lib/api-client-react/src/generated/*.ts`, a consumer that pulls the lib in
through a TS **project reference** (e.g. `artifacts/thanksgiving-mobile`'s
`tsconfig.json` `references: [{ path: "../../lib/api-client-react" }]`) resolves
the lib's emitted `dist/*.d.ts`, NOT the fresh source. The dist declarations are
stale, so newly-generated hooks/types (e.g. `useListCmsPostVersions`,
`useCompareCmsPostVersions`, `PageVersionSummary`) appear as TS2305 "no exported
member" even though they exist in source and older hooks from the same barrel
(e.g. `useGetCmsMe`) still resolve.

**Fix:** run `pnpm run typecheck:libs` (`tsc --build`) to refresh the lib's
`dist` declarations before typechecking the consuming artifact.

**Why:** replit.md claims codegen needs no follow-up `typecheck:libs`. That holds
for same-package use, but is false for cross-package consumers that read the
composite lib's emitted declarations.
