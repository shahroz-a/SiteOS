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

interface BulkAltReviewDialogProps {
  /** Flagged images to generate and review suggestions for. */
  items: MediaItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BulkAltReviewDialog({
  items,
  open,
  onOpenChange,
}: BulkAltReviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {open ? (
          <ReviewBody items={items} onClose={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ReviewBody({
  items,
  onClose,
}: {
  items: MediaItem[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const suggestBatch = useSuggestCmsMediaAltBatch();
  const updateAlt = useUpdateCmsMediaAlt();

  // Snapshot the items once so pagination/refetch behind the dialog can't
  // reshuffle the queue mid-review.
  const queueRef = useRef(items);
  const queue = queueRef.current;

  const [states, setStates] = useState<Record<string, ItemState>>(() =>
    Object.fromEntries(queue.map((it) => [it.url, { kind: "pending" }])),
  );
  const requestedRef = useRef(false);

  const setState = (url: string, next: ItemState) =>
    setStates((prev) => ({ ...prev, [url]: next }));

  // Kick off the suggestion requests as soon as the dialog opens. The server
  // caps each batch at MAX_URLS_PER_BATCH, so a large queue is split into
  // several requests fired together; each chunk resolves its own rows.
  useEffect(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;

    const urls = queue.map((it) => it.url);
    setStates(
      Object.fromEntries(urls.map((url) => [url, { kind: "suggesting" }])),
    );

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const approve = (url: string, alt: string) => {
    const trimmed = alt.trim();
    if (!trimmed) return;
    updateAlt.mutate(
      { data: { url, alt: trimmed } },
      {
        onSuccess: () => {
          setState(url, { kind: "approved", alt: trimmed });
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

  const allReviewed = counts.ready === 0 && counts.busy === 0;
  const savingUrl =
    updateAlt.isPending && updateAlt.variables
      ? updateAlt.variables.data.url
      : null;

  return (
    <>
      <DialogHeader className="border-b border-border/60 px-6 py-4">
        <DialogTitle className="font-serif text-2xl tracking-tight">
          Suggest alt text for {queue.length}{" "}
          {queue.length === 1 ? "image" : "images"}
        </DialogTitle>
        <DialogDescription>
          AI drafts a description for each flagged image. Review and edit, then
          approve or skip each one — nothing is saved until you approve it.
        </DialogDescription>
        <div className="flex flex-wrap gap-2 pt-1 text-xs">
          <Badge variant="secondary" className="font-normal">
            {counts.approved} approved
          </Badge>
          {counts.skipped > 0 ? (
            <Badge variant="secondary" className="font-normal">
              {counts.skipped} skipped
            </Badge>
          ) : null}
          {counts.error > 0 ? (
            <Badge
              variant="outline"
              className="border-red-500/30 bg-red-500/10 font-normal text-red-700 dark:text-red-300"
            >
              {counts.error} failed
            </Badge>
          ) : null}
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
            onSkip={() => setState(item.url, { kind: "skipped" })}
          />
        ))}
      </div>

      <DialogFooter className="border-t border-border/60 px-6 py-4">
        <Button variant="outline" onClick={onClose}>
          {allReviewed ? "Done" : "Close"}
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
}: {
  item: MediaItem;
  state: ItemState;
  saving: boolean;
  onChangeAlt: (alt: string) => void;
  onApprove: (alt: string) => void;
  onSkip: () => void;
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
}: {
  state: ItemState;
  saving: boolean;
  onChangeAlt: (alt: string) => void;
  onApprove: (alt: string) => void;
  onSkip: () => void;
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
      <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{state.message}</span>
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
