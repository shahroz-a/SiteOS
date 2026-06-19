import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import {
  db,
  usersTable,
  auditLogsTable,
  pagesTable,
  validationReportsTable,
} from "@workspace/db";
import {
  GetCmsMeResponse,
  ListCmsUsersResponse,
  ListCmsAuditLogsQueryParams,
  ListCmsAuditLogsResponse,
  ListCmsHeldBackArticlesResponse,
  GetCmsHeldBackArticleSourceParams,
  GetCmsHeldBackArticleSourceResponse,
  ResolveCmsHeldBackArticleBody,
  ResolveCmsHeldBackArticleParams,
  ResolveCmsHeldBackArticleResponse,
  UpdateCmsUserRoleBody,
  UpdateCmsUserRoleParams,
  UpdateCmsUserRoleResponse,
} from "@workspace/api-zod";
import {
  DEFAULT_ROLE,
  getPermissionsForRole,
  isRole,
  type Role,
} from "@workspace/cms-auth";
import { rescoreStoredValidation } from "@workspace/content-validation";
import { requireAuth, requirePermission } from "../middlewares/rbac";
import { recordAudit } from "../lib/audit";
import { runReextract, type ReextractEvent } from "../lib/reextract";

const router: IRouter = Router();

function normalizeRole(value: unknown): Role {
  return isRole(value) ? value : DEFAULT_ROLE;
}

// The current CMS user with role and effective permissions.
router.get("/cms/me", requireAuth, (req: Request, res: Response) => {
  // requireAuth guarantees an authenticated user + cmsRole.
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const role = req.cmsRole ?? DEFAULT_ROLE;
  res.json(
    GetCmsMeResponse.parse({
      user: {
        id: req.user.id,
        email: req.user.email,
        firstName: req.user.firstName,
        lastName: req.user.lastName,
        profileImageUrl: req.user.profileImageUrl,
      },
      role,
      permissions: getPermissionsForRole(role),
    }),
  );
});

// List all CMS users and their roles. Requires user management.
router.get(
  "/cms/users",
  requireAuth,
  requirePermission("users.manage"),
  async (_req: Request, res: Response) => {
    const rows = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        profileImageUrl: usersTable.profileImageUrl,
        role: usersTable.role,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .orderBy(asc(usersTable.createdAt));

    res.json(
      ListCmsUsersResponse.parse(
        rows.map((u) => ({
          ...u,
          role: normalizeRole(u.role),
          createdAt: u.createdAt.toISOString(),
        })),
      ),
    );
  },
);

// Change a CMS user's role. Admin-only (gated on users.manage) and audited.
router.patch(
  "/cms/users/:userId/role",
  requireAuth,
  requirePermission("users.manage"),
  async (req: Request, res: Response) => {
    const parsed = UpdateCmsUserRoleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }
    const { role } = parsed.data;
    const { userId } = UpdateCmsUserRoleParams.parse(req.params);

    const [existing] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        profileImageUrl: usersTable.profileImageUrl,
        role: usersTable.role,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const [updated] = await db
      .update(usersTable)
      .set({ role, updatedAt: new Date() })
      .where(eq(usersTable.id, userId))
      .returning({
        id: usersTable.id,
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        profileImageUrl: usersTable.profileImageUrl,
        role: usersTable.role,
        createdAt: usersTable.createdAt,
      });

    await recordAudit(req, {
      action: "user.role.update",
      entityType: "user",
      entityId: userId,
      actorRole: req.cmsRole ?? null,
      before: { role: existing.role },
      after: { role: updated.role },
    });

    res.json(
      UpdateCmsUserRoleResponse.parse({
        ...updated,
        role: normalizeRole(updated.role),
        createdAt: updated.createdAt.toISOString(),
      }),
    );
  },
);

// Paginated audit trail of privileged CMS actions, newest first. Gated on
// audit.view so admins/editors can see who changed what.
router.get(
  "/cms/audit-logs",
  requireAuth,
  requirePermission("audit.view"),
  async (req: Request, res: Response) => {
    const { page, limit, action, entityType, entityId, actorId, from, to } =
      ListCmsAuditLogsQueryParams.parse({
        ...req.query,
        // `from`/`to` are date-typed in the contract; coerce the query strings.
        from: req.query.from ? new Date(String(req.query.from)) : undefined,
        to: req.query.to ? new Date(String(req.query.to)) : undefined,
      });
    const offset = (page - 1) * limit;

    const filters: SQL[] = [];
    if (action) filters.push(eq(auditLogsTable.action, action));
    if (entityType) filters.push(eq(auditLogsTable.entityType, entityType));
    if (entityId) filters.push(eq(auditLogsTable.entityId, entityId));
    if (actorId) filters.push(eq(auditLogsTable.actorId, actorId));
    if (from) filters.push(gte(auditLogsTable.createdAt, from));
    if (to) filters.push(lte(auditLogsTable.createdAt, to));
    const where = filters.length ? and(...filters) : undefined;

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogsTable)
      .where(where);
    const total = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const rows = await db
      .select()
      .from(auditLogsTable)
      .where(where)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json(
      ListCmsAuditLogsResponse.parse({
        items: rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        })),
        pagination: { page, limit, total, totalPages },
      }),
    );
  },
);

