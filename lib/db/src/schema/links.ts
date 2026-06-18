import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { pagesTable } from "./pages";

/**
 * Links from one page to another internal page. `targetPageId` is resolved
 * when the destination has been crawled; `href` always preserves the raw URL.
 */
export const internalLinksTable = pgTable(
  "internal_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pagesTable.id, { onDelete: "cascade" }),
    targetPageId: uuid("target_page_id").references(() => pagesTable.id, {
      onDelete: "set null",
    }),
    href: text("href").notNull(),
    anchorText: text("anchor_text"),
    rel: text("rel"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("internal_links_page_idx").on(t.pageId),
    index("internal_links_target_idx").on(t.targetPageId),
  ],
);

export const externalLinksTable = pgTable(
  "external_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pagesTable.id, { onDelete: "cascade" }),
    href: text("href").notNull(),
    anchorText: text("anchor_text"),
    rel: text("rel"),
    domain: text("domain"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("external_links_page_idx").on(t.pageId)],
);

/** URL redirect map preserved from the source site (e.g. trailing-slash, moved pages). */
export const redirectsTable = pgTable(
  "redirects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromPath: text("from_path").notNull().unique(),
    toPath: text("to_path").notNull(),
    statusCode: integer("status_code").notNull().default(301),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("redirects_from_path_idx").on(t.fromPath)],
);

export const insertInternalLinkSchema = createInsertSchema(
  internalLinksTable,
).omit({ id: true, createdAt: true });
export type InsertInternalLink = z.infer<typeof insertInternalLinkSchema>;
export type InternalLink = typeof internalLinksTable.$inferSelect;

export const insertExternalLinkSchema = createInsertSchema(
  externalLinksTable,
).omit({ id: true, createdAt: true });
export type InsertExternalLink = z.infer<typeof insertExternalLinkSchema>;
export type ExternalLink = typeof externalLinksTable.$inferSelect;

export const insertRedirectSchema = createInsertSchema(redirectsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertRedirect = z.infer<typeof insertRedirectSchema>;
export type Redirect = typeof redirectsTable.$inferSelect;
