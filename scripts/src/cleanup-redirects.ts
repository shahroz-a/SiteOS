/**
 * Clean up ACTIVE redirects that can never produce a forwarding stub.
 *
 * The prerender only materialises a forwarding HTML stub for redirects whose
 * old path is a safe, serveable path under `/blog/` (see `classifyRedirect` in
 * `prerender/redirects.ts`). Every other ACTIVE redirect quietly drops the
 * inbound link — the `reports/redirect-skipped.json` report surfaces them,
 * grouped by reason (`non-blog-source`, `malformed-segment`, `self-redirect`),
 * but until now fixing them was a manual chore.
 *
 * This maintenance command closes the loop. It re-uses the SAME
 * `classifyRedirect` logic the prerender serves with, so it can never disagree
 * with what is actually written, and for each forwards-to-nowhere row it either:
 *   - REPAIRS it, when `normalizeRedirectFromPath` can salvage the old path
 *     (e.g. collapsing accidental repeated slashes) into one that now serves
 *     without becoming a self-loop or colliding with another row, or
 *   - DEACTIVATES it (`is_active = false`) when it can never forward
 *     (off-blog sources, true self-loops, irrecoverable junk segments).
 *
 * Defaults to a dry run; pass `--apply` to write.
 *
 * Every `--apply` run records exactly which ids it deactivated/repaired to
 * `reports/redirect-cleanup.json`, so an operator who later realises a row was
 * fine can undo it — either a single id (`--reactivate=<id>`) or the whole last
 * run (`--restore-last`, which reactivates every deactivated row and reverts
 * every repaired `from_path` back to its original value). Both undo modes are
 * themselves dry-run by default and require `--apply` to write.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run cleanup:redirects            # dry run
 *   pnpm --filter @workspace/scripts run cleanup:redirects -- --apply # write
 *   pnpm --filter @workspace/scripts run cleanup:redirects -- --restore-last --apply
 *   pnpm --filter @workspace/scripts run cleanup:redirects -- --reactivate=<id> --apply
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, inArray } from "drizzle-orm";
import { db, pool, redirectsTable } from "@workspace/db";
import {
  classifyRedirect,
  normalizeRedirectFromPath,
  type RedirectSkipReason,
} from "./prerender/redirects";

const APPLY = process.argv.includes("--apply");
const RESTORE_LAST = process.argv.includes("--restore-last");
const reactivateArg = process.argv.find((a) => a.startsWith("--reactivate="));
const REACTIVATE_ID = reactivateArg
  ? reactivateArg.slice("--reactivate=".length)
  : null;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
export const CLEANUP_REPORT_PATH = path.resolve(
  repoRoot,
  "reports",
  "redirect-cleanup.json",
);

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type Action =
  | { kind: "repair"; id: string; fromPath: string; toPath: string; reason: RedirectSkipReason; newFromPath: string }
  | { kind: "deactivate"; id: string; fromPath: string; toPath: string; reason: RedirectSkipReason };

/**
 * Decide what to do with every ACTIVE redirect that currently forwards nowhere.
 * Pure (no DB) so it can be unit tested: takes the active rows + the set of all
 * existing `from_path` values (to avoid repairing into the table's unique
 * constraint) and returns the repair/deactivate actions.
 */
export function planRedirectCleanup(
  activeRedirects: Array<{ id: string; fromPath: string; toPath: string }>,
  existingFromPaths: ReadonlySet<string>,
): Action[] {
  const actions: Action[] = [];
  // Track paths that become occupied by a repair within this run so two junk
  // rows can't both be salvaged onto the same clean path.
  const claimed = new Set<string>();
  for (const r of activeRedirects) {
    const { reason } = classifyRedirect(r.fromPath, r.toPath);
    if (reason === null) continue; // already serves — leave it alone.

    const normalized = normalizeRedirectFromPath(r.fromPath);
    const salvageable =
      normalized !== null &&
      normalized !== r.fromPath &&
      classifyRedirect(normalized, r.toPath).reason === null &&
      !existingFromPaths.has(normalized) &&
      !claimed.has(normalized);

    if (salvageable) {
      claimed.add(normalized);
      actions.push({
        kind: "repair",
        id: r.id,
        fromPath: r.fromPath,
        toPath: r.toPath,
        reason,
        newFromPath: normalized,
      });
    } else {
      actions.push({
        kind: "deactivate",
        id: r.id,
        fromPath: r.fromPath,
        toPath: r.toPath,
        reason,
      });
    }
  }
  return actions;
}

/**
 * Persisted record of one `--apply` cleanup run, written to
 * `reports/redirect-cleanup.json`. It captures exactly which ids changed and
 * how, so the change can be undone later (`--restore-last`).
 */
