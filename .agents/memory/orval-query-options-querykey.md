---
name: Orval on-demand query options need queryKey
description: Passing `query` options to an orval-generated useX query hook requires queryKey, even just to set enabled:false
---

Orval generates each query hook with the options param typed as
`{ query?: UseQueryOptions<...> }`, and TanStack v5's `UseQueryOptions` makes
`queryKey` **required**. So any time you pass a `query` object — e.g. an
on-demand export that should not auto-run (`{ query: { enabled: false } }`) —
TS errors with TS2741 "Property 'queryKey' is missing" unless you also pass it.

**How to apply:** import and call the co-generated key helper, e.g.
`{ query: { enabled: false, queryKey: getExportCmsContentQueryKey(params) } }`.
Every query hook exports a matching `getXQueryKey()` (and `getXQueryOptions()`).
Trigger the fetch later with `.refetch()`.
