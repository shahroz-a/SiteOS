import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSuggestCmsMediaAltBatch,
  useUpdateCmsMediaAlt,
  type MediaItem,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@workspace/ui/dialog";
import { Button } from "@workspace/ui/button";
import { Textarea } from "@workspace/ui/textarea";
import { Badge } from "@workspace/ui/badge";
import { Spinner } from "@workspace/ui/spinner";
import { Progress } from "@workspace/ui/progress";
import { useToast } from "@workspace/ui";
import { cn } from "@workspace/ui";
import { ALT_STATUS_META, fileNameFromUrl } from "@/lib/media-utils";
import {
  AlertTriangle,
  Check,
  ImageOff,
  RotateCcw,
  Save,
  X,
} from "lucide-react";

/** Server-side cap on URLs per suggest-alt-batch request (mirrors the API). */
const MAX_URLS_PER_BATCH = 50;

/** Per-image state in the bulk review queue. */
type ItemState =
  | { kind: "pending" }
  | { kind: "suggesting" }
  | { kind: "ready"; alt: string }
  | { kind: "error"; message: string }
  | { kind: "approved"; alt: string }
  | { kind: "skipped" };

/** A bulk-suggestion session: the first window plus the size of the whole backlog. */
export interface BulkSuggestSession {
  /** First bounded window of flagged images to review. */
  items: MediaItem[];
  /** Total flagged images across the whole filtered set at session start. */
  total: number;
}

interface BulkAltReviewDialogProps {
  /** Active session, or null when closed. */
  session: BulkSuggestSession | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Loads the next window of still-flagged images, excluding any URLs already
   * handled this session. Returns an empty array when the backlog is cleared.
   */
  fetchNext: (excludeUrls: string[]) => Promise<MediaItem[]>;
}

