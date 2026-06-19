# Memory index

- [Stale workflow-supervisor env](stale-workflow-env.md) — a deleted secret can linger in a long-running workflow process and re-inherit across restarts; only a full workspace reload clears it. Don't let implicit env precedence hijack connections.
- [drizzle-kit push on Replit Helium Postgres](drizzle-push-helium.md) — `push` silently dies during "Pulling schema"; use `generate` SQL then apply via executeSql.
- [Drizzle CASE → pgEnum cast](drizzle-enum-case-cast.md) — assigning a `sql` CASE/expression to an enum column needs `::<enum>`; bare literals coerce but CASE results are text (crashed crawler markFailed on first retry-exhausted page).
- [Crawler NUL/binary write-sink crash](crawler-write-sink-nul.md) — one binary response can abort the whole crawl via uncaught throws on the error path; make every text sink NUL-safe and error-logging non-fatal; keep assets out of the frontier.
- [pages-table bulk read OOM](pages-table-bulk-read-oom.md) — `original_html` (~500MB) dominates the pages table; batch jobs must project columns, never `select(*)`, or they OOM the Node heap.
