import { db, checkSearchReadiness, type SearchReadiness } from "@workspace/db";
import { logger } from "./logger";

export type { SearchReadiness };

/**
 * Probe the database for the CMS-search prerequisites (`pg_trgm` extension +
 * trigram GIN indexes) and emit a structured log line describing the result.
 *
 * Production gets these objects only via a re-publish (the dev→prod schema
 * diff), and the agent cannot run DDL against prod — so a publish that fails to
 * create `pg_trgm` leaves CMS Search silently broken until a staff member hits a
 * 500. This probe surfaces the problem proactively in the deployment logs.
 *
 * It never throws: a connection or query error is logged and reported as
 * `null` so a transient DB hiccup at boot can never crash the server.
 */
export async function probeSearchReadiness(): Promise<SearchReadiness | null> {
  let readiness: SearchReadiness;
  try {
    readiness = await checkSearchReadiness(db);
  } catch (err) {
    logger.error(
      { err },
      "Could not verify CMS search readiness (database probe failed); CMS Search may not work",
    );
    return null;
  }

  if (readiness.ready) {
    logger.info(
      {
        trigramIndexes: readiness.expectedIndexCount,
      },
      "CMS search prerequisites present (pg_trgm extension + all trigram indexes)",
    );
    return readiness;
  }

  logger.warn(
    {
      extensionPresent: readiness.extensionPresent,
      missingIndexes: readiness.missingIndexes,
      missingIndexCount: readiness.missingIndexes.length,
      expectedIndexCount: readiness.expectedIndexCount,
      remedy: readiness.extensionPresent
        ? "run `pnpm --filter @workspace/scripts run ensure:search-indexes` (dev) or re-publish (prod)"
        : "the `pg_trgm` extension is missing — re-publish so the dev→prod diff installs it, then verify it exists on prod; in dev run `ensure:search-indexes`",
    },
    "CMS search is NOT fully set up: missing prerequisites — `/cms/search` will fail until they are created",
  );
  return readiness;
}
