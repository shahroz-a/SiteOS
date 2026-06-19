import { useState } from "react";
import type { MediaItem } from "@workspace/api-client-react";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ALT_STATUS_META, fileNameFromUrl } from "@/lib/media-utils";
import { ImageOff } from "lucide-react";

interface MediaGridProps {
  items: MediaItem[];
  onSelect: (item: MediaItem) => void;
  selectedUrl?: string | null;
}

export function MediaGrid({ items, onSelect, selectedUrl }: MediaGridProps) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => (
        <MediaCard
          key={item.url}
          item={item}
          onSelect={onSelect}
          selected={item.url === selectedUrl}
        />
      ))}
    </div>
  );
}

function MediaCard({
  item,
  onSelect,
  selected,
}: {
  item: MediaItem;
  onSelect: (item: MediaItem) => void;
  selected: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const altMeta = ALT_STATUS_META[item.altStatus];
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={cn(
        "group flex flex-col overflow-hidden rounded-lg border border-border/60 bg-card text-left transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-primary ring-2 ring-primary",
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
            alt={item.alt ?? ""}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        )}
      </AspectRatio>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <p
          className="truncate text-xs font-medium text-foreground"
          title={item.alt ?? fileNameFromUrl(item.url)}
        >
          {item.alt?.trim() || fileNameFromUrl(item.url)}
        </p>
        <div className="mt-auto flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {item.usageCount} use{item.usageCount === 1 ? "" : "s"}
          </span>
          {item.altStatus !== "ok" ? (
            <Badge
              variant="outline"
              className={cn("font-normal", altMeta.badgeClass)}
            >
              {altMeta.shortLabel}
            </Badge>
          ) : null}
        </div>
      </div>
    </button>
  );
}
