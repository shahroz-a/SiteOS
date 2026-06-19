import { Router, type IRouter, type Request, type Response } from "express";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db, usersTable, auditLogsTable } from "@workspace/db";
import {
  GetCmsMeResponse,
  ListCmsUsersResponse,
  ListCmsAuditLogsQueryParams,
  ListCmsAuditLogsResponse,
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
    const { page, limit } = ListCmsAuditLogsQueryParams.parse(req.query);
    const offset = (page - 1) * limit;

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogsTable);
    const total = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const rows = await db
      .select()
      .from(auditLogsTable)
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

export default router;
