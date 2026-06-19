import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  varchar,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./auth";

/**
 * A per-user saved search/filter view in the CMS. `query` stores the full
 * search request (the `q` term plus filters and sort) so a staff member can
 * re-run a complex global search with one click. Scoped to the owning user;
 * routes always filter by the acting user's id — saved views are private.
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
