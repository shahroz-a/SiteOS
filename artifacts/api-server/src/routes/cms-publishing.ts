import { Router, type IRouter, type Request, type Response } from "express";
import {
  TransitionCmsPostParams,
  TransitionCmsPostBody,
  TransitionCmsPostResponse,
  CreateCmsPreviewLinkParams,
  CreateCmsPreviewLinkBody,
  ChangeCmsPostUrlParams,
  ChangeCmsPostUrlBody,
  ChangeCmsPostUrlResponse,
} from "@workspace/api-zod";
import { requireAuth, requirePermission } from "../middlewares/rbac";
import { recordAudit } from "../lib/audit";
import {
  transitionPost,
  createPreviewToken,
  changePostUrl,
  requiredPermissionForTransition,
} from "../lib/cms-publishing";
import { serializeCmsPostDetail } from "../lib/cms-content";
import { hasPermission, DEFAULT_ROLE } from "@workspace/cms-auth";

const router: IRouter = Router();

// Move an article through its publish lifecycle. The transition itself is gated
// dynamically: publishing/scheduling (or leaving published) needs
// content.publish; other editorial moves need content.edit. We require
// content.view to enter, then enforce the precise permission once we know the
// source/target states. Every transition is audited.
router.post(
  "/cms/posts/:id/transition",
  requireAuth,
  requirePermission("content.view"),
  async (req: Request, res: Response) => {
    const { id } = TransitionCmsPostParams.parse(req.params);
    const parsed = TransitionCmsPostBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid transition", details: parsed.error.issues });
      return;
    }

    const before = await serializeCmsPostDetail(id);
    if (!before) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    const to = parsed.data.to;
    const perm = requiredPermissionForTransition(before.status, to);
    if (!hasPermission(req.cmsRole ?? DEFAULT_ROLE, perm)) {
      res.status(403).json({ error: `This transition requires ${perm}` });
      return;
    }

    const scheduledFor = parsed.data.scheduledFor ?? null;
    const result = await transitionPost(id, to, scheduledFor);
    if (!result.ok) {
      if (result.error === "not-found") {
        res.status(404).json({ error: "Post not found" });
        return;
      }
      const messages: Record<string, string> = {
        "invalid-transition": `Cannot move from ${before.status} to ${to}`,
        "schedule-required": "A future scheduledFor date is required to schedule",
        "schedule-in-past": "scheduledFor must be in the future",
      };
      res.status(400).json({ error: messages[result.error ?? ""] ?? "Invalid transition" });
      return;
    }

    await recordAudit(req, {
      action: "post.transition",
      entityType: "page",
      entityId: id,
      actorRole: req.cmsRole ?? null,
      before: { status: before.status },
      after: { status: to, scheduledFor: scheduledFor?.toISOString() ?? null },
      metadata: parsed.data.note ? { note: parsed.data.note } : null,
    });

    res.json(TransitionCmsPostResponse.parse(result.detail));
  },
);

// Mint an expiring shareable preview link for a draft. Anyone who can view
// content may share a preview (the token itself is the only secret).
router.post(
  "/cms/posts/:id/preview-link",
  requireAuth,
  requirePermission("content.view"),
  async (req: Request, res: Response) => {
    const { id } = CreateCmsPreviewLinkParams.parse(req.params);
    const parsed = CreateCmsPreviewLinkBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }

    const link = await createPreviewToken(
      id,
      parsed.data.expiresInHours,
      req.user?.id ?? null,
    );
    if (!link) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    await recordAudit(req, {
      action: "post.preview-link",
      entityType: "page",
      entityId: id,
      actorRole: req.cmsRole ?? null,
      after: { expiresAt: link.expiresAt.toISOString() },
    });

    res.status(201).json({
      token: link.token,
      url: `/blog/preview/${link.token}`,
      expiresAt: link.expiresAt.toISOString(),
    });
  },
);

// Change an article's slug/pathname and auto-create a redirect from the old
// path. Gated behind url.manage AND an explicit `confirm: true`.
router.patch(
  "/cms/posts/:id/url",
  requireAuth,
  requirePermission("url.manage"),
  async (req: Request, res: Response) => {
    const { id } = ChangeCmsPostUrlParams.parse(req.params);
    const parsed = ChangeCmsPostUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }
    if (!parsed.data.confirm) {
      res.status(400).json({ error: "URL changes must be explicitly confirmed" });
      return;
    }

    const result = await changePostUrl(
      id,
      parsed.data.slug,
      parsed.data.createRedirect,
    );
    if (!result.ok) {
      if (result.error === "not-found") {
        res.status(404).json({ error: "Post not found" });
        return;
      }
      const messages: Record<string, string> = {
        "empty-slug": "The slug cannot be empty",
        "slug-taken": "That slug is already in use by another article",
      };
      res.status(400).json({ error: messages[result.error ?? ""] ?? "Invalid request" });
      return;
    }

    await recordAudit(req, {
      action: "post.url-change",
      entityType: "page",
      entityId: id,
      actorRole: req.cmsRole ?? null,
      before: result.before ?? null,
      after: result.detail
        ? { slug: result.detail.slug, pathname: result.detail.pathname }
        : null,
    });

    res.json(ChangeCmsPostUrlResponse.parse(result.detail));
  },
);

export default router;