export function BulkAltReviewDialog({
  session,
  open,
  onOpenChange,
  fetchNext,
}: BulkAltReviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {open && session ? (
          <ReviewBody
            initialItems={session.items}
            total={session.total}
            fetchNext={fetchNext}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function ReviewBody({
  initialItems,
  total,
  fetchNext,
  onClose,
}: {
  initialItems: MediaItem[];
  total: number;
  fetchNext: (excludeUrls: string[]) => Promise<MediaItem[]>;
  onClose: () => void;
}) {
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
  const [session, setSession] = useState({ approved: 0, skipped: 0 });
  // Every URL handled this session (approved/skipped/errored), excluded when
  // loading the next window so nothing can reappear and loop forever.
  const seenRef = useRef<Set<string>>(new Set());
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
  };

  // Current-window tallies, used to drive the per-window flow (not the overall
  // progress, which is tracked exactly by `session`).
  const counts = queue.reduce(
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

  return (
    <>
      <DialogHeader className="border-b border-border/60 px-6 py-4">
        <DialogTitle className="font-serif text-2xl tracking-tight">
          Suggest alt text
        </DialogTitle>
        <DialogDescription>
          AI drafts a description for each flagged image. Review and edit, then
          approve or skip each one — nothing is saved until you approve it. The
          pass continues through your whole backlog automatically; close it
          anytime to stop.
        </DialogDescription>
        <div className="space-y-2 pt-2">
          <Progress value={percent} />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-foreground">
              {handled.toLocaleString()} of {total.toLocaleString()} handled
            </span>
            <Badge variant="secondary" className="font-normal">
              {session.approved} approved
            </Badge>
            {session.skipped > 0 ? (
              <Badge variant="secondary" className="font-normal">
                {session.skipped} skipped
              </Badge>
            ) : null}
            {counts.error > 0 ? (
              <Badge
                variant="outline"
                className="border-red-500/30 bg-red-500/10 font-normal text-red-700 dark:text-red-300"
              >
                {counts.error} failed in this set
              </Badge>
            ) : null}
            {advancing ? (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Spinner className="size-3" /> Loading the next set…
              </span>
            ) : done ? (
              <span className="flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-300">
                <Check className="h-3.5 w-3.5" /> All caught up
              </span>
            ) : null}
          </div>
        </div>
      </DialogHeader>

      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
        {queue.map((item) => (
          <ReviewRow
            key={item.url}
            item={item}
            state={states[item.url] ?? { kind: "pending" }}
            saving={savingUrl === item.url}
            onChangeAlt={(alt) => setState(item.url, { kind: "ready", alt })}
            onApprove={(alt) => approve(item.url, alt)}
            onSkip={() => skip(item.url)}
            onRetry={() => retry(item.url)}
          />
        ))}
      </div>

      <DialogFooter className="border-t border-border/60 px-6 py-4 sm:justify-between">
        {counts.error > 0 ? (
          <Button
            variant="outline"
            onClick={retryAllFailed}
            disabled={advancing}
          >
            <RotateCcw className="h-4 w-4" /> Retry all failed ({counts.error})
          </Button>
        ) : (
          <span />
        )}
        <Button variant="outline" onClick={onClose}>
          {done ? "Done" : "Close"}
        </Button>
      </DialogFooter>
    </>
  );
}

function ReviewRow({
  item,
  state,
  saving,
  onChangeAlt,
  onApprove,
  onSkip,
  onRetry,
}: {
  item: MediaItem;
  state: ItemState;
  saving: boolean;
  onChangeAlt: (alt: string) => void;
  onApprove: (alt: string) => void;
  onSkip: () => void;
  onRetry: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const altMeta = ALT_STATUS_META[item.altStatus];

  return (
    <div className="flex gap-4 rounded-lg border border-border/60 p-3">
      <div className="h-24 w-24 shrink-0 overflow-hidden rounded-md border border-border/60 bg-muted">
        {failed ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-6 w-6" />
          </div>
        ) : (
          <img
            src={item.url}
            alt={item.alt ?? ""}
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p
            className="truncate text-sm font-medium"
            title={fileNameFromUrl(item.url)}
          >
            {fileNameFromUrl(item.url)}
          </p>
          <Badge
            variant="outline"
            className={cn("shrink-0 font-normal", altMeta.badgeClass)}
          >
            {altMeta.shortLabel}
          </Badge>
        </div>

        <RowControls
          state={state}
          saving={saving}
          onChangeAlt={onChangeAlt}
          onApprove={onApprove}
          onSkip={onSkip}
          onRetry={onRetry}
        />
      </div>
    </div>
  );
}

function RowControls({
  state,
  saving,
  onChangeAlt,
  onApprove,
  onSkip,
  onRetry,
}: {
  state: ItemState;
  saving: boolean;
  onChangeAlt: (alt: string) => void;
  onApprove: (alt: string) => void;
  onSkip: () => void;
  onRetry: () => void;
}) {
  if (state.kind === "suggesting" || state.kind === "pending") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Generating suggestion…
      </div>
    );
  }

  if (state.kind === "approved") {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
          <Check className="h-4 w-4" /> Saved
        </div>
        <p className="text-sm text-muted-foreground">{state.alt}</p>
      </div>
    );
  }

  if (state.kind === "skipped") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <X className="h-4 w-4" /> Skipped
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.message}</span>
        </div>
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            <RotateCcw className="h-4 w-4" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  // state.kind === "ready"
  const trimmed = state.alt.trim();
  return (
    <div className="space-y-2">
      <Textarea
        value={state.alt}
        onChange={(e) => onChangeAlt(e.target.value)}
        rows={2}
        className="text-sm"
        placeholder="Describe this image for screen readers and SEO…"
        disabled={saving}
      />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onSkip}
          disabled={saving}
        >
          <RotateCcw className="h-4 w-4" /> Skip
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => onApprove(state.alt)}
          disabled={!trimmed || saving}
        >
          {saving ? <Spinner className="size-4" /> : <Save className="h-4 w-4" />}
          Approve
        </Button>
      </div>
    </div>
  );
}
