/**
 * AI suggestion decision tracking.
 *
 * The AI assistant is suggest-only; an editor explicitly accepts (applies) or
 * rejects (dismisses) each suggestion. This module records those decisions in
 * the append-only `audit_logs` trail and aggregates them into a simple
 * usefulness report (acceptance rate per suggestion kind) so the team can see
 * which kinds of suggestions are useful, improve prompts over time, and audit
 * AI-assisted edits.
 *
 * Decisions are logged as `audit_logs` rows with action `ai.suggestion.accept`
 * or `ai.suggestion.reject`, entityType `ai_suggestion`, entityId = the post
 * id, and the kind/target/suggestionId carried in `metadata`. They surface in
 * the CMS audit log alongside every other privileged action.
 */
import { type Request } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { AI_SUGGESTION_KINDS, type AiSuggestionKind } from "./ai-assist";
import { recordAudit } from "./audit";

export const AI_DECISION_ACCEPT_ACTION = "ai.suggestion.accept";
export const AI_DECISION_REJECT_ACTION = "ai.suggestion.reject";
export const AI_DECISION_ENTITY_TYPE = "ai_suggestion";

export type AiDecision = "accepted" | "rejected";

export interface AiDecisionInput {
  kind: AiSuggestionKind;
  decision: AiDecision;
  apply: "field" | "faq" | "info";
  target?: string | null;
  suggestionId?: string | null;
  label?: string | null;
}

/**
 * Record a single accept/reject decision in the audit trail. Best-effort:
 * `recordAudit` swallows + logs its own failures, so a logging problem can
 * never break the editor's accept/reject flow.
 */
export async function recordAiDecision(
  req: Request,
  pageId: string,
  input: AiDecisionInput,
  exec: typeof db = db,
): Promise<void> {
  await recordAudit(
    req,
    {
      action:
        input.decision === "accepted"
          ? AI_DECISION_ACCEPT_ACTION
          : AI_DECISION_REJECT_ACTION,
      entityType: AI_DECISION_ENTITY_TYPE,
      entityId: pageId,
      metadata: {
        kind: input.kind,
        apply: input.apply,
        target: input.target ?? null,
        suggestionId: input.suggestionId ?? null,
        label: input.label ?? null,
      },
    },
    exec,
  );
}

export interface AiDecisionKindStat {
  kind: string;
  accepted: number;
  rejected: number;
  total: number;
  acceptanceRate: number;
}

export interface AiDecisionReport {
  kinds: AiDecisionKindStat[];
  totals: AiDecisionKindStat;
}

function makeStat(kind: string, accepted: number, rejected: number): AiDecisionKindStat {
  const total = accepted + rejected;
  return {
    kind,
    accepted,
    rejected,
    total,
    acceptanceRate: total === 0 ? 0 : accepted / total,
  };
}

/**
 * Aggregate every recorded decision into a per-kind usefulness report (plus an
 * overall total). One grouped query over the audit trail — no N+1. Every known
 * suggestion kind is always present (zeroed when it has no decisions) so the
 * report shape is stable for the UI.
 */
export async function buildAiDecisionReport(
  exec: typeof db = db,
): Promise<AiDecisionReport> {
  const rows = await exec
    .select({
      kind: sql<string>`coalesce(${auditLogsTable.metadata}->>'kind', 'unknown')`,
      action: auditLogsTable.action,
      count: sql<number>`count(*)::int`,
    })
    .from(auditLogsTable)
    .where(
      and(
        eq(auditLogsTable.entityType, AI_DECISION_ENTITY_TYPE),
        inArray(auditLogsTable.action, [
          AI_DECISION_ACCEPT_ACTION,
          AI_DECISION_REJECT_ACTION,
        ]),
      ),
    )
    .groupBy(sql`coalesce(${auditLogsTable.metadata}->>'kind', 'unknown')`, auditLogsTable.action);

  const accepted = new Map<string, number>();
  const rejected = new Map<string, number>();
  for (const row of rows) {
    const target = row.action === AI_DECISION_ACCEPT_ACTION ? accepted : rejected;
    target.set(row.kind, (target.get(row.kind) ?? 0) + Number(row.count));
  }

  // Stable ordering: every known kind first, then any unexpected kinds seen.
  const knownKinds = AI_SUGGESTION_KINDS as readonly string[];
  const extraKinds = [...new Set([...accepted.keys(), ...rejected.keys()])]
    .filter((k) => !knownKinds.includes(k))
    .sort();
  const allKinds = [...knownKinds, ...extraKinds];

  let totalAccepted = 0;
  let totalRejected = 0;
  const kinds = allKinds.map((kind) => {
    const a = accepted.get(kind) ?? 0;
    const r = rejected.get(kind) ?? 0;
    totalAccepted += a;
    totalRejected += r;
    return makeStat(kind, a, r);
  });

  return {
    kinds,
    totals: makeStat("all", totalAccepted, totalRejected),
  };
}
