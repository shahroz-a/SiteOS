import { sql } from "drizzle-orm";
import type { SqlExecutor } from "./search-indexes";

export type { SqlExecutor };

/**
 * The Postgres objects the page-view analytics depend on but that are NOT part
 * of any drizzle migration journal (`drizzle-kit push` is broken on Helium, so
 * they were applied as one-off raw SQL):
 *   1. the raw event log table `page_views`,
 *   2. the daily rollup tables `page_view_daily` and `page_view_referrer_daily`,
 *   3. the analytics indexes listed below.
 *
 * These required shapes are declared here once and consumed by both the
 * api-server readiness probe (which only checks they exist) and stay in lockstep
 * with the self-healing setup script (`scripts/src/ensure-analytics.ts`, which
 * CREATEs them) AND the drizzle schema (`lib/db/src/schema/analytics.ts`).
 *
 * Production gets these objects only via a re-publish (the dev→prod schema
 * diff), so this readiness check surfaces a publish that failed to create them
 * instead of letting `POST /events/page-view` or `GET /cms/analytics` 500.
 */

/** Tables required for page-view analytics. */
export const ANALYTICS_TABLES: ReadonlyArray<string> = [
  "page_views",
  "page_view_daily",
  "page_view_referrer_daily",
];

/** Indexes required for page-view analytics (kept in lockstep with ensure-analytics.ts). */
export const ANALYTICS_INDEXES: ReadonlyArray<string> = [
  "page_views_page_idx",
  "page_views_viewed_at_idx",
  "page_views_slug_idx",
  "page_view_daily_day_idx",
  "page_view_daily_page_idx",
  "page_view_daily_slug_idx",
  "page_view_referrer_daily_day_idx",
];

export interface AnalyticsReadiness {
  /** Names of the analytics tables that are present. */
  presentTables: string[];
  /** Names of the analytics tables that are missing. */
  missingTables: string[];
  /** Total number of analytics indexes expected to exist. */
  expectedIndexCount: number;
  /** Names of the analytics indexes that are present. */
  presentIndexes: string[];
  /** Names of the analytics indexes that are missing. */
  missingIndexes: string[];
  /** True only when every table and index is present. */
  ready: boolean;
}

/**
 * Inspect the database for the page-view analytics prerequisites without
 * modifying anything. Side-effect free and safe to call at startup or from a
 * health route. Never throws for a missing object — only a genuine DB error
 * (e.g. connection failure) propagates.
 */
export async function checkAnalyticsReadiness(
  executor: SqlExecutor,
): Promise<AnalyticsReadiness> {
  const tables = [...ANALYTICS_TABLES];
  // `= ANY(${array})` mis-binds through drizzle (Postgres 42809); use an
  // explicit IN list built from individual bound params instead.
  const tableResult = await executor.execute(
    sql`SELECT relname FROM pg_class WHERE relkind = 'r' AND relname IN (${sql.join(
      tables.map((t) => sql`${t}`),
      sql`, `,
    )})`,
  );
  const presentTableSet = new Set(
    tableResult.rows.map((row) => String(row["relname"])),
  );
  const presentTables = tables.filter((t) => presentTableSet.has(t));
  const missingTables = tables.filter((t) => !presentTableSet.has(t));

  const indexes = [...ANALYTICS_INDEXES];
  const idxResult = await executor.execute(
    sql`SELECT relname FROM pg_class WHERE relkind = 'i' AND relname IN (${sql.join(
      indexes.map((n) => sql`${n}`),
      sql`, `,
    )})`,
  );
  const presentIndexSet = new Set(
    idxResult.rows.map((row) => String(row["relname"])),
  );
  const presentIndexes = indexes.filter((n) => presentIndexSet.has(n));
  const missingIndexes = indexes.filter((n) => !presentIndexSet.has(n));

  return {
    presentTables,
    missingTables,
    expectedIndexCount: indexes.length,
    presentIndexes,
    missingIndexes,
    ready: missingTables.length === 0 && missingIndexes.length === 0,
  };
}
