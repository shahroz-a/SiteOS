/**
 * Post-build verification: real dead-redirect cleanup against the LIVE world.
 *
 * The decision policy in `../redirect-target-health.ts` is covered by fast unit
 * tests, but the runner's *evidence-gathering* — the live on-blog corpus lookup
 * (`loadServedPaths`) and the off-blog HTTP probe (`probeStatus`) in
 * `../../redirect-health.ts` — is only exercised manually. A changed/renamed
 * query, a drifted `pages`/`redirects` shape, or a broken probe (wrong
 * method/header/timeout handling) would slip past the pure tests. This opt-in
 * check closes that gap by running the REAL evidence-gathering against the live
 * DB and the live network, then feeding the readings through the same policy the
 * runner uses, asserting:
 *
 *  - **on-blog corpus lookup** flags a genuinely missing `/blog/...` target as
 *    dead (deactivate immediately) and does NOT flag a page we actually serve;
 *  - **off-blog HTTP probe** reads a live 200 as alive (never deactivated) and a
 *    real 404 as dead (deactivated once it accumulates to the threshold);
 *  - the full runner `run({ dryRun: true })` executes end-to-end against the
 *    live `redirects` table without writing anything (no DB mutation, only a
 *    throwaway report file).
 *
 * OPT-IN. Like the payload round-trip and the redirect-stub verification, it
 * touches the real database and network and so only runs when `VERIFY_REAL_DATA=1`
 * is set; the normal test / validation suite skips it (avoiding flakiness and
 * pooler pressure). Run it on demand with:
 *
 *   pnpm --filter @workspace/scripts run verify:redirect-health
 *
 * Non-destructive by construction: every assertion uses `--dry-run` semantics —
 * `loadServedPaths`/`probeStatus` are read-only, and `run` is called with
 * `dryRun: true` so it only SELECTs and writes its report into a temp dir that is
 * removed afterwards.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadServedPaths,
  probeStatus,
  run,
} from "../../redirect-health";
import {
  decideHealth,
  normalizeTargetPath,
  readingVerdict,
} from "../redirect-target-health";
import { redirectTargetUrl } from "../redirects";

const RUN = process.env.VERIFY_REAL_DATA === "1";
const PROBE_TIMEOUT_MS = 20_000;

/** A path that can never correspond to a real served blog page. */
const MISSING_ON_BLOG = `/blog/__verify-redirect-health-missing-${Date.now()}`;

