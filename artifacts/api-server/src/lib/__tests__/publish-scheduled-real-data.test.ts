/**
 * Post-build verification: the always-on api-server's IN-PROCESS scheduler
 * actually takes scheduled posts live, run against the REAL database.
 *
 * The standalone Scheduled-Deployment job is already covered by a real-DB test
 * (`scripts/src/__tests__/publish-scheduled-real-data.test.ts`). But the path
 * most users actually rely on is the api-server's own in-process 60s scheduler:
 * `publishDueScheduledPosts` (`artifacts/api-server/src/lib/cms-publishing.ts`),
 * wired into `artifacts/api-server/src/index.ts`. That code is pure SQL — a
 * single UPDATE that flips every `scheduled` page whose `scheduledFor` <= now to
 * `published`, stamping `publishedAt` with the originally-scheduled time and
 * clearing `scheduledFor` — so only a DB-backed test can exercise its real
 * behaviour. This opt-in check seeds two scheduled posts (one past-due, one
 * future) under unique throwaway slugs, drives the REAL
 * `publishDueScheduledPosts`, and asserts:
 *
 *  - **due post published** — the past-due post becomes `published`, its
 *    `publishedAt` equals the originally-scheduled time, and `scheduledFor` is
 *    cleared, and its id is among the returned published ids;
 *  - **future post untouched** — the future-dated post stays `scheduled` with
 *    its `scheduledFor` intact and its id is NOT returned;
 *  - **idempotent** — a second run never re-publishes the due post, and both
 *    posts are unchanged.
 *
 * OPT-IN + NON-DESTRUCTIVE. Like the standalone job's verify test and the
 * rollup / redirect-health checks it touches the real DB, so it only runs when
 * `VERIFY_REAL_DATA=1`; the normal suite skips it. Every mutation happens inside
 * an OUTER transaction that is force-rolled-back at the end (via a sentinel
 * throw), so the live database is left exactly as it was — the seeded posts and
 * the publishes they trigger never commit. `publishDueScheduledPosts` is handed
 * that transaction as its executor so its UPDATE nests inside the rollback
 * boundary.
 *
 * Run on demand with:
 *   pnpm --filter @workspace/api-server run verify:publish-scheduled
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { publishDueScheduledPosts } from "../cms-publishing.js";
import type { Executor } from "../cms-content.js";

const RUN = process.env.VERIFY_REAL_DATA === "1";

/** Sentinel used to force the outer transaction to roll back after asserting. */
const ROLLBACK = Symbol("rollback");

describe.skipIf(!RUN)(
  "publishDueScheduledPosts — real DB (in-process scheduler takes due posts live, future ones not, idempotent)",
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
      "publishes only past-due scheduled posts, stamps publishedAt, and is idempotent",
      async () => {
        const { db, pagesTable } = await import("@workspace/db");

        // Unique slugs so seeded rows can never collide with real content and
        // assertions can scope to exactly what this test inserted.
        const stamp = Date.now();
        const dueSlug = `__verify-inproc-publish-due-${stamp}`;
        const futureSlug = `__verify-inproc-publish-future-${stamp}`;

        // A fixed "now" for the run so the assertions are deterministic.
        const now = new Date();
        const pastFor = new Date(now.getTime() - 60 * 60 * 1000); // 1h ago
        const futureFor = new Date(now.getTime() + 60 * 60 * 1000); // 1h ahead

        const seedPost = (slug: string, scheduledFor: Date) => ({
          slug,
          title: `Verify in-process scheduled ${slug}`,
          pageType: "post" as const,
          status: "scheduled" as const,
          originalUrl: `https://example.test/${slug}`,
          canonicalUrl: `https://example.test/${slug}`,
          pathname: `/blog/${slug}`,
          scheduledFor,
        });

        try {
          await db.transaction(async (tx) => {
            const inserted = await tx
              .insert(pagesTable)
              .values([
                seedPost(dueSlug, pastFor),
                seedPost(futureSlug, futureFor),
              ])
              .returning({ id: pagesTable.id, slug: pagesTable.slug });
            const dueId = inserted.find((r) => r.slug === dueSlug)!.id;
            const futureId = inserted.find((r) => r.slug === futureSlug)!.id;

            // Read back a seeded post's status/dates by slug.
            const readBySlug = async (slug: string) => {
              const res = await tx.execute<{
                status: string;
                published_at: string | null;
                scheduled_for: string | null;
              }>(sql`
                select status,
                       published_at,
                       scheduled_for
                from pages where slug = ${slug}
              `);
              return res.rows[0];
            };

            // --- First run inside the rolled-back tx. ---
            const exec = tx as unknown as Executor;
            const firstIds = await publishDueScheduledPosts(now, exec);

            // Our due post is among the published ids; the future one is not.
            // (Other real scheduled posts could also be due in the live table —
            // all confined to this rolled-back tx — so scope to our ids.)
            const publishedIds = new Set(firstIds);
            expect(publishedIds.has(dueId)).toBe(true);
            expect(publishedIds.has(futureId)).toBe(false);

            // DUE post: now published, publishedAt == original scheduledFor,
            // scheduledFor cleared.
            const due = await readBySlug(dueSlug);
            expect(due?.status).toBe("published");
            expect(due?.scheduled_for).toBeNull();
            expect(new Date(due!.published_at!).toISOString()).toBe(
              pastFor.toISOString(),
            );

            // FUTURE post: untouched — still scheduled, scheduledFor intact,
            // not yet published.
            const future = await readBySlug(futureSlug);
            expect(future?.status).toBe("scheduled");
            expect(future?.published_at).toBeNull();
            expect(new Date(future!.scheduled_for!).toISOString()).toBe(
              futureFor.toISOString(),
            );

            // --- Idempotency: a second run never re-publishes our due post. ---
            const secondIds = await publishDueScheduledPosts(now, exec);
            expect(secondIds.includes(dueId)).toBe(false);

            // Both posts are exactly as the first run left them.
            const dueAgain = await readBySlug(dueSlug);
            expect(dueAgain?.status).toBe("published");
            expect(dueAgain?.scheduled_for).toBeNull();
            expect(new Date(dueAgain!.published_at!).toISOString()).toBe(
              pastFor.toISOString(),
            );
            const futureAgain = await readBySlug(futureSlug);
            expect(futureAgain?.status).toBe("scheduled");

            // Unwind everything we did to the live DB.
            throw ROLLBACK;
          });
        } catch (err) {
          if (err !== ROLLBACK) throw err;
        }

        // The rollback really happened: neither seeded post persisted.
        const leftover = await db.execute<{ n: number }>(sql`
          select count(*)::int as n from pages
          where slug in (${dueSlug}, ${futureSlug})
        `);
        expect(Number(leftover.rows[0]?.n ?? -1)).toBe(0);
      },
      300_000,
    );
  },
);
