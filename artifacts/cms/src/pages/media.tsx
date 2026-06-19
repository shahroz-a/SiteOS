import { useEffect, useState } from "react";
import {
  useListCmsMedia,
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
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useToast } from "@workspace/ui";
import { ImagePlus } from "lucide-react";

const PAGE_SIZE = 24;

export default function MediaPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<MediaItem | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

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
          onChange={(e) => setSearch(e.target.value)}
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
