import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { pagesTable } from "./pages";

/**
 * Lightweight, privacy-respecting page-view event log written from the public
 * blog. One row per view. We intentionally store NO IP address, user agent,
 * cookie or per-visitor identifier — only which page was seen, when, and a
 * coarse referrer host — so this cannot be used for per-user behavioral
 * tracking. Aggregated server-side into the CMS analytics views.
 */
export const pageViewsTable = pgTable(
  "page_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Resolved server-side from the slug. Nullable so a deleted page doesn't
    // cascade away its historical views (set null keeps the count, drops join).
    pageId: uuid("page_id").references(() => pagesTable.id, {
      onDelete: "set null",
    }),
    // Public slug snapshot, retained even if the page row is later removed.
    slug: text("slug").notNull(),
    // Coarse referrer host only (e.g. "www.google.com") — never a full URL.
    referrerHost: text("referrer_host"),
    viewedAt: timestamp("viewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("page_views_page_idx").on(t.pageId),
    index("page_views_viewed_at_idx").on(t.viewedAt),
    index("page_views_slug_idx").on(t.slug),
  ],
);

export const insertPageViewSchema = createInsertSchema(pageViewsTable).omit({
  id: true,
  createdAt: true,
  viewedAt: true,
});
export type InsertPageView = z.infer<typeof insertPageViewSchema>;
export type PageView = typeof pageViewsTable.$inferSelect;
