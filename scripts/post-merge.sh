#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push-force
# Re-create the CMS-search prerequisites (pg_trgm extension + 18 trigram GIN
# indexes). These are NOT in any drizzle migration journal, so a dev DB
# rollback/restore wipes them; this step is idempotent and self-heals them.
pnpm --filter @workspace/scripts run ensure:search-indexes
# Re-create the page-view analytics table + indexes. Like the search indexes
# above, these are NOT in any drizzle migration journal, so a dev DB
# rollback/restore wipes them; this step is idempotent and self-heals them.
pnpm --filter @workspace/scripts run ensure:analytics
