import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSuggestCmsMediaAltBatch,
  useUpdateCmsMediaAlt,
  type MediaItem,
} from "@workspace/api-client-react";
import { useToast } from "@workspace/ui";
import { subscribeSkipped, subscribeApproved } from "@/lib/bulk-alt-progress";

/** Server-side cap on URLs per suggest-alt-batch request (mirrors the API). */
export const MAX_URLS_PER_BATCH = 50;

/** Per-image state in the bulk review queue. */
export type ItemState =
  | { kind: "pending" }
  | { kind: "suggesting" }
  | { kind: "ready"; alt: string }
  | { kind: "error"; message: string }
  | { kind: "approved"; alt: string }
  | { kind: "skipped" };

/** Per-window tallies, used to drive the per-window flow. */
export interface WindowCounts {
  approved: number;
  skipped: number;
  ready: number;
  error: number;
  busy: number;
}

export interface AltReview {
  /** The current review window — a bounded slice of the whole flagged backlog. */
  queue: MediaItem[];
  /** Per-image review state, keyed by URL. */
  states: Record<string, ItemState>;
  /** Running session totals across all windows. */
  session: { approved: number; skipped: number };
  /** True while the next window is being loaded. */
  advancing: boolean;
  /** True once the whole backlog is cleared or the pass stopped. */
  done: boolean;
  /** Tallies for the current window only. */
  counts: WindowCounts;
  /** Handled count clamped to `total`. */
  handled: number;
  /** Overall completion percentage (0–100). */
  percent: number;
  /** URL whose alt text is currently being saved, or null. */
  savingUrl: string | null;
  /** Replace the editable draft for a ready item. */
  setAltDraft: (url: string, alt: string) => void;
  /** Save the reviewed alt text for one image. */
  approve: (url: string, alt: string) => void;
  /** Mark one image as skipped. */
  skip: (url: string) => void;
  /** Pull every image skipped so far this pass back into the review queue. */
  reviewSkipped: () => void;
  /**
   * Forget the images skipped this pass without reviewing them: clears the
   * persisted skip state and zeroes the count.
   */
  clearSkippedState: () => void;
  /** Re-request a suggestion for one previously-failed image. */
  retry: (url: string) => void;
  /** Re-request suggestions for every failed image in the current window. */
  retryAllFailed: () => void;
}

/**
 * Owns the stateful bulk alt-text review flow: per-window suggestion fan-out,
 * the whole-window failure guard, auto-advancing through the backlog, and
 * per-item / "retry all failed" recovery. Kept separate from the dialog UI so
 * the state transitions can be exercised in isolation.
 */
