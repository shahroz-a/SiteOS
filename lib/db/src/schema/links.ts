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
    // --- Target-health bookkeeping (see scripts/src/redirect-health.ts) ---
    // Consecutive confirmed-dead readings of the target. Off-blog (network)
    // targets must accumulate enough of these before auto-deactivation so a
    // single flaky 404/timeout can't retire a working redirect; a healthy
    // reading resets it to 0. On-blog (deterministic) targets need only one.
    targetCheckFailures: integer("target_check_failures").notNull().default(0),
    // When the target was last health-checked.
    targetCheckedAt: timestamp("target_checked_at", { withTimezone: true }),
    // Last observed final HTTP status for an off-blog target (null for on-blog
    // targets, which are checked against the page corpus, not the network).
    targetLastStatus: integer("target_last_status"),
    // Why the auto-deactivator flipped isActive to false (null while active).
    // An operator reviews/undoes by reading this + the deactivation report.
    deactivatedReason: text("deactivated_reason"),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
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
