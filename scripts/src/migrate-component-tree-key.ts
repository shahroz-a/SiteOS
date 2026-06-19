/**
 * One-off corpus migration: unify the component-tree block discriminator on
 * `blockType`.
 *
 * Historically the crawler stored `pages.componentTree` (and the derived
 * `component_tree.tree` / `page_versions.snapshot.componentTree`) with each
 * block keyed by `type`, while the importer / `@workspace/content` / the CMS
 * editor key it `blockType`. Producers and readers are now unified on
 * `blockType`; this script rewrites the stored corpus so the dual-key shim is
 * only ever exercised as a defensive fallback.
 *
 * SAFETY — the transform is *structural*: it renames a block node's own `type`
 * to `blockType` and recurses into `children` ONLY. It NEVER descends into a
 * node's `data`, because `data` legitimately holds Lexical/richText nodes that
 * are correctly keyed `type` (paragraph/heading/text/link/…). Renaming those
 * would corrupt rich text. The rename is idempotent (a node that already has
 * `blockType` is left untouched and its `type` is not duplicated).
 *
 * Run with:
 *   pnpm --filter @workspace/scripts run migrate:component-tree-key            (apply)
 *   pnpm --filter @workspace/scripts run migrate:component-tree-key -- --dry-run
 */
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";

/**
 * Recursively rename a component-tree node's `type` discriminator to
 * `blockType`, recursing into `children` only (never `data`). Returns whether
 * any node in the subtree was changed. Mutates `value` in place.
 */
export function renameTreeKey(value: unknown): boolean {
  let changed = false;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (renameTreeKey(item)) changed = true;
    }
    return changed;
  }
  if (!value || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;

  // Rename this node's own discriminator. Only when it actually carries a
  // string `type` and doesn't already have a `blockType` (idempotent).
  if (typeof node.type === "string" && node.blockType === undefined) {
    node.blockType = node.type;
    delete node.type;
    changed = true;
  }

  // Recurse into structural children ONLY. `data` holds Lexical richText whose
  // nodes are legitimately keyed `type` — it must never be touched.
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (renameTreeKey(child)) changed = true;
    }
  }
  return changed;
}

/**
 * Migrate a whole `componentTree` value (crawler top-level array OR importer
 * root object). Returns the (possibly mutated) value and whether it changed.
 */
export function migrateComponentTree(tree: unknown): {
  tree: unknown;
  changed: boolean;
} {
  if (tree == null) return { tree, changed: false };
  const changed = renameTreeKey(tree);
  return { tree, changed };
}

interface MigrationStats {
  scanned: number;
  changed: number;
}

type Executor = Pick<typeof db, "execute">;

/**
 * Batch size for keyset-paginated reads. The corpus is large and some rows
 * (notably `page_versions.snapshot`, a FULL page snapshot) are big, so reading
 * an entire table in one query exhausts memory / the pooler. We page by `id`.
 */
const BATCH_SIZE = 200;

/**
 * Keyset-paginate a table by `id`, transforming the JSONB column `col` on each
 * row via `pick`/`apply`. `pick(row)` extracts the component tree to migrate;
 * `write(id, newColValue)` issues the UPDATE. Memory stays bounded to one batch.
 */
async function migrateTableBatched<Row extends { id: string }>(
  exec: Executor,
  opts: {
    apply: boolean;
    log: (m: string) => void;
    label: string;
    selectBatch: (cursor: string | null) => ReturnType<Executor["execute"]>;
    migrateRow: (row: Row) => { changed: boolean; write: () => Promise<void> };
  },
): Promise<MigrationStats> {
  const stats: MigrationStats = { scanned: 0, changed: 0 };
  let cursor: string | null = null;
  for (;;) {
    const rows = (await opts.selectBatch(cursor)).rows as Row[];
    if (rows.length === 0) break;
    stats.scanned += rows.length;
    for (const row of rows) {
      const { changed, write } = opts.migrateRow(row);
      if (!changed) continue;
      stats.changed += 1;
      if (opts.apply) await write();
    }
    cursor = rows[rows.length - 1].id;
    if (rows.length < BATCH_SIZE) break;
  }
  opts.log(
    `${opts.label}: ${stats.changed}/${stats.scanned} ${opts.apply ? "updated" : "would change"}`,
  );
  return stats;
}

