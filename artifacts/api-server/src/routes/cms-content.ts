import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateCmsPostBody,
  UpdateCmsPostBody,
  UpdateCmsPostParams,
  ScaffoldCmsPostBody,
  GetCmsPostParams,
  GetCmsPostResponse,
  GetCmsPostSourceParams,
  GetCmsPostSourceResponse,
  UpdateCmsPostResponse,
  DeleteCmsPostParams,
  DeleteCmsPostResponse,
  DuplicateCmsPostParams,
  DuplicateCmsPostBody,
  ListCmsPostQueryParams,
  ListCmsPostResponse,
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
  loadPostSource,
  listCmsPosts,
} from "../lib/cms-content";
import { runPublishGate } from "../lib/seo-validation";

const router: IRouter = Router();

// List/search articles of any status. Requires content.view. Backs the content
// list and the internal-linking assistant (which needs draft/archived status).
router.get(
  "/cms/posts",
  requireAuth,
  requirePermission("content.view"),
  async (req: Request, res: Response) => {
    const parsed = ListCmsPostQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query", details: parsed.error.issues });
      return;
    }
    const { page, limit, q, status } = parsed.data;
    const result = await listCmsPosts({
      page: page ?? 1,
      limit: limit ?? 12,
      q: q ?? undefined,
      status: status ?? undefined,
    });
    res.json(ListCmsPostResponse.parse(result));
  },
);

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

// Source-vs-parsed bodies for ONE article (any status), powering the importer
// diff preview in the editor. Returns the faithful source body (cleaned article
// HTML, falling back to the raw original HTML) next to the parsed structured
// trees (componentTree + richText) the importer extracted, so an editor can
// sanity-check fidelity on ANY imported article — not just held-back ones.
// Restricted to posts (page_type="post"). Requires content.view.
router.get(
  "/cms/posts/:id/source",
  requireAuth,
  requirePermission("content.view"),
  async (req: Request, res: Response) => {
    const { id } = GetCmsPostSourceParams.parse(req.params);
    const source = await loadPostSource(id);
    if (!source) {
      res.status(404).json({ error: "Post not found" });
      return;
    }
    res.json(GetCmsPostSourceResponse.parse(source));
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

    // Publish gate: transitioning this article to public (published/scheduled)
    // via the wholesale update runs the SEO/content validation engine and blocks
    // on any critical failure. The validator reads persisted state, so we apply
    // the edits first, then gate; on a blocking failure we revert the status to
    // draft (keeping the content edits) so a failing article never goes public.
    const targetStatus = parsed.data.status ?? before.status;
    const goingPublic =
      statusChanged && (targetStatus === "published" || targetStatus === "scheduled");

    const detail = await updatePost(id, parsed.data);
    if (!detail) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    if (goingPublic) {
      const gate = await runPublishGate(id);
      if (gate && !gate.ok) {
        await updatePost(id, { ...parsed.data, status: "draft" });
        res
          .status(422)
          .json({ error: gate.summary, blocking: gate.result.blocking });
        return;
      }
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
