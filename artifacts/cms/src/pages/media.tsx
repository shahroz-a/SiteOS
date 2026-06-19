import type { ChangeEvent } from "react";
import { useEffect, useState } from "react";
import {
  useListCmsMedia,
  listCmsMedia,
  type MediaItem,
} from "@workspace/api-client-react";
import { Input } from "@workspace/ui/input";
import { Button } from "@workspace/ui/button";
import { Switch } from "@workspace/ui/switch";
import { Label } from "@workspace/ui/label";
import { Spinner } from "@workspace/ui/spinner";
import { Empty, EmptyTitle, EmptyDescription } from "@workspace/ui/empty";
import { MediaGrid } from "@/components/media-grid";
import { MediaDetailsSheet } from "@/components/media-details-sheet";
import { MediaPicker } from "@/components/media-picker";
import {
  BulkAltReviewDialog,
  type BulkSuggestSession,
} from "@/components/bulk-alt-review-dialog";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useToast } from "@workspace/ui";
import { ImagePlus, Sparkles } from "lucide-react";

const PAGE_SIZE = 24;

/** Max flagged images gathered into a single bulk-suggestion review pass. */
const BULK_SUGGEST_CEILING = 200;

export default function MediaPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<MediaItem | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bulkSession, setBulkSession] = useState<BulkSuggestSession | null>(
    null,
  );
  const [bulkLoading, setBulkLoading] = useState(false);

  const q = useDebouncedValue(search, 300);

  // Reset to the first page whenever the filters change.
  useEffect(() => {
    setPage(1);
  }, [q, onlyIssues]);

  const { data, isLoading, isError, isFetching } = useListCmsMedia({
    q: q || undefined,
    onlyIssues,
    page,
    limit: PAGE_SIZE,
  });

  const items = data?.items ?? [];
  const pagination = data?.pagination;
  const summary = data?.summary;
  const totalPages = pagination?.totalPages ?? 1;

  // The bulk action targets EVERY image failing alt validation across the
  // current search filter — not just the loaded page. We gather them by
  // paginating the list with onlyIssues forced on (capped for cost/review
  // sanity), then hand the full set to the review queue.
  const totalIssues = summary?.withAltIssues ?? 0;

  // Gather one bounded window of still-flagged images for the current search
  // filter, excluding any URLs already handled in this session. Each window is
  // capped at BULK_SUGGEST_CEILING for cost/review sanity; the review dialog
  // calls this repeatedly to walk the whole backlog one window at a time.
  const gatherFlagged = async (
    exclude: Set<string>,
  ): Promise<MediaItem[]> => {
    const gathered: MediaItem[] = [];
    const limit = 100;
    let pageNum = 1;
    while (gathered.length < BULK_SUGGEST_CEILING) {
      const res = await listCmsMedia({
        q: q || undefined,
        onlyIssues: true,
        page: pageNum,
        limit,
      });
      for (const it of res.items) {
        if (exclude.has(it.url)) continue;
        gathered.push(it);
        if (gathered.length >= BULK_SUGGEST_CEILING) break;
      }
      if (pageNum >= res.pagination.totalPages) break;
      pageNum += 1;
    }
    return gathered;
  };

  const startBulkSuggest = async () => {
    setBulkLoading(true);
    try {
      const first = await gatherFlagged(new Set());
      if (first.length === 0) {
        toast({ title: "No flagged images to suggest for." });
        return;
      }
      setBulkSession({ items: first, total: totalIssues });
    } catch {
      toast({
        title: "Couldn't load flagged images",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-serif text-4xl tracking-tight">Media library</h1>
          <p className="max-w-2xl text-muted-foreground">
            Every image already used across the blog, reusable from its CDN URL.
            {summary ? (
              <>
                {" "}
                <span className="font-medium text-foreground">
                  {summary.totalImages.toLocaleString()}
                </span>{" "}
                images
                {summary.withAltIssues > 0 ? (
                  <>
                    {" · "}
                    <span className="font-medium text-amber-600 dark:text-amber-400">
                      {summary.withAltIssues.toLocaleString()}
                    </span>{" "}
                    need alt text
                  </>
                ) : null}
                .
              </>
            ) : null}
          </p>
        </div>
        <Button variant="outline" onClick={() => setPickerOpen(true)}>
          <ImagePlus className="mr-2 h-4 w-4" />
          Image picker
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Input
          placeholder="Search by description, caption or URL…"
          value={search}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          className="max-w-md"
        />
        <div className="flex items-center gap-2">
          <Switch
            id="only-issues"
            checked={onlyIssues}
            onCheckedChange={setOnlyIssues}
          />
          <Label htmlFor="only-issues" className="cursor-pointer">
            Only needs alt text
          </Label>
        </div>
        {totalIssues > 0 ? (
          <Button
            variant="outline"
            className="ml-auto"
            onClick={startBulkSuggest}
            disabled={bulkLoading}
          >
            {bulkLoading ? (
              <Spinner className="mr-2 size-4" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Suggest alt for {totalIssues.toLocaleString()} flagged
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="size-8 text-muted-foreground" />
        </div>
      ) : isError ? (
        <Empty className="h-64">
          <EmptyTitle>Couldn't load the media library</EmptyTitle>
          <EmptyDescription>Please try again.</EmptyDescription>
        </Empty>
      ) : items.length === 0 ? (
        <Empty className="h-64">
          <EmptyTitle>No images found</EmptyTitle>
          <EmptyDescription>
            {onlyIssues
              ? "No images match this filter. Try turning off “Only needs alt text”."
              : "Try a different search term."}
          </EmptyDescription>
        </Empty>
      ) : (
        <MediaGrid items={items} onSelect={setActive} selectedUrl={active?.url} />
      )}

      {pagination && pagination.total > 0 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {pagination.page} of {totalPages} ·{" "}
            {pagination.total.toLocaleString()}{" "}
            {pagination.total === 1 ? "image" : "images"}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <MediaDetailsSheet
        item={active}
        open={active !== null}
        onOpenChange={(open) => {
          if (!open) setActive(null);
        }}
      />

      <BulkAltReviewDialog
        session={bulkSession}
        open={bulkSession !== null}
        onOpenChange={(open) => {
          if (!open) setBulkSession(null);
        }}
        fetchNext={(exclude) => gatherFlagged(new Set(exclude))}
      />

      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(item) => {
          void navigator.clipboard?.writeText(item.url);
          toast({
            title: "Image URL copied",
            description: "Paste the CDN URL into an article — no upload needed.",
          });
        }}
      />
    </div>
  );
}
