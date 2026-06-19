import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gt, isNotNull } from "drizzle-orm";
import { db, redirectsTable } from "@workspace/db";
import {
  ListCmsDeactivatedRedirectsResponse,
  ReactivateCmsRedirectResponse,
  ReactivateCmsRedirectParams,
} from "@workspace/api-zod";
import { requireAuth, requirePermission } from "../middlewares/rbac";
import { recordAudit } from "../lib/audit";

const router: IRouter = Router();

type RedirectRow = typeof redirectsTable.$inferSelect;

/** Off-blog targets are everything that isn't a root-relative `/blog/...` path. */
function redirectKind(toPath: string): "on-blog" | "off-blog" {
  return toPath.startsWith("/blog/") ? "on-blog" : "off-blog";
}

function serializeRedirect(r: RedirectRow) {
  return {
    id: r.id,
    fromPath: r.fromPath,
    toPath: r.toPath,
    statusCode: r.statusCode,
    isActive: r.isActive,
    kind: redirectKind(r.toPath),
    deactivatedReason: r.deactivatedReason,
    deactivatedAt: r.deactivatedAt ? r.deactivatedAt.toISOString() : null,
    targetLastStatus: r.targetLastStatus,
    targetCheckedAt: r.targetCheckedAt ? r.targetCheckedAt.toISOString() : null,
    targetCheckFailures: r.targetCheckFailures,
  };
}

// The auto-deactivated redirect review queue plus off-blog "at-risk" rows.
// Gated on url.manage (admin/editor/seo) — the same permission that governs
// redirect/URL changes.
router.get(
  "/cms/redirects/deactivated",
  requireAuth,
  requirePermission("url.manage"),
  async (_req: Request, res: Response) => {
    // Auto-deactivated: the health job sets isActive=false AND records a reason.
    // (A reason distinguishes these from any manually-disabled redirect.)
    const deactivated = await db
      .select()
      .from(redirectsTable)
      .where(
        and(
          eq(redirectsTable.isActive, false),
          isNotNull(redirectsTable.deactivatedReason),
        ),
      )
      .orderBy(desc(redirectsTable.deactivatedAt));

    // At-risk: still active but the off-blog target has failed at least once
    // (below the deactivation threshold). Worth watching.
    const atRisk = await db
      .select()
      .from(redirectsTable)
      .where(
        and(
          eq(redirectsTable.isActive, true),
          gt(redirectsTable.targetCheckFailures, 0),
        ),
      )
      .orderBy(desc(redirectsTable.targetCheckedAt));

    res.json(
      ListCmsDeactivatedRedirectsResponse.parse({
        deactivated: deactivated.map(serializeRedirect),
        atRisk: atRisk.map(serializeRedirect),
      }),
    );
  },
);

// Re-activate an auto-deactivated redirect: flip isActive back to true and clear
// the health bookkeeping so the next health run re-evaluates it cleanly. Audited.
router.post(
  "/cms/redirects/:id/reactivate",
  requireAuth,
  requirePermission("url.manage"),
  async (req: Request, res: Response) => {
    const { id } = ReactivateCmsRedirectParams.parse(req.params);

    const [existing] = await db
      .select()
      .from(redirectsTable)
      .where(eq(redirectsTable.id, id));

    if (!existing) {
      res.status(404).json({ error: "Redirect not found" });
      return;
    }

    const [updated] = await db
      .update(redirectsTable)
      .set({
        isActive: true,
        deactivatedReason: null,
        deactivatedAt: null,
        targetCheckFailures: 0,
      })
      .where(eq(redirectsTable.id, id))
      .returning();

    await recordAudit(req, {
      action: "redirect.reactivate",
      entityType: "redirect",
      entityId: id,
      actorRole: req.cmsRole ?? null,
      before: {
        isActive: existing.isActive,
        deactivatedReason: existing.deactivatedReason,
        targetCheckFailures: existing.targetCheckFailures,
      },
      after: {
        isActive: updated.isActive,
        deactivatedReason: updated.deactivatedReason,
        targetCheckFailures: updated.targetCheckFailures,
      },
      metadata: { fromPath: updated.fromPath, toPath: updated.toPath },
    });

    res.json(ReactivateCmsRedirectResponse.parse(serializeRedirect(updated)));
  },
);

export default router;
