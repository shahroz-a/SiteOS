import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { pageStatusEnum, pageTypeEnum } from "./enums";
import { authorsTable, categoriesTable, tagsTable } from "./taxonomy";

/**
 * The core page entity. A page is identified publicly by its canonical URL /
 * slug — internal UUIDs must never appear in routing. It retains the original
 * HTML, cleaned HTML and rich-text JSON so future parser changes never require
 * recrawling, plus the assembled component tree for Payload-compatible render.
 */
export const pagesTable = pgTable(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Identity / classification
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    excerpt: text("excerpt"),
    pageType: pageTypeEnum("page_type").notNull().default("post"),
    status: pageStatusEnum("status").notNull().default("published"),
    language: text("language").notNull().default("en"),

    // URL preservation metadata (lossless)
    originalUrl: text("original_url").notNull(),
    canonicalUrl: text("canonical_url").notNull().unique(),
    pathname: text("pathname").notNull(),
    parentPath: text("parent_path"),
    permalink: text("permalink"),
    trailingSlash: boolean("trailing_slash").notNull().default(false),
    canonicalTag: text("canonical_tag"),
    hreflang: jsonb("hreflang").$type<Array<{ lang: string; href: string }>>(),
    redirectTarget: text("redirect_target"),
    httpStatus: integer("http_status"),
    sitemapSource: text("sitemap_source"),
    sitemapLastmod: timestamp("sitemap_lastmod", { withTimezone: true }),
    crawledAt: timestamp("crawled_at", { withTimezone: true }),

    // Relations
    authorId: uuid("author_id").references(() => authorsTable.id, {
      onDelete: "set null",
    }),
    primaryCategoryId: uuid("primary_category_id").references(
      () => categoriesTable.id,
      { onDelete: "set null" },
    ),

    // Featured media
    featuredImageUrl: text("featured_image_url"),
    featuredImageAlt: text("featured_image_alt"),

    // Content (lossless representations)
    originalHtml: text("original_html"),
    cleanedHtml: text("cleaned_html"),
    richText: jsonb("rich_text").$type<unknown>(),
    componentTree: jsonb("component_tree").$type<unknown>(),

    // Derived stats
    readingTimeMinutes: integer("reading_time_minutes"),
    wordCount: integer("word_count"),

    // Publishing dates
    publishedAt: timestamp("published_at", { withTimezone: true }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    modifiedAt: timestamp("modified_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("pages_slug_idx").on(t.slug),
    index("pages_status_idx").on(t.status),
    index("pages_type_idx").on(t.pageType),
    index("pages_author_idx").on(t.authorId),
    index("pages_primary_category_idx").on(t.primaryCategoryId),
    index("pages_published_at_idx").on(t.publishedAt),
    index("pages_scheduled_for_idx").on(t.scheduledFor),
  ],
);

/**
 * Immutable historical snapshots of a page, captured per crawl/parse so a
 * parser change can be re-applied without losing earlier captures.
 */
export const pageVersionsTable = pgTable(
  "page_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pagesTable.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    snapshot: jsonb("snapshot").$type<unknown>().notNull(),
    originalHtml: text("original_html"),
    contentHash: text("content_hash"),
    changeSummary: text("change_summary"),
    crawledAt: timestamp("crawled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("page_versions_page_idx").on(t.pageId)],
);

/** Many-to-many: pages <-> categories. */
export const pageCategoriesTable = pgTable(
  "page_categories",
  {
    pageId: uuid("page_id")
      .notNull()
      .references(() => pagesTable.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categoriesTable.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.categoryId] })],
);

/** Many-to-many: pages <-> tags. */
export const pageTagsTable = pgTable(
  "page_tags",
  {
    pageId: uuid("page_id")
      .notNull()
      .references(() => pagesTable.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tagsTable.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.tagId] })],
);

export const insertPageSchema = createInsertSchema(pagesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPage = z.infer<typeof insertPageSchema>;
export type Page = typeof pagesTable.$inferSelect;

export const insertPageVersionSchema = createInsertSchema(
  pageVersionsTable,
).omit({ id: true, createdAt: true });
export type InsertPageVersion = z.infer<typeof insertPageVersionSchema>;
export type PageVersion = typeof pageVersionsTable.$inferSelect;

export type PageCategory = typeof pageCategoriesTable.$inferSelect;
export type PageTag = typeof pageTagsTable.$inferSelect;
