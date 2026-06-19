import { describe, it, expect } from "vitest";
import {
  evaluateSchedulerHealth,
  SCHEDULER_INTERVAL_MS,
  TICK_STALENESS_MS,
  OVERDUE_THRESHOLD_MS,
} from "../scheduler-health";

const NOW = new Date("2026-06-19T12:00:00.000Z");

function tickState(over: Partial<{
  startedAt: Date;
  lastTickAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  lastPublishedCount: number | null;
  tickCount: number;
}> = {}) {
  return {
    startedAt: NOW,
    lastTickAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    lastPublishedCount: null,
    tickCount: 0,
    ...over,
  };
}

describe("evaluateSchedulerHealth", () => {
  it("is healthy with a recent successful tick and no overdue posts", () => {
    const s = tickState({
      lastTickAt: new Date(NOW.getTime() - SCHEDULER_INTERVAL_MS),
      lastSuccessAt: new Date(NOW.getTime() - SCHEDULER_INTERVAL_MS),
      tickCount: 5,
    });
    const h = evaluateSchedulerHealth(s, 0, NOW);
    expect(h.ready).toBe(true);
    expect(h.tickAlive).toBe(true);
    expect(h.overdueCount).toBe(0);
    expect(h.sinceLastTickMs).toBe(SCHEDULER_INTERVAL_MS);
  });

  it("gives a freshly-booted server grace before the first tick", () => {
    const s = tickState({ startedAt: new Date(NOW.getTime() - 1_000) });
    const h = evaluateSchedulerHealth(s, 0, NOW);
    expect(h.tickAlive).toBe(true);
    expect(h.ready).toBe(true);
    expect(h.sinceLastTickMs).toBeNull();
  });

  it("flags a stalled tick once no tick has run within the staleness window", () => {
    const s = tickState({ startedAt: new Date(NOW.getTime() - TICK_STALENESS_MS - 1) });
    const h = evaluateSchedulerHealth(s, 0, NOW);
    expect(h.tickAlive).toBe(false);
    expect(h.ready).toBe(false);
  });

  it("flags a stalled tick when the last tick is older than the staleness window", () => {
    const s = tickState({
      lastTickAt: new Date(NOW.getTime() - TICK_STALENESS_MS - 1),
      lastSuccessAt: new Date(NOW.getTime() - TICK_STALENESS_MS - 1),
    });
    const h = evaluateSchedulerHealth(s, 0, NOW);
    expect(h.tickAlive).toBe(false);
    expect(h.ready).toBe(false);
  });

  it("is not ready when posts are overdue even if the tick is alive", () => {
    const s = tickState({ lastTickAt: NOW, lastSuccessAt: NOW });
    const h = evaluateSchedulerHealth(s, 3, NOW);
    expect(h.tickAlive).toBe(true);
    expect(h.overdueCount).toBe(3);
    expect(h.ready).toBe(false);
  });

  it("is not ready when the last tick errored even with a live tick and no overdue posts", () => {
    const s = tickState({
      lastTickAt: NOW,
      lastErrorAt: NOW,
      lastError: "boom",
    });
    const h = evaluateSchedulerHealth(s, 0, NOW);
    expect(h.tickAlive).toBe(true);
    expect(h.ready).toBe(false);
    expect(h.tick.lastError).toBe("boom");
  });

  it("exposes the configured thresholds in the result", () => {
    const h = evaluateSchedulerHealth(tickState(), 0, NOW);
    expect(h.intervalMs).toBe(SCHEDULER_INTERVAL_MS);
    expect(h.stalenessThresholdMs).toBe(TICK_STALENESS_MS);
    expect(h.overdueThresholdMs).toBe(OVERDUE_THRESHOLD_MS);
  });

  it("serializes tick timestamps as ISO strings (or null)", () => {
    const s = tickState({ lastTickAt: NOW, lastSuccessAt: NOW });
    const h = evaluateSchedulerHealth(s, 0, NOW);
    expect(h.tick.startedAt).toBe(NOW.toISOString());
    expect(h.tick.lastTickAt).toBe(NOW.toISOString());
    expect(h.tick.lastErrorAt).toBeNull();
  });
});
