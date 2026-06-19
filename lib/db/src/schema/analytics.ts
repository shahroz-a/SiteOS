import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  date,
  index,
  primaryKey,
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

/**
 * Daily pre-aggregated page-view rollup. The raw `page_views` event log grows
 * one row per view and would otherwise expand without bound, slowing the
 * analytics aggregates and bloating the database. The scheduled rollup job
 * (`scripts/src/rollup-page-views.ts`) folds every completed past day's raw
 * rows into one row per (day, slug) here and then deletes those raw rows, so
 * storage stays bounded by content × time instead of by traffic.
 *
 * Invariant the analytics queries rely on: a given calendar day lives EITHER in
 * this rollup OR in the raw `page_views` table, never both — the job aggregates
 * and deletes a day's raw rows in one transaction, and only rolls up days that
 * are already complete (strictly before the current UTC date), so live inserts
 * for "today" are never raced. This lets the analytics layer UNION the two
 * sources with no risk of double counting.
 */
export const pageViewDailyTable = pgTable(
  "page_view_daily",
  {
    // Calendar day (UTC) the views occurred on.
    day: date("day").notNull(),
    // Resolved page id at rollup time. Nullable so a later page deletion
    // (onDelete set null) drops the join but keeps the historical count.
    pageId: uuid("page_id").references(() => pagesTable.id, {
      onDelete: "set null",
    }),
    // Public slug snapshot — the stable identifier the rollup is keyed on.
    slug: text("slug").notNull(),
    // Number of raw views folded into this (day, slug) bucket.
    views: integer("views").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.slug] }),
    index("page_view_daily_day_idx").on(t.day),
    index("page_view_daily_page_idx").on(t.pageId),
    index("page_view_daily_slug_idx").on(t.slug),
  ],
);

export type PageViewDaily = typeof pageViewDailyTable.$inferSelect;

/**
 * Daily pre-aggregated referrer-host rollup. The raw `page_views` event log
 * keeps a coarse `referrer_host` on every view, but the per-(day, slug) rollup
 * above intentionally drops it — so once a day's raw rows are folded away, the
 * "where did this traffic come from" signal would be lost. This sibling rollup
 * preserves it by folding the same completed days into one row per
 * (day, referrer_host) before the raw rows are deleted.
 *
 * Keyed on (day, referrer_host) only — NOT slug — so it stays bounded by
 * time × the (small) set of distinct referring hosts rather than by traffic or
 * content. `referrer_host` is NOT NULL with an empty-string default: a missing
 * referrer (direct / same-origin / app traffic) folds into the `''` bucket so
 * it can still participate in the primary key.
 *
 * Same one-tier-per-day invariant as `page_view_daily`: the rollup job folds and
 * deletes a completed day's raw rows in one transaction, so the analytics layer
 * can UNION this rollup with the current day's raw `page_views` without double
 * counting.
 */
export const pageViewReferrerDailyTable = pgTable(
  "page_view_referrer_daily",
  {
    // Calendar day (UTC) the views occurred on.
    day: date("day").notNull(),
    // Coarse referrer host (e.g. "www.google.com"); empty string for views with
    // no referrer (direct / same-origin), so the value is always PK-safe.
    referrerHost: text("referrer_host").notNull().default(""),
    // Number of raw views folded into this (day, referrer_host) bucket.
    views: integer("views").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.referrerHost] }),
    index("page_view_referrer_daily_day_idx").on(t.day),
  ],
);

export type PageViewReferrerDaily =
  typeof pageViewReferrerDailyTable.$inferSelect;
