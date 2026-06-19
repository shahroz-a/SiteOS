#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push-force
# Re-create the page-view analytics table + indexes. These are NOT in any
# drizzle migration journal, so a dev DB
# rollback/restore wipes them; this step is idempotent and self-heals them.
pnpm --filter @workspace/scripts run ensure:analytics
# Re-apply the CMS publishing/scheduling schema shapes (page_status enum values
# review/scheduled + pages.scheduled_for column/index). Like the steps above,
# these are NOT reliably in any drizzle migration journal, so a dev DB
# rollback/restore can wipe them; this step is idempotent and self-heals them.
pnpm --filter @workspace/scripts run ensure:publishing
