import { and, count, eq, lte } from "drizzle-orm";
import { db, pagesTable } from "@workspace/db";
import { logger } from "./logger";
import type { Executor } from "./cms-content";

/**
 * Cadence of the in-process auto-publish scheduler (the `setInterval` in
 * `index.ts`). Exported here so the loop and the health checks share one
 * definition and the staleness threshold below stays a multiple of it.
 */
export const SCHEDULER_INTERVAL_MS = 60_000;

/**
 * If no scheduler tick has been recorded within this window the in-process loop
 * is considered stalled (stopped firing / the timer was lost). Three intervals
 * gives generous slack for a slow tick or a GC pause without false alarms.
 */
export const TICK_STALENESS_MS = SCHEDULER_INTERVAL_MS * 3;

/**
 * A `scheduled` post whose time passed more than this long ago — yet is still
 * not `published` — is "overdue" and signals the scheduler is not doing its job.
 * Set comfortably above the tick cadence so the normal up-to-60s lag between a
 * post coming due and the next tick publishing it never counts as overdue.
 */
export const OVERDUE_THRESHOLD_MS = 5 * 60_000;

/** Mutable in-memory record of the most recent scheduler activity. */
interface TickState {
  /** When the scheduler loop was started (boot baseline before any tick). */
  startedAt: Date;
  /** When the most recent tick ran (success OR failure), or null if none yet. */
  lastTickAt: Date | null;
  /** When the most recent successful tick ran, or null if none yet. */
  lastSuccessAt: Date | null;
  /** When the most recent failing tick ran, or null if none yet. */
  lastErrorAt: Date | null;
  /** Message of the most recent tick failure; cleared on the next success. */
  lastError: string | null;
  /** Posts published by the most recent successful tick. */
  lastPublishedCount: number | null;
  /** Total ticks recorded (success + failure) since start. */
  tickCount: number;
}

const state: TickState = {
  startedAt: new Date(),
  lastTickAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
  lastPublishedCount: null,
  tickCount: 0,
};

/** (Re)set the boot baseline used for the pre-first-tick staleness grace. */
export function markSchedulerStarted(now: Date = new Date()): void {
  state.startedAt = now;
  state.lastTickAt = null;
  state.lastSuccessAt = null;
  state.lastErrorAt = null;
  state.lastError = null;
  state.lastPublishedCount = null;
  state.tickCount = 0;
}

/** Record a successful scheduler tick (clears any prior error state). */
export function recordSchedulerSuccess(
  publishedCount: number,
  now: Date = new Date(),
): void {
  state.lastTickAt = now;
  state.lastSuccessAt = now;
  state.lastErrorAt = null;
  state.lastError = null;
  state.lastPublishedCount = publishedCount;
  state.tickCount += 1;
}

/** Record a failing scheduler tick (the loop is alive but not publishing). */
export function recordSchedulerError(err: unknown, now: Date = new Date()): void {
  state.lastTickAt = now;
  state.lastErrorAt = now;
  state.lastError = err instanceof Error ? err.message : String(err);
  state.tickCount += 1;
}

/** JSON-serialisable snapshot of the tick state (ISO timestamps). */
export interface SchedulerTickSnapshot {
  startedAt: string;
  lastTickAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastPublishedCount: number | null;
  tickCount: number;
}

export interface SchedulerHealth {
  /** True only when the tick is alive, no posts are overdue, and no last error. */
  ready: boolean;
  /** True when a tick has run recently enough (within the staleness window). */
  tickAlive: boolean;
  /** `scheduled` posts overdue past `OVERDUE_THRESHOLD_MS`. */
  overdueCount: number;
  /** Time since the last recorded tick, or null if none has run yet. */
  sinceLastTickMs: number | null;
  intervalMs: number;
  stalenessThresholdMs: number;
  overdueThresholdMs: number;
  tick: SchedulerTickSnapshot;
}

/** The fields of `TickState` the pure evaluation needs (dates, not ISO). */
type TickStateLike = Pick<
  TickState,
  | "startedAt"
  | "lastTickAt"
  | "lastSuccessAt"
  | "lastErrorAt"
  | "lastError"
  | "lastPublishedCount"
  | "tickCount"
>;

