import { Router, type IRouter, type Request, type Response } from "express";
import {
  ListCmsMediaQueryParams,
  ListCmsMediaResponse,
  SuggestCmsMediaAltBody,
  UpdateCmsMediaAltBody,
} from "@workspace/api-zod";
import { requireAuth, requirePermission } from "../middlewares/rbac";
import { listMedia, suggestAltText, updateAltByUrl } from "../lib/media";

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

// Suggest an accessible alt-text description for an image using an AI vision
// model. The suggestion is returned to the editor for review/edit and is NEVER
// saved automatically. Gated on media.manage.
router.post(
  "/cms/media/suggest-alt",
  requireAuth,
  requirePermission("media.manage"),
  async (req: Request, res: Response) => {
    const parsed = SuggestCmsMediaAltBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid body", details: parsed.error.issues });
      return;
    }

    try {
      const suggestion = await suggestAltText(parsed.data.url);
      res.json({ suggestion });
    } catch (err) {
      req.log.error({ err }, "alt-text suggestion failed");
      res
        .status(502)
        .json({ error: "Couldn't generate an alt-text suggestion." });
    }
  },
);

// Save reviewed alt text for a media item, updating every usage of the image
// (keyed by CDN URL) across all pages. Gated on media.manage.
router.patch(
  "/cms/media/alt",
  requireAuth,
  requirePermission("media.manage"),
  async (req: Request, res: Response) => {
    const parsed = UpdateCmsMediaAltBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid body", details: parsed.error.issues });
      return;
    }

    const { url, alt } = parsed.data;
    const updatedUsages = await updateAltByUrl(url, alt);
    if (updatedUsages === 0) {
      res.status(404).json({ error: "No image with that URL exists." });
      return;
    }

    res.json({ url, alt, updatedUsages });
  },
);

export default router;
