import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateCmsPostBody,
  UpdateCmsPostBody,
  UpdateCmsPostParams,
  ScaffoldCmsPostBody,
  GetCmsPostParams,
  GetCmsPostResponse,
  UpdateCmsPostResponse,
  DeleteCmsPostParams,
  DeleteCmsPostResponse,
  DuplicateCmsPostParams,
  DuplicateCmsPostBody,
} from "@workspace/api-zod";
import { hasPermission, DEFAULT_ROLE, type Permission } from "@workspace/cms-auth";
import { requireAuth, requirePermission } from "../middlewares/rbac";
import { recordAudit } from "../lib/audit";
import {
  createPost,
  updatePost,
  deletePost,
  scaffoldPost,
  duplicatePost,
  serializeCmsPostDetail,
} from "../lib/cms-content";

const router: IRouter = Router();

// Create a new article with all nested content. Requires content.create.
router.post(
  "/cms/posts",
  requireAuth,
  requirePermission("content.create"),
  async (req: Request, res: Response) => {
    const parsed = CreateCmsPostBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid post", details: parsed.error.issues });
      return;
    }
    const detail = await createPost(parsed.data);
    await recordAudit(req, {
      action: "post.create",
      entityType: "page",
      entityId: detail.id,
      actorRole: req.cmsRole ?? null,
      after: { slug: detail.slug, status: detail.status, title: detail.title },
    });
    res.status(201).json(GetCmsPostResponse.parse(detail));
  },
);

// Create a blank draft scaffold. Requires content.create.
router.post(
  "/cms/posts/scaffold",
  requireAuth,
  requirePermission("content.create"),
  async (req: Request, res: Response) => {
    const parsed = ScaffoldCmsPostBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid scaffold", details: parsed.error.issues });
      return;
    }
    const detail = await scaffoldPost(parsed.data);
    await recordAudit(req, {
      action: "post.scaffold",
      entityType: "page",
      entityId: detail.id,
      actorRole: req.cmsRole ?? null,
      after: { slug: detail.slug, status: detail.status, title: detail.title },
    });
    res.status(201).json(GetCmsPostResponse.parse(detail));
  },
);

// Fetch a single article by internal id, any status. Requires content.view.
router.get(
  "/cms/posts/:id",
  requireAuth,
  requirePermission("content.view"),
  async (req: Request, res: Response) => {
    const { id } = GetCmsPostParams.parse(req.params);
    const detail = await serializeCmsPostDetail(id);
    if (!detail) {
      res.status(404).json({ error: "Post not found" });
      return;
    }
    res.json(GetCmsPostResponse.parse(detail));
  },
);

// Duplicate an article as a new draft with SEO flagged for review.
router.post(
  "/cms/posts/:id/duplicate",
  requireAuth,
  requirePermission("content.create"),
  async (req: Request, res: Response) => {
    const { id } = DuplicateCmsPostParams.parse(req.params);
    const parsed = DuplicateCmsPostBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid duplicate", details: parsed.error.issues });
      return;
    }
    const detail = await duplicatePost(id, parsed.data);
    if (!detail) {
      res.status(404).json({ error: "Post not found" });
      return;
    }
    await recordAudit(req, {
      action: "post.duplicate",
      entityType: "page",
      entityId: detail.id,
      actorRole: req.cmsRole ?? null,
      before: { sourceId: id },
      after: { slug: detail.slug, status: detail.status, title: detail.title },
    });
    res.status(201).json(GetCmsPostResponse.parse(detail));
  },
);

// Replace an article wholesale. Requires content.edit; slug/status changes are
// additionally gated and audited.
router.put(
  "/cms/posts/:id",
  requireAuth,
  requirePermission("content.edit"),
  async (req: Request, res: Response) => {
    const { id } = UpdateCmsPostParams.parse(req.params);
    const parsed = UpdateCmsPostBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid post", details: parsed.error.issues });
      return;
    }

    const before = await serializeCmsPostDetail(id);
    if (!before) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    const slugChanged = parsed.data.slug !== before.slug;
    const statusChanged = (parsed.data.status ?? before.status) !== before.status;
    const willPublish =
      statusChanged && (parsed.data.status ?? before.status) === "published";

    // Changing the public URL requires url.manage.
    if (slugChanged && !hasPerm(req, "url.manage")) {
      res.status(403).json({ error: "Changing the slug requires url.manage" });
      return;
    }
    // Publishing requires content.publish.
    if (willPublish && !hasPerm(req, "content.publish")) {
      res.status(403).json({ error: "Publishing requires content.publish" });
      return;
    }

    const detail = await updatePost(id, parsed.data);
    if (!detail) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    await recordAudit(req, {
      action: "post.update",
      entityType: "page",
      entityId: id,
      actorRole: req.cmsRole ?? null,
      before: { slug: before.slug, status: before.status, title: before.title },
      after: { slug: detail.slug, status: detail.status, title: detail.title },
    });
    res.json(UpdateCmsPostResponse.parse(detail));
  },
);

// Delete an article (cascades to all children). Requires content.delete.
router.delete(
  "/cms/posts/:id",
  requireAuth,
  requirePermission("content.delete"),
  async (req: Request, res: Response) => {
    const { id } = DeleteCmsPostParams.parse(req.params);
    const before = await serializeCmsPostDetail(id);
    const ok = await deletePost(id);
    if (!ok) {
      res.status(404).json({ error: "Post not found" });
      return;
    }
    await recordAudit(req, {
      action: "post.delete",
      entityType: "page",
      entityId: id,
      actorRole: req.cmsRole ?? null,
      before: before
        ? { slug: before.slug, status: before.status, title: before.title }
        : null,
    });
    res.json(DeleteCmsPostResponse.parse({ success: true, id }));
  },
);

function hasPerm(req: Request, permission: Permission): boolean {
  return hasPermission(req.cmsRole ?? DEFAULT_ROLE, permission);
}

export default router;
