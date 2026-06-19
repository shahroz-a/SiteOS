import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
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
    const { page, limit, action } = ListCmsAuditLogsQueryParams.parse(
      req.query,
    );
    const offset = (page - 1) * limit;
    const where = action ? eq(auditLogsTable.action, action) : undefined;

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

export default router;
