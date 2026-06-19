import { type Request } from "express";
import { db, auditLogsTable } from "@workspace/db";

type AuditInsert = typeof auditLogsTable.$inferInsert;

export interface AuditEntry {
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  actorRole?: string | null;
}

/**
 * Append a row to the append-only audit trail. Privileged write actions (role
 * changes, future publish/url changes, etc.) call this to record who did what,
 * when, and the before/after state. Failures are swallowed and logged so an
 * audit-write problem can never break the underlying action.
 *
 * `exec` defaults to the shared `db` connection; an explicit executor (e.g. a
 * transaction) may be passed so the audit write joins a surrounding unit of
 * work — used by the rolled-back live-DB integration tests.
 */
export async function recordAudit(
  req: Request,
  entry: AuditEntry,
  exec: typeof db = db,
): Promise<void> {
  try {
    const actor = req.isAuthenticated() ? req.user : null;
    const values: AuditInsert = {
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      metadata: entry.metadata ?? null,
      actorId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      actorRole: entry.actorRole ?? null,
      ipAddress: req.ip ?? null,
    };
    await exec.insert(auditLogsTable).values(values);
  } catch (err) {
    req.log.error({ err }, "Failed to write audit log entry");
  }
}
