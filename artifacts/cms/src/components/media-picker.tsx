import type { ChangeEvent } from "react";
import { useEffect, useState } from "react";
import {
  useListCmsMedia,
  getListCmsMediaQueryKey,
  type MediaItem,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/dialog";
import { Input } from "@workspace/ui/input";
import { Button } from "@workspace/ui/button";
import { Spinner } from "@workspace/ui/spinner";
import { Empty, EmptyDescription, EmptyTitle } from "@workspace/ui/empty";
import { MediaGrid } from "@/components/media-grid";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

const PAGE_SIZE = 12;

interface MediaPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Called with the chosen media item. The library reuses the existing CDN
   * image, so consumers should use `item.url` directly — nothing is uploaded.
   */
  onSelect: (item: MediaItem) => void;
  title?: string;
  description?: string;
}

/**
 * A reusable image picker over the media library. Editors embed this to insert
 * an existing Headout CDN image into content without re-uploading binaries.
 */
export function MediaPicker({
  open,
  onOpenChange,
  onSelect,
  title = "Choose an image",
  description = "Search the media library and reuse an existing CDN image.",
}: MediaPickerProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(search, 300);

  // Reset paging whenever the search term changes or the dialog reopens.
  useEffect(() => {
    setPage(1);
  }, [q]);
  useEffect(() => {
    if (open) {
      setSearch("");
      setPage(1);
    }
  }, [open]);

  const params = { q: q || undefined, page, limit: PAGE_SIZE };
  const { data, isLoading, isError, isFetching } = useListCmsMedia(params, {
    query: { queryKey: getListCmsMediaQueryKey(params), enabled: open },
  });

  const items = data?.items ?? [];
  const totalPages = data?.pagination.totalPages ?? 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          placeholder="Search by description, caption or URL…"
          value={search}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Spinner className="size-6 text-muted-foreground" />
            </div>
          ) : isError ? (
            <Empty className="h-48">
              <EmptyTitle>Couldn't load media</EmptyTitle>
              <EmptyDescription>Please try again.</EmptyDescription>
            </Empty>
          ) : items.length === 0 ? (
            <Empty className="h-48">
              <EmptyTitle>No images found</EmptyTitle>
              <EmptyDescription>
                Try a different search term.
              </EmptyDescription>
            </Empty>
          ) : (
            <MediaGrid
              items={items}
              onSelect={(item) => {
                onSelect(item);
                onOpenChange(false);
              }}
            />
          )}
        </div>

        {totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-border/60 pt-3">
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
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
      </DialogContent>
    </Dialog>
  );
}