// The editor review queue: articles held back from the public read API because
// content-fidelity validation failed (pages.status="draft"). Each entry's
// verdict is re-scored at request time through the CURRENT validator (via the
// shared `rescoreStoredValidation` helper), so editors always see the live
// reason an article is held back — never a stale verdict written by an older
// validator. Gated on review.approve (reviewer/editor/admin).
router.get(
  "/cms/held-back-articles",
  requireAuth,
  requirePermission("review.approve"),
  async (_req: Request, res: Response) => {
    // The held-back SET is driven by pages.status="draft" + page_type="post";
    // other draft page types are not part of the "broken article" queue.
    const drafts = await db
      .select({
        id: pagesTable.id,
        slug: pagesTable.slug,
        title: pagesTable.title,
        url: pagesTable.canonicalUrl,
        pageType: pagesTable.pageType,
        crawledAt: pagesTable.crawledAt,
      })
      .from(pagesTable)
      .where(and(eq(pagesTable.status, "draft"), eq(pagesTable.pageType, "post")))
      .orderBy(desc(pagesTable.crawledAt));

    // Latest validation row per draft page (one row per (re)validation), used as
    // the captured source/parsed tallies the current validator re-scores.
    const validationRows = await db
      .select({
        pageId: validationReportsTable.pageId,
        issues: validationReportsTable.issues,
      })
      .from(validationReportsTable)
      .innerJoin(pagesTable, eq(validationReportsTable.pageId, pagesTable.id))
      .where(and(eq(pagesTable.status, "draft"), eq(pagesTable.pageType, "post")))
      .orderBy(desc(validationReportsTable.createdAt));
    const latestByPage = new Map<string, unknown>();
    for (const v of validationRows) {
      if (v.pageId && !latestByPage.has(v.pageId)) latestByPage.set(v.pageId, v.issues);
    }

    const articles = drafts.map((p) => {
      const stored = latestByPage.get(p.id);
      // No validation row yet → nothing to re-score; carry null verdict fields.
      if (stored === undefined) {
        return {
          id: p.id,
          slug: p.slug,
          title: p.title,
          url: p.url,
          crawledAt: p.crawledAt ? p.crawledAt.toISOString() : null,
          validationStatus: null,
          validationScore: null,
          issues: null,
        };
      }
      const rescored = rescoreStoredValidation(stored, {
        pageType: p.pageType,
        url: p.url,
        title: p.title,
      });
      return {
        id: p.id,
        slug: p.slug,
        title: p.title,
        url: p.url,
        crawledAt: p.crawledAt ? p.crawledAt.toISOString() : null,
        validationStatus: rescored.status,
        validationScore: rescored.score,
        issues: rescored.issues,
      };
    });

    res.json(
      ListCmsHeldBackArticlesResponse.parse({
        total: articles.length,
        articles,
      }),
    );
  },
);

// Act on a held-back article from the review queue. A permitted user can
// "publish" (flip pages.status draft → published, releasing the article to the
// public read API as an explicit override of failing validation) or "dismiss"
// (flip draft → archived so it leaves the queue without becoming public). Only
// rows still in the queue (status="draft", page_type="post") can be acted on.
// Gated on review.approve and audited via the append-only audit log.
router.patch(
  "/cms/held-back-articles/:id",
  requireAuth,
  requirePermission("review.approve"),
  async (req: Request, res: Response) => {
    const parsedBody = ResolveCmsHeldBackArticleBody.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: "Invalid action" });
      return;
    }
    const { action } = parsedBody.data;
    const { id } = ResolveCmsHeldBackArticleParams.parse(req.params);

    // Only a draft post is part of the review queue; refuse to act on anything
    // already published/archived or that isn't an article.
    const [existing] = await db
      .select({ id: pagesTable.id, slug: pagesTable.slug })
      .from(pagesTable)
      .where(
        and(
          eq(pagesTable.id, id),
          eq(pagesTable.status, "draft"),
          eq(pagesTable.pageType, "post"),
        ),
      );

    if (!existing) {
      res.status(404).json({ error: "Article not found in the review queue" });
      return;
    }

    const nextStatus = action === "publish" ? "published" : "archived";

    const [updated] = await db
      .update(pagesTable)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(pagesTable.id, id))
      .returning({ id: pagesTable.id, slug: pagesTable.slug, status: pagesTable.status });

    await recordAudit(req, {
      action: action === "publish" ? "article.publish" : "article.dismiss",
      entityType: "page",
      entityId: id,
      actorRole: req.cmsRole ?? null,
      before: { status: "draft" },
      after: { status: nextStatus },
    });

    res.json(
      ResolveCmsHeldBackArticleResponse.parse({
        id: updated.id,
        slug: updated.slug,
        status: updated.status,
      }),
    );
  },
);

