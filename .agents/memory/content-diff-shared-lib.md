---
name: Importer fidelity diff shared lib
description: Where the source-vs-parsed importer diff math lives and why both surfaces must consume it.
---

The importer fidelity diff (source HTML vs the parsed/imported content) is computed by `@workspace/content-diff` (`lib/content-diff`). It has three layers: pure block/word/URL diff math (`diff.ts`), DOM-free extraction from raw source HTML + parsed componentTree/richText (`extract.ts`), and a high-level `computeSourceDiff(input)` (`source-diff.ts`).

**Rule:** never reimplement the diff math in a surface. The web CMS (`artifacts/cms/src/components/source-diff.tsx`) and the mobile companion (`artifacts/thanksgiving-mobile`, source screen + `components/cms/SourceDiffView.tsx`) both import from `@workspace/content-diff`.

**Why:** the web SourceDiff originally did DOM extraction (querySelectorAll on rendered output), which can't run in React Native. Splitting the pure math into a shared lib lets both surfaces share identical block/URL alignment so the two diffs can't drift. The lib resolves to `./src/index.ts` source (no build step needed), so metro, vite, and vitest all consume it directly.

**How to apply:** if the fidelity diff needs a behavior change (new block kind, different URL normalization, etc.), edit `lib/content-diff` and let both surfaces inherit it. The lib's tsconfig needs `"dom"` in `lib` for the `URL` global even though it's DOM-free otherwise.