export interface CleanupRunRecord {
  ranAt: string;
  repaired: Array<{
    id: string;
    originalFromPath: string;
    newFromPath: string;
    toPath: string;
    reason: RedirectSkipReason;
  }>;
  deactivated: Array<{
    id: string;
    fromPath: string;
    toPath: string;
    reason: RedirectSkipReason;
  }>;
}

/** Build the persisted run record from the actions actually applied. Pure. */
export function buildCleanupRecord(
  actions: Action[],
  ranAt: string,
): CleanupRunRecord {
  const repaired: CleanupRunRecord["repaired"] = [];
  const deactivated: CleanupRunRecord["deactivated"] = [];
  for (const a of actions) {
    if (a.kind === "repair") {
      repaired.push({
        id: a.id,
        originalFromPath: a.fromPath,
        newFromPath: a.newFromPath,
        toPath: a.toPath,
        reason: a.reason,
      });
    } else {
      deactivated.push({
        id: a.id,
        fromPath: a.fromPath,
        toPath: a.toPath,
        reason: a.reason,
      });
    }
  }
  return { ranAt, repaired, deactivated };
}

/** One undo step against a single redirect row. */
export type RestoreAction =
  | { kind: "reactivate"; id: string; fromPath: string }
  | {
      kind: "revert-path";
      id: string;
      fromPath: string;
      currentFromPath: string;
    };

/**
 * Turn a persisted cleanup record into the steps that undo it. Pure (no DB):
 * every deactivated row is re-activated, and every repaired row has its
 * `from_path` reverted to the original value the cleanup changed it from.
 */
export function planRedirectRestore(record: CleanupRunRecord): RestoreAction[] {
  const actions: RestoreAction[] = [];
  for (const r of record.repaired) {
    actions.push({
      kind: "revert-path",
      id: r.id,
      fromPath: r.originalFromPath,
      currentFromPath: r.newFromPath,
    });
  }
  for (const d of record.deactivated) {
    actions.push({ kind: "reactivate", id: d.id, fromPath: d.fromPath });
  }
  return actions;
}

async function writeCleanupRecord(record: CleanupRunRecord): Promise<void> {
  await mkdir(path.dirname(CLEANUP_REPORT_PATH), { recursive: true });
  await writeFile(
    CLEANUP_REPORT_PATH,
    JSON.stringify(record, null, 2) + "\n",
    "utf8",
  );
}

async function readCleanupRecord(): Promise<CleanupRunRecord | null> {
  try {
    const raw = await readFile(CLEANUP_REPORT_PATH, "utf8");
    return JSON.parse(raw) as CleanupRunRecord;
  } catch {
    return null;
  }
}

/** `--reactivate=<id>`: flip a single redirect back to active. */
async function runReactivate(id: string): Promise<void> {
  console.log(`\n=== reactivate redirect (${APPLY ? "APPLY" : "DRY RUN"}) ===`);
  const [row] = await db
    .select({
      id: redirectsTable.id,
      fromPath: redirectsTable.fromPath,
      toPath: redirectsTable.toPath,
      isActive: redirectsTable.isActive,
    })
    .from(redirectsTable)
    .where(eq(redirectsTable.id, id));

  if (!row) {
    console.error(`No redirect with id ${id}.`);
    await pool.end();
    process.exitCode = 1;
    return;
  }
  console.log(`  ${row.fromPath}  →  ${row.toPath}`);
  if (row.isActive) {
    console.log(`\nAlready active — nothing to do.\n`);
    await pool.end();
    return;
  }
  if (!APPLY) {
    console.log(`\nDry run only. Re-run with --apply to write.\n`);
    await pool.end();
    return;
  }
  await db
    .update(redirectsTable)
    .set({ isActive: true })
    .where(eq(redirectsTable.id, id));
  console.log(`\nReactivated ${id}.\n`);
  await pool.end();
}

