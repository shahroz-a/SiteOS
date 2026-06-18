import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { pagesTable } from "./pages";
import { crawlStatusEnum, logLevelEnum, validationStatusEnum } from "./enums";

/** Work queue of URLs to crawl, with priority/depth/retry bookkeeping. */
export const crawlQueueTable = pgTable(
  "crawl_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    url: text("url").notNull().unique(),
    status: crawlStatusEnum("status").notNull().default("pending"),
    priority: integer("priority").notNull().default(0),
    depth: integer("depth").notNull().default(0),
    discoveredFrom: text("discovered_from"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("crawl_queue_status_idx").on(t.status),
    index("crawl_queue_priority_idx").on(t.priority),
  ],
);

/** Per-fetch crawl log entries (success/failure, HTTP status, timing). */
export const crawlLogsTable = pgTable(
  "crawl_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    url: text("url").notNull(),
    pageId: uuid("page_id").references(() => pagesTable.id, {
      onDelete: "set null",
    }),
    level: logLevelEnum("level").notNull().default("info"),
    httpStatus: integer("http_status"),
    message: text("message"),
    details: jsonb("details").$type<unknown>(),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("crawl_logs_page_idx").on(t.pageId)],
);

/** Validation/QA results produced after parsing a page. */
export const validationReportsTable = pgTable(
  "validation_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id").references(() => pagesTable.id, {
      onDelete: "cascade",
    }),
    reportType: text("report_type").notNull(),
    status: validationStatusEnum("status").notNull().default("pass"),
    issues: jsonb("issues").$type<unknown>(),
    score: integer("score"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("validation_reports_page_idx").on(t.pageId)],
);

export const insertCrawlQueueSchema = createInsertSchema(crawlQueueTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCrawlQueue = z.infer<typeof insertCrawlQueueSchema>;
export type CrawlQueueItem = typeof crawlQueueTable.$inferSelect;

export const insertCrawlLogSchema = createInsertSchema(crawlLogsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCrawlLog = z.infer<typeof insertCrawlLogSchema>;
export type CrawlLog = typeof crawlLogsTable.$inferSelect;

export const insertValidationReportSchema = createInsertSchema(
  validationReportsTable,
).omit({ id: true, createdAt: true });
export type InsertValidationReport = z.infer<
  typeof insertValidationReportSchema
>;
export type ValidationReport = typeof validationReportsTable.$inferSelect;
