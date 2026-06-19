/**
 * Self-healing setup for the CMS publishing & scheduling schema shapes.
 *
 * The publishing lifecycle relies on two Postgres schema additions that are NOT
 * reliably part of any drizzle migration journal:
 *   1. the `page_status` enum values `review` and `scheduled`
 *      (`lib/db/src/schema/enums.ts`), and
 *   2. the `pages.scheduled_for` column + its `pages_scheduled_for_idx` index
 *      (`lib/db/src/schema/pages.ts`).
 *
 * `drizzle-kit push` is broken on Helium (it silently dies during the
 * introspection step), so these shapes were originally applied to the dev DB as
 * one-off raw SQL. That means a dev DB rollback / checkpoint restore — or a
 * fresh DB — can wipe them while leaving the rest of the schema intact, and CMS
 * publishing/scheduling starts failing with no obvious cause (an enum value or a
 * column no longer exists).
 *
 * This script re-applies the enum values and the column + index idempotently
 * (`ALTER TYPE … ADD VALUE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` /
 * `CREATE INDEX IF NOT EXISTS`) so a rollback or fresh DB self-heals. The
 * definitions are kept in lockstep with the drizzle schema — including the enum
 * ordering (review/scheduled inserted before `published`) and the column type
 * (`timestamp with time zone`) — so the publish-time dev→prod diff stays clean.
 *
 * Run with: pnpm --filter @workspace/scripts run ensure:publishing
 * It also runs automatically via the post-merge setup script.
 *
 * NOTE: this only ensures the DEVELOPMENT database. Production schema is applied
 * by Replit's Publish flow, which diffs the dev DB against prod and applies the
 * difference — so re-publish after this runs to get these shapes into prod.
 */
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";

/**
 * Minimal executor surface shared by the global `db` and a transaction handle.
 * Threading this through lets the self-heal run against an injected transaction
 * (e.g. a rolled-back one in tests) instead of only the global connection.
 */
export type Executor = Pick<typeof db, "execute">;

// Enum values to ensure on `page_status`, in lockstep with
// `lib/db/src/schema/enums.ts`: draft, review, scheduled, published, archived.
// Each value is inserted BEFORE `published` so the enum ordering matches a fresh
// schema create (review, then scheduled, both ahead of published). `ALTER TYPE
// … ADD VALUE` is run with IF NOT EXISTS, so a re-run is a no-op; the no-op form
// is safe inside a transaction (only *using* a newly-added value in the same
// transaction is disallowed).
const ENUM_VALUES: Array<{ value: string; before: string }> = [
  { value: "review", before: "published" },
  { value: "scheduled", before: "published" },
];

export async function ensurePublishingShapes(
  log: (m: string) => void = console.log,
  executor: Executor = db,
): Promise<void> {
  log("Ensuring page_status enum has review/scheduled values…");
  for (const { value, before } of ENUM_VALUES) {
    const existed = await enumValueExists(executor, "page_status", value);
    // Static identifiers from this source file (never user input). ADD VALUE
    // can't be parameterized; IF NOT EXISTS makes the re-run a no-op.
    await executor.execute(
      sql.raw(
        `ALTER TYPE "page_status" ADD VALUE IF NOT EXISTS '${value}' BEFORE '${before}'`,
      ),
    );
    if (existed) {
      log(`  page_status already has '${value}'.`);
    } else {
      log(`  + added page_status value '${value}'`);
    }
  }

  log("Ensuring pages.scheduled_for column exists…");
  const columnExisted = await columnExists(executor, "pages", "scheduled_for");
  // Static DDL — column type matches lib/db/src/schema/pages.ts
  // (`timestamp with time zone`) so the publish-time dev→prod diff is a no-op.
  await executor.execute(
    sql.raw(
      `ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "scheduled_for" timestamp with time zone`,
    ),
  );
  log(
    columnExisted
      ? "  pages.scheduled_for already present."
      : "  + added pages.scheduled_for",
  );

  log("Ensuring pages_scheduled_for_idx index exists…");
  const indexExisted = await indexExists(executor, "pages_scheduled_for_idx");
  await executor.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS pages_scheduled_for_idx ON pages (scheduled_for)`,
    ),
  );
  log(
    indexExisted
      ? "  pages_scheduled_for_idx already present."
      : "  + created pages_scheduled_for_idx",
  );

  log("Publishing/scheduling schema shapes ready.");
}

async function enumValueExists(
  executor: Executor,
  enumName: string,
  value: string,
): Promise<boolean> {
  const result = await executor.execute(
    sql`SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = ${enumName} AND e.enumlabel = ${value}
        LIMIT 1`,
  );
  return result.rows.length > 0;
}

async function columnExists(
  executor: Executor,
  table: string,
  column: string,
): Promise<boolean> {
  const result = await executor.execute(
    sql`SELECT 1 FROM information_schema.columns
        WHERE table_name = ${table} AND column_name = ${column}
        LIMIT 1`,
  );
  return result.rows.length > 0;
}

async function indexExists(
  executor: Executor,
  name: string,
): Promise<boolean> {
  const result = await executor.execute(
    sql`SELECT 1 FROM pg_class WHERE relkind = 'i' AND relname = ${name} LIMIT 1`,
  );
  return result.rows.length > 0;
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("ensure-publishing-shapes.ts");

if (isMain) {
  ensurePublishingShapes()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Failed to ensure publishing schema shapes:", err);
      await pool.end();
      process.exit(1);
    });
}