function toSnapshot(s: TickStateLike): SchedulerTickSnapshot {
  return {
    startedAt: s.startedAt.toISOString(),
    lastTickAt: s.lastTickAt ? s.lastTickAt.toISOString() : null,
    lastSuccessAt: s.lastSuccessAt ? s.lastSuccessAt.toISOString() : null,
    lastErrorAt: s.lastErrorAt ? s.lastErrorAt.toISOString() : null,
    lastError: s.lastError,
    lastPublishedCount: s.lastPublishedCount,
    tickCount: s.tickCount,
  };
}

/**
 * Pure health evaluation: combine the in-memory tick state with a DB-derived
 * overdue count to decide whether the scheduler is healthy. Side-effect-free and
 * fully injectable so it can be unit-tested without a DB or real timers.
 *
 * Before the first tick has run, staleness is measured from `startedAt` so a
 * freshly-booted server is given one full staleness window of grace.
 */
export function evaluateSchedulerHealth(
  s: TickStateLike,
  overdueCount: number,
  now: Date = new Date(),
): SchedulerHealth {
  const baseline = s.lastTickAt ?? s.startedAt;
  const tickAlive = now.getTime() - baseline.getTime() <= TICK_STALENESS_MS;
  const sinceLastTickMs = s.lastTickAt
    ? now.getTime() - s.lastTickAt.getTime()
    : null;
  const ready = tickAlive && overdueCount === 0 && s.lastError === null;
  return {
    ready,
    tickAlive,
    overdueCount,
    sinceLastTickMs,
    intervalMs: SCHEDULER_INTERVAL_MS,
    stalenessThresholdMs: TICK_STALENESS_MS,
    overdueThresholdMs: OVERDUE_THRESHOLD_MS,
    tick: toSnapshot(s),
  };
}

/**
 * Count `scheduled` posts whose `scheduledFor` is older than the overdue
 * threshold — i.e. their publish time has well passed but they are still not
 * live. A non-zero result means the scheduler has not been doing its job.
 */
export async function countOverdueScheduledPosts(
  now: Date = new Date(),
  exec: Executor = db,
): Promise<number> {
  const cutoff = new Date(now.getTime() - OVERDUE_THRESHOLD_MS);
  const [row] = await exec
    .select({ value: count() })
    .from(pagesTable)
    .where(
      and(
        eq(pagesTable.status, "scheduled"),
        lte(pagesTable.scheduledFor, cutoff),
      ),
    );
  return Number(row?.value ?? 0);
}

/**
 * Full scheduler health: in-memory tick liveness + DB overdue count. Used by the
 * `/api/healthz/scheduler` probe route and the startup log probe below.
 */
export async function checkSchedulerHealth(
  now: Date = new Date(),
  exec: Executor = db,
): Promise<SchedulerHealth> {
  const overdueCount = await countOverdueScheduledPosts(now, exec);
  return evaluateSchedulerHealth(state, overdueCount, now);
}

/**
 * Fire-and-forget log probe, mirroring `probePublishingReadiness`. Emits a clear
 * WARN in the deployment logs when the scheduler looks unhealthy (stalled tick,
 * last tick errored, or scheduled posts overdue) so a silent failure is visible
 * without anyone polling the route. Never throws.
 */
export async function probeSchedulerHealth(): Promise<SchedulerHealth | null> {
  let health: SchedulerHealth;
  try {
    health = await checkSchedulerHealth();
  } catch (err) {
    logger.error(
      { err },
      "Could not verify auto-publish scheduler health (database probe failed)",
    );
    return null;
  }

  if (health.ready) {
    logger.info(
      {
        overdueCount: health.overdueCount,
        tickCount: health.tick.tickCount,
        lastTickAt: health.tick.lastTickAt,
      },
      "Auto-publish scheduler healthy (tick alive, no overdue scheduled posts)",
    );
    return health;
  }

  logger.warn(
    {
      tickAlive: health.tickAlive,
      sinceLastTickMs: health.sinceLastTickMs,
      stalenessThresholdMs: health.stalenessThresholdMs,
      overdueCount: health.overdueCount,
      overdueThresholdMs: health.overdueThresholdMs,
      lastError: health.tick.lastError,
      lastTickAt: health.tick.lastTickAt,
      remedy:
        "check the api-server is up and its 60s scheduler interval is firing; the standalone `publish:scheduled:prod` scheduled deployment is the backstop",
    },
    "Auto-publish scheduler is NOT healthy: tick may have stalled or scheduled posts are overdue",
  );
  return health;
}
