import { sql } from "drizzle-orm";
import type { SqlExecutor } from "./search-indexes";

export type { SqlExecutor };

/**
 * The Postgres schema shapes the CMS publishing & scheduling lifecycle depends
 * on but that are NOT reliably part of any drizzle migration journal:
 *   1. the `page_status` enum values `review` and `scheduled`
 *      (`lib/db/src/schema/enums.ts`), and
 *   2. the `pages.scheduled_for` column (`lib/db/src/schema/pages.ts`).
 *
 * These required shapes are declared here for the api-server readiness probe
 * (which only checks they exist). The self-healing setup script
 * (`scripts/src/ensure-publishing-shapes.ts`) CREATEs them with its own DDL —
 * keep this list in lockstep with that script AND the schema files
 * (`lib/db/src/schema/{enums,pages}.ts`).
 */

/** Enum values required on `page_status` for the publishing lifecycle. */
export const REQUIRED_PAGE_STATUS_VALUES: ReadonlyArray<string> = [
  "review",
  "scheduled",
];

/** Column required on `pages` for scheduling. */
export const SCHEDULED_FOR_COLUMN = {
  table: "pages",
  column: "scheduled_for",
} as const;

export interface PublishingReadiness {
  /** `page_status` enum values that are present (of the required set). */
  presentStatusValues: string[];
  /** `page_status` enum values that are missing (of the required set). */
  missingStatusValues: string[];
  /** Whether the `pages.scheduled_for` column exists. */
  scheduledForColumnPresent: boolean;
  /** True only when every required enum value and the column are present. */
  ready: boolean;
}

/**
 * Inspect the database for the CMS publishing/scheduling prerequisites without
 * modifying anything. Side-effect free and safe to call at startup or from a
 * health route. Never throws for a missing object — only a genuine DB error
 * (e.g. connection failure) propagates.
 */
export async function checkPublishingReadiness(
  executor: SqlExecutor,
): Promise<PublishingReadiness> {
  const required = [...REQUIRED_PAGE_STATUS_VALUES];
  // `= ANY(${array})` mis-binds through drizzle (Postgres 42809); use an
  // explicit IN list built from individual bound params instead.
  const enumResult = await executor.execute(
    sql`SELECT e.enumlabel AS enumlabel
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'page_status' AND e.enumlabel IN (${sql.join(
          required.map((v) => sql`${v}`),
          sql`, `,
        )})`,
  );
  const presentSet = new Set(
    enumResult.rows.map((row) => String(row["enumlabel"])),
  );
  const presentStatusValues = required.filter((v) => presentSet.has(v));
  const missingStatusValues = required.filter((v) => !presentSet.has(v));

  const columnResult = await executor.execute(
    sql`SELECT 1 FROM information_schema.columns
        WHERE table_name = ${SCHEDULED_FOR_COLUMN.table}
          AND column_name = ${SCHEDULED_FOR_COLUMN.column}
        LIMIT 1`,
  );
  const scheduledForColumnPresent = columnResult.rows.length > 0;

  return {
    presentStatusValues,
    missingStatusValues,
    scheduledForColumnPresent,
    ready: missingStatusValues.length === 0 && scheduledForColumnPresent,
  };
}