async function migratePagesComponentTree(
  exec: Executor,
  apply: boolean,
  log: (m: string) => void,
): Promise<MigrationStats> {
  return migrateTableBatched<{ id: string; component_tree: unknown }>(exec, {
    apply,
    log,
    label: "pages.component_tree",
    selectBatch: (cursor) =>
      exec.execute(
        cursor == null
          ? sql`SELECT id, component_tree FROM pages WHERE component_tree IS NOT NULL ORDER BY id LIMIT ${BATCH_SIZE}`
          : sql`SELECT id, component_tree FROM pages WHERE component_tree IS NOT NULL AND id > ${cursor} ORDER BY id LIMIT ${BATCH_SIZE}`,
      ),
    migrateRow: (row) => {
      const { tree, changed } = migrateComponentTree(row.component_tree);
      return {
        changed,
        write: async () => {
          await exec.execute(
            sql`UPDATE pages SET component_tree = ${JSON.stringify(tree)}::jsonb WHERE id = ${row.id}`,
          );
        },
      };
    },
  });
}

async function migrateComponentTreeTable(
  exec: Executor,
  apply: boolean,
  log: (m: string) => void,
): Promise<MigrationStats> {
  return migrateTableBatched<{ id: string; tree: unknown }>(exec, {
    apply,
    log,
    label: "component_tree.tree",
    selectBatch: (cursor) =>
      exec.execute(
        cursor == null
          ? sql`SELECT id, tree FROM component_tree WHERE tree IS NOT NULL ORDER BY id LIMIT ${BATCH_SIZE}`
          : sql`SELECT id, tree FROM component_tree WHERE tree IS NOT NULL AND id > ${cursor} ORDER BY id LIMIT ${BATCH_SIZE}`,
      ),
    migrateRow: (row) => {
      const { tree, changed } = migrateComponentTree(row.tree);
      return {
        changed,
        write: async () => {
          await exec.execute(
            sql`UPDATE component_tree SET tree = ${JSON.stringify(tree)}::jsonb WHERE id = ${row.id}`,
          );
        },
      };
    },
  });
}

async function migratePageVersions(
  exec: Executor,
  apply: boolean,
  log: (m: string) => void,
): Promise<MigrationStats> {
  return migrateTableBatched<{ id: string; snapshot: unknown }>(exec, {
    apply,
    log,
    label: "page_versions.snapshot.componentTree",
    selectBatch: (cursor) =>
      exec.execute(
        cursor == null
          ? sql`SELECT id, snapshot FROM page_versions WHERE snapshot IS NOT NULL ORDER BY id LIMIT ${BATCH_SIZE}`
          : sql`SELECT id, snapshot FROM page_versions WHERE snapshot IS NOT NULL AND id > ${cursor} ORDER BY id LIMIT ${BATCH_SIZE}`,
      ),
    migrateRow: (row) => {
      const snapshot = row.snapshot;
      if (!snapshot || typeof snapshot !== "object") {
        return { changed: false, write: async () => {} };
      }
      const snap = snapshot as Record<string, unknown>;
      if (!("componentTree" in snap) || snap.componentTree == null) {
        return { changed: false, write: async () => {} };
      }
      const { tree, changed } = migrateComponentTree(snap.componentTree);
      if (changed) snap.componentTree = tree;
      return {
        changed,
        write: async () => {
          await exec.execute(
            sql`UPDATE page_versions SET snapshot = ${JSON.stringify(snap)}::jsonb WHERE id = ${row.id}`,
          );
        },
      };
    },
  });
}

export async function migrateCorpus(
  opts: { apply: boolean; log?: (m: string) => void; exec?: Executor } = {
    apply: false,
  },
): Promise<MigrationStats[]> {
  const log = opts.log ?? console.log;
  const exec = opts.exec ?? db;
  log(opts.apply ? "Applying migration…" : "Dry run (no writes)…");
  const results = [
    await migratePagesComponentTree(exec, opts.apply, log),
    await migrateComponentTreeTable(exec, opts.apply, log),
    await migratePageVersions(exec, opts.apply, log),
  ];
  const totalChanged = results.reduce((n, r) => n + r.changed, 0);
  log(
    opts.apply
      ? `Done. ${totalChanged} rows updated.`
      : `Done (dry run). ${totalChanged} rows would change. Re-run without --dry-run to apply.`,
  );
  return results;
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("migrate-component-tree-key.ts");

if (isMain) {
  const apply = !process.argv.includes("--dry-run");
  migrateCorpus({ apply })
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Migration failed:", err);
      await pool.end();
      process.exit(1);
    });
}
