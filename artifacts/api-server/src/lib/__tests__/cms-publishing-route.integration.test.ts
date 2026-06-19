process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = "silent";

/**
 * Opt-in, rolled-back, HTTP-LEVEL audit-trail test for the publishing routes.
 *
 * The sibling `cms-publishing.integration.test.ts` proves the audit ROW shape by
 * calling the lib functions (transitionPost / changePostUrl) plus `recordAudit`
 * directly with a hand-built fake Express request. That cannot prove the actual
 * route WIRING: that a real session resolves through `authMiddleware` →
 * `requireAuth` → `requirePermission`, that the publish gate blocks before any
 * audit write, and that `recordAudit` actually fires (with the live session's
 * actorId/email/role/ip) only on the success path and never on a rejected one.
 *
 * This test drives the REAL Express app over the REAL database with `supertest`,
 * authenticating with a genuine session row (Bearer = sid) so the whole
 * middleware chain runs exactly as in production. To keep the live DB untouched,
 * the entire request is funnelled through ONE transaction that is always rolled
 * back: inside `db.transaction(tx => …)` the shared `db` singleton's query
 * methods are temporarily redirected to `tx` (every module imports `db` by
 * reference, so the routes, middleware, publish gate and `recordAudit` all run
 * on the same `tx`), then restored. Gated on `VERIFY_CMS_WRITE=1` like the rest
 * of the live-DB harness, so the normal suite skips it.
 *
 * Run with: `VERIFY_CMS_WRITE=1 pnpm exec vitest run \
 *   artifacts/api-server/src/lib/__tests__/cms-publishing-route.integration.test.ts`
 */
import { describe, it, expect } from "vitest";

const RUN = process.env.VERIFY_CMS_WRITE === "1";

const dbMod = RUN ? await import("@workspace/db") : ({} as never);
const contentMod = RUN ? await import("../cms-content") : ({} as never);
const appMod = RUN ? await import("../../app") : ({} as never);
const supertestMod = RUN ? await import("supertest") : ({} as never);

class Rollback extends Error {}

/**
 * Redirect the shared `db` singleton's query-builder methods at a transaction so
 * everything the routes touch (middleware session lookup, the publish gate,
 * `transitionPost` / `changePostUrl`, `recordAudit`) runs inside `tx`. Returns a
 * restorer that puts the original prototype methods back.
 */
function patchDbTo(
  db: Record<string, unknown>,
  tx: Record<string, unknown>,
): () => void {
  const methods = [
    "select",
    "selectDistinct",
    "insert",
    "update",
    "delete",
    "execute",
    "transaction",
    "with",
    "$count",
    "refreshMaterializedView",
  ];
  const saved: [string, PropertyDescriptor | undefined][] = [];
  for (const m of methods) {
    if (typeof tx[m] === "function") {
      saved.push([m, Object.getOwnPropertyDescriptor(db, m)]);
      db[m] = (...args: unknown[]) =>
        (tx[m] as (...a: unknown[]) => unknown)(...args);
    }
  }
  return () => {
    for (const [m, desc] of saved) {
      if (desc) Object.defineProperty(db, m, desc);
      else delete db[m];
    }
  };
}

