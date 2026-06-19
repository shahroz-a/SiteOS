import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { pagesTable } from "./pages";

/**
 * Flat, queryable representation of a page's ordered, nested block tree.
 * `parentId` + `position` reconstruct the hierarchy; `data` holds the
 * Payload-compatible block fields.
 */
export const blocksTable = pgTable(
  "blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pagesTable.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references(
      (): AnyPgColumn => blocksTable.id,
      { onDelete: "cascade" },
    ),
    blockType: text("block_type").notNull(),
    position: integer("position").notNull().default(0),
    depth: integer("depth").notNull().default(0),
    anchorId: text("anchor_id"),
    data: jsonb("data").$type<unknown>(),
    text: text("text"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("blocks_page_idx").on(t.pageId),
    index("blocks_parent_idx").on(t.parentId),
  ],
);

/**
 * The assembled, nested component tree for a page (one row per page).
 * Payload-compatible JSON used directly by the renderer.
 */
export const componentTreeTable = pgTable("component_tree", {
  id: uuid("id").primaryKey().defaultRandom(),
  pageId: uuid("page_id")
    .notNull()
    .unique()
    .references(() => pagesTable.id, { onDelete: "cascade" }),
  tree: jsonb("tree").$type<unknown>().notNull(),
  schemaVersion: text("schema_version").notNull().default("1"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Granular rich-text nodes (Lexical/Slate-style) for fine-grained content,
 * optionally attached to a block.
 */
export const richTextNodesTable = pgTable(
  "rich_text_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pagesTable.id, { onDelete: "cascade" }),
    blockId: uuid("block_id").references(() => blocksTable.id, {
      onDelete: "cascade",
    }),
    parentId: uuid("parent_id").references(
      (): AnyPgColumn => richTextNodesTable.id,
      { onDelete: "cascade" },
    ),
    nodeType: text("node_type").notNull(),
    position: integer("position").notNull().default(0),
    content: jsonb("content").$type<unknown>(),
    text: text("text"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("rich_text_nodes_page_idx").on(t.pageId),
    index("rich_text_nodes_block_idx").on(t.blockId),
  ],
);

export const insertBlockSchema = createInsertSchema(blocksTable).omit({
  id: true,
  createdAt: true,
});
export type InsertBlock = z.infer<typeof insertBlockSchema>;
export type Block = typeof blocksTable.$inferSelect;

export const insertComponentTreeSchema = createInsertSchema(
  componentTreeTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertComponentTree = z.infer<typeof insertComponentTreeSchema>;
export type ComponentTree = typeof componentTreeTable.$inferSelect;

export const insertRichTextNodeSchema = createInsertSchema(
  richTextNodesTable,
).omit({ id: true, createdAt: true });
export type InsertRichTextNode = z.infer<typeof insertRichTextNodeSchema>;
export type RichTextNode = typeof richTextNodesTable.$inferSelect;
