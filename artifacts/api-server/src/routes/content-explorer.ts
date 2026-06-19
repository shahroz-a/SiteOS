import { Router, type IRouter, type Request, type Response } from "express";
import {
  ListContentExplorerQueryParams,
  ListContentExplorerResponse,
  BulkTransitionContentBody,
  BulkTransitionContentResponse,
  BulkUpdateContentCategoryBody,
  BulkUpdateContentCategoryResponse,
  BulkUpdateContentAuthorBody,
  BulkUpdateContentAuthorResponse,
  BulkUpdateContentSeoBody,
  BulkUpdateContentSeoResponse,
  BulkExportContentBody,
  BulkExportContentResponse,
} from "@workspace/api-zod";
import { requireAuth, requirePermission } from "../middlewares/rbac";
import { recordAudit } from "../lib/audit";
import { hasPermission, DEFAULT_ROLE } from "@workspace/cms-auth";
import { requiredPermissionForTransition } from "../lib/cms-publishing";
import {
  listContentExplorer,
  bulkTransition,
  bulkSetCategory,
  bulkSetAuthor,
  bulkSetSeo,
  buildContentExport,
  type ExplorerSort,
  type ExplorerOrder,
} from "../lib/content-explorer";

const router: IRouter = Router();

// Server-side paginated/sortable/filterable list backing the Airtable-style
// content explorer. Read-only; any staffer who can view content may browse it.
router.get(
  "/cms/content-explorer",
  requireAuth,
  requirePermission("content.view"),
  async (req: Request, res: Response) => {
    const parsed = ListContentExplorerQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query", details: parsed.error.issues });
      return;
    }
    const { q, status, author, category, sort, order, page, limit } = parsed.data;
    const result = await listContentExplorer({
      q: q || undefined,
      status: status || undefined,
      author: author || undefined,
      category: category || undefined,
      sort: (sort as ExplorerSort | undefined) ?? "updated",
      order: (order as ExplorerOrder | undefined) ?? "desc",
      page,
      limit,
    });
    res.json(ListContentExplorerResponse.parse(result));
  },
);

// Bulk lifecycle transition. Enter with content.view; the precise per-item
// permission (content.edit / content.publish) is enforced inside bulkTransition
// against the actor's role. Every successful transition is audited individually.
router.post(
  "/cms/content-explorer/bulk/transition",
  requireAuth,
  requirePermission("content.view"),
  async (req: Request, res: Response) => {
    const parsed = BulkTransitionContentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }
    const role = req.cmsRole ?? DEFAULT_ROLE;
    const { ids, to, scheduledFor, note } = parsed.data;
    const result = await bulkTransition(ids, to, scheduledFor ?? null, role);

    for (const id of result.succeeded) {
      await recordAudit(req, {
        action: "post.transition",
        entityType: "page",
        entityId: id,
        actorRole: req.cmsRole ?? null,
        after: { status: to, scheduledFor: scheduledFor?.toISOString() ?? null },
        metadata: { bulk: true, ...(note ? { note } : {}) },
      });
    }

    res.json(BulkTransitionContentResponse.parse(result));
  },
);

// Bulk set/clear the primary category. Requires content.edit.
router.post(
  "/cms/content-explorer/bulk/category",
  requireAuth,
  requirePermission("content.edit"),
  async (req: Request, res: Response) => {
    const parsed = BulkUpdateContentCategoryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }
    const { ids, categoryId } = parsed.data;
    const result = await bulkSetCategory(ids, categoryId ?? null);

    for (const id of result.succeeded) {
      await recordAudit(req, {
        action: "post.category",
        entityType: "page",
        entityId: id,
        actorRole: req.cmsRole ?? null,
        after: { primaryCategoryId: categoryId ?? null },
        metadata: { bulk: true },
      });
    }

    res.json(BulkUpdateContentCategoryResponse.parse(result));
  },
);

// Bulk set/clear the author. Requires content.edit.
router.post(
  "/cms/content-explorer/bulk/author",
  requireAuth,
  requirePermission("content.edit"),
  async (req: Request, res: Response) => {
    const parsed = BulkUpdateContentAuthorBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }
    const { ids, authorId } = parsed.data;
    const result = await bulkSetAuthor(ids, authorId ?? null);

    for (const id of result.succeeded) {
      await recordAudit(req, {
        action: "post.author",
        entityType: "page",
        entityId: id,
        actorRole: req.cmsRole ?? null,
        after: { authorId: authorId ?? null },
        metadata: { bulk: true },
      });
    }

    res.json(BulkUpdateContentAuthorResponse.parse(result));
  },
);

// Bulk SEO field update. Requires seo.edit.
router.post(
  "/cms/content-explorer/bulk/seo",
  requireAuth,
  requirePermission("seo.edit"),
  async (req: Request, res: Response) => {
    const parsed = BulkUpdateContentSeoBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }
    const { ids, ...fields } = parsed.data;
    const result = await bulkSetSeo(ids, fields);

    for (const id of result.succeeded) {
      await recordAudit(req, {
        action: "post.seo",
        entityType: "page",
        entityId: id,
        actorRole: req.cmsRole ?? null,
        after: fields,
        metadata: { bulk: true },
      });
    }

    res.json(BulkUpdateContentSeoResponse.parse(result));
  },
);

// Export selected rows as a downloadable JSON/CSV envelope. Requires
// content.view (read-only); the export itself is audited.
router.post(
  "/cms/content-explorer/bulk/export",
  requireAuth,
  requirePermission("content.view"),
  async (req: Request, res: Response) => {
    const parsed = BulkExportContentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }
    const { ids, format } = parsed.data;
    const envelope = await buildContentExport(ids, format ?? "json");

    await recordAudit(req, {
      action: "content.export",
      entityType: "page",
      entityId: null,
      actorRole: req.cmsRole ?? null,
      metadata: { bulk: true, count: ids.length, format: format ?? "json" },
    });

    res.json(BulkExportContentResponse.parse(envelope));
  },
);

export default router;
