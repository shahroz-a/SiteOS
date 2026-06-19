import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  varchar,
  boolean,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./auth";

/**
 * A saved search/filter view in the CMS. `query` stores the full search request
 * (the `q` term plus filters and sort) so a staff member can re-run a complex
 * global search with one click. Owned by a user (`userId`); a view can be marked
 * `shared` so every other authenticated CMS user can see and apply it. Shared
 * views remain editable/deletable only by their owner — non-owners get read-only
 * access (apply only). Private (non-shared) views stay visible to the owner only.
 */
export const savedViewsTable = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    /**
     * The persisted search request. Shape mirrors the `/cms/search` query
     * params: `{ q?, status?, pageType?, language?, category?, author?, tag?, sort? }`.
     */
    query: jsonb("query").$type<Record<string, unknown>>().notNull(),
    /**
     * When true, every other authenticated CMS user can see and apply this view
     * (but not rename/update/delete it). When false the view is private to its
     * owner. Defaults to private.
     */
    shared: boolean("shared").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("saved_views_user_idx").on(t.userId),
    unique("saved_views_user_name_uq").on(t.userId, t.name),
  ],
);

export const insertSavedViewSchema = createInsertSchema(savedViewsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSavedView = z.infer<typeof insertSavedViewSchema>;
export type SavedView = typeof savedViewsTable.$inferSelect;
