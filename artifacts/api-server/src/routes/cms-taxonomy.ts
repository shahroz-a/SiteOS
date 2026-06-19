import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateCmsAuthorBody,
  UpdateCmsAuthorBody,
  UpdateCmsAuthorParams,
  UpdateCmsAuthorResponse,
  DeleteCmsAuthorParams,
  DeleteCmsAuthorResponse,
  CreateCmsCategoryBody,
  UpdateCmsCategoryBody,
  UpdateCmsCategoryParams,
  UpdateCmsCategoryResponse,
  DeleteCmsCategoryParams,
  DeleteCmsCategoryResponse,
  CreateCmsTagBody,
  UpdateCmsTagBody,
  UpdateCmsTagParams,
  UpdateCmsTagResponse,
  DeleteCmsTagParams,
  DeleteCmsTagResponse,
} from "@workspace/api-zod";
import { requireAuth, requirePermission } from "../middlewares/rbac";
import { recordAudit } from "../lib/audit";
import {
  createAuthor,
  updateAuthor,
  deleteAuthor,
  createCategory,
  updateCategory,
  deleteCategory,
  createTag,
  updateTag,
  deleteTag,
} from "../lib/cms-taxonomy";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Authors
// ---------------------------------------------------------------------------

router.post(
  "/cms/authors",
  requireAuth,
  requirePermission("taxonomy.manage"),
  async (req: Request, res: Response) => {
    const parsed = CreateCmsAuthorBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid author", details: parsed.error.issues });
      return;
    }
    const row = await createAuthor(parsed.data);
    await recordAudit(req, {
      action: "author.create",
      entityType: "author",
      entityId: row.id,
      actorRole: req.cmsRole ?? null,
      after: { name: row.name, slug: row.slug },
    });
    res.status(201).json(UpdateCmsAuthorResponse.parse(row));
  },
);

router.put(
  "/cms/authors/:id",
  requireAuth,
  requirePermission("taxonomy.manage"),
  async (req: Request, res: Response) => {
    const { id } = UpdateCmsAuthorParams.parse(req.params);
    const parsed = UpdateCmsAuthorBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid author", details: parsed.error.issues });
      return;
    }
    const row = await updateAuthor(id, parsed.data);
    if (!row) {
      res.status(404).json({ error: "Author not found" });
      return;
    }
    await recordAudit(req, {
      action: "author.update",
      entityType: "author",
      entityId: id,
      actorRole: req.cmsRole ?? null,
      after: { name: row.name, slug: row.slug },
    });
    res.json(UpdateCmsAuthorResponse.parse(row));
  },
);

router.delete(
  "/cms/authors/:id",
  requireAuth,
  requirePermission("taxonomy.manage"),
  async (req: Request, res: Response) => {
    const { id } = DeleteCmsAuthorParams.parse(req.params);
    const ok = await deleteAuthor(id);
    if (!ok) {
      res.status(404).json({ error: "Author not found" });
      return;
    }
    await recordAudit(req, {
      action: "author.delete",
      entityType: "author",
      entityId: id,
      actorRole: req.cmsRole ?? null,
    });
    res.json(DeleteCmsAuthorResponse.parse({ success: true, id }));
  },
);

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

router.post(
  "/cms/categories",
  requireAuth,
  requirePermission("taxonomy.manage"),
  async (req: Request, res: Response) => {
    const parsed = CreateCmsCategoryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid category", details: parsed.error.issues });
      return;
    }
    const row = await createCategory(parsed.data);
    await recordAudit(req, {
      action: "category.create",
      entityType: "category",
      entityId: row.id,
      actorRole: req.cmsRole ?? null,
      after: { name: row.name, slug: row.slug },
    });
    res.status(201).json(UpdateCmsCategoryResponse.parse(row));
  },
);

router.put(
  "/cms/categories/:id",
  requireAuth,
  requirePermission("taxonomy.manage"),
  async (req: Request, res: Response) => {
    const { id } = UpdateCmsCategoryParams.parse(req.params);
    const parsed = UpdateCmsCategoryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid category", details: parsed.error.issues });
      return;
    }
    const row = await updateCategory(id, parsed.data);
    if (!row) {
      res.status(404).json({ error: "Category not found" });
      return;
    }
    await recordAudit(req, {
      action: "category.update",
      entityType: "category",
      entityId: id,
      actorRole: req.cmsRole ?? null,
      after: { name: row.name, slug: row.slug },
    });
    res.json(UpdateCmsCategoryResponse.parse(row));
  },
);

router.delete(
  "/cms/categories/:id",
  requireAuth,
  requirePermission("taxonomy.manage"),
  async (req: Request, res: Response) => {
    const { id } = DeleteCmsCategoryParams.parse(req.params);
    const ok = await deleteCategory(id);
    if (!ok) {
      res.status(404).json({ error: "Category not found" });
      return;
    }
    await recordAudit(req, {
      action: "category.delete",
      entityType: "category",
      entityId: id,
      actorRole: req.cmsRole ?? null,
    });
    res.json(DeleteCmsCategoryResponse.parse({ success: true, id }));
  },
);

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

router.post(
  "/cms/tags",
  requireAuth,
  requirePermission("taxonomy.manage"),
  async (req: Request, res: Response) => {
    const parsed = CreateCmsTagBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid tag", details: parsed.error.issues });
      return;
    }
    const row = await createTag(parsed.data);
    await recordAudit(req, {
      action: "tag.create",
      entityType: "tag",
      entityId: row.id,
      actorRole: req.cmsRole ?? null,
      after: { name: row.name, slug: row.slug },
    });
    res.status(201).json(UpdateCmsTagResponse.parse(row));
  },
);

router.put(
  "/cms/tags/:id",
  requireAuth,
  requirePermission("taxonomy.manage"),
  async (req: Request, res: Response) => {
    const { id } = UpdateCmsTagParams.parse(req.params);
    const parsed = UpdateCmsTagBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid tag", details: parsed.error.issues });
      return;
    }
    const row = await updateTag(id, parsed.data);
    if (!row) {
      res.status(404).json({ error: "Tag not found" });
      return;
    }
    await recordAudit(req, {
      action: "tag.update",
      entityType: "tag",
      entityId: id,
      actorRole: req.cmsRole ?? null,
      after: { name: row.name, slug: row.slug },
    });
    res.json(UpdateCmsTagResponse.parse(row));
  },
);

router.delete(
  "/cms/tags/:id",
  requireAuth,
  requirePermission("taxonomy.manage"),
  async (req: Request, res: Response) => {
    const { id } = DeleteCmsTagParams.parse(req.params);
    const ok = await deleteTag(id);
    if (!ok) {
      res.status(404).json({ error: "Tag not found" });
      return;
    }
    await recordAudit(req, {
      action: "tag.delete",
      entityType: "tag",
      entityId: id,
      actorRole: req.cmsRole ?? null,
    });
    res.json(DeleteCmsTagResponse.parse({ success: true, id }));
  },
);

export default router;
