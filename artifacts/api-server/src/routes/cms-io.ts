import { Router, type IRouter, type Request, type Response } from "express";
import {
  serializeBundle,
  parseBundle,
  FORMAT_META,
  EXPORT_FORMATS,
  IMPORT_FORMATS,
  PAYLOAD_COLLECTIONS,
  PAYLOAD_BLOCK_MAPPINGS,
  type ExportFormat,
  type ImportFormat,
} from "@workspace/content-io";
import { requireAuth, requirePermission } from "../middlewares/rbac";
import { recordAudit } from "../lib/audit";
import {
  loadContentBundle,
  importContentBundle,
  buildPayloadMigrationReport,
} from "../lib/content-io";

const router: IRouter = Router();

function isExportFormat(value: unknown): value is ExportFormat {
  return (
    typeof value === "string" && EXPORT_FORMATS.includes(value as ExportFormat)
  );
}

function isImportFormat(value: unknown): value is ImportFormat {
  return (
    typeof value === "string" && IMPORT_FORMATS.includes(value as ImportFormat)
  );
}

/**
 * Export the whole corpus in a single format. Returns a download envelope
 * `{ filename, contentType, content }` so the browser can save it without a
 * server-side zip dependency. Requires content.view.
 */
router.get(
  "/cms/export",
  requireAuth,
  requirePermission("content.view"),
  async (req: Request, res: Response) => {
    const format = req.query.format ?? "json";
    if (!isExportFormat(format)) {
      res.status(400).json({
        error: "Unsupported format",
        supported: EXPORT_FORMATS,
      });
      return;
    }
    const bundle = await loadContentBundle();
    const content = serializeBundle(bundle, format);
    const meta = FORMAT_META[format];
    const stamp = new Date().toISOString().slice(0, 10);
    res.json({
      filename: `headout-content-${stamp}.${meta.extension}`,
      contentType: meta.contentType,
      content,
      counts: bundle.counts,
    });
  },
);

/**
 * One-click full export: every supported format at once, returned as an array of
 * download envelopes. Requires content.view.
 */
router.get(
  "/cms/export/full",
  requireAuth,
  requirePermission("content.view"),
  async (_req: Request, res: Response) => {
    const bundle = await loadContentBundle();
    const stamp = new Date().toISOString().slice(0, 10);
    const files = EXPORT_FORMATS.map((format) => {
      const meta = FORMAT_META[format];
      return {
        format,
        filename: `headout-content-${stamp}.${meta.extension}`,
        contentType: meta.contentType,
        content: serializeBundle(bundle, format),
      };
    });
    res.json({ counts: bundle.counts, files });
  },
);

/**
 * Import content from a supported format. Non-destructive and transactional:
 * upserts by natural key and only rewrites a post when its content hash changed.
 * Requires content.create.
 */
router.post(
  "/cms/import",
  requireAuth,
  requirePermission("content.create"),
  async (req: Request, res: Response) => {
    const { format, content, dryRun } = (req.body ?? {}) as {
      format?: unknown;
      content?: unknown;
      dryRun?: unknown;
    };
    if (!isImportFormat(format)) {
      res
        .status(400)
        .json({ error: "Unsupported import format", supported: IMPORT_FORMATS });
      return;
    }
    if (typeof content !== "string" || content.length === 0) {
      res.status(400).json({ error: "Missing `content` string to import" });
      return;
    }
    let bundle;
    try {
      bundle = parseBundle(content, format);
    } catch (err) {
      req.log.warn({ err }, "Failed to parse import payload");
      res.status(400).json({
        error: "Could not parse content for the given format",
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const isDryRun = dryRun === true;
    const result = await importContentBundle(bundle, { dryRun: isDryRun });
    // A dry run is a preview that persists nothing, so it is not an auditable event.
    if (!isDryRun) {
      await recordAudit(req, {
        action: "content.import",
        entityType: "bundle",
        actorRole: req.cmsRole ?? null,
        metadata: { format, ...result },
      });
    }
    res.json(result);
  },
);

/**
 * Download a full JSON backup of the corpus (the canonical bundle). Restore-able
 * via POST /cms/restore. Admin-only (settings.manage).
 */
router.get(
  "/cms/backup",
  requireAuth,
  requirePermission("settings.manage"),
  async (_req: Request, res: Response) => {
    const bundle = await loadContentBundle();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    res.json({
      filename: `headout-backup-${stamp}.json`,
      contentType: "application/json",
      content: serializeBundle(bundle, "json"),
      counts: bundle.counts,
    });
  },
);

/**
 * Restore from a JSON backup produced by GET /cms/backup. Non-destructive
 * (same upsert semantics as import). Admin-only (settings.manage).
 */
router.post(
  "/cms/restore",
  requireAuth,
  requirePermission("settings.manage"),
  async (req: Request, res: Response) => {
    const { content } = (req.body ?? {}) as { content?: unknown };
    if (typeof content !== "string" || content.length === 0) {
      res.status(400).json({ error: "Missing backup `content` string" });
      return;
    }
    let bundle;
    try {
      bundle = parseBundle(content, "json");
    } catch (err) {
      res.status(400).json({
        error: "Invalid backup file",
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const result = await importContentBundle(bundle);
    await recordAudit(req, {
      action: "content.restore",
      entityType: "bundle",
      actorRole: req.cmsRole ?? null,
      metadata: { ...result },
    });
    res.json(result);
  },
);

/**
 * The Payload compatibility surface: the static collection + block mapping
 * registry plus a live migration report (block-type coverage over real data).
 * Requires content.view.
 */
router.get(
  "/cms/payload-mapping",
  requireAuth,
  requirePermission("content.view"),
  async (_req: Request, res: Response) => {
    const report = await buildPayloadMigrationReport();
    res.json({
      collections: PAYLOAD_COLLECTIONS,
      blockMappings: PAYLOAD_BLOCK_MAPPINGS,
      report,
    });
  },
);

export default router;
