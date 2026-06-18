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

export const faqTable = pgTable(
  "faq",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pagesTable.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    answerRichText: jsonb("answer_rich_text").$type<unknown>(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("faq_page_idx").on(t.pageId)],
);

export const accordionsTable = pgTable(
  "accordions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pagesTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content"),
    contentRichText: jsonb("content_rich_text").$type<unknown>(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("accordions_page_idx").on(t.pageId)],
);

/** Ordered breadcrumb trail entries for a page. */
export const breadcrumbsTable = pgTable(
  "breadcrumbs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pagesTable.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    label: text("label").notNull(),
    url: text("url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("breadcrumbs_page_idx").on(t.pageId)],
);

/** Raw JSON-LD structured-data blocks extracted from a page. */
export const jsonldTable = pgTable(
  "jsonld",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pagesTable.id, { onDelete: "cascade" }),
    type: text("type"),
    data: jsonb("data").$type<unknown>().notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("jsonld_page_idx").on(t.pageId)],
);

export const insertFaqSchema = createInsertSchema(faqTable).omit({
  id: true,
  createdAt: true,
});
export type InsertFaq = z.infer<typeof insertFaqSchema>;
export type Faq = typeof faqTable.$inferSelect;

export const insertAccordionSchema = createInsertSchema(accordionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAccordion = z.infer<typeof insertAccordionSchema>;
export type Accordion = typeof accordionsTable.$inferSelect;

export const insertBreadcrumbSchema = createInsertSchema(breadcrumbsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertBreadcrumb = z.infer<typeof insertBreadcrumbSchema>;
export type Breadcrumb = typeof breadcrumbsTable.$inferSelect;

export const insertJsonldSchema = createInsertSchema(jsonldTable).omit({
  id: true,
  createdAt: true,
});
export type InsertJsonld = z.infer<typeof insertJsonldSchema>;
export type Jsonld = typeof jsonldTable.$inferSelect;