describe.skipIf(!RUN)("CMS publishing routes — audit trail over HTTP (rolled-back)", () => {
  it("writes a human-attributed audit row on success and none on rejection", async () => {
    const { db, pagesTable, usersTable, sessionsTable, auditLogsTable } = dbMod;
    const { canonicalUrlForSlug, pathnameForSlug } = contentMod;
    const request = supertestMod.default;
    const app = appMod.default;
    const { eq, and } = await import("drizzle-orm");

    const suffix = Date.now();
    const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    async function insertUser(
      tx: typeof db,
      role: string,
    ): Promise<{ id: string; email: string; sid: string }> {
      const email = `${role}-${suffix}@example.com`;
      const [u] = await tx
        .insert(usersTable)
        .values({ email, firstName: role, lastName: "Tester", role })
        .returning({ id: usersTable.id, email: usersTable.email });
      const sid = `sid-${role}-${suffix}`;
      await tx.insert(sessionsTable).values({
        sid,
        sess: {
          user: {
            id: u!.id,
            email: u!.email,
            firstName: role,
            lastName: "Tester",
            profileImageUrl: null,
          },
          access_token: "tok",
        },
        expire: FUTURE,
      });
      return { id: u!.id, email: u!.email, sid };
    }

    async function insertDraft(tx: typeof db, slug: string): Promise<string> {
      const [row] = await tx
        .insert(pagesTable)
        .values({
          slug,
          title: `Route Audit Test ${slug}`,
          status: "draft",
          originalUrl: canonicalUrlForSlug(slug),
          canonicalUrl: canonicalUrlForSlug(slug),
          pathname: pathnameForSlug(slug),
        })
        .returning({ id: pagesTable.id });
      return row!.id;
    }

    async function auditRowsFor(tx: typeof db, entityId: string, action: string) {
      return tx
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
            eq(auditLogsTable.entityId, entityId),
            eq(auditLogsTable.action, action),
          ),
        );
    }

    let restore: (() => void) | null = null;
    try {
      await db.transaction(async (txRaw) => {
        const tx = txRaw as unknown as typeof db;

        // Seed two real users + sessions and the pages each scenario acts on,
        // all inside the tx so authMiddleware (which reads sessions/users
        // through the patched `db`) sees them and they vanish on rollback.
        const editor = await insertUser(tx, "editor");
        const writer = await insertUser(tx, "writer");

        const reviewId = await insertDraft(tx, `route-review-${suffix}`);
        const urlOldSlug = `route-url-old-${suffix}`;
        const urlNewSlug = `route-url-new-${suffix}`;
        const urlId = await insertDraft(tx, urlOldSlug);
        const forbiddenId = await insertDraft(tx, `route-forbidden-${suffix}`);
        const gateId = await insertDraft(tx, `route-gate-${suffix}`);

        // From here every DB call the app makes is funnelled through `tx`.
        restore = patchDbTo(
          db as unknown as Record<string, unknown>,
          tx as unknown as Record<string, unknown>,
        );

        // 1) SUCCESS — editor moves a draft to review through the real route.
        //    Editorial move (no publish gate) so this isolates the recordAudit
        //    wiring: a 200 AND a human-attributed audit row.
        const reviewRes = await request(app)
          .post(`/api/cms/posts/${reviewId}/transition`)
          .set("Authorization", `Bearer ${editor.sid}`)
          .send({ to: "review" });
        expect(reviewRes.status).toBe(200);
        expect(reviewRes.body.status).toBe("review");

        const [reviewAudit] = await auditRowsFor(tx, reviewId, "post.transition");
        expect(reviewAudit).toBeTruthy();
        expect(reviewAudit?.entityType).toBe("page");
        expect(reviewAudit?.actorId).toBe(editor.id);
        expect(reviewAudit?.actorEmail).toBe(editor.email);
        expect(reviewAudit?.actorRole).toBe("editor");
        expect(
          typeof reviewAudit?.ipAddress === "string" &&
            (reviewAudit?.ipAddress?.length ?? 0) > 0,
        ).toBe(true);
        expect(reviewAudit?.before).toEqual({ status: "draft" });
        expect(reviewAudit?.after).toEqual({ status: "review", scheduledFor: null });

        // 2) SUCCESS — editor renames a slug through the real PATCH route; the
        //    audit row records the old/new slug+pathname with the live actor.
        const urlRes = await request(app)
          .patch(`/api/cms/posts/${urlId}/url`)
          .set("Authorization", `Bearer ${editor.sid}`)
          .send({ slug: urlNewSlug, confirm: true, createRedirect: true });
        expect(urlRes.status).toBe(200);
        expect(urlRes.body.pathname).toBe(pathnameForSlug(urlNewSlug));

        const [urlAudit] = await auditRowsFor(tx, urlId, "post.url-change");
        expect(urlAudit).toBeTruthy();
        expect(urlAudit?.actorId).toBe(editor.id);
        expect(urlAudit?.actorEmail).toBe(editor.email);
        expect(urlAudit?.actorRole).toBe("editor");
        expect(urlAudit?.before).toEqual({
          slug: urlOldSlug,
          pathname: pathnameForSlug(urlOldSlug),
        });
        expect(urlAudit?.after).toEqual({
          slug: urlNewSlug,
          pathname: pathnameForSlug(urlNewSlug),
        });

        // 3) REJECTED (403) — a writer lacks content.publish, so publishing is
        //    refused by requirePermission BEFORE the handler body. No audit row.
        const forbiddenRes = await request(app)
          .post(`/api/cms/posts/${forbiddenId}/transition`)
          .set("Authorization", `Bearer ${writer.sid}`)
          .send({ to: "published" });
        expect(forbiddenRes.status).toBe(403);

        const forbiddenAudits = await auditRowsFor(
          tx,
          forbiddenId,
          "post.transition",
        );
        expect(forbiddenAudits.length).toBe(0);

        // 4) REJECTED (422) — an editor MAY publish, but a contentless draft
        //    fails the publish gate's critical checks. The gate returns 422
        //    BEFORE recordAudit runs, so still no audit row — proving the
        //    recordAudit call ordering (it never fires on the blocked path).
        const gateRes = await request(app)
          .post(`/api/cms/posts/${gateId}/transition`)
          .set("Authorization", `Bearer ${editor.sid}`)
          .send({ to: "published" });
        expect(gateRes.status).toBe(422);
        expect(Array.isArray(gateRes.body.blocking)).toBe(true);
        expect(gateRes.body.blocking.length).toBeGreaterThan(0);

        const gateAudits = await auditRowsFor(tx, gateId, "post.transition");
        expect(gateAudits.length).toBe(0);
        // The page must remain a draft — the blocked publish changed nothing.
        const [gatePage] = await tx
          .select({ status: pagesTable.status })
          .from(pagesTable)
          .where(eq(pagesTable.id, gateId))
          .limit(1);
        expect(gatePage?.status).toBe("draft");

        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    } finally {
      restore?.();
    }
  }, 30000);
});
