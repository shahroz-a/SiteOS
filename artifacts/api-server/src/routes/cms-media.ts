import { Router, type IRouter, type Request, type Response } from "express";
import { ListCmsMediaQueryParams, ListCmsMediaResponse } from "@workspace/api-zod";
import { requireAuth, requirePermission } from "../middlewares/rbac";
import { listMedia } from "../lib/media";

const router: IRouter = Router();

// Browse the media library: unique CDN images with usage counts, referencing
// pages and alt-text accessibility validation. Reuses existing CDN URLs and
// never re-uploads binaries. Gated on media.manage.
router.get(
  "/cms/media",
  requireAuth,
  requirePermission("media.manage"),
  async (req: Request, res: Response) => {
    const parsed = ListCmsMediaQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid query", details: parsed.error.issues });
      return;
    }
    const { page, limit, q, onlyIssues } = parsed.data;

    const { items, total, summary } = await listMedia({
      page,
      limit,
      q: q?.trim() ? q.trim() : undefined,
      onlyIssues: onlyIssues ?? false,
    });

    const totalPages = Math.max(1, Math.ceil(total / limit));

    res.json(
      ListCmsMediaResponse.parse({
        items,
        pagination: { page, limit, total, totalPages },
        summary,
      }),
    );
  },
);

export default router;
