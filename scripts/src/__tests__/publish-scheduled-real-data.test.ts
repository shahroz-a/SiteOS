/**
 * Post-build verification: scheduled posts actually go live, run against the
 * REAL database.
 *
 * The fast unit suite only covers `parseArgs`. The actual behaviour of the
 * auto-publish job — a `scheduled` post whose `scheduledFor` is in the past
 * flips to `published` with `publishedAt` stamped from the originally-scheduled
 * time and `scheduledFor` cleared, while a future-dated one is left untouched,
 * and a second run is a no-op — is pure SQL that only a DB-backed test can
 * exercise. This opt-in check seeds two scheduled posts (one past-due, one
 * future) under unique throwaway slugs, drives the REAL `run()` job, and
 * asserts:
 *
 *  - **due post published** — the past-due post becomes `published`, its
 *    `publishedAt` equals the originally-scheduled time, and `scheduledFor` is
 *    cleared;
 *  - **future post untouched** — the future-dated post stays `scheduled` with
 *    its `scheduledFor` intact;
 *  - **idempotent** — a second run finds nothing due (no rows returned), and
 *    the two posts are unchanged.
 *
 * OPT-IN + NON-DESTRUCTIVE. Like the rollup and redirect-health checks it
 * touches the real DB, so it only runs when `VERIFY_REAL_DATA=1`; the normal
 * suite skips it. Every mutation happens inside an OUTER transaction that is
 * force-rolled-back at the end (via a sentinel throw), so the live database is
 * left exactly as it was — the seeded posts and the publishes they trigger
 * never commit. `run()` is handed that transaction as its executor so its own
 * apply-path UPDATE + audit/crawl writes nest inside the rollback boundary.
 *
 * Run on demand with:
 *   pnpm --filter @workspace/scripts run verify:publish-scheduled
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { run } from "../publish-scheduled";

const RUN = process.env.VERIFY_REAL_DATA === "1";

/** Sentinel used to force the outer transaction to roll back after asserting. */
const ROLLBACK = Symbol("rollback");

describe.skipIf(!RUN)(
  "publish-scheduled — real DB (due posts go live, future ones don't, idempotent)",
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
        const dueSlug = `__verify-publish-due-${stamp}`;
        const futureSlug = `__verify-publish-future-${stamp}`;

        // A fixed "now" for the run so the assertions are deterministic.
        const now = new Date();
        const pastFor = new Date(now.getTime() - 60 * 60 * 1000); // 1h ago
        const futureFor = new Date(now.getTime() + 60 * 60 * 1000); // 1h ahead

        const seedPost = (slug: string, scheduledFor: Date) => ({
          slug,
          title: `Verify scheduled ${slug}`,
          pageType: "post" as const,
          status: "scheduled" as const,
          originalUrl: `https://example.test/${slug}`,
          canonicalUrl: `https://example.test/${slug}`,
          pathname: `/blog/${slug}`,
          scheduledFor,
        });

        try {
          await db.transaction(async (tx) => {
            await tx
              .insert(pagesTable)
              .values([
                seedPost(dueSlug, pastFor),
                seedPost(futureSlug, futureFor),
              ]);

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

            // --- First run (apply mode) inside the rolled-back tx. ---
            const first = await run({ dryRun: false }, now, tx);
            expect(first.dryRun).toBe(false);

            // Exactly our due post is among the published rows; the future one
            // is not. (Other real scheduled posts could also be due in the live
            // table — all confined to this rolled-back tx — so scope to slug.)
            const publishedSlugs = new Set(first.published.map((p) => p.slug));
            expect(publishedSlugs.has(dueSlug)).toBe(true);
            expect(publishedSlugs.has(futureSlug)).toBe(false);

            // The published entry stamps publishedAt with the original schedule.
            const dueEntry = first.published.find((p) => p.slug === dueSlug);
            expect(dueEntry?.scheduledFor).toBe(pastFor.toISOString());

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

            // AUDIT TRAIL: the due post's auto-publish wrote an audit_logs row
            // (action article.publish.scheduled, entityType page, NO human
            // actor, scheduled->published before/after) and a matching
            // crawl_logs line — the editor-visible history a future refactor
            // must not silently drop. The future post wrote neither.
            const dueId = dueEntry!.id;
            const audit = await tx.execute<{
              action: string;
              entity_type: string | null;
              actor_id: string | null;
              before: { status?: string } | null;
              after: { status?: string; publishedAt?: string | null } | null;
              metadata: { source?: string; slug?: string } | null;
            }>(sql`
              select action, entity_type, actor_id, before, after, metadata
              from audit_logs
              where entity_id = ${dueId}
                and action = 'article.publish.scheduled'
            `);
            expect(audit.rows.length).toBe(1);
            const auditRow = audit.rows[0]!;
            expect(auditRow.entity_type).toBe("page");
            expect(auditRow.actor_id).toBeNull();
            expect(auditRow.before?.status).toBe("scheduled");
            expect(auditRow.after?.status).toBe("published");
            expect(auditRow.after?.publishedAt).toBe(pastFor.toISOString());
            expect(auditRow.metadata?.source).toBe("publish-scheduled-job");
            expect(auditRow.metadata?.slug).toBe(dueSlug);

            const crawl = await tx.execute<{
              level: string;
              message: string | null;
              details: { action?: string; slug?: string; id?: string } | null;
            }>(sql`
              select level, message, details
              from crawl_logs
              where url = ${`/blog/${dueSlug}`}
                and (details->>'action') = 'publish-scheduled'
            `);
            expect(crawl.rows.length).toBe(1);
            const crawlRow = crawl.rows[0]!;
            expect(crawlRow.level).toBe("info");
            expect(crawlRow.message).toContain(dueSlug);
            expect(crawlRow.details?.slug).toBe(dueSlug);
            expect(crawlRow.details?.id).toBe(dueId);

            // The future (untouched) post produced no audit/crawl rows.
            const futureAudit = await tx.execute<{ n: number }>(sql`
              select count(*)::int as n from audit_logs
              where action = 'article.publish.scheduled'
                and (metadata->>'slug') = ${futureSlug}
            `);
            expect(Number(futureAudit.rows[0]?.n ?? -1)).toBe(0);

            // --- Idempotency: a second run never re-publishes our due post. ---
            const second = await run({ dryRun: false }, now, tx);
            expect(second.published.some((p) => p.slug === dueSlug)).toBe(false);

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
