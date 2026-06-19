import { Router, type IRouter, type Request, type Response } from "express";
import {
  ListCmsMediaQueryParams,
  ListCmsMediaResponse,
  SuggestCmsMediaAltBody,
  SuggestCmsMediaAltBatchBody,
  UpdateCmsMediaAltBody,
  UpdateCmsMediaMetadataBody,
} from "@workspace/api-zod";
import { requireAuth, requirePermission } from "../middlewares/rbac";
import { recordAudit } from "../lib/audit";
import {
  listMedia,
  suggestAltText,
  suggestAltTextBatch,
  updateAltByUrl,
  updateMetadataByUrl,
  MEDIA_METADATA_FIELDS,
} from "../lib/media";

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

// Suggest alt text for many images in one pass (bulk action from the media
// library). Each image is described independently and per-image failures are
// reported inline, so a single bad image never fails the whole batch. Nothing
// is saved — every suggestion is returned for individual editor review. Gated
// on media.manage.
router.post(
  "/cms/media/suggest-alt-batch",
  requireAuth,
  requirePermission("media.manage"),
  async (req: Request, res: Response) => {
    const parsed = SuggestCmsMediaAltBatchBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid body", details: parsed.error.issues });
      return;
    }

    // One result per requested URL, in request order (the response contract).
    const results = await suggestAltTextBatch(parsed.data.urls);
    res.json({ results });
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
    const { updatedUsages, before, after } = await updateAltByUrl(url, alt);
    if (updatedUsages === 0) {
      res.status(404).json({ error: "No image with that URL exists." });
      return;
    }

    // Record the alt-text change in the append-only audit trail so there is a
    // record of who changed an image's alt text and when. The CDN URL is the
    // stable media identifier (entityId), matching the audit-log display
    // contract for `media.metadata.update` entries.
    await recordAudit(req, {
      action: "media.metadata.update",
      entityType: "media",
      entityId: url,
      actorRole: req.cmsRole ?? null,
      before: { alt: before.alt, altStatus: before.altStatus },
      after: { alt: after.alt, altStatus: after.altStatus },
      metadata: { url, updatedUsages },
    });

    res.json({ url, alt, updatedUsages });
  },
);

// Save reviewed free-text metadata (title/caption/credit) for a media item,
// updating every usage of the image (keyed by CDN URL) across all pages. At
// least one of title/caption/credit must be present. Gated on media.manage.
router.patch(
  "/cms/media/metadata",
  requireAuth,
  requirePermission("media.manage"),
  async (req: Request, res: Response) => {
    const parsed = UpdateCmsMediaMetadataBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid body", details: parsed.error.issues });
      return;
    }

    const { url, title, caption, credit } = parsed.data;

    // Require at least one editable field — a URL-only request changes nothing.
    const edits: Record<string, string | null | undefined> = {
      title,
      caption,
      credit,
    };
    const provided = MEDIA_METADATA_FIELDS.filter((f) => f in parsed.data);
    if (provided.length === 0) {
      res.status(400).json({
        error: "Provide at least one of title, caption or credit.",
      });
      return;
    }

    const { updatedUsages, before, after, changedFields } =
      await updateMetadataByUrl(
        url,
        Object.fromEntries(provided.map((f) => [f, edits[f]])),
      );
    if (updatedUsages === 0) {
      res.status(404).json({ error: "No image with that URL exists." });
      return;
    }

    // Record the metadata change in the append-only audit trail (only when a
    // value actually changed) so there is a record of who changed an image's
    // title/caption/credit and when. The CDN URL is the stable media identifier
    // (entityId), and before/after carry only the changed fields — matching the
    // audit-log display contract for `media.metadata.update` entries.
    if (changedFields.length > 0) {
      await recordAudit(req, {
        action: "media.metadata.update",
        entityType: "media",
        entityId: url,
        actorRole: req.cmsRole ?? null,
        before: Object.fromEntries(changedFields.map((f) => [f, before[f]])),
        after: Object.fromEntries(changedFields.map((f) => [f, after[f]])),
        metadata: { url, updatedUsages, changedFields },
      });
    }

    res.json({
      url,
      title: after.title,
      caption: after.caption,
      credit: after.credit,
      updatedUsages,
      changedFields,
    });
  },
);

export default router;
