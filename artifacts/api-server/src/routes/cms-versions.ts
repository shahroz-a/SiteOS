import { Router, type IRouter, type Request, type Response } from "express";
import {
  ListCmsPostVersionsParams,
  ListCmsPostVersionsResponse,
  GetCmsPostVersionParams,
  GetCmsPostVersionResponse,
  CompareCmsPostVersionsParams,
  CompareCmsPostVersionsResponse,
  RestoreCmsPostVersionParams,
  RestoreCmsPostVersionResponse,
} from "@workspace/api-zod";
import { hasPermission, DEFAULT_ROLE, type Permission } from "@workspace/cms-auth";
import { requireAuth, requirePermission } from "../middlewares/rbac";
import { recordAudit } from "../lib/audit";
import { serializeCmsPostDetail } from "../lib/cms-content";
import {
  pageExists,
  listPageVersions,
  getPageVersionSnapshot,
  compareVersions,
  restoreVersion,
} from "../lib/cms-versions";

const router: IRouter = Router();

function hasPerm(req: Request, permission: Permission): boolean {
  return hasPermission(req.cmsRole ?? DEFAULT_ROLE, permission);
}

// List an article's version history (newest first). Requires content.view.
router.get(
  "/cms/posts/:id/versions",
  requireAuth,
  requirePermission("content.view"),
  async (req: Request, res: Response) => {
    const { id } = ListCmsPostVersionsParams.parse(req.params);
    if (!(await pageExists(id))) {
      res.status(404).json({ error: "Post not found" });
      return;
    }
    const { items, latestVersion } = await listPageVersions(id);
    res.json(ListCmsPostVersionsResponse.parse({ items, latestVersion }));
  },
);

// Compare two versions of an article. Requires content.view. Declared before
// the single-version route is irrelevant (different segment count), but kept
// grouped for readability.
router.get(
  "/cms/posts/:id/versions/:from/compare/:to",
  requireAuth,
  requirePermission("content.view"),
  async (req: Request, res: Response) => {
    const { id, from, to } = CompareCmsPostVersionsParams.parse(req.params);
    if (!(await pageExists(id))) {
      res.status(404).json({ error: "Post not found" });
      return;
    }
    const diff = await compareVersions(id, from, to);
    if (!diff) {
      res.status(404).json({ error: "Version not found" });
      return;
    }
    res.json(CompareCmsPostVersionsResponse.parse(diff));
  },
);

// Fetch a single version snapshot. Requires content.view.
router.get(
  "/cms/posts/:id/versions/:versionNumber",
  requireAuth,
  requirePermission("content.view"),
  async (req: Request, res: Response) => {
    const { id, versionNumber } = GetCmsPostVersionParams.parse(req.params);
    if (!(await pageExists(id))) {
      res.status(404).json({ error: "Post not found" });
      return;
    }
    const version = await getPageVersionSnapshot(id, versionNumber);
    if (!version) {
      res.status(404).json({ error: "Version not found" });
      return;
    }
    res.json(GetCmsPostVersionResponse.parse(version));
  },
);

// Restore an article to a previous version. Requires content.edit; restoring a
// snapshot whose status is "published" additionally requires content.publish.
// The restore itself is recorded as a new version and an audit entry.
router.post(
  "/cms/posts/:id/versions/:versionNumber/restore",
  requireAuth,
  requirePermission("content.edit"),
  async (req: Request, res: Response) => {
    const { id, versionNumber } = RestoreCmsPostVersionParams.parse(req.params);

    const version = await getPageVersionSnapshot(id, versionNumber);
    if (!version) {
      res.status(404).json({ error: "Version not found" });
      return;
    }

    const before = await serializeCmsPostDetail(id);
    if (!before) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    if (version.snapshot.status === "published" && !hasPerm(req, "content.publish")) {
      res
        .status(403)
        .json({ error: "Restoring a published version requires content.publish" });
      return;
    }

    const result = await restoreVersion(id, versionNumber);
    if (!result) {
      res.status(404).json({ error: "Version not found" });
      return;
    }

    await recordAudit(req, {
      action: "post.restore",
      entityType: "page",
      entityId: id,
      actorRole: req.cmsRole ?? null,
      before: {
        slug: before.slug,
        status: before.status,
        title: before.title,
        version: before.latestVersion,
      },
      after: {
        slug: result.detail.slug,
        status: result.detail.status,
        title: result.detail.title,
        restoredFrom: versionNumber,
        version: result.detail.latestVersion,
      },
    });

    res.json(RestoreCmsPostVersionResponse.parse(result.detail));
  },
);

export default router;
