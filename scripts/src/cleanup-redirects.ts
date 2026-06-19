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
 * Usage:
 *   pnpm --filter @workspace/scripts run cleanup:redirects            # dry run
 *   pnpm --filter @workspace/scripts run cleanup:redirects -- --apply # write
 */
import { eq, inArray } from "drizzle-orm";
import { db, pool, redirectsTable } from "@workspace/db";
import {
  classifyRedirect,
  normalizeRedirectFromPath,
  type RedirectSkipReason,
} from "./prerender/redirects";

const APPLY = process.argv.includes("--apply");

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

async function main(): Promise<void> {
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

  console.log(
    `\nApplied. Repaired ${repairs.length}, deactivated ${deactivations.length}.\n`,
  );
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
