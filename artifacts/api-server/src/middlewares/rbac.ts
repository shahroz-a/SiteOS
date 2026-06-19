import { type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  type Permission,
  type Role,
  DEFAULT_ROLE,
  hasPermission,
  isRole,
} from "@workspace/cms-auth";

declare global {
  namespace Express {
    interface Request {
      /** The acting user's CMS role, populated by `requireAuth`. */
      cmsRole?: Role;
    }
  }
}

/**
 * Loads the authenticated user's role from the DB and attaches it as
 * `req.cmsRole`. Responds 401 when there is no valid session. Use this before
 * any `requirePermission(...)` guard.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const [row] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id));

  if (!row) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  req.cmsRole = isRole(row.role) ? row.role : DEFAULT_ROLE;
  next();
}

/**
 * Guards a route on a single permission. Must run after `requireAuth` so
 * `req.cmsRole` is populated. Responds 403 when the role lacks the permission.
 */
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.cmsRole;
    if (!role) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (!hasPermission(role, permission)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

/**
 * Guards a route on holding ANY of the given permissions. Must run after
 * `requireAuth` so `req.cmsRole` is populated. Responds 403 when the role holds
 * none of them.
 */
export function requireAnyPermission(permissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.cmsRole;
    if (!role) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (!permissions.some((p) => hasPermission(role, p))) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}
