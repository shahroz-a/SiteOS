/**
 * Self-healing setup for the page-view analytics storage.
 *
 * The `page_views` table (`lib/db/src/schema/analytics.ts`) and its three
 * indexes are NOT part of any drizzle migration journal. `drizzle-kit push` is
 * broken on Helium (it silently dies during the introspection step), so the
 * table was originally applied to the dev DB as one-off raw SQL. That means a
 * dev DB rollback / checkpoint restore — or a fresh DB — wipes it while leaving
 * the rest of the schema intact, and both `POST /events/page-view` and
 * `GET /cms/analytics` start failing with no obvious cause.
 *
 * This script re-creates the table and its indexes idempotently
 * (`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`) so a rollback or
 * fresh DB self-heals. The DDL is kept in lockstep with the drizzle schema in
 * `lib/db/src/schema/analytics.ts` — including the foreign-key constraint name
 * drizzle generates (`page_views_page_id_pages_id_fk`) so the publish-time
 * dev→prod schema diff stays clean.
 *
 * Run with: pnpm --filter @workspace/scripts run ensure:analytics
 * It also runs automatically via the post-merge setup script.
 *
 * NOTE: this only ensures the DEVELOPMENT database. Production schema is applied
 * by Replit's Publish flow, which diffs the dev DB against prod and applies the
 * difference — so re-publish after this runs to get `page_views` into prod.
 */
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";

const INDEXES: Array<{ name: string; ddl: string }> = [
  {
    name: "page_views_page_idx",
    ddl: "CREATE INDEX IF NOT EXISTS page_views_page_idx ON page_views (page_id)",
  },
  {
    name: "page_views_viewed_at_idx",
    ddl: "CREATE INDEX IF NOT EXISTS page_views_viewed_at_idx ON page_views (viewed_at)",
  },
  {
    name: "page_views_slug_idx",
    ddl: "CREATE INDEX IF NOT EXISTS page_views_slug_idx ON page_views (slug)",
  },
  {
    name: "page_view_daily_day_idx",
    ddl: "CREATE INDEX IF NOT EXISTS page_view_daily_day_idx ON page_view_daily (day)",
  },
  {
    name: "page_view_daily_page_idx",
    ddl: "CREATE INDEX IF NOT EXISTS page_view_daily_page_idx ON page_view_daily (page_id)",
  },
  {
    name: "page_view_daily_slug_idx",
    ddl: "CREATE INDEX IF NOT EXISTS page_view_daily_slug_idx ON page_view_daily (slug)",
  },
  {
    name: "page_view_referrer_daily_day_idx",
    ddl: "CREATE INDEX IF NOT EXISTS page_view_referrer_daily_day_idx ON page_view_referrer_daily (day)",
  },
];

/**
 * Minimal executor surface shared by the global `db` and a transaction handle.
 * Threading this through lets the self-heal run against an injected transaction
 * (e.g. a rolled-back one in tests) instead of only the global connection.
 */
export type Executor = Pick<typeof db, "execute">;

export async function ensureAnalytics(
  log: (m: string) => void = console.log,
  executor: Executor = db,
): Promise<void> {
  log("Ensuring page_views table exists…");
  const tableExisted = await tableExists(executor, "page_views");
  // Static DDL from this source file — never user input. Column types, defaults
  // and the FK constraint name match lib/db/src/schema/analytics.ts so the
  // publish-time dev→prod diff is a no-op once prod has the table.
  await executor.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS page_views (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        page_id uuid,
        slug text NOT NULL,
        referrer_host text,
        viewed_at timestamp with time zone NOT NULL DEFAULT now(),
        created_at timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT page_views_page_id_pages_id_fk
          FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE SET NULL
      )
    `),
  );
  log(tableExisted ? "  page_views already present." : "  + created page_views");

  log("Ensuring page_view_daily rollup table exists…");
  const rollupExisted = await tableExists(executor, "page_view_daily");
  // Static DDL — column types, PK and FK constraint names match
  // lib/db/src/schema/analytics.ts so the publish-time dev→prod diff is a no-op.
  await executor.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS page_view_daily (
        day date NOT NULL,
        page_id uuid,
        slug text NOT NULL,
        views integer NOT NULL DEFAULT 0,
        updated_at timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT page_view_daily_day_slug_pk PRIMARY KEY (day, slug),
        CONSTRAINT page_view_daily_page_id_pages_id_fk
          FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE SET NULL
      )
    `),
  );
  log(
    rollupExisted
      ? "  page_view_daily already present."
      : "  + created page_view_daily",
  );

  log("Ensuring page_view_referrer_daily rollup table exists…");
  const referrerRollupExisted = await tableExists(
    executor,
    "page_view_referrer_daily",
  );
  // Static DDL — column types and PK constraint name match
  // lib/db/src/schema/analytics.ts so the publish-time dev→prod diff is a no-op.
  await executor.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS page_view_referrer_daily (
        day date NOT NULL,
        referrer_host text NOT NULL DEFAULT '',
        views integer NOT NULL DEFAULT 0,
        updated_at timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT page_view_referrer_daily_day_referrer_host_pk
          PRIMARY KEY (day, referrer_host)
      )
    `),
  );
  log(
    referrerRollupExisted
      ? "  page_view_referrer_daily already present."
      : "  + created page_view_referrer_daily",
  );

  log(`Ensuring ${INDEXES.length} analytics indexes exist…`);
  let created = 0;
  let present = 0;
  for (const idx of INDEXES) {
    const existed = await indexExists(executor, idx.name);
    await executor.execute(sql.raw(idx.ddl));
    if (existed) {
      present += 1;
    } else {
      created += 1;
      log(`  + created ${idx.name}`);
    }
  }

  log(
    `Analytics storage ready: ${created} indexes created, ${present} already present (${INDEXES.length} total).`,
  );
}

async function tableExists(
  executor: Executor,
  name: string,
): Promise<boolean> {
  const result = await executor.execute(
    sql`SELECT 1 FROM pg_class WHERE relkind = 'r' AND relname = ${name} LIMIT 1`,
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
  process.argv[1]?.endsWith("ensure-analytics.ts");

if (isMain) {
  ensureAnalytics()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Failed to ensure analytics storage:", err);
      await pool.end();
      process.exit(1);
    });
}
