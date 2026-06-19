import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateCmsAuthorBody,
  UpdateCmsAuthorBody,
  UpdateCmsAuthorParams,
  UpdateCmsAuthorResponse,
  DeleteCmsAuthorParams,
  DeleteCmsAuthorResponse,
  ListCmsAuthorsResponse,
  ArchiveCmsAuthorParams,
  ArchiveCmsAuthorBody,
  ArchiveCmsAuthorResponse,
  CreateCmsCategoryBody,
  UpdateCmsCategoryBody,
  UpdateCmsCategoryParams,
  UpdateCmsCategoryResponse,
  DeleteCmsCategoryParams,
  DeleteCmsCategoryResponse,
  ListCmsCategoriesResponse,
  ArchiveCmsCategoryParams,
  ArchiveCmsCategoryBody,
  ArchiveCmsCategoryResponse,
  MergeCmsCategoryParams,
  MergeCmsCategoryBody,
  MergeCmsCategoryResponse,
  CreateCmsTagBody,
  UpdateCmsTagBody,
  UpdateCmsTagParams,
  UpdateCmsTagResponse,
  DeleteCmsTagParams,
  DeleteCmsTagResponse,
  ListCmsTagsResponse,
  ArchiveCmsTagParams,
  ArchiveCmsTagBody,
  ArchiveCmsTagResponse,
  MergeCmsTagParams,
  MergeCmsTagBody,
  MergeCmsTagResponse,
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
  listAuthorsForCms,
  listCategoriesForCms,
  listTagsForCms,
  archiveAuthor,
  archiveCategory,
  archiveTag,
  mergeCategories,
  mergeTags,
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

router.get(
  "/cms/authors",
  requireAuth,
  requirePermission("taxonomy.manage"),
  async (_req: Request, res: Response) => {
    const rows = await listAuthorsForCms();
    res.json(ListCmsAuthorsResponse.parse(rows));
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

router.post(
  "/cms/authors/:id/archive",
  requireAuth,
  requirePermission("taxonomy.manage"),
  async (req: Request, res: Response) => {
    const { id } = ArchiveCmsAuthorParams.parse(req.params);
    const parsed = ArchiveCmsAuthorBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }
    const row = await archiveAuthor(id, parsed.data.archived);
    if (!row) {
      res.status(404).json({ error: "Author not found" });
      return;
    }
    await recordAudit(req, {
      action: parsed.data.archived ? "author.archive" : "author.restore",
      entityType: "author",
      entityId: id,
      actorRole: req.cmsRole ?? null,
      after: { archived: row.archived },
    });
    res.json(ArchiveCmsAuthorResponse.parse(row));
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

router.get(
  "/cms/categories",
  requireAuth,
  requirePermission("taxonomy.manage"),
  async (_req: Request, res: Response) => {
    const rows = await listCategoriesForCms();
    res.json(ListCmsCategoriesResponse.parse(rows));
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

router.post(
  "/cms/categories/:id/archive",
  requireAuth,
  requirePermission("taxonomy.manage"),
  async (req: Request, res: Response) => {
    const { id } = ArchiveCmsCategoryParams.parse(req.params);
    const parsed = ArchiveCmsCategoryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }
    const row = await archiveCategory(id, parsed.data.archived);
    if (!row) {
      res.status(404).json({ error: "Category not found" });
      return;
    }
    await recordAudit(req, {
      action: parsed.data.archived ? "category.archive" : "category.restore",
      entityType: "category",
      entityId: id,
      actorRole: req.cmsRole ?? null,
      after: { archived: row.archived },
    });
    res.json(ArchiveCmsCategoryResponse.parse(row));
  },
);

router.post(
  "/cms/categories/:id/merge",
  requireAuth,
  requirePermission("taxonomy.manage"),
  async (req: Request, res: Response) => {
    const { id } = MergeCmsCategoryParams.parse(req.params);
    const parsed = MergeCmsCategoryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }
    const result = await mergeCategories(id, parsed.data.targetId);
    if (!result.ok) {
      if (result.reason === "same") {
        res.status(400).json({ error: "Cannot merge a category into itself" });
        return;
      }
      res.status(404).json({
        error:
          result.reason === "source"
            ? "Source category not found"
            : "Target category not found",
      });
      return;
    }
    await recordAudit(req, {
      action: "category.merge",
      entityType: "category",
      entityId: id,
      actorRole: req.cmsRole ?? null,
      after: { mergedInto: parsed.data.targetId },
    });
    res.json(MergeCmsCategoryResponse.parse(result.target));
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

router.get(
  "/cms/tags",
  requireAuth,
  requirePermission("taxonomy.manage"),
  async (_req: Request, res: Response) => {
    const rows = await listTagsForCms();
    res.json(ListCmsTagsResponse.parse(rows));
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

router.post(
  "/cms/tags/:id/archive",
  requireAuth,
  requirePermission("taxonomy.manage"),
  async (req: Request, res: Response) => {
    const { id } = ArchiveCmsTagParams.parse(req.params);
    const parsed = ArchiveCmsTagBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }
    const row = await archiveTag(id, parsed.data.archived);
    if (!row) {
      res.status(404).json({ error: "Tag not found" });
      return;
    }
    await recordAudit(req, {
      action: parsed.data.archived ? "tag.archive" : "tag.restore",
      entityType: "tag",
      entityId: id,
      actorRole: req.cmsRole ?? null,
      after: { archived: row.archived },
    });
    res.json(ArchiveCmsTagResponse.parse(row));
  },
);

router.post(
  "/cms/tags/:id/merge",
  requireAuth,
  requirePermission("taxonomy.manage"),
  async (req: Request, res: Response) => {
    const { id } = MergeCmsTagParams.parse(req.params);
    const parsed = MergeCmsTagBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }
    const result = await mergeTags(id, parsed.data.targetId);
    if (!result.ok) {
      if (result.reason === "same") {
        res.status(400).json({ error: "Cannot merge a tag into itself" });
        return;
      }
      res.status(404).json({
        error:
          result.reason === "source"
            ? "Source tag not found"
            : "Target tag not found",
      });
      return;
    }
    await recordAudit(req, {
      action: "tag.merge",
      entityType: "tag",
      entityId: id,
      actorRole: req.cmsRole ?? null,
      after: { mergedInto: parsed.data.targetId },
    });
    res.json(MergeCmsTagResponse.parse(result.target));
  },
);

export default router;
