import { describe, it, expect, beforeEach, vi } from "vitest";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MediaItem } from "@workspace/api-client-react";

/**
 * Programmable mocks for the two API hooks the review flow drives. The mutate
 * functions resolve synchronously by consulting a per-test behaviour ref, so
 * state transitions land inside `act(...)` deterministically — no real network.
 */
const h = vi.hoisted(() => {
  type SuggestResult = {
    url: string;
    suggestion: string | null;
    error: string | null;
  };
  type SuggestOutcome = { throws: true } | { throws?: false; results: SuggestResult[] };
  type UpdateOutcome = { throws?: boolean };

  const suggestBehaviorRef: { current: (urls: string[]) => SuggestOutcome } = {
    // Default: every URL gets a fresh suggestion.
    current: (urls) => ({
      results: urls.map((url) => ({ url, suggestion: `alt:${url}`, error: null })),
    }),
  };
  const updateBehaviorRef: { current: () => UpdateOutcome } = {
    current: () => ({}),
  };
  const toastCalls: unknown[] = [];

  const suggestMutate = vi.fn(
    (
      vars: { data: { urls: string[] } },
      cbs: {
        onSuccess: (res: { results: SuggestResult[] }) => void;
        onError: (err: unknown) => void;
      },
    ) => {
      const outcome = suggestBehaviorRef.current(vars.data.urls);
      if ("throws" in outcome && outcome.throws) {
        cbs.onError(new Error("service down"));
      } else {
        cbs.onSuccess({ results: outcome.results });
      }
    },
  );

  const updateMutate = vi.fn(
    (
      vars: { data: { url: string; alt: string } },
      cbs: {
        onSuccess: (res: {
          url: string;
          alt: string;
          updatedUsages: number;
        }) => void;
        onError: (err: unknown) => void;
      },
    ) => {
      const outcome = updateBehaviorRef.current();
      if (outcome.throws) {
        cbs.onError(new Error("save failed"));
      } else {
        cbs.onSuccess({ url: vars.data.url, alt: vars.data.alt, updatedUsages: 1 });
      }
    },
  );

  return {
    suggestBehaviorRef,
    updateBehaviorRef,
    toastCalls,
    suggestMutate,
    updateMutate,
  };
});

vi.mock("@workspace/api-client-react", () => ({
  useSuggestCmsMediaAltBatch: () => ({ mutate: h.suggestMutate }),
  useUpdateCmsMediaAlt: () => ({
    mutate: h.updateMutate,
    isPending: false,
    variables: undefined,
  }),
}));

vi.mock("@workspace/ui", () => ({
  useToast: () => ({ toast: (arg: unknown) => h.toastCalls.push(arg) }),
}));

/**
 * Capture the cross-tab subscription callbacks so tests can simulate another
 * tab persisting a skip/approval. The hook subscribes inside a useEffect, so the
 * `current` refs are populated after the initial render.
 */
const sub = vi.hoisted(() => {
  const skippedCb: { current: ((urls: string[]) => void) | null } = {
    current: null,
  };
  const approvedCb: {
    current: ((entries: Record<string, string>) => void) | null;
  } = { current: null };
  return { skippedCb, approvedCb };
});

vi.mock("@/lib/bulk-alt-progress", () => ({
  subscribeSkipped: (_filter: string, onChange: (urls: string[]) => void) => {
    sub.skippedCb.current = onChange;
    return () => {
      sub.skippedCb.current = null;
    };
  },
  subscribeApproved: (
    _filter: string,
    onChange: (entries: Record<string, string>) => void,
  ) => {
    sub.approvedCb.current = onChange;
    return () => {
      sub.approvedCb.current = null;
    };
  },
}));

// Imported after the mocks are registered.
import { useAltReview, type AltReview } from "../use-alt-review";

function mk(url: string): MediaItem {
  return { url } as MediaItem;
}

/**
 * Minimal `renderHook` over react-test-renderer wrapped in a real
 * QueryClientProvider (the hook calls `useQueryClient`). Mirrors the editor
 * hook test's Probe pattern.
 */
