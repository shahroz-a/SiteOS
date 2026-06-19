import {
  db,
  checkAnalyticsReadiness,
  type AnalyticsReadiness,
} from "@workspace/db";
import { logger } from "./logger";

export type { AnalyticsReadiness };

/**
 * Probe the database for the page-view analytics prerequisites (the
 * `page_views` raw event log, the `page_view_daily` / `page_view_referrer_daily`
 * rollup tables, and their indexes) and emit a structured log line describing
 * the result.
 *
 * Production gets these objects only via a re-publish (the dev→prod schema
 * diff), and the agent cannot run DDL against prod — so a publish that fails to
 * create them leaves page-view recording (`POST /events/page-view`) and the CMS
 * analytics screen (`GET /cms/analytics`) silently broken until they hit a 500.
 * This probe surfaces the problem proactively in the deployment logs (mirrors
 * `probeSearchReadiness` / `probePublishingReadiness`).
 *
 * It never throws: a connection or query error is logged and reported as `null`
 * so a transient DB hiccup at boot can never crash the server.
 */
export async function probeAnalyticsReadiness(): Promise<AnalyticsReadiness | null> {
  let readiness: AnalyticsReadiness;
  try {
    readiness = await checkAnalyticsReadiness(db);
  } catch (err) {
    logger.error(
      { err },
      "Could not verify page-view analytics readiness (database probe failed); analytics may not work",
    );
    return null;
  }

  if (readiness.ready) {
    logger.info(
      {
        tables: readiness.presentTables,
        analyticsIndexes: readiness.expectedIndexCount,
      },
      "Page-view analytics prerequisites present (page_views + rollup tables + indexes)",
    );
    return readiness;
  }

  logger.warn(
    {
      missingTables: readiness.missingTables,
      missingIndexes: readiness.missingIndexes,
      missingIndexCount: readiness.missingIndexes.length,
      expectedIndexCount: readiness.expectedIndexCount,
      remedy:
        "run `pnpm --filter @workspace/scripts run ensure:analytics` (dev) or re-publish (prod)",
    },
    "Page-view analytics is NOT fully set up: missing prerequisites — recording page views and the CMS analytics screen will fail until they are created",
  );
  return readiness;
}