export function useAltReview({
  filter,
  initialItems,
  total,
  initialSkipped,
  initialApproved,
  fetchNext,
  onSkippedChange,
  onApprovedChange,
  onCompleted,
}: {
  /**
   * Search filter the pass is scoped to. Used to subscribe to cross-tab skip
   * and approval updates persisted under the same filter key.
   */
  filter: string;
  initialItems: MediaItem[];
  total: number;
  /**
   * URLs skipped in an earlier, interrupted run of this pass (restored from
   * persistence). They're already excluded from `initialItems`; seeded here so
   * the progress count and in-session exclude set pick up where they left off.
   */
  initialSkipped: string[];
  /**
   * url→alt map of images already approved by a concurrent tab on the same
   * filter (restored from the cross-tab channel). They're already excluded from
   * `initialItems` (their server flag is cleared, so `total` doesn't count them
   * either); seeded into the in-session exclude set so a later cross-tab event
   * for the same URL isn't mistaken for a new approval and double-counted.
   */
  initialApproved?: Record<string, string>;
  fetchNext: (excludeUrls: string[]) => Promise<MediaItem[]>;
  /**
   * Called whenever an image is skipped, with the full set of URLs skipped so
   * far this pass. The parent persists this so the pass survives a
   * close/reopen (and page reload) without re-showing skipped images.
   */
  onSkippedChange?: (skippedUrls: string[]) => void;
  /**
   * Called whenever an image is approved, with the full url→alt map approved so
   * far this pass. The parent persists this on the cross-tab channel so other
   * open tabs running the same pass reflect it as already handled.
   */
  onApprovedChange?: (approved: Record<string, string>) => void;
  /** Called once the backlog is fully cleared, so the parent can reset state. */
  onCompleted?: () => void;
}): AltReview {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const suggestBatch = useSuggestCmsMediaAltBatch();
  const updateAlt = useUpdateCmsMediaAlt();

  // Snapshot the fetcher so a filter change behind the dialog can't reshuffle
  // the session mid-review.
  const fetchNextRef = useRef(fetchNext);

  // The current review window — a bounded slice of the whole flagged backlog.
  const [queue, setQueue] = useState<MediaItem[]>(initialItems);
  // Items for the window the suggestion effect should fire for; kept in a ref so
  // the effect never reads a stale queue between renders.
  const windowItemsRef = useRef<MediaItem[]>(initialItems);
  // Bumped each time a new window loads so the suggestion effect re-fires.
  const [windowKey, setWindowKey] = useState(0);
  const [states, setStates] = useState<Record<string, ItemState>>(() =>
    Object.fromEntries(initialItems.map((it) => [it.url, { kind: "pending" }])),
  );

  // Running session totals, incremented exactly once per editor action so the
  // overall progress is exact regardless of how many windows have scrolled by.
  // Skips carry over from an interrupted earlier run of this pass.
  const [session, setSession] = useState(() => ({
    approved: 0,
    skipped: initialSkipped.length,
  }));
  // Every URL handled this session (approved/skipped/errored), excluded when
  // loading the next window so nothing can reappear and loop forever. Seeded
  // with skips restored from a prior, interrupted run of this pass AND with any
  // images a concurrent tab already approved (so a later cross-tab event for the
  // same URL isn't counted as a fresh approval).
  const seenRef = useRef<Set<string>>(
    new Set([...initialSkipped, ...Object.keys(initialApproved ?? {})]),
  );
  // The subset of `seenRef` that was skipped (not approved/errored). This is
  // what we persist so a reopened pass doesn't re-show skipped images.
  const skippedRef = useRef<Set<string>>(new Set(initialSkipped));
  // The url→alt map of images approved this pass. Persisted on the cross-tab
  // channel so other open tabs reflect them as handled. Seeded with approvals a
  // concurrent tab already made (their flag is cleared, so `total` excludes them
  // and we must NOT also add them to the session count).
  const approvedRef = useRef<Record<string, string>>({
    ...(initialApproved ?? {}),
  });
  const [advancing, setAdvancing] = useState(false);
  const [done, setDone] = useState(false);

  const setState = (url: string, next: ItemState) =>
    setStates((prev) => ({ ...prev, [url]: next }));

  // Request AI suggestions for a set of URLs, marking each "suggesting" first
  // and resolving to "ready"/"error" as chunks return. Used for both the
  // initial per-window pass and for retrying individual failures.
  const runSuggestions = (urls: string[]) => {
    if (urls.length === 0) return;
    setStates((prev) => {
      const next = { ...prev };
      for (const url of urls) next[url] = { kind: "suggesting" };
      return next;
    });

    const chunks: string[][] = [];
    for (let i = 0; i < urls.length; i += MAX_URLS_PER_BATCH) {
      chunks.push(urls.slice(i, i + MAX_URLS_PER_BATCH));
    }

    let sawError = false;
    for (const chunk of chunks) {
      suggestBatch.mutate(
        { data: { urls: chunk } },
        {
          onSuccess: (res) => {
            setStates((prev) => {
              const next = { ...prev };
              for (const r of res.results) {
                next[r.url] = r.suggestion
                  ? { kind: "ready", alt: r.suggestion }
                  : {
                      kind: "error",
                      message: r.error ?? "Couldn't generate a suggestion.",
                    };
              }
              return next;
            });
          },
          onError: () => {
            setStates((prev) => {
              const next = { ...prev };
              for (const url of chunk) {
                next[url] = {
                  kind: "error",
                  message: "The AI service is unavailable.",
                };
              }
              return next;
            });
            if (!sawError) {
              sawError = true;
              toast({
                title: "Couldn't generate some suggestions",
                description: "The AI service is unavailable. Please try again.",
                variant: "destructive",
              });
            }
          },
        },
      );
    }
  };

  const fireSuggestions = (windowItems: MediaItem[]) =>
    runSuggestions(windowItems.map((it) => it.url));

  // Re-request a suggestion for one previously-failed image. Clearing `done`
  // lets the pass resume auto-advancing if the whole window had stalled on
  // failures.
  const retry = (url: string) => {
    setDone(false);
    runSuggestions([url]);
  };

  // Re-request suggestions for every failed image in the current window.
  const retryAllFailed = () => {
    const failedUrls = queue
      .map((it) => it.url)
      .filter((url) => states[url]?.kind === "error");
    if (failedUrls.length === 0) return;
    setDone(false);
    runSuggestions(failedUrls);
  };

  // Generate suggestions for the current window whenever a new one loads.
  useEffect(() => {
    fireSuggestions(windowItemsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowKey]);

  const approve = (url: string, alt: string) => {
    const trimmed = alt.trim();
    if (!trimmed) return;
    updateAlt.mutate(
      { data: { url, alt: trimmed } },
      {
        onSuccess: () => {
          setState(url, { kind: "approved", alt: trimmed });
          setSession((s) => ({ ...s, approved: s.approved + 1 }));
          seenRef.current.add(url);
          approvedRef.current[url] = trimmed;
          onApprovedChange?.({ ...approvedRef.current });
          queryClient.invalidateQueries({ queryKey: ["/api/cms/media"] });
        },
        onError: () => {
          toast({
            title: "Couldn't save alt text",
            description: "Please try again.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const skip = (url: string) => {
    setState(url, { kind: "skipped" });
    setSession((s) => ({ ...s, skipped: s.skipped + 1 }));
    seenRef.current.add(url);
    skippedRef.current.add(url);
    onSkippedChange?.([...skippedRef.current]);
  };

  // Keep this pass in sync with the same pass running in another open tab. When
  // another tab skips an image it persists the updated skip set; we pick that up
  // via the `storage` event and fold any URLs we haven't already handled into
  // this tab's running progress so the two tabs converge instead of diverging.
  useEffect(() => {
    return subscribeSkipped(filter, (skippedUrls) => {
      const added: string[] = [];
      for (const url of skippedUrls) {
        if (seenRef.current.has(url)) continue;
        seenRef.current.add(url);
        skippedRef.current.add(url);
        added.push(url);
      }
      if (added.length === 0) return;
      // Reflect any newly-skipped image that happens to be in the current
      // window so it isn't re-reviewed here.
      setStates((prev) => {
        let next: Record<string, ItemState> | null = null;
        for (const url of added) {
          const existing = prev[url];
          if (existing !== undefined && existing.kind !== "skipped") {
            next ??= { ...prev };
            next[url] = { kind: "skipped" };
          }
        }
        return next ?? prev;
      });
      setSession((s) => ({ ...s, skipped: s.skipped + added.length }));
    });
  }, [filter]);

  // Keep this pass in sync with approvals made in another open tab. When another
  // tab approves an image it writes the url→alt to the cross-tab channel; we
  // pick that up via the `storage` event and fold any URLs we haven't already
  // handled into this tab's running progress so a concurrent tab can't
  // re-suggest or re-count an image already approved elsewhere. Items still in
  // this window are flipped to "approved" with the exact alt the other tab saved.
  useEffect(() => {
    return subscribeApproved(filter, (entries) => {
      // Newly-seen approvals (count once); already-approved URLs whose alt an
      // editor *corrected* in another tab (refresh the displayed/stored alt but
      // DON'T re-count — already handled here); and URLs this tab *skipped* that
      // another tab has since approved (promote skip→approval: move one from the
      // skipped tally to the approved tally, no net double-count).
      const added: string[] = [];
      const refreshed: string[] = [];
      const promoted: string[] = [];
      for (const [url, alt] of Object.entries(entries)) {
        if (seenRef.current.has(url)) {
          if (url in approvedRef.current) {
            // Already approved here: refresh the displayed/stored alt if the
            // other tab corrected it. A no-op when the alt is unchanged (e.g.
            // another tab echoing the same approval back).
            if (approvedRef.current[url] !== alt) {
              approvedRef.current[url] = alt;
              refreshed.push(url);
            }
          } else if (skippedRef.current.has(url)) {
            // Seen here only because it was skipped, but another tab approved it
            // (with edits). Promote it: it's no longer skipped, it's approved.
            skippedRef.current.delete(url);
            approvedRef.current[url] = alt;
            promoted.push(url);
          }
          // A URL seen because it errored here is neither approved nor skipped;
          // nothing to update.
          continue;
        }
        seenRef.current.add(url);
        approvedRef.current[url] = alt;
        added.push(url);
      }
      if (added.length === 0 && refreshed.length === 0 && promoted.length === 0)
        return;
      setStates((prev) => {
        let next: Record<string, ItemState> | null = null;
        for (const url of [...added, ...refreshed, ...promoted]) {
          const existing = prev[url];
          const alt = entries[url] ?? "";
          // Flip pending/ready/skipped items to approved, and update an
          // already-approved item whose alt changed; skip when it already shows
          // the exact alt.
          if (
            existing !== undefined &&
            !(existing.kind === "approved" && existing.alt === alt)
          ) {
            next ??= { ...prev };
            next[url] = { kind: "approved", alt };
          }
        }
        return next ?? prev;
      });
      // Newly-seen approvals add to the count; promotions move one image from
      // the skipped tally to the approved tally (handled total unchanged).
      if (added.length > 0 || promoted.length > 0) {
        setSession((s) => ({
          ...s,
          approved: s.approved + added.length + promoted.length,
          skipped: s.skipped - promoted.length,
        }));
      }
      // A promotion shrinks the persisted skip set, so the reopened pass won't
      // re-show the now-approved image as skipped.
      if (promoted.length > 0) {
        onSkippedChange?.([...skippedRef.current]);
      }
    });
  }, [filter]);

  const setAltDraft = (url: string, alt: string) =>
    setState(url, { kind: "ready", alt });

  // Pull every image skipped so far this pass back into the review queue. The
  // skipped URLs stay flagged on the server, so it's enough to drop them from
  // the seen/skipped sets and reload a window — they'll be gathered again.
  const reviewSkipped = async () => {
    const skippedUrls = [...skippedRef.current];
    if (skippedUrls.length === 0 || advancing) return;
    setAdvancing(true);
    for (const url of skippedUrls) seenRef.current.delete(url);
    skippedRef.current.clear();
    onSkippedChange?.([]);
    setSession((s) => ({ ...s, skipped: 0 }));
    setDone(false);
    try {
      const next = await fetchNextRef.current([...seenRef.current]);
      if (next.length === 0) {
        setDone(true);
        onCompleted?.();
        return;
      }
      windowItemsRef.current = next;
      setQueue(next);
      setStates(
        Object.fromEntries(next.map((it) => [it.url, { kind: "pending" }])),
      );
      setWindowKey((k) => k + 1);
    } catch {
      toast({
        title: "Couldn't load your skipped images",
        description: "Reopen the suggestion pass to try again.",
        variant: "destructive",
      });
      setDone(true);
    } finally {
      setAdvancing(false);
    }
  };

  // Forget the skipped images without reviewing them: clears the persisted skip
  // state and zeroes the count. They stay flagged on the server, so a future
  // pass starts fresh on them.
  const clearSkippedState = () => {
    if (skippedRef.current.size === 0) return;
    for (const url of skippedRef.current) seenRef.current.delete(url);
    skippedRef.current.clear();
    onSkippedChange?.([]);
    setSession((s) => ({ ...s, skipped: 0 }));
  };

  // Current-window tallies, used to drive the per-window flow (not the overall
  // progress, which is tracked exactly by `session`).
  const counts = queue.reduce<WindowCounts>(
    (acc, it) => {
      const s = states[it.url]?.kind ?? "pending";
      if (s === "approved") acc.approved += 1;
      else if (s === "skipped") acc.skipped += 1;
      else if (s === "ready") acc.ready += 1;
      else if (s === "error") acc.error += 1;
      else acc.busy += 1;
      return acc;
    },
    { approved: 0, skipped: 0, ready: 0, error: 0, busy: 0 },
  );

  const windowReviewed = counts.ready === 0 && counts.busy === 0;

  // Load the next window once the current one is fully reviewed.
  const advance = async () => {
    setAdvancing(true);
    for (const it of queue) seenRef.current.add(it.url);
    try {
      const next = await fetchNextRef.current([...seenRef.current]);
      if (next.length === 0) {
        setDone(true);
        // Backlog cleared (only skipped images remain). The pass is complete,
        // so drop its persisted skip state — a future pass starts fresh.
        onCompleted?.();
        return;
      }
      windowItemsRef.current = next;
      setQueue(next);
      setStates(
        Object.fromEntries(next.map((it) => [it.url, { kind: "pending" }])),
      );
      setWindowKey((k) => k + 1);
    } catch {
      toast({
        title: "Couldn't load the next set of images",
        description: "Reopen the suggestion pass to continue with the rest.",
        variant: "destructive",
      });
      setDone(true);
    } finally {
      setAdvancing(false);
    }
  };

  // Auto-continue through the backlog: when a window is fully reviewed, move on
  // to the next set of still-flagged images — unless the editor already stopped.
  useEffect(() => {
    if (!windowReviewed || advancing || done) return;
    // If the entire window failed (e.g. the AI service is down), stop rather
    // than churn silently through the rest of the backlog.
    if (counts.approved === 0 && counts.skipped === 0 && counts.error > 0) {
      setDone(true);
      return;
    }
    void advance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowReviewed]);

  const handled = Math.min(session.approved + session.skipped, total);
  const percent = total > 0 ? Math.round((handled / total) * 100) : 100;
  const savingUrl =
    updateAlt.isPending && updateAlt.variables
      ? updateAlt.variables.data.url
      : null;

  return {
    queue,
    states,
    session,
    advancing,
    done,
    counts,
    handled,
    percent,
    savingUrl,
    setAltDraft,
    approve,
    skip,
    reviewSkipped,
    clearSkippedState,
    retry,
    retryAllFailed,
  };
}