/** `--restore-last`: undo the whole last `--apply` cleanup run. */
async function runRestoreLast(): Promise<void> {
  console.log(
    `\n=== restore last cleanup (${APPLY ? "APPLY" : "DRY RUN"}) ===`,
  );
  const record = await readCleanupRecord();
  if (!record) {
    console.error(
      `No cleanup record found at ${CLEANUP_REPORT_PATH}. Nothing to restore.`,
    );
    await pool.end();
    process.exitCode = 1;
    return;
  }

  const actions = planRedirectRestore(record);
  const reactivations = actions.filter((a) => a.kind === "reactivate");
  const reverts = actions.filter((a) => a.kind === "revert-path");

  console.log(`last run:               ${record.ranAt}`);
  console.log(`reactivate:             ${reactivations.length}`);
  console.log(`revert from_path:       ${reverts.length}`);
  for (const a of actions.slice(0, 20)) {
    if (a.kind === "revert-path") {
      console.log(`  [revert] ${a.currentFromPath}  →  ${a.fromPath}`);
    } else {
      console.log(`  [reactivate] ${a.fromPath}`);
    }
  }

  if (!APPLY) {
    console.log(`\nDry run only. Re-run with --apply to write.\n`);
    await pool.end();
    return;
  }

  await db.transaction(async (tx) => {
    // Reverting from_path first frees each clean path before any reactivation
    // touches the table, keeping the unique constraint happy.
    for (const a of reverts) {
      if (a.kind !== "revert-path") continue;
      await tx
        .update(redirectsTable)
        .set({ fromPath: a.fromPath })
        .where(eq(redirectsTable.id, a.id));
    }
    const reactivateIds = reactivations.map((a) => a.id);
    for (const ids of chunk(reactivateIds, 500)) {
      await tx
        .update(redirectsTable)
        .set({ isActive: true })
        .where(inArray(redirectsTable.id, ids));
    }
  });

  console.log(
    `\nRestored. Reactivated ${reactivations.length}, reverted ${reverts.length}.\n`,
  );
  await pool.end();
}

async function main(): Promise<void> {
  if (REACTIVATE_ID !== null) {
    await runReactivate(REACTIVATE_ID);
    return;
  }
  if (RESTORE_LAST) {
    await runRestoreLast();
    return;
  }

  const all = await db
    .select({
      id: redirectsTable.id,
      fromPath: redirectsTable.fromPath,
      toPath: redirectsTable.toPath,
      isActive: redirectsTable.isActive,
    })
    .from(redirectsTable);

  const activeRedirects = all.filter((r) => r.isActive);
  const existingFromPaths = new Set(all.map((r) => r.fromPath));

  const actions = planRedirectCleanup(activeRedirects, existingFromPaths);
  const repairs = actions.filter((a) => a.kind === "repair");
  const deactivations = actions.filter((a) => a.kind === "deactivate");

  const byReason = (kind: Action["kind"]) =>
    actions
      .filter((a) => a.kind === kind)
      .reduce<Record<string, number>>((acc, a) => {
        acc[a.reason] = (acc[a.reason] ?? 0) + 1;
        return acc;
      }, {});

  // --- Report -------------------------------------------------------------
  console.log(`\n=== cleanup-redirects (${APPLY ? "APPLY" : "DRY RUN"}) ===`);
  console.log(`total redirects:        ${all.length}`);
  console.log(`active:                 ${activeRedirects.length}`);
  console.log(`forwarding nowhere:     ${actions.length}`);
  console.log(`  → repair:             ${repairs.length}`);
  for (const [reason, n] of Object.entries(byReason("repair"))) {
    console.log(`      ${String(n).padStart(4)}  ${reason}`);
  }
  console.log(`  → deactivate:         ${deactivations.length}`);
  for (const [reason, n] of Object.entries(byReason("deactivate"))) {
    console.log(`      ${String(n).padStart(4)}  ${reason}`);
  }

  const sample = (arr: Action[]) => arr.slice(0, 20);
  if (repairs.length) {
    console.log(`\nrepairs (first ${Math.min(20, repairs.length)}):`);
    for (const a of sample(repairs)) {
      if (a.kind !== "repair") continue;
      console.log(`  [${a.reason}] ${a.fromPath}  →  ${a.newFromPath}`);
    }
  }
  if (deactivations.length) {
    console.log(`\ndeactivations (first ${Math.min(20, deactivations.length)}):`);
    for (const a of sample(deactivations)) {
      console.log(`  [${a.reason}] ${a.fromPath}  →  ${a.toPath}`);
    }
  }

  if (!APPLY) {
    console.log(`\nDry run only. Re-run with --apply to write.\n`);
    await pool.end();
    return;
  }

  // --- Apply --------------------------------------------------------------
  await db.transaction(async (tx) => {
    // Repairs are per-row (each gets a distinct new from_path).
    for (const a of repairs) {
      if (a.kind !== "repair") continue;
      await tx
        .update(redirectsTable)
        .set({ fromPath: a.newFromPath })
        .where(eq(redirectsTable.id, a.id));
    }
    // Deactivations can be batched by id.
    const deactivateIds = deactivations.map((a) => a.id);
    for (const ids of chunk(deactivateIds, 500)) {
      await tx
        .update(redirectsTable)
        .set({ isActive: false })
        .where(inArray(redirectsTable.id, ids));
    }
  });

  // Record exactly what changed so an operator can undo it later.
  const record = buildCleanupRecord(actions, new Date().toISOString());
  await writeCleanupRecord(record);

  console.log(
    `\nApplied. Repaired ${repairs.length}, deactivated ${deactivations.length}.`,
  );
  console.log(`Run recorded to ${CLEANUP_REPORT_PATH} (undo with --restore-last).\n`);
  await pool.end();
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
}
