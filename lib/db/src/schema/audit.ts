import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./auth";

/**
 * Append-only audit trail of privileged CMS actions. Later write features call
 * the `recordAudit` helper (api-server) to log who did what, when, and the
 * before/after state of the affected entity.
 */
export const auditLogsTable = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The acting user. Kept nullable + ON DELETE SET NULL so the audit row
    // survives even if the user is later removed.
    actorId: varchar("actor_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    // Denormalized snapshot so the log stays readable without a join.
    actorEmail: varchar("actor_email"),
    actorRole: varchar("actor_role"),
    // e.g. "user.role.update", "post.publish", "post.url.change".
    action: text("action").notNull(),
    // The kind of entity affected, e.g. "user", "post".
    entityType: text("entity_type"),
    // The affected entity's id (string form to cover uuid/varchar ids).
    entityId: text("entity_id"),
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    ipAddress: varchar("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_logs_actor_idx").on(t.actorId),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_created_idx").on(t.createdAt),
  ],
);

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