// Source-vs-parsed bodies for ONE held-back article, powering the review
// drawer's side-by-side preview. Returns the faithful source body (cleaned
// article HTML, falling back to the raw original HTML) next to the parsed
// structured trees (componentTree + richText) the importer extracted, so an
// editor can render them side by side and see exactly what content the importer
// dropped or garbled. Only articles still in the queue (status="draft",
// page_type="post") are exposed. `original_html` is large, so it is fetched
// only as a fallback (second query) when the cleaned body is empty — never
// eagerly. Gated on review.approve.
router.get(
  "/cms/held-back-articles/:id/source",
  requireAuth,
  requirePermission("review.approve"),
  async (req: Request, res: Response) => {
    const { id } = GetCmsHeldBackArticleSourceParams.parse(req.params);

    const [page] = await db
      .select({
        id: pagesTable.id,
        slug: pagesTable.slug,
        title: pagesTable.title,
        url: pagesTable.canonicalUrl,
        cleanedHtml: pagesTable.cleanedHtml,
        componentTree: pagesTable.componentTree,
        richText: pagesTable.richText,
      })
      .from(pagesTable)
      .where(
        and(
          eq(pagesTable.id, id),
          eq(pagesTable.status, "draft"),
          eq(pagesTable.pageType, "post"),
        ),
      );

    if (!page) {
      res.status(404).json({ error: "Article not found in the review queue" });
      return;
    }

    const cleaned = page.cleanedHtml?.trim() ? page.cleanedHtml : null;
    let sourceHtml: string | null = cleaned;
    let sourceKind: "cleaned" | "original" | null = cleaned ? "cleaned" : null;

    // Fall back to the (large) raw original HTML only when there is no cleaned
    // body. Fetched in its own query so the common path never materializes the
    // ~500KB-per-row original_html column.
    if (!sourceHtml) {
      const [raw] = await db
        .select({ originalHtml: pagesTable.originalHtml })
        .from(pagesTable)
        .where(eq(pagesTable.id, id));
      if (raw?.originalHtml?.trim()) {
        sourceHtml = raw.originalHtml;
        sourceKind = "original";
      }
    }

    res.json(
      GetCmsHeldBackArticleSourceResponse.parse({
        id: page.id,
        slug: page.slug,
        title: page.title,
        url: page.url,
        sourceHtml,
        sourceKind,
        componentTree: page.componentTree ?? null,
        richText: page.richText ?? null,
      }),
    );
  },
);

// Re-extract a held-back article from its source URL and stream live progress.
//
// This re-runs the crawler's fetch → parse → validate → store pipeline for one
// page so an editor can give a transiently-broken extraction a fresh try from
// the review drawer. Because the work runs as a child process emitting staged
// progress, the response is a streamed NDJSON body (one JSON object per line)
// rather than a single JSON payload — so it is intentionally NOT part of the
// OpenAPI/orval contract (like the sitemap/feed routes). The client reads the
// stream and shows each stage; a slow/unreachable source is killed after a hard
// timeout and reported as a terminal `{type:"error",code:"timeout"}` event.
router.post(
  "/cms/held-back-articles/:id/reextract",
  requireAuth,
  requirePermission("review.approve"),
  async (req: Request, res: Response) => {
    const { id } = ResolveCmsHeldBackArticleParams.parse(req.params);

    // Only a draft post is part of the review queue; refuse anything else with a
    // normal JSON error before we switch the response into streaming mode.
    const [existing] = await db
      .select({ id: pagesTable.id })
      .from(pagesTable)
      .where(
        and(
          eq(pagesTable.id, id),
          eq(pagesTable.status, "draft"),
          eq(pagesTable.pageType, "post"),
        ),
      );

    if (!existing) {
      res.status(404).json({ error: "Article not found in the review queue" });
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    let ended = false;
    const send = (event: ReextractEvent) => {
      if (ended) return;
      res.write(`${JSON.stringify(event)}\n`);
    };

    let result: ReextractEvent | null = null;
    const cancel = runReextract(id, {
      onEvent: (event) => {
        if (event.type === "result") result = event;
        send(event);
      },
      onClose: ({ timedOut }) => {
        if (timedOut) {
          send({
            type: "error",
            code: "timeout",
            message:
              "The source took too long to respond and was stopped. Try again later.",
          });
        }
        if (result) {
          void recordAudit(req, {
            action: "article.reextract",
            entityType: "page",
            entityId: id,
            actorRole: req.cmsRole ?? null,
            after: {
              validationStatus: result.validationStatus ?? null,
              status: result.pageStatus ?? null,
            },
          });
        }
        ended = true;
        res.end();
      },
    });

    // If the editor closes the drawer / navigates away, stop the child process.
    req.on("close", () => {
      ended = true;
      cancel();
    });
  },
);

export default router;
