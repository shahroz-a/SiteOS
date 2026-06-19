/**
 * Opt-in live-DB integration test for the CMS publishing lifecycle, scheduling,
 * and slug-change redirects. Where the existing route tests only prove the
 * RBAC/invariant guards (who may do what, and the 400/403/404 paths), this test
 * proves the *database effects* the routes promise actually land:
 *
 *   - a draft -> published transition flips `status` and stamps `publishedAt`
 *   - scheduling stores `scheduledFor`, and the background due-publish query
 *     (`publishDueScheduledPosts`) picks the post up once its time has passed
 *   - a slug change writes an active 301 redirect whose OLD path resolves to the
 *     NEW path through `resolveRedirect` (the function backing
 *     `GET /redirects/resolve`)
 *
 * Everything runs inside a SINGLE database transaction that is ALWAYS rolled
 * back, so the live database is never mutated — this also keeps
 * `publishDueScheduledPosts` (which scans *every* scheduled page) from
 * collaterally publishing real scheduled posts. Because it touches the real
 * database it only runs when `VERIFY_CMS_WRITE=1` is set, so the normal suite
 * skips it.
 *
 * Run with: `VERIFY_CMS_WRITE=1 pnpm exec vitest run \
 *   artifacts/api-server/src/lib/__tests__/cms-publishing.integration.test.ts`
 */
import { describe, it, expect } from "vitest";

const RUN = process.env.VERIFY_CMS_WRITE === "1";

const mod = RUN
  ? await import("../cms-publishing")
  : ({} as never);
const dbMod = RUN ? await import("@workspace/db") : ({} as never);
const contentMod = RUN ? await import("../cms-content") : ({} as never);

class Rollback extends Error {}

describe.skipIf(!RUN)("CMS publishing — live DB (rolled-back)", () => {
  it("publishes, schedules, and redirects with the right DB effects", async () => {
    const {
      transitionPost,
      publishDueScheduledPosts,
      changePostUrl,
      resolveRedirect,
    } = mod;
    const { db, pagesTable } = dbMod;
    const { canonicalUrlForSlug, pathnameForSlug } = contentMod;
    const { eq } = await import("drizzle-orm");

    const suffix = Date.now();

    /** Insert a fresh draft directly so the whole test stays inside `tx`. */
    async function insertDraft(
      tx: typeof db,
      slug: string,
    ): Promise<string> {
      const [row] = await tx
        .insert(pagesTable)
        .values({
          slug,
          title: `Publishing Test ${slug}`,
          status: "draft",
          originalUrl: canonicalUrlForSlug(slug),
          canonicalUrl: canonicalUrlForSlug(slug),
          pathname: pathnameForSlug(slug),
        })
        .returning({ id: pagesTable.id });
      return row!.id;
    }

    async function readPage(tx: typeof db, id: string) {
      const [row] = await tx
        .select({
          status: pagesTable.status,
          publishedAt: pagesTable.publishedAt,
          scheduledFor: pagesTable.scheduledFor,
        })
        .from(pagesTable)
        .where(eq(pagesTable.id, id))
        .limit(1);
      return row;
    }

    try {
      await db.transaction(async (txRaw) => {
        const tx = txRaw as unknown as typeof db;

        // 1) draft -> published flips status and stamps publishedAt.
        const publishId = await insertDraft(tx, `publish-me-${suffix}`);
        const publishNow = new Date("2026-06-19T12:00:00Z");
        const pubResult = await transitionPost(
          publishId,
          "published",
          null,
          publishNow,
          tx,
        );
        expect(pubResult.ok).toBe(true);
        expect(pubResult.detail?.status).toBe("published");
        const published = await readPage(tx, publishId);
        expect(published?.status).toBe("published");
        expect(published?.publishedAt?.getTime()).toBe(publishNow.getTime());
        expect(published?.scheduledFor).toBeNull();

        // 2) scheduling stores scheduledFor; the due-publish query then picks it
        //    up once its time has passed and stamps publishedAt = scheduledFor.
        const scheduleId = await insertDraft(tx, `schedule-me-${suffix}`);
        const scheduleNow = new Date("2026-06-19T12:00:00Z");
        const scheduledFor = new Date("2026-06-20T12:00:00Z");
        const schedResult = await transitionPost(
          scheduleId,
          "scheduled",
          scheduledFor,
          scheduleNow,
          tx,
        );
        expect(schedResult.ok).toBe(true);
        const scheduled = await readPage(tx, scheduleId);
        expect(scheduled?.status).toBe("scheduled");
        expect(scheduled?.scheduledFor?.getTime()).toBe(scheduledFor.getTime());

        // Not yet due: a run before scheduledFor must NOT publish it.
        const earlyIds = await publishDueScheduledPosts(
          new Date("2026-06-20T11:59:00Z"),
          tx,
        );
        expect(earlyIds).not.toContain(scheduleId);
        expect((await readPage(tx, scheduleId))?.status).toBe("scheduled");

        // Now due: the background query picks it up and publishes it.
        const dueIds = await publishDueScheduledPosts(
          new Date("2026-06-20T12:00:01Z"),
          tx,
        );
        expect(dueIds).toContain(scheduleId);
        const autoPublished = await readPage(tx, scheduleId);
        expect(autoPublished?.status).toBe("published");
        expect(autoPublished?.publishedAt?.getTime()).toBe(
          scheduledFor.getTime(),
        );
        expect(autoPublished?.scheduledFor).toBeNull();

        // 3) a slug change writes a working 301: the OLD path resolves to the
        //    NEW path via resolveRedirect (the GET /redirects/resolve backend).
        const oldSlug = `old-url-${suffix}`;
        const newSlug = `new-url-${suffix}`;
        const oldPath = pathnameForSlug(oldSlug);
        const newPath = pathnameForSlug(newSlug);
        const redirectId = await insertDraft(tx, oldSlug);
        const urlResult = await changePostUrl(redirectId, newSlug, true, tx);
        expect(urlResult.ok).toBe(true);
        expect(urlResult.detail?.pathname).toBe(newPath);

        const resolved = await resolveRedirect(oldPath, tx);
        expect(resolved.found).toBe(true);
        expect(resolved.toPath).toBe(newPath);
        expect(resolved.statusCode).toBe(301);

        // The new (live) path must NOT itself redirect.
        const newResolved = await resolveRedirect(newPath, tx);
        expect(newResolved.found).toBe(false);

        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  });
});
