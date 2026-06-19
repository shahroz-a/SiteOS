import { useState } from "react";
import { Link } from "wouter";
import type { MediaItem } from "@workspace/api-client-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  ALT_STATUS_META,
  formatDimensions,
  fileNameFromUrl,
} from "@/lib/media-utils";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  ImageOff,
} from "lucide-react";

interface MediaDetailsSheetProps {
  item: MediaItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MediaDetailsSheet({
  item,
  open,
  onOpenChange,
}: MediaDetailsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {item ? <DetailsBody item={item} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailsBody({ item }: { item: MediaItem }) {
  const { toast } = useToast();
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const altMeta = ALT_STATUS_META[item.altStatus];
  const dimensions = formatDimensions(item.width, item.height);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(item.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast({ title: "CDN URL copied to clipboard" });
    } catch {
      toast({ title: "Couldn't copy URL", variant: "destructive" });
    }
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle className="font-serif text-2xl tracking-tight">
          {item.alt?.trim() || fileNameFromUrl(item.url)}
        </SheetTitle>
        <SheetDescription>
          Used on {item.pageCount} {item.pageCount === 1 ? "page" : "pages"} ·{" "}
          {item.usageCount} total {item.usageCount === 1 ? "usage" : "usages"}
        </SheetDescription>
      </SheetHeader>

      <div className="mt-6 space-y-6">
        <div className="overflow-hidden rounded-lg border border-border/60 bg-muted">
          {failed ? (
            <div className="flex h-48 items-center justify-center text-muted-foreground">
              <ImageOff className="h-8 w-8" />
            </div>
          ) : (
            <img
              src={item.url}
              alt={item.alt ?? ""}
              className="max-h-80 w-full object-contain"
              onError={() => setFailed(true)}
            />
          )}
        </div>

        <div className="space-y-2">
          <Badge
            variant="outline"
            className={cn("font-normal", altMeta.badgeClass)}
          >
            {altMeta.label}
          </Badge>
          {item.altIssues.length > 0 ? (
            <ul className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              {item.altIssues.map((issue, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{issue}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            CDN URL
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">
              {item.url}
            </code>
            <Button size="sm" variant="outline" onClick={copyUrl}>
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={item.url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>

        <Separator />

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Field label="Alt text" value={item.alt} />
          <Field label="Title" value={item.title} />
          <Field label="Caption" value={item.caption} />
          <Field label="Credit" value={item.credit} />
          <Field label="Dimensions" value={dimensions} />
          <Field label="Type" value={item.mimeType} />
          <Field label="Role" value={item.role} />
        </dl>

        {item.pages.length > 0 ? (
          <>
            <Separator />
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Referencing pages
              </p>
              <ul className="space-y-2">
                {item.pages.map((page) => {
                  const pageAltMeta = ALT_STATUS_META[page.altStatus];
                  return (
                    <li
                      key={page.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/content/${page.slug}`}
                          className="block truncate text-sm font-medium hover:underline"
                          title={page.title}
                        >
                          {page.title || page.slug}
                        </Link>
                        <span className="truncate text-xs text-muted-foreground">
                          {page.pathname}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="secondary" className="font-normal">
                          {page.status}
                        </Badge>
                        {page.altStatus !== "ok" ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              "font-normal",
                              pageAltMeta.badgeClass,
                            )}
                          >
                            {pageAltMeta.shortLabel}
                          </Badge>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate" title={value ?? undefined}>
        {value?.trim() ? value : "—"}
      </dd>
    </div>
  );
}
