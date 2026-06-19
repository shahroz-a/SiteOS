/**
 * Live preview pane. Renders the in-progress draft through the SHARED
 * `@workspace/blog-renderer` so the CMS preview is byte-for-byte the same
 * pipeline the public blog uses — no preview-only rendering logic here.
 */
import { useMemo, useState } from "react";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import { ContentRenderer } from "@workspace/blog-renderer";
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/toggle-group";
import { cn } from "@workspace/ui";
import { blocksToComponentTree, type EditorBlock } from "./model";

type Device = "desktop" | "tablet" | "mobile";

const DEVICE_WIDTH: Record<Device, string> = {
  desktop: "100%",
  tablet: "768px",
  mobile: "390px",
};

export function EditorPreview({
  blocks,
  title,
  bannerUrl,
  bannerAlt,
}: {
  blocks: EditorBlock[];
  title?: string;
  /** The article's banner/hero image; rendered above the body as on the public blog. */
  bannerUrl?: string | null;
  bannerAlt?: string | null;
}) {
  const [device, setDevice] = useState<Device>("desktop");

  const componentTree = useMemo(() => blocksToComponentTree(blocks), [blocks]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-2">
        <span className="text-sm font-medium text-muted-foreground">Live preview</span>
        <ToggleGroup
          type="single"
          value={device}
          onValueChange={(v) => v && setDevice(v as Device)}
          size="sm"
        >
          <ToggleGroupItem value="desktop" aria-label="Desktop">
            <Monitor className="h-4 w-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="tablet" aria-label="Tablet">
            <Tablet className="h-4 w-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="mobile" aria-label="Mobile">
            <Smartphone className="h-4 w-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="flex-1 overflow-auto bg-muted/30 p-4">
        <div
          className={cn(
            "mx-auto rounded-lg border border-border bg-background shadow-sm transition-all",
            device !== "desktop" && "max-w-full",
          )}
          style={{ width: DEVICE_WIDTH[device] }}
        >
          {bannerUrl ? (
            <img
              src={bannerUrl}
              alt={bannerAlt ?? title ?? ""}
              className="h-48 w-full rounded-t-lg object-cover"
            />
          ) : null}
          <article className="prose prose-stone max-w-none p-6 sm:p-8 dark:prose-invert">
            {title ? <h1 className="mb-6">{title}</h1> : null}
            <ContentRenderer post={{ componentTree, contentHtml: null }} />
          </article>
        </div>
      </div>
    </div>
  );
}
