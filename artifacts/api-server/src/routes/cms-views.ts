import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, or } from "drizzle-orm";
import { db, savedViewsTable } from "@workspace/db";
import {
  ListSavedViewsResponse,
  CreateSavedViewBody,
  UpdateSavedViewParams,
  UpdateSavedViewBody,
  UpdateSavedViewResponse,
  DeleteSavedViewParams,
  DeleteSavedViewResponse,
} from "@workspace/api-zod";
import { requireAuth, requirePermission } from "../middlewares/rbac";

const router: IRouter = Router();

type SavedViewRow = typeof savedViewsTable.$inferSelect;

function serialize(row: SavedViewRow, viewerId: string) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    query: row.query,
    shared: row.shared,
    isOwner: row.userId === viewerId,
    ownerId: row.userId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// List the signed-in user's saved views, newest first.
router.get(
  "/cms/saved-views",
  requireAuth,
  requirePermission("content.view"),
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    // Return the user's own views plus any view shared by another user.
    const rows = await db
      .select()
      .from(savedViewsTable)
      .where(
        or(
          eq(savedViewsTable.userId, req.user.id),
          eq(savedViewsTable.shared, true),
        ),
      )
      .orderBy(desc(savedViewsTable.updatedAt));

    res.json(
      ListSavedViewsResponse.parse({
        items: rows.map((row) => serialize(row, req.user.id)),
      }),
    );
  },
);

// Create a saved view scoped to the signed-in user.
router.post(
  "/cms/saved-views",
  requireAuth,
  requirePermission("content.view"),
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const parsed = CreateSavedViewBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid saved view" });
      return;
    }
    const { name, description, query, shared } = parsed.data;

    const [created] = await db
      .insert(savedViewsTable)
      .values({
        userId: req.user.id,
        name,
        description: description ?? null,
        query,
        shared: shared ?? false,
      })
      .returning();

    res
      .status(201)
      .json(UpdateSavedViewResponse.parse(serialize(created, req.user.id)));
  },
);

// Update one of the signed-in user's saved views.
router.patch(
  "/cms/saved-views/:id",
  requireAuth,
  requirePermission("content.view"),
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const { id } = UpdateSavedViewParams.parse(req.params);
    const parsed = UpdateSavedViewBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid saved view" });
      return;
    }
    const { name, description, query, shared } = parsed.data;

    const updates: Partial<SavedViewRow> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description ?? null;
    if (query !== undefined) updates.query = query;
    if (shared !== undefined) updates.shared = shared;

    // Scoped to the owner — only the owner may rename/update/share a view.
    const [updated] = await db
      .update(savedViewsTable)
      .set(updates)
      .where(
        and(
          eq(savedViewsTable.id, id),
          eq(savedViewsTable.userId, req.user.id),
        ),
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Saved view not found" });
      return;
    }

    res.json(UpdateSavedViewResponse.parse(serialize(updated, req.user.id)));
  },
);

// Delete one of the signed-in user's saved views.
router.delete(
  "/cms/saved-views/:id",
  requireAuth,
  requirePermission("content.view"),
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const { id } = DeleteSavedViewParams.parse(req.params);

    const [deleted] = await db
      .delete(savedViewsTable)
      .where(
        and(
          eq(savedViewsTable.id, id),
          eq(savedViewsTable.userId, req.user.id),
        ),
      )
      .returning({ id: savedViewsTable.id });

    if (!deleted) {
      res.status(404).json({ error: "Saved view not found" });
      return;
    }

    res.json(DeleteSavedViewResponse.parse({ success: true, id: deleted.id }));
  },
);

export default router;