describe.skipIf(!RUN)(
  "dead-redirect cleanup — real evidence-gathering against live DB + network",
  () => {
    afterAll(async () => {
      try {
        const { pool } = await import("@workspace/db");
        await pool.end();
      } catch {
        // pool may already be closed; ignore.
      }
    });

    it(
      "on-blog corpus lookup flags missing targets and spares served pages",
      async () => {
        const { db, pagesTable } = await import("@workspace/db");

        const served = await loadServedPaths();

        // The blog index is always served — sanity that the query produced a
        // populated corpus (not an empty set that would make everything "dead").
        expect(served.size).toBeGreaterThan(1);
        expect(served.has(normalizeTargetPath("/blog/"))).toBe(true);

        // A real, served page is KNOWN-ALIVE: its on-blog reading must NOT
        // deactivate. Pull one straight from the live corpus.
        const [page] = await db
          .select({ pathname: pagesTable.pathname })
          .from(pagesTable)
          .limit(1);
        expect(
          page?.pathname,
          "no pages in the live corpus; cannot verify on-blog cleanup",
        ).toBeTruthy();
        const livePath = normalizeTargetPath(page!.pathname!);
        expect(served.has(livePath)).toBe(true);

        const aliveDecision = decideHealth(
          "on-blog",
          readingVerdict({ kind: "on-blog", exists: served.has(livePath) }),
          0,
        );
        expect(aliveDecision.deactivate).toBe(false);
        expect(aliveDecision.reason).toBeNull();

        // A path that cannot exist is KNOWN-DEAD: on-blog is deterministic, so a
        // single missing reading deactivates immediately.
        expect(served.has(normalizeTargetPath(MISSING_ON_BLOG))).toBe(false);
        const deadDecision = decideHealth(
          "on-blog",
          readingVerdict({
            kind: "on-blog",
            exists: served.has(normalizeTargetPath(MISSING_ON_BLOG)),
          }),
          0,
        );
        expect(deadDecision.deactivate).toBe(true);
        expect(deadDecision.reason).toBe("on-blog-target-missing");
      },
      120_000,
    );

    it(
      "off-blog HTTP probe reads live 200 as alive and a real 404 as dead",
      async () => {
        // A live, reachable Headout page is KNOWN-ALIVE — exercises the real
        // probe against the actual off-blog origin redirect targets resolve to.
        const headoutRoot = redirectTargetUrl("/");
        expect(headoutRoot.startsWith("https://www.headout.com")).toBe(true);

        // REAL probe against the live origin redirect targets actually resolve
        // to. This exercises the runner's network path end-to-end (HEAD→GET
        // fallback, redirect-following, status extraction) against the genuine
        // dependency — not a stand-in third-party endpoint that could be down.
        const headoutStatus = await probeStatus(headoutRoot, PROBE_TIMEOUT_MS);
        expect(
          headoutStatus,
          "could not reach the live Headout origin; probe path may be broken",
        ).not.toBeNull();

        // A reachable origin is KNOWN-ALIVE: it returns 200 / a redirect / even a
        // bot-block (403), never 404/410, so it reads alive and is never
        // deactivated — and a healthy reading resets the failure counter.
        const aliveVerdict = readingVerdict({ kind: "off-blog", status: headoutStatus });
        expect(aliveVerdict).not.toBe("dead");
        const aliveDecision = decideHealth("off-blog", aliveVerdict, 5);
        expect(aliveDecision.deactivate).toBe(false);
        expect(aliveDecision.failures).toBe(0);

        // KNOWN-DEAD off-blog reading (404). We feed the status through the
        // runner's REAL verdict/decision logic rather than probing a live 404:
        // Headout soft-404s (returns 200 for unknown paths) so it can't emit a
        // confirmed-dead reading, and a third-party 404 endpoint is flaky. The
        // network probe itself is already covered above (same code path for any
        // status) and by the full-runner test's real off-blog probes. Off-blog
        // needs corroboration: one dead reading only puts it at-risk; a second
        // confirmed-dead reading (across runs) reaches the threshold.
        const deadVerdict = readingVerdict({ kind: "off-blog", status: 404 });
        expect(deadVerdict).toBe("dead");

        const firstRun = decideHealth("off-blog", deadVerdict, 0);
        expect(firstRun.deactivate).toBe(false); // below threshold → at-risk only
        expect(firstRun.failures).toBe(1);

        const secondRun = decideHealth("off-blog", deadVerdict, firstRun.failures);
        expect(secondRun.deactivate).toBe(true);
        expect(secondRun.reason).toBe("off-blog-target-dead");
      },
      120_000,
    );

    it(
      "full runner executes end-to-end in dry-run without mutating the DB",
      async () => {
        const { db, redirectsTable } = await import("@workspace/db");

        // Snapshot ALL rows (active + inactive) to prove the dry-run mutates
        // nothing, and separately count ACTIVE rows — `run()` only checks active
        // redirects, so `result.checked` is active-only by design.
        const before = await db
          .select({
            id: redirectsTable.id,
            isActive: redirectsTable.isActive,
            failures: redirectsTable.targetCheckFailures,
          })
          .from(redirectsTable);
        const activeBefore = before.filter((r) => r.isActive).length;

        const reportDir = mkdtempSync(
          path.join(os.tmpdir(), "verify-redirect-health-"),
        );
        try {
          const result = await run({
            dryRun: true,
            noNetwork: false,
            concurrency: 5,
            timeoutMs: PROBE_TIMEOUT_MS,
            reportDir,
          });

          expect(result.dryRun).toBe(true);
          // The runner saw the live table and produced a coherent report.
          // `run()` only checks ACTIVE redirects, so `checked` is active-only.
          expect(result.checked).toBe(activeBefore);
          expect(result.deactivated.length).toBeLessThanOrEqual(result.checked);
          // Any on-blog deactivation must be a genuinely missing target, and
          // any off-blog dead reading carries a 404/410 status — the runner's
          // verdicts agree with the policy on real data.
          for (const entry of result.deactivated) {
            if (entry.kind === "on-blog") {
              expect(entry.reason).toBe("on-blog-target-missing");
            } else {
              expect(entry.reason).toBe("off-blog-target-dead");
              expect([404, 410]).toContain(entry.status);
            }
          }
          for (const entry of result.atRisk) {
            expect(entry.kind).toBe("off-blog");
            expect([404, 410]).toContain(entry.status);
          }
        } finally {
          rmSync(reportDir, { recursive: true, force: true });
        }

        // Nothing changed: dry-run must not flip isActive or bump counters.
        const after = await db
          .select({
            id: redirectsTable.id,
            isActive: redirectsTable.isActive,
            failures: redirectsTable.targetCheckFailures,
          })
          .from(redirectsTable);

        const byId = new Map(after.map((r) => [r.id, r]));
        for (const row of before) {
          const now = byId.get(row.id);
          expect(now?.isActive).toBe(row.isActive);
          expect(now?.failures).toBe(row.failures);
        }
      },
      600_000,
    );
  },
);