function renderReview(args: {
  filter?: string;
  initialItems: MediaItem[];
  total: number;
  initialSkipped?: string[];
  initialApproved?: Record<string, string>;
  fetchNext: (excludeUrls: string[]) => Promise<MediaItem[]>;
  onSkippedChange?: (skippedUrls: string[]) => void;
  onApprovedChange?: (approved: Record<string, string>) => void;
  onCompleted?: () => void;
}) {
  const hookArgs = { filter: "", initialSkipped: [], ...args };
  const ref: { current: AltReview | null } = { current: null };
  function Probe() {
    ref.current = useAltReview(hookArgs);
    return null;
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  act(() => {
    renderer = TestRenderer.create(
      createElement(QueryClientProvider, { client }, createElement(Probe)),
    );
  });
  return {
    get api(): AltReview {
      if (!ref.current) throw new Error("hook not rendered");
      return ref.current;
    },
    run(fn: (api: AltReview) => void) {
      act(() => {
        fn(ref.current!);
      });
    },
    async flush() {
      // Let any awaited advance() continuation settle, then flush effects.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    },
    unmount() {
      act(() => {
        renderer?.unmount();
      });
    },
  };
}

beforeEach(() => {
  h.suggestMutate.mockClear();
  h.updateMutate.mockClear();
  h.toastCalls.length = 0;
  h.suggestBehaviorRef.current = (urls) => ({
    results: urls.map((url) => ({ url, suggestion: `alt:${url}`, error: null })),
  });
  h.updateBehaviorRef.current = () => ({});
});

describe("useAltReview — suggestion outcomes", () => {
  it("marks every image ready when suggestions succeed", () => {
    const fetchNext = vi.fn(async () => []);
    const r = renderReview({
      initialItems: [mk("a"), mk("b")],
      total: 2,
      fetchNext,
    });
    expect(r.api.states["a"]).toEqual({ kind: "ready", alt: "alt:a" });
    expect(r.api.states["b"]).toEqual({ kind: "ready", alt: "alt:b" });
    expect(r.api.counts.ready).toBe(2);
    expect(r.api.done).toBe(false);
    // A window with ready items is not "reviewed" yet, so it must not advance.
    expect(fetchNext).not.toHaveBeenCalled();
    r.unmount();
  });

  it("marks an image errored when the AI service call throws", () => {
    h.suggestBehaviorRef.current = () => ({ throws: true });
    const fetchNext = vi.fn(async () => []);
    const r = renderReview({
      initialItems: [mk("a")],
      total: 1,
      fetchNext,
    });
    expect(r.api.states["a"]).toEqual({
      kind: "error",
      message: "The AI service is unavailable.",
    });
    expect(h.toastCalls).toHaveLength(1);
    r.unmount();
  });

  it("marks an image errored when a result has no suggestion", () => {
    h.suggestBehaviorRef.current = (urls) => ({
      results: urls.map((url) => ({
        url,
        suggestion: null,
        error: "No usable description.",
      })),
    });
    const r = renderReview({
      initialItems: [mk("a")],
      total: 1,
      fetchNext: vi.fn(async () => []),
    });
    expect(r.api.states["a"]).toEqual({
      kind: "error",
      message: "No usable description.",
    });
    r.unmount();
  });

  it("fans large windows out across multiple capped batches", () => {
    const urls = Array.from({ length: 60 }, (_, i) => `u${i}`);
    const r = renderReview({
      initialItems: urls.map(mk),
      total: 60,
      fetchNext: vi.fn(async () => []),
    });
    // 60 URLs / 50 per batch = 2 batch calls.
    expect(h.suggestMutate).toHaveBeenCalledTimes(2);
    expect(r.api.counts.ready).toBe(60);
    r.unmount();
  });
});

describe("useAltReview — approve / skip tallies", () => {
  it("counts approvals and skips into the running session", async () => {
    const fetchNext = vi.fn(async () => []);
    const r = renderReview({
      initialItems: [mk("a"), mk("b")],
      total: 5,
      fetchNext,
    });
    r.run((a) => a.approve("a", "  a good alt  "));
    expect(r.api.states["a"]).toEqual({ kind: "approved", alt: "a good alt" });
    expect(r.api.session.approved).toBe(1);

    r.run((a) => a.skip("b"));
    expect(r.api.states["b"]).toEqual({ kind: "skipped" });
    expect(r.api.session.skipped).toBe(1);

    // Window fully reviewed → it auto-advances; backlog empty → done.
    await r.flush();
    expect(fetchNext).toHaveBeenCalledTimes(1);
    expect(fetchNext).toHaveBeenCalledWith(expect.arrayContaining(["a", "b"]));
    expect(r.api.done).toBe(true);
    expect(r.api.handled).toBe(2);
    r.unmount();
  });

  it("ignores an approve with only whitespace", () => {
    const r = renderReview({
      initialItems: [mk("a")],
      total: 1,
      fetchNext: vi.fn(async () => []),
    });
    r.run((a) => a.approve("a", "   "));
    expect(h.updateMutate).not.toHaveBeenCalled();
    expect(r.api.session.approved).toBe(0);
    r.unmount();
  });

  it("toasts and leaves the item unsaved when the save fails", () => {
    h.updateBehaviorRef.current = () => ({ throws: true });
    const r = renderReview({
      initialItems: [mk("a")],
      total: 1,
      fetchNext: vi.fn(async () => []),
    });
    r.run((a) => a.approve("a", "some alt"));
    expect(r.api.states["a"]).toEqual({ kind: "ready", alt: "alt:a" });
    expect(r.api.session.approved).toBe(0);
    expect(h.toastCalls).toHaveLength(1);
    r.unmount();
  });
});

describe("useAltReview — auto-advance through the backlog", () => {
  it("loads the next window and re-runs suggestions once one is cleared", async () => {
    let call = 0;
    const fetchNext = vi.fn(async () => {
      call += 1;
      return call === 1 ? [mk("c"), mk("d")] : [];
    });
    const r = renderReview({
      initialItems: [mk("a")],
      total: 3,
      fetchNext,
    });
    r.run((a) => a.skip("a"));
    await r.flush();

    // Second window loaded and its suggestions fired.
    expect(r.api.queue.map((it) => it.url)).toEqual(["c", "d"]);
    expect(r.api.states["c"]).toEqual({ kind: "ready", alt: "alt:c" });
    expect(r.api.done).toBe(false);
    r.unmount();
  });

  it("stops the pass when loading the next window fails", async () => {
    const fetchNext = vi.fn(async () => {
      throw new Error("network");
    });
    const r = renderReview({
      initialItems: [mk("a")],
      total: 3,
      fetchNext,
    });
    r.run((a) => a.skip("a"));
    await r.flush();
    expect(r.api.done).toBe(true);
    expect(r.api.advancing).toBe(false);
    expect(h.toastCalls).toHaveLength(1);
    r.unmount();
  });
});

describe("useAltReview — whole-window failure guard", () => {
  it("stops rather than advancing when every image in the window errors", async () => {
    h.suggestBehaviorRef.current = () => ({ throws: true });
    const fetchNext = vi.fn(async () => []);
    const r = renderReview({
      initialItems: [mk("a"), mk("b")],
      total: 10,
      fetchNext,
    });
    await r.flush();
    expect(r.api.counts.error).toBe(2);
    expect(r.api.done).toBe(true);
    // The guard must NOT churn through the rest of the backlog.
    expect(fetchNext).not.toHaveBeenCalled();
    r.unmount();
  });

  it("does not trip the guard when at least one image was handled", async () => {
    // First image succeeds, second fails → window has an approval, not all-error.
    h.suggestBehaviorRef.current = (urls) => ({
      results: urls.map((url) => ({
        url,
        suggestion: url === "a" ? "alt:a" : null,
        error: url === "a" ? null : "nope",
      })),
    });
    const fetchNext = vi.fn(async () => []);
    const r = renderReview({
      initialItems: [mk("a"), mk("b")],
      total: 10,
      fetchNext,
    });
    r.run((a) => a.approve("a", "alt:a"));
    await r.flush();
    // 'a' approved, 'b' still errored → window reviewed with a handled item.
    // counts.approved > 0 means the guard doesn't fire; it advances instead.
    expect(fetchNext).toHaveBeenCalledTimes(1);
    r.unmount();
  });
});

describe("useAltReview — retry recovery", () => {
  it("retry on a single stalled item clears done and resumes the pass", async () => {
    // Whole window fails → pass stalls (done = true).
    h.suggestBehaviorRef.current = () => ({ throws: true });
    const fetchNext = vi.fn(async () => []);
    const r = renderReview({
      initialItems: [mk("a")],
      total: 5,
      fetchNext,
    });
    await r.flush();
    expect(r.api.done).toBe(true);

    // The service recovers; retry the single failure.
    h.suggestBehaviorRef.current = (urls) => ({
      results: urls.map((url) => ({ url, suggestion: `alt:${url}`, error: null })),
    });
    r.run((a) => a.retry("a"));
    expect(r.api.states["a"]).toEqual({ kind: "ready", alt: "alt:a" });
    expect(r.api.done).toBe(false);

    // Approving the recovered item now resumes auto-advance.
    r.run((a) => a.approve("a", "alt:a"));
    await r.flush();
    expect(fetchNext).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it("retryAllFailed re-requests every failed item and un-stalls the pass", async () => {
    h.suggestBehaviorRef.current = () => ({ throws: true });
    const r = renderReview({
      initialItems: [mk("a"), mk("b")],
      total: 5,
      fetchNext: vi.fn(async () => []),
    });
    await r.flush();
    expect(r.api.done).toBe(true);
    expect(r.api.counts.error).toBe(2);

    h.suggestMutate.mockClear();
    h.suggestBehaviorRef.current = (urls) => ({
      results: urls.map((url) => ({ url, suggestion: `alt:${url}`, error: null })),
    });
    r.run((a) => a.retryAllFailed());
    expect(h.suggestMutate).toHaveBeenCalledTimes(1);
    expect(r.api.states["a"]).toEqual({ kind: "ready", alt: "alt:a" });
    expect(r.api.states["b"]).toEqual({ kind: "ready", alt: "alt:b" });
    expect(r.api.done).toBe(false);
    r.unmount();
  });

  it("retryAllFailed is a no-op when nothing failed", () => {
    const r = renderReview({
      initialItems: [mk("a")],
      total: 1,
      fetchNext: vi.fn(async () => []),
    });
    h.suggestMutate.mockClear();
    r.run((a) => a.retryAllFailed());
    expect(h.suggestMutate).not.toHaveBeenCalled();
    r.unmount();
  });
});

describe("useAltReview — skip persistence", () => {
  it("seeds the skipped tally and exclude set from a prior interrupted run", async () => {
    const fetchNext = vi.fn(async () => []);
    const r = renderReview({
      initialItems: [mk("a")],
      total: 5,
      initialSkipped: ["x", "y"],
      fetchNext,
    });
    // Restored skips count toward progress immediately.
    expect(r.api.session.skipped).toBe(2);

    // Clearing the current window auto-advances; the fetch excludes the
    // restored skips plus the current item.
    r.run((a) => a.skip("a"));
    await r.flush();
    expect(fetchNext).toHaveBeenCalledWith(
      expect.arrayContaining(["x", "y", "a"]),
    );
    r.unmount();
  });

  it("reports the full skip set to onSkippedChange on each skip", () => {
    const onSkippedChange = vi.fn();
    const r = renderReview({
      initialItems: [mk("a"), mk("b")],
      total: 5,
      initialSkipped: ["x"],
      onSkippedChange,
      fetchNext: vi.fn(async () => []),
    });
    r.run((a) => a.skip("a"));
    expect(onSkippedChange).toHaveBeenLastCalledWith(
      expect.arrayContaining(["x", "a"]),
    );
    r.run((a) => a.skip("b"));
    expect(onSkippedChange).toHaveBeenLastCalledWith(
      expect.arrayContaining(["x", "a", "b"]),
    );
    r.unmount();
  });

  it("calls onCompleted when the backlog is fully cleared", async () => {
    const onCompleted = vi.fn();
    const r = renderReview({
      initialItems: [mk("a")],
      total: 3,
      onCompleted,
      fetchNext: vi.fn(async () => []),
    });
    r.run((a) => a.skip("a"));
    await r.flush();
    expect(r.api.done).toBe(true);
    expect(onCompleted).toHaveBeenCalledTimes(1);
    r.unmount();
  });
});

describe("useAltReview — approval persistence", () => {
  it("reports the full approved url→alt map to onApprovedChange on each approve", () => {
    const onApprovedChange = vi.fn();
    const r = renderReview({
      initialItems: [mk("a"), mk("b")],
      total: 5,
      onApprovedChange,
      fetchNext: vi.fn(async () => []),
    });
    r.run((a) => a.approve("a", "alt for a"));
    expect(onApprovedChange).toHaveBeenLastCalledWith({ a: "alt for a" });
    r.run((a) => a.approve("b", "alt for b"));
    expect(onApprovedChange).toHaveBeenLastCalledWith({
      a: "alt for a",
      b: "alt for b",
    });
    r.unmount();
  });

  it("seeds the in-session exclude set from a concurrent tab's approvals without inflating the count", async () => {
    const fetchNext = vi.fn(async () => []);
    const r = renderReview({
      initialItems: [mk("a")],
      total: 5,
      // 'x' was approved by another tab; its server flag is already cleared, so
      // `total` excludes it and the session count must NOT include it.
      initialApproved: { x: "alt x" },
      fetchNext,
    });
    expect(r.api.session.approved).toBe(0);

    // Clearing the current window auto-advances; the fetch excludes the
    // already-approved 'x' plus the current item.
    r.run((a) => a.approve("a", "alt a"));
    await r.flush();
    expect(fetchNext).toHaveBeenCalledWith(expect.arrayContaining(["x", "a"]));
    r.unmount();
  });
});

describe("useAltReview — cross-tab approval sync", () => {
  it("folds an approval from another tab into this tab's progress and current window", () => {
    const r = renderReview({
      initialItems: [mk("a"), mk("b")],
      total: 5,
      fetchNext: vi.fn(async () => []),
    });
    // Another tab approves 'a' while it's still pending/ready here.
    act(() => {
      sub.approvedCb.current?.({ a: "alt from other tab" });
    });
    // It flips to approved with the exact alt the other tab saved, and counts.
    expect(r.api.states["a"]).toEqual({
      kind: "approved",
      alt: "alt from other tab",
    });
    expect(r.api.session.approved).toBe(1);
    r.unmount();
  });

  it("does not double-count an image this tab already approved", () => {
    const r = renderReview({
      initialItems: [mk("a")],
      total: 5,
      fetchNext: vi.fn(async () => []),
    });
    r.run((a) => a.approve("a", "my alt"));
    expect(r.api.session.approved).toBe(1);

    // The other tab's storage event echoes the same approval back.
    act(() => {
      sub.approvedCb.current?.({ a: "my alt" });
    });
    // Already handled here — the count stays at 1 and the alt isn't clobbered.
    expect(r.api.session.approved).toBe(1);
    expect(r.api.states["a"]).toEqual({ kind: "approved", alt: "my alt" });
    r.unmount();
  });

  it("refreshes the displayed alt when another tab re-edits an already-approved image without re-counting", () => {
    const r = renderReview({
      initialItems: [mk("a")],
      total: 5,
      fetchNext: vi.fn(async () => []),
    });
    // Another tab approves 'a'.
    act(() => {
      sub.approvedCb.current?.({ a: "first alt" });
    });
    expect(r.api.states["a"]).toEqual({ kind: "approved", alt: "first alt" });
    expect(r.api.session.approved).toBe(1);

    // The other tab re-edits 'a' with corrected alt text.
    act(() => {
      sub.approvedCb.current?.({ a: "corrected alt" });
    });
    // Displayed alt refreshes, but the count stays at 1 (already handled).
    expect(r.api.states["a"]).toEqual({
      kind: "approved",
      alt: "corrected alt",
    });
    expect(r.api.session.approved).toBe(1);
    r.unmount();
  });

  it("refreshes an already-approved alt re-edited in a URL outside the current window without re-counting", async () => {
    const fetchNext = vi.fn(async () => []);
    const r = renderReview({
      initialItems: [mk("a")],
      total: 5,
      // 'z' was approved by another tab; not in this window.
      initialApproved: { z: "old z alt" },
      fetchNext,
    });
    expect(r.api.session.approved).toBe(0);

    // The other tab corrects 'z' (outside this window).
    act(() => {
      sub.approvedCb.current?.({ z: "new z alt" });
    });
    // No double count — 'z' was already handled (seeded).
    expect(r.api.session.approved).toBe(0);

    // The corrected alt is what gets excluded/persisted: approve 'a' to flush
    // the approved map, and confirm the next fetch still excludes 'z'.
    r.run((a) => a.approve("a", "alt a"));
    await r.flush();
    expect(fetchNext).toHaveBeenCalledWith(expect.arrayContaining(["z", "a"]));
    r.unmount();
  });

  it("promotes an image skipped here then approved in another tab from skipped to approved", () => {
    const onSkippedChange = vi.fn();
    const r = renderReview({
      initialItems: [mk("a")],
      total: 5,
      onSkippedChange,
      fetchNext: vi.fn(async () => []),
    });
    // Skip 'a' in this tab.
    r.run((a) => a.skip("a"));
    expect(r.api.states["a"]).toEqual({ kind: "skipped" });
    expect(r.api.session.skipped).toBe(1);
    expect(r.api.session.approved).toBe(0);
    expect(onSkippedChange).toHaveBeenLastCalledWith(["a"]);

    // Another tab approves 'a' (with edits).
    act(() => {
      sub.approvedCb.current?.({ a: "approved alt" });
    });
    // It flips skipped → approved, and moves from the skipped tally to the
    // approved tally — no net double-count.
    expect(r.api.states["a"]).toEqual({ kind: "approved", alt: "approved alt" });
    expect(r.api.session.skipped).toBe(0);
    expect(r.api.session.approved).toBe(1);
    expect(r.api.handled).toBe(1);
    // The persisted skip set shrinks so a reopened pass won't re-show it.
    expect(onSkippedChange).toHaveBeenLastCalledWith([]);
    r.unmount();
  });

  it("promotes a skipped URL outside the current window and excludes it from the next fetch", async () => {
    const fetchNext = vi.fn(async () => []);
    const r = renderReview({
      initialItems: [mk("a")],
      total: 5,
      // 'z' was skipped in a prior interrupted run; not in this window.
      initialSkipped: ["z"],
      fetchNext,
    });
    expect(r.api.session.skipped).toBe(1);

    // Another tab approves 'z'.
    act(() => {
      sub.approvedCb.current?.({ z: "alt z" });
    });
    expect(r.api.session.skipped).toBe(0);
    expect(r.api.session.approved).toBe(1);

    // 'z' is now excluded as an approval (still excluded from the next fetch).
    r.run((a) => a.skip("a"));
    await r.flush();
    expect(fetchNext).toHaveBeenCalledWith(expect.arrayContaining(["z", "a"]));
    r.unmount();
  });

  it("does not re-count or re-promote a skip-then-approve already folded in", () => {
    const r = renderReview({
      initialItems: [mk("a")],
      total: 5,
      fetchNext: vi.fn(async () => []),
    });
    r.run((a) => a.skip("a"));
    act(() => {
      sub.approvedCb.current?.({ a: "approved alt" });
    });
    expect(r.api.session.approved).toBe(1);
    expect(r.api.session.skipped).toBe(0);

    // The other tab echoes the same approval back — it's now an already-approved
    // URL, so it must not re-count or re-touch the skipped tally.
    act(() => {
      sub.approvedCb.current?.({ a: "approved alt" });
    });
    expect(r.api.session.approved).toBe(1);
    expect(r.api.session.skipped).toBe(0);
    expect(r.api.states["a"]).toEqual({ kind: "approved", alt: "approved alt" });
    r.unmount();
  });

  it("counts a cross-tab approval for a URL outside the current window", async () => {
    const fetchNext = vi.fn(async () => []);
    const r = renderReview({
      initialItems: [mk("a")],
      total: 5,
      fetchNext,
    });
    // Another tab approves 'z', which isn't in this window at all.
    act(() => {
      sub.approvedCb.current?.({ z: "alt z" });
    });
    expect(r.api.session.approved).toBe(1);
    // 'z' isn't shown here, but it's excluded from the next window's fetch.
    r.run((a) => a.skip("a"));
    await r.flush();
    expect(fetchNext).toHaveBeenCalledWith(expect.arrayContaining(["z", "a"]));
    r.unmount();
  });
});
