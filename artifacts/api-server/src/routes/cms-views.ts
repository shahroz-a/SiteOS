import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
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

function serialize(row: SavedViewRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    query: row.query,
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
    const rows = await db
      .select()
      .from(savedViewsTable)
      .where(eq(savedViewsTable.userId, req.user.id))
      .orderBy(desc(savedViewsTable.updatedAt));

    res.json(
      ListSavedViewsResponse.parse({ items: rows.map(serialize) }),
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
    const { name, description, query } = parsed.data;

    const [created] = await db
      .insert(savedViewsTable)
      .values({
        userId: req.user.id,
        name,
        description: description ?? null,
        query,
      })
      .returning();

    res.status(201).json(UpdateSavedViewResponse.parse(serialize(created)));
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
    const { name, description, query } = parsed.data;

    const updates: Partial<SavedViewRow> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description ?? null;
    if (query !== undefined) updates.query = query;

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

    res.json(UpdateSavedViewResponse.parse(serialize(updated)));
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
