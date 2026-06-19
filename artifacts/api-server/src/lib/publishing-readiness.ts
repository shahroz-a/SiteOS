import {
  db,
  checkPublishingReadiness,
  type PublishingReadiness,
} from "@workspace/db";
import { logger } from "./logger";

export type { PublishingReadiness };

/**
 * Probe the database for the CMS publishing/scheduling prerequisites (the
 * `page_status` enum values `review`/`scheduled` + the `pages.scheduled_for`
 * column) and emit a structured log line describing the result.
 *
 * Production gets these shapes only via a re-publish (the dev→prod schema diff),
 * and the agent cannot run DDL against prod — so a publish that fails to apply
 * them leaves CMS publishing/scheduling silently broken until an editor tries to
 * move a post to review/scheduled and hits a 500. This probe surfaces the
 * problem proactively in the deployment logs (mirrors `probeAnalyticsReadiness`).
 *
 * It never throws: a connection or query error is logged and reported as `null`
 * so a transient DB hiccup at boot can never crash the server.
 */
export async function probePublishingReadiness(): Promise<PublishingReadiness | null> {
  let readiness: PublishingReadiness;
  try {
    readiness = await checkPublishingReadiness(db);
  } catch (err) {
    logger.error(
      { err },
      "Could not verify CMS publishing readiness (database probe failed); publishing/scheduling may not work",
    );
    return null;
  }

  if (readiness.ready) {
    logger.info(
      {
        statusValues: readiness.presentStatusValues,
        scheduledForColumnPresent: readiness.scheduledForColumnPresent,
      },
      "CMS publishing prerequisites present (page_status review/scheduled + pages.scheduled_for)",
    );
    return readiness;
  }

  logger.warn(
    {
      missingStatusValues: readiness.missingStatusValues,
      scheduledForColumnPresent: readiness.scheduledForColumnPresent,
      remedy:
        "run `pnpm --filter @workspace/scripts run ensure:publishing` (dev) or re-publish (prod)",
    },
    "CMS publishing/scheduling is NOT fully set up: missing prerequisites — moving a post to review/scheduled will fail until they are created",
  );
  return readiness;
}
