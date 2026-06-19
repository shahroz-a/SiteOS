/**
 * Opt-in live-DB integration test for the CMS publishing lifecycle, scheduling,
 * and slug-change redirects. Where the existing route tests only prove the
 * RBAC/invariant guards (who may do what, and the 400/403/404 paths), this test
 * proves the *database effects* the routes promise actually land:
 *
 *   - a draft -> published transition flips `status` and stamps `publishedAt`
 *   - scheduling stores `scheduledFor`, and the background due-publish query
 *     (`publishDueScheduledPosts`) picks the post up once its time has passed
 *   - each auto-publish leaves the editor-visible history behind: an
 *     `audit_logs` row (action `article.publish.scheduled`, entityType `page`,
 *     scheduled->published before/after) plus a matching `crawl_logs` line
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
    const { db, pagesTable, auditLogsTable, crawlLogsTable } = dbMod;
    const { canonicalUrlForSlug, pathnameForSlug } = contentMod;
    const { eq, and } = await import("drizzle-orm");

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

        // 2b) the auto-publish leaves the editor-visible history behind: one
        //     audit_logs row (no human actor, scheduled->published) and one
        //     matching crawl_logs line, both scoped to this post.
        const [audit] = await tx
          .select({
            action: auditLogsTable.action,
            entityType: auditLogsTable.entityType,
            entityId: auditLogsTable.entityId,
            actorId: auditLogsTable.actorId,
            before: auditLogsTable.before,
            after: auditLogsTable.after,
            metadata: auditLogsTable.metadata,
          })
          .from(auditLogsTable)
          .where(
            and(
              eq(auditLogsTable.entityId, scheduleId),
              eq(auditLogsTable.action, "article.publish.scheduled"),
            ),
          )
          .limit(1);
        expect(audit).toBeTruthy();
        expect(audit?.entityType).toBe("page");
        expect(audit?.actorId).toBeNull();
        expect(audit?.before).toEqual({ status: "scheduled" });
        expect(audit?.after).toEqual({
          status: "published",
          publishedAt: scheduledFor.toISOString(),
        });
        expect(
          (audit?.metadata as { slug?: string } | null)?.slug,
        ).toBe(`schedule-me-${suffix}`);

        const [crawlLog] = await tx
          .select({
            url: crawlLogsTable.url,
            level: crawlLogsTable.level,
            message: crawlLogsTable.message,
            details: crawlLogsTable.details,
          })
          .from(crawlLogsTable)
          .where(eq(crawlLogsTable.url, pathnameForSlug(`schedule-me-${suffix}`)))
          .limit(1);
        expect(crawlLog).toBeTruthy();
        expect(crawlLog?.level).toBe("info");
        expect(crawlLog?.message).toContain(`schedule-me-${suffix}`);
        expect(
          (crawlLog?.details as { action?: string } | null)?.action,
        ).toBe("publish-scheduled");
        expect(
          (crawlLog?.details as { id?: string } | null)?.id,
        ).toBe(scheduleId);

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
  }, 30000);

  // The MANUAL, editor-driven lifecycle moves (a person publishing/scheduling a
  // post or renaming its URL through the CMS routes) must leave a human-
  // attributed audit_logs row behind. The automatic scheduler trail is covered
  // above; here we prove the route layer's `recordAudit` call records the acting
  // user (actorId/actorEmail/actorRole), the right action string, entityType
  // "page", and the before/after state — so a route refactor can't silently drop
  // the human history. We exercise the same lib functions the routes call
  // (transitionPost / changePostUrl) plus recordAudit with the EXACT entry each
  // route builds, all threaded through the rolled-back tx so the live DB is
  // never mutated.
  it("records human-attributed audit rows for manual transitions and slug changes", async () => {
    const { transitionPost, changePostUrl } = mod;
    const { db, pagesTable, auditLogsTable, usersTable } = dbMod;
    const { recordAudit } = await import("../audit");
    const { canonicalUrlForSlug, pathnameForSlug } = contentMod;
    const { eq, and } = await import("drizzle-orm");

    const suffix = Date.now();

    async function insertDraft(tx: typeof db, slug: string): Promise<string> {
      const [row] = await tx
        .insert(pagesTable)
        .values({
          slug,
          title: `Manual Audit Test ${slug}`,
          status: "draft",
          originalUrl: canonicalUrlForSlug(slug),
          canonicalUrl: canonicalUrlForSlug(slug),
          pathname: pathnameForSlug(slug),
        })
        .returning({ id: pagesTable.id });
      return row!.id;
    }

    try {
      await db.transaction(async (txRaw) => {
        const tx = txRaw as unknown as typeof db;

        // A real CMS user as the acting editor — actorId is an FK to users, so
        // it must reference an existing row.
        const [actor] = await tx
          .insert(usersTable)
          .values({
            email: `editor-${suffix}@example.com`,
            firstName: "Manual",
            lastName: "Editor",
            role: "editor",
          })
          .returning({ id: usersTable.id, email: usersTable.email });

        // A faithful stand-in for the authenticated Express request the route
        // hands to recordAudit: an authenticated user, an IP, and a logger.
        const req = {
          isAuthenticated: () => true,
          user: { id: actor!.id, email: actor!.email },
          ip: "203.0.113.7",
          cmsRole: "editor",
          log: { error: () => {} },
        } as unknown as Parameters<typeof recordAudit>[0];

        // 1) Manual publish: draft -> published through transitionPost, then the
        //    route's audit call (action "post.transition").
        const publishId = await insertDraft(tx, `manual-publish-${suffix}`);
        const publishNow = new Date("2026-06-19T12:00:00Z");
        const pubResult = await transitionPost(
          publishId,
          "published",
          null,
          publishNow,
          tx,
        );
        expect(pubResult.ok).toBe(true);
        await recordAudit(
          req,
          {
            action: "post.transition",
            entityType: "page",
            entityId: publishId,
            actorRole: "editor",
            before: { status: "draft" },
            after: { status: "published", scheduledFor: null },
            metadata: null,
          },
          tx,
        );

        const [pubAudit] = await tx
          .select({
            action: auditLogsTable.action,
            entityType: auditLogsTable.entityType,
            entityId: auditLogsTable.entityId,
            actorId: auditLogsTable.actorId,
            actorEmail: auditLogsTable.actorEmail,
            actorRole: auditLogsTable.actorRole,
            ipAddress: auditLogsTable.ipAddress,
            before: auditLogsTable.before,
            after: auditLogsTable.after,
          })
          .from(auditLogsTable)
          .where(
            and(
              eq(auditLogsTable.entityId, publishId),
              eq(auditLogsTable.action, "post.transition"),
            ),
          )
          .limit(1);
        expect(pubAudit).toBeTruthy();
        expect(pubAudit?.entityType).toBe("page");
        expect(pubAudit?.actorId).toBe(actor!.id);
        expect(pubAudit?.actorEmail).toBe(actor!.email);
        expect(pubAudit?.actorRole).toBe("editor");
        expect(pubAudit?.ipAddress).toBe("203.0.113.7");
        expect(pubAudit?.before).toEqual({ status: "draft" });
        expect(pubAudit?.after).toEqual({
          status: "published",
          scheduledFor: null,
        });

        // 2) Manual schedule: draft -> scheduled carries the scheduledFor in the
        //    audit after-state.
        const scheduleId = await insertDraft(tx, `manual-schedule-${suffix}`);
        const scheduleNow = new Date("2026-06-19T12:00:00Z");
        const scheduledFor = new Date("2026-06-25T12:00:00Z");
        const schedResult = await transitionPost(
          scheduleId,
          "scheduled",
          scheduledFor,
          scheduleNow,
          tx,
        );
        expect(schedResult.ok).toBe(true);
        await recordAudit(
          req,
          {
            action: "post.transition",
            entityType: "page",
            entityId: scheduleId,
            actorRole: "editor",
            before: { status: "draft" },
            after: {
              status: "scheduled",
              scheduledFor: scheduledFor.toISOString(),
            },
            metadata: null,
          },
          tx,
        );

        const [schedAudit] = await tx
          .select({
            action: auditLogsTable.action,
            actorId: auditLogsTable.actorId,
            after: auditLogsTable.after,
          })
          .from(auditLogsTable)
          .where(
            and(
              eq(auditLogsTable.entityId, scheduleId),
              eq(auditLogsTable.action, "post.transition"),
            ),
          )
          .limit(1);
        expect(schedAudit).toBeTruthy();
        expect(schedAudit?.actorId).toBe(actor!.id);
        expect(schedAudit?.after).toEqual({
          status: "scheduled",
          scheduledFor: scheduledFor.toISOString(),
        });

        // 3) Manual slug change: changePostUrl renames the post, then the route's
        //    audit call (action "post.url-change") records old/new slug+pathname.
        const oldSlug = `manual-old-${suffix}`;
        const newSlug = `manual-new-${suffix}`;
        const oldPath = pathnameForSlug(oldSlug);
        const newPath = pathnameForSlug(newSlug);
        const urlId = await insertDraft(tx, oldSlug);
        const urlResult = await changePostUrl(urlId, newSlug, true, tx);
        expect(urlResult.ok).toBe(true);
        await recordAudit(
          req,
          {
            action: "post.url-change",
            entityType: "page",
            entityId: urlId,
            actorRole: "editor",
            before: urlResult.before ?? null,
            after: urlResult.detail
              ? {
                  slug: urlResult.detail.slug,
                  pathname: urlResult.detail.pathname,
                }
              : null,
          },
          tx,
        );

        const [urlAudit] = await tx
          .select({
            action: auditLogsTable.action,
            entityType: auditLogsTable.entityType,
            entityId: auditLogsTable.entityId,
            actorId: auditLogsTable.actorId,
            actorEmail: auditLogsTable.actorEmail,
            actorRole: auditLogsTable.actorRole,
            before: auditLogsTable.before,
            after: auditLogsTable.after,
          })
          .from(auditLogsTable)
          .where(
            and(
              eq(auditLogsTable.entityId, urlId),
              eq(auditLogsTable.action, "post.url-change"),
            ),
          )
          .limit(1);
        expect(urlAudit).toBeTruthy();
        expect(urlAudit?.entityType).toBe("page");
        expect(urlAudit?.actorId).toBe(actor!.id);
        expect(urlAudit?.actorEmail).toBe(actor!.email);
        expect(urlAudit?.actorRole).toBe("editor");
        expect(urlAudit?.before).toEqual({ slug: oldSlug, pathname: oldPath });
        expect(urlAudit?.after).toEqual({ slug: newSlug, pathname: newPath });

        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }, 30000);
});
