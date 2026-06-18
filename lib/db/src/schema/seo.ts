import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { pagesTable } from "./pages";

/** Normalized SEO fields for a page (one row per page). */
export const seoTable = pgTable("seo", {
  id: uuid("id").primaryKey().defaultRandom(),
  pageId: uuid("page_id")
    .notNull()
    .unique()
    .references(() => pagesTable.id, { onDelete: "cascade" }),
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),
  canonicalUrl: text("canonical_url"),
  robots: text("robots"),
  focusKeyword: text("focus_keyword"),
  keywords: text("keywords").array(),
  ogTitle: text("og_title"),
  ogDescription: text("og_description"),
  ogImage: text("og_image"),
  ogType: text("og_type"),
  twitterCard: text("twitter_card"),
  twitterTitle: text("twitter_title"),
  twitterDescription: text("twitter_description"),
  twitterImage: text("twitter_image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Raw page metadata captured verbatim: all <meta> tags, HTTP response headers
 * and other key/value bags, preserved for lossless reconstruction.
 */
export const metadataTable = pgTable("metadata", {
  id: uuid("id").primaryKey().defaultRandom(),
  pageId: uuid("page_id")
    .notNull()
    .unique()
    .references(() => pagesTable.id, { onDelete: "cascade" }),
  metaTags: jsonb("meta_tags").$type<
    Array<{ name?: string; property?: string; content?: string }>
  >(),
  httpHeaders: jsonb("http_headers").$type<Record<string, string>>(),
  openGraph: jsonb("open_graph").$type<Record<string, unknown>>(),
  twitter: jsonb("twitter").$type<Record<string, unknown>>(),
  custom: jsonb("custom").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertSeoSchema = createInsertSchema(seoTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSeo = z.infer<typeof insertSeoSchema>;
export type Seo = typeof seoTable.$inferSelect;

export const insertMetadataSchema = createInsertSchema(metadataTable).omit({
  id: true,
  createdAt: true,
});
export type InsertMetadata = z.infer<typeof insertMetadataSchema>;
export type Metadata = typeof metadataTable.$inferSelect;
