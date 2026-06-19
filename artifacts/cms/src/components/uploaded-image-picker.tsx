import type { ChangeEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  useListUploadedImages,
  getListUploadedImagesQueryKey,
  type UploadedImage,
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
import { AspectRatio } from "@workspace/ui/aspect-ratio";
import { cn } from "@workspace/ui";
import { Empty, EmptyDescription, EmptyTitle } from "@workspace/ui/empty";
import { ImageOff } from "lucide-react";
import { fileNameFromUrl } from "@/lib/media-utils";

const PAGE_SIZE = 12;

interface UploadedImagePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Called with the chosen uploaded image. Consumers should use `image.url`
   * directly as the block image `src` — nothing is re-uploaded.
   */
  onSelect: (image: UploadedImage) => void;
}

/**
 * A picker over images the editor has previously uploaded to object storage.
 * Lets editors reuse an earlier upload in an Image or Gallery block instead of
 * uploading the same file again or pasting the URL by hand.
 */
export function UploadedImagePicker({
  open,
  onOpenChange,
  onSelect,
}: UploadedImagePickerProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // The list endpoint isn't searchable server-side (it's a bucket listing), so
  // reset paging when the dialog reopens and filter client-side on the page.
  useEffect(() => {
    if (open) {
      setSearch("");
      setPage(1);
    }
  }, [open]);

  const params = { page, limit: PAGE_SIZE };
  const { data, isLoading, isError, isFetching } = useListUploadedImages(params, {
    query: { queryKey: getListUploadedImagesQueryKey(params), enabled: open },
  });

  const items = data?.items ?? [];
  const totalPages = data?.pagination.totalPages ?? 1;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.url.toLowerCase().includes(q),
    );
  }, [items, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Choose an uploaded image</DialogTitle>
          <DialogDescription>
            Reuse an image you uploaded earlier — no need to upload it again.
          </DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          placeholder="Filter this page by file name…"
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
              <EmptyTitle>Couldn't load uploads</EmptyTitle>
              <EmptyDescription>Please try again.</EmptyDescription>
            </Empty>
          ) : filtered.length === 0 ? (
            <Empty className="h-48">
              <EmptyTitle>
                {items.length === 0 ? "No uploads yet" : "No matches"}
              </EmptyTitle>
              <EmptyDescription>
                {items.length === 0
                  ? "Upload an image and it will show up here for reuse."
                  : "Try a different file name."}
              </EmptyDescription>
            </Empty>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {filtered.map((item) => (
                <UploadedImageCard
                  key={item.name}
                  item={item}
                  onSelect={() => {
                    onSelect(item);
                    onOpenChange(false);
                  }}
                />
              ))}
            </div>
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

function UploadedImageCard({
  item,
  onSelect,
}: {
  item: UploadedImage;
  onSelect: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const label = fileNameFromUrl(item.url);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex flex-col overflow-hidden rounded-lg border border-border/60 bg-card text-left transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <AspectRatio ratio={4 / 3} className="bg-muted">
        {failed ? (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-6 w-6" />
          </div>
        ) : (
          <img
            src={item.url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        )}
      </AspectRatio>
      <div className="p-3">
        <p className="truncate text-xs font-medium text-foreground" title={label}>
          {label}
        </p>
      </div>
    </button>
  );
}
