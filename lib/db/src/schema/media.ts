import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { pagesTable } from "./pages";

export const galleriesTable = pgTable(
  "galleries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pagesTable.id, { onDelete: "cascade" }),
    title: text("title"),
    layout: text("layout"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("galleries_page_idx").on(t.pageId)],
);

/**
 * Images either belong directly to a page or to a gallery (which belongs to a
 * page). `originalUrl` preserves the source CDN URL; `storageKey` is reserved
 * for a future object-storage copy.
 */
export const imagesTable = pgTable(
  "images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id").references(() => pagesTable.id, {
      onDelete: "cascade",
    }),
    galleryId: uuid("gallery_id").references(() => galleriesTable.id, {
      onDelete: "cascade",
    }),
    originalUrl: text("original_url").notNull(),
    url: text("url").notNull(),
    storageKey: text("storage_key"),
    alt: text("alt"),
    title: text("title"),
    caption: text("caption"),
    credit: text("credit"),
    width: integer("width"),
    height: integer("height"),
    mimeType: text("mime_type"),
    fileSize: integer("file_size"),
    role: text("role"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("images_page_idx").on(t.pageId),
    index("images_gallery_idx").on(t.galleryId),
  ],
);

export const videosTable = pgTable(
  "videos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pagesTable.id, { onDelete: "cascade" }),
    provider: text("provider"),
    originalUrl: text("original_url").notNull(),
    embedUrl: text("embed_url"),
    title: text("title"),
    caption: text("caption"),
    thumbnailUrl: text("thumbnail_url"),
    durationSeconds: integer("duration_seconds"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("videos_page_idx").on(t.pageId)],
);

export const insertGallerySchema = createInsertSchema(galleriesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertGallery = z.infer<typeof insertGallerySchema>;
export type Gallery = typeof galleriesTable.$inferSelect;

export const insertImageSchema = createInsertSchema(imagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertImage = z.infer<typeof insertImageSchema>;
export type Image = typeof imagesTable.$inferSelect;

export const insertVideoSchema = createInsertSchema(videosTable).omit({
  id: true,
  createdAt: true,
});
export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videosTable.$inferSelect;
