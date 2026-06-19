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
 * Secure, expiring share tokens that grant read-only access to a single page's
 * full content regardless of its publish status. Used by "Preview Draft": the
 * token is the only secret, so it lets a reviewer see an unpublished article via
 * the production renderer without the page ever appearing on the public blog.
 * Tokens can be revoked (`revokedAt`) and always expire (`expiresAt`).
 */
export const previewTokensTable = pgTable(
  "preview_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull().unique(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pagesTable.id, { onDelete: "cascade" }),
    createdById: text("created_by_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("preview_tokens_page_idx").on(t.pageId),
    index("preview_tokens_token_idx").on(t.token),
  ],
);

export const insertPreviewTokenSchema = createInsertSchema(
  previewTokensTable,
).omit({ id: true, createdAt: true });
export type InsertPreviewToken = z.infer<typeof insertPreviewTokenSchema>;
export type PreviewToken = typeof previewTokensTable.$inferSelect;
