import { useState } from "react";
import { type MediaItem } from "@workspace/api-client-react";
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
import { useAltReview, type ItemState } from "./use-alt-review";

/** A bulk-suggestion session: the first window plus the size of the whole backlog. */
export interface BulkSuggestSession {
  /**
   * Search filter snapshotted at session start. Progress is persisted under
   * this key, so a filter change behind the dialog can't write/clear progress
   * against the wrong scope mid-pass.
   */
  filter: string;
  /** First bounded window of flagged images to review. */
  items: MediaItem[];
  /** Total flagged images across the whole filtered set at session start. */
  total: number;
  /**
   * URLs skipped in an earlier, interrupted run of this pass (restored from
   * persistence). They're already excluded from `items`; seeded here so the
   * progress count and in-session exclude set pick up where they left off.
   */
  skipped: string[];
  /**
   * url→alt map of images already approved by a concurrent tab on the same
   * filter (restored from the cross-tab channel). Already excluded from `items`;
   * seeded so a later cross-tab event for the same URL isn't double-counted.
   */
  approved: Record<string, string>;
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
  /**
   * Called whenever an image is skipped, with the full set of URLs skipped so
   * far this pass. The parent persists this so the pass survives a
   * close/reopen (and page reload) without re-showing skipped images.
   */
  onSkippedChange?: (skippedUrls: string[]) => void;
  /**
   * Called when the skip set *shrinks* (skips reviewed, forgotten, or promoted
   * to an approval). The parent must authoritatively *replace* the persisted
   * value here — `onSkippedChange` only ever grows it (union) and can't honour a
   * removal.
   */
  onSkippedReset?: (skippedUrls: string[]) => void;
  /**
   * Called whenever an image is approved, with the full url→alt map approved so
   * far this pass. The parent persists this on the cross-tab channel so other
   * open tabs running the same pass reflect it as already handled.
   */
  onApprovedChange?: (approved: Record<string, string>) => void;
  /** Called once the backlog is fully cleared, so the parent can reset state. */
  onCompleted?: () => void;
}

export function BulkAltReviewDialog({
  session,
  open,
  onOpenChange,
  fetchNext,
  onSkippedChange,
  onSkippedReset,
  onApprovedChange,
  onCompleted,
}: BulkAltReviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {open && session ? (
          <ReviewBody
            filter={session.filter}
            initialItems={session.items}
            total={session.total}
            initialSkipped={session.skipped}
            initialApproved={session.approved}
            fetchNext={fetchNext}
            onSkippedChange={onSkippedChange}
            onSkippedReset={onSkippedReset}
            onApprovedChange={onApprovedChange}
            onCompleted={onCompleted}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function ReviewBody({
  filter,
  initialItems,
  total,
  initialSkipped,
  initialApproved,
  fetchNext,
  onSkippedChange,
  onSkippedReset,
  onApprovedChange,
  onCompleted,
  onClose,
}: {
  filter: string;
  initialItems: MediaItem[];
  total: number;
  initialSkipped: string[];
  initialApproved: Record<string, string>;
  fetchNext: (excludeUrls: string[]) => Promise<MediaItem[]>;
  onSkippedChange?: (skippedUrls: string[]) => void;
  onSkippedReset?: (skippedUrls: string[]) => void;
  onApprovedChange?: (approved: Record<string, string>) => void;
  onCompleted?: () => void;
  onClose: () => void;
}) {
  const {
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
  } = useAltReview({
    filter,
    initialItems,
    total,
    initialSkipped,
    initialApproved,
    fetchNext,
    onSkippedChange,
    onSkippedReset,
    onApprovedChange,
    onCompleted,
  });

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
              <span className="inline-flex items-center overflow-hidden rounded-md border border-border/60">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 rounded-none px-2 text-xs font-normal"
                  onClick={reviewSkipped}
                  disabled={advancing}
                  title="Bring your skipped images back into this pass"
                >
                  <RotateCcw className="h-3 w-3" />
                  Review {session.skipped} skipped
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 rounded-none border-l border-border/60 px-1.5 text-xs font-normal text-muted-foreground"
                  onClick={clearSkippedState}
                  disabled={advancing}
                  title="Forget the skipped images (clears saved skip state)"
                  aria-label="Clear skipped images"
                >
                  <X className="h-3 w-3" />
                </Button>
              </span>
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
            onChangeAlt={(alt) => setAltDraft(item.url, alt)}
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
