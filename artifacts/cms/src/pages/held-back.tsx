import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import {
  useListCmsHeldBackArticles,
  useResolveCmsHeldBackArticle,
  useGetCmsHeldBackArticleSource,
  getListCmsHeldBackArticlesQueryKey,
  type HeldBackArticle,
  type HeldBackValidationIssue,
} from "@workspace/api-client-react";
import { ContentRenderer } from "@workspace/blog-renderer";
import {
  streamReextract,
  type ReextractStage,
  type ReextractResultEvent,
} from "@/lib/reextract-client";
import { Badge } from "@workspace/ui/badge";
import { Button } from "@workspace/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/table";
import { Skeleton } from "@workspace/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/sheet";
import { Separator } from "@workspace/ui/separator";
import { useToast } from "@workspace/ui";
import { useCmsAuth } from "@/lib/cms-auth-context";
import { diffBlocks, normalizeUrl } from "@/lib/content-diff";

function statusBadge(status: HeldBackArticle["validationStatus"]) {
  if (status === "fail") {
    return <Badge variant="destructive">Failed</Badge>;
  }
  if (status === "warn") {
    return (
      <Badge variant="secondary" className="bg-amber-100 text-amber-900">
        Warning
      </Badge>
    );
  }
  if (status === "pass") {
    return (
      <Badge variant="secondary" className="bg-emerald-100 text-emerald-900">
        Passing
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Not scored
    </Badge>
  );
}

function FailIssues({ issues }: { issues: HeldBackValidationIssue[] | null }) {
  const fails = (issues ?? []).filter((i) => i.severity === "fail");
  if (fails.length === 0) {
    return (
      <span className="text-sm text-muted-foreground">
        No current failing checks
      </span>
    );
  }
  return (
    <ul className="space-y-1">
      {fails.map((issue, i) => (
        <li key={`${issue.field}-${i}`} className="text-sm">
          <span className="font-medium">{issue.field}</span>
          <span className="text-muted-foreground"> — {issue.message}</span>
        </li>
      ))}
    </ul>
  );
}

function severityBadge(severity: HeldBackValidationIssue["severity"]) {
  if (severity === "fail") {
    return (
      <Badge variant="destructive" className="text-[10px] uppercase">
        Fail
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      className="bg-amber-100 text-amber-900 text-[10px] uppercase"
    >
      Warn
    </Badge>
  );
}

function IssueRow({ issue }: { issue: HeldBackValidationIssue }) {
  const delta = issue.source - issue.parsed;
  return (
    <div className="rounded-md border border-border/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{issue.field}</span>
        {severityBadge(issue.severity)}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{issue.message}</p>
      <div className="mt-2 flex items-center gap-4 text-sm tabular-nums">
        <span>
          <span className="text-muted-foreground">Source: </span>
          <span className="font-medium">{issue.source}</span>
        </span>
        <span>
          <span className="text-muted-foreground">Parsed: </span>
          <span className="font-medium">{issue.parsed}</span>
        </span>
        {delta !== 0 ? (
          <span className="text-destructive">
            {delta > 0 ? `Missing ${delta}` : `Extra ${-delta}`}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Source-vs-parsed visual diff                                        */
/* ------------------------------------------------------------------ */

const BLOCK_SELECTOR =
  "p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, th, td, dt, dd, summary";

const REMOVED_CLS = [
  "diff-marker",
  "bg-destructive/10",
  "border-l-2",
  "border-destructive",
  "pl-3",
  "rounded-sm",
];
const CHANGED_CLS = [
  "diff-marker",
  "bg-amber-500/10",
  "border-l-2",
  "border-amber-500",
  "pl-3",
  "rounded-sm",
];
const IMG_CLS = [
  "diff-marker",
  "outline",
  "outline-2",
  "outline-offset-2",
  "outline-destructive",
];
const LINK_CLS = [
  "diff-marker",
  "text-destructive",
  "underline",
  "decoration-destructive",
  "decoration-2",
  "underline-offset-2",
];
const ACTIVE_CLS = ["ring-2", "ring-primary", "ring-offset-2"];

type MarkerType = "removed" | "changed" | "image" | "link";

interface MarkerInfo {
  type: MarkerType;
  label: string;
}

interface DiffViewState {
  dropped: number;
  changed: number;
  added: number;
  missingImages: number;
  missingLinks: number;
  markers: MarkerInfo[];
}

/** Leaf block elements that actually hold text (no nested block descendant). */
function leafBlockEls(root: HTMLElement): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
  return all.filter(
    (el) =>
      !el.querySelector(BLOCK_SELECTOR) && (el.textContent ?? "").trim().length,
  );
}

function truncate(s: string, n = 90): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

const MARKER_META: Record<
  MarkerType,
  { dot: string; verb: string }
> = {
  removed: { dot: "bg-destructive", verb: "Dropped paragraph" },
  changed: { dot: "bg-amber-500", verb: "Changed text" },
  image: { dot: "bg-destructive", verb: "Missing image" },
  link: { dot: "bg-destructive", verb: "Dropped link" },
};

function DiffControls({
  state,
  active,
  onPrev,
  onNext,
  onJump,
}: {
  state: DiffViewState | null;
  active: number;
  onPrev: () => void;
  onNext: () => void;
  onJump: (index: number) => void;
}) {
  if (!state) {
    return (
      <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
        Analyzing differences…
      </div>
    );
  }

  const total = state.markers.length;

  if (total === 0) {
    return (
      <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-900 dark:text-emerald-200">
        No differences detected — the importer kept every paragraph, image, and
        link from the source.
      </div>
    );
  }

  const chips: { label: string; count: number; cls: string }[] = [
    {
      label: "dropped",
      count: state.dropped,
      cls: "bg-destructive/10 text-destructive",
    },
    {
      label: "changed",
      count: state.changed,
      cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
    {
      label: "missing images",
      count: state.missingImages,
      cls: "bg-destructive/10 text-destructive",
    },
    {
      label: "dropped links",
      count: state.missingLinks,
      cls: "bg-destructive/10 text-destructive",
    },
    {
      label: "importer-added",
      count: state.added,
      cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    },
  ].filter((c) => c.count > 0);

  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <span
              key={c.label}
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.cls}`}
            >
              {c.count} {c.label}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs tabular-nums text-muted-foreground">
            {active >= 0 ? active + 1 : "—"} / {total}
          </span>
          <Button size="sm" variant="outline" onClick={onPrev}>
            Prev
          </Button>
          <Button size="sm" variant="outline" onClick={onNext}>
            Next difference
          </Button>
        </div>
      </div>

      <ol className="max-h-32 space-y-0.5 overflow-y-auto text-sm">
        {state.markers.map((m, i) => {
          const meta = MARKER_META[m.type];
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => onJump(i)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-muted ${
                  i === active ? "bg-muted" : ""
                }`}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`}
                  aria-hidden
                />
                <span className="shrink-0 text-xs font-medium text-muted-foreground">
                  {meta.verb}
                </span>
                <span className="truncate text-xs text-muted-foreground/80">
                  {m.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SourceComparison({ articleId }: { articleId: string }) {
  const { data, isLoading, isError } = useGetCmsHeldBackArticleSource(articleId);

  const sourceRef = useRef<HTMLDivElement>(null);
  const parsedRef = useRef<HTMLDivElement>(null);
  const markerElsRef = useRef<HTMLElement[]>([]);
  const [diff, setDiff] = useState<DiffViewState | null>(null);
  const [active, setActive] = useState(-1);

  const hasSource = Boolean(data?.sourceHtml && data.sourceHtml.trim().length);
  const hasParsed = Boolean(
    data &&
      ((Array.isArray(data.componentTree)
        ? data.componentTree.length > 0
        : Boolean(data.componentTree)) ||
        data.richText),
  );

  useEffect(() => {
    setActive(-1);
    markerElsRef.current = [];

    const sourceRoot = sourceRef.current;
    if (!data || !hasSource || !sourceRoot) {
      setDiff(null);
      return;
    }

    const sourceBlocks = leafBlockEls(sourceRoot);
    const sourceTexts = sourceBlocks.map((el) => el.textContent ?? "");

    const parsedRoot = hasParsed ? parsedRef.current : null;
    const parsedBlocks = parsedRoot ? leafBlockEls(parsedRoot) : [];
    const parsedTexts = parsedBlocks.map((el) => el.textContent ?? "");

    const { blocks, dropped, added, changed } = diffBlocks(
      sourceTexts,
      parsedTexts,
    );

    // Build the set of parsed image/link targets so we can flag source assets
    // the importer didn't carry over.
    const parsedImgSet = new Set<string>();
    const parsedLinkSet = new Set<string>();
    parsedRoot?.querySelectorAll<HTMLImageElement>("img[src]").forEach((img) => {
      const n = normalizeUrl(img.getAttribute("src") ?? "");
      if (n) parsedImgSet.add(n);
    });
    parsedRoot?.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
      const n = normalizeUrl(a.getAttribute("href") ?? "");
      if (n) parsedLinkSet.add(n);
    });

    const annotated: HTMLElement[] = [];

    for (const block of blocks) {
      if (block.sourceIndex === null) continue;
      const el = sourceBlocks[block.sourceIndex];
      if (!el) continue;
      if (block.kind === "removed") {
        el.classList.add(...REMOVED_CLS);
        annotated.push(el);
      } else if (block.kind === "changed") {
        el.classList.add(...CHANGED_CLS);
        annotated.push(el);
      }
    }

    let missingImages = 0;
    sourceRoot.querySelectorAll<HTMLImageElement>("img[src]").forEach((img) => {
      const n = normalizeUrl(img.getAttribute("src") ?? "");
      if (!n || parsedImgSet.has(n)) return;
      missingImages++;
      img.classList.add(...IMG_CLS);
      annotated.push(img);
    });

    let missingLinks = 0;
    sourceRoot.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
      const n = normalizeUrl(a.getAttribute("href") ?? "");
      if (!n || parsedLinkSet.has(n)) return;
      missingLinks++;
      a.classList.add(...LINK_CLS);
      annotated.push(a);
    });

    // Order every annotated element by its position in the source document so
    // Prev/Next walks the article top-to-bottom.
    annotated.sort((x, y) => {
      const pos = x.compareDocumentPosition(y);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    for (const el of annotated) {
      el.style.scrollMarginTop = "1rem";
    }
    markerElsRef.current = annotated;

    const markers: MarkerInfo[] = annotated.map((el) => {
      if (el.tagName === "IMG") {
        const img = el as HTMLImageElement;
        return {
          type: "image",
          label: truncate(
            img.getAttribute("alt") || img.getAttribute("src") || "",
          ),
        };
      }
      if (el.tagName === "A") {
        return {
          type: "link",
          label: truncate(
            el.textContent || el.getAttribute("href") || "",
          ),
        };
      }
      const isChanged = el.classList.contains("border-amber-500");
      return {
        type: isChanged ? "changed" : "removed",
        label: truncate(el.textContent ?? ""),
      };
    });

    setDiff({
      dropped,
      changed,
      added,
      missingImages,
      missingLinks,
      markers,
    });
    // `articleId` keys the request, so re-run whenever the loaded body changes.
  }, [data, hasSource, hasParsed, articleId]);

  function jumpTo(index: number) {
    const els = markerElsRef.current;
    if (els.length === 0) return;
    const i = ((index % els.length) + els.length) % els.length;
    for (const el of els) el.classList.remove(...ACTIVE_CLS);
    const el = els[i];
    el.classList.add(...ACTIVE_CLS);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setActive(i);
  }

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className="text-sm text-muted-foreground">
        Couldn't load the source preview for this article.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <DiffControls
        state={hasSource ? diff : null}
        active={active}
        onPrev={() => jumpTo(active < 0 ? -1 : active - 1)}
        onNext={() => jumpTo(active + 1)}
        onJump={jumpTo}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium">
              Original article
              <span className="ml-2 font-normal text-muted-foreground">
                differences highlighted
              </span>
            </h4>
            {data.sourceKind === "original" ? (
              <Badge variant="outline" className="text-[10px] uppercase">
                Raw HTML
              </Badge>
            ) : null}
          </div>
          <div
            ref={sourceRef}
            className="h-[60vh] overflow-y-auto rounded-md border border-border/60 bg-muted/20 p-4"
          >
            {hasSource ? (
              <ContentRenderer post={{ contentHtml: data.sourceHtml }} />
            ) : (
              <p className="text-sm italic text-muted-foreground">
                No source HTML was stored for this article.
              </p>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <h4 className="text-sm font-medium">What the importer extracted</h4>
          <div
            ref={parsedRef}
            className="h-[60vh] overflow-y-auto rounded-md border border-border/60 p-4"
          >
            {hasParsed ? (
              <ContentRenderer
                post={{
                  componentTree: data.componentTree,
                  richText: data.richText,
                }}
              />
            ) : (
              <p className="text-sm italic text-muted-foreground">
                The importer extracted no structured content — everything on the
                left was dropped.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ArticleDrawer({
  article,
  open,
  onOpenChange,
}: {
  article: HeldBackArticle | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const { can } = useCmsAuth();
  const queryClient = useQueryClient();
  const canResolve = can("review.approve");

  const resolve = useResolveCmsHeldBackArticle({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({
          queryKey: getListCmsHeldBackArticlesQueryKey(),
        });
        toast({
          title:
            data.status === "published"
              ? "Article published"
              : "Article dismissed",
        });
        onOpenChange(false);
      },
      onError: () => {
        toast({
          title: "Could not update article",
          description:
            "You may not have permission, or something went wrong.",
          variant: "destructive",
        });
      },
    },
  });

  const issues = article?.issues ?? [];
  const pending = resolve.isPending;

  const [reextractStage, setReextractStage] = useState<ReextractStage | null>(
    null,
  );
  const [reextractError, setReextractError] = useState<string | null>(null);
  const [reextractResult, setReextractResult] =
    useState<ReextractResultEvent | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const reextracting = reextractStage !== null;

  // Reset transient re-extract state whenever a different article is shown.
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setReextractStage(null);
    setReextractError(null);
    setReextractResult(null);
    setElapsedMs(0);
  }, [article?.id]);

  // Abort any in-flight stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Tick an elapsed timer while a re-extract runs.
  useEffect(() => {
    if (!reextracting) return;
    const startedAt = Date.now();
    setElapsedMs(0);
    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 250);
    return () => window.clearInterval(interval);
  }, [reextracting]);

  async function handleReextract() {
    if (!article || reextracting) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setReextractError(null);
    setReextractResult(null);
    setReextractStage("loading");

    try {
      await streamReextract(
        article.id,
        (event) => {
          if (event.type === "progress") {
            setReextractStage(event.stage);
          } else if (event.type === "result") {
            setReextractResult(event);
          } else if (event.type === "error") {
            setReextractError(event.message);
          }
        },
        controller.signal,
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        setReextractError(
          err instanceof Error ? err.message : "Re-extract failed.",
        );
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setReextractStage(null);
    }

    if (controller.signal.aborted) return;

    setReextractResult((current) => {
      if (current) {
        queryClient.invalidateQueries({
          queryKey: getListCmsHeldBackArticlesQueryKey(),
        });
        toast({
          title: current.heldBack
            ? "Re-extracted — still held back"
            : "Re-extracted — article cleared the queue",
          description: current.heldBack
            ? `Validation: ${current.validationStatus} (${current.validationScore}).`
            : "It passed validation and was published.",
        });
      }
      return current;
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl lg:max-w-3xl xl:max-w-5xl">
        {article ? (
          <>
            <SheetHeader>
              <SheetTitle className="font-serif text-2xl leading-tight">
                {article.title ?? "Untitled"}
              </SheetTitle>
              <SheetDescription>
                {article.url ? (
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-foreground hover:underline"
                  >
                    {article.url}
                  </a>
                ) : (
                  article.slug
                )}
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-2">
              <div className="flex items-center gap-3">
                {statusBadge(article.validationStatus)}
                <span className="text-sm text-muted-foreground">
                  Score:{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {article.validationScore ?? "—"}
                  </span>
                </span>
              </div>

              <Separator />

              <div className="space-y-1">
                <h3 className="font-medium">Content-fidelity checks</h3>
                <p className="text-sm text-muted-foreground">
                  Source counts come from the original article; parsed counts
                  come from what the importer extracted.
                </p>
              </div>

              {issues.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No validation checks recorded for this article.
                </p>
              ) : (
                <div className="space-y-2">
                  {issues.map((issue, i) => (
                    <IssueRow key={`${issue.field}-${i}`} issue={issue} />
                  ))}
                </div>
              )}

              <Separator />

              <div className="space-y-1">
                <h3 className="font-medium">Source vs. parsed content</h3>
                <p className="text-sm text-muted-foreground">
                  The original article on the left, and what the importer
                  extracted on the right. Anything visible on the left but
                  missing or garbled on the right is what would be lost if this
                  is published as-is.
                </p>
              </div>

              <SourceComparison articleId={article.id} />
            </div>

            <SheetFooter className="flex-col gap-2 sm:flex-col">
              {canResolve ? (
                <>
                  <ReextractPanel
                    stage={reextractStage}
                    elapsedMs={elapsedMs}
                    error={reextractError}
                    result={reextractResult}
                    onReextract={handleReextract}
                    disabled={pending}
                  />
                  <Button
                    disabled={pending || reextracting}
                    onClick={() =>
                      resolve.mutate({
                        id: article.id,
                        data: { action: "publish" },
                      })
                    }
                  >
                    Publish anyway
                  </Button>
                  <Button
                    variant="outline"
                    disabled={pending || reextracting}
                    onClick={() =>
                      resolve.mutate({
                        id: article.id,
                        data: { action: "dismiss" },
                      })
                    }
                  >
                    Dismiss from queue
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Publishing releases the article to the public site despite
                    the failing checks. Dismissing archives it without
                    publishing.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  You don't have permission to act on this article.
                </p>
              )}
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

const REEXTRACT_STAGES: { key: ReextractStage; label: string }[] = [
  { key: "loading", label: "Loading article" },
  { key: "fetching", label: "Fetching source" },
  { key: "parsing", label: "Parsing content" },
  { key: "validating", label: "Validating" },
  { key: "storing", label: "Saving" },
];

function formatElapsed(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function ReextractPanel({
  stage,
  elapsedMs,
  error,
  result,
  onReextract,
  disabled,
}: {
  stage: ReextractStage | null;
  elapsedMs: number;
  error: string | null;
  result: ReextractResultEvent | null;
  onReextract: () => void;
  disabled: boolean;
}) {
  const running = stage !== null;
  const activeIndex = stage
    ? REEXTRACT_STAGES.findIndex((s) => s.key === stage)
    : -1;

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">Re-extract from source</div>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || running}
          onClick={onReextract}
        >
          {running ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Re-extracting…
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5" /> Re-extract
            </>
          )}
        </Button>
      </div>

      {running ? (
        <div className="mt-3 space-y-2">
          <ol className="space-y-1.5">
            {REEXTRACT_STAGES.map((s, i) => {
              const state =
                i < activeIndex
                  ? "done"
                  : i === activeIndex
                    ? "active"
                    : "pending";
              return (
                <li
                  key={s.key}
                  className="flex items-center gap-2 text-sm"
                  aria-current={state === "active" ? "step" : undefined}
                >
                  <span className="flex h-4 w-4 items-center justify-center">
                    {state === "active" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground" />
                    ) : state === "done" ? (
                      <span className="text-foreground">✓</span>
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                    )}
                  </span>
                  <span
                    className={
                      state === "pending"
                        ? "text-muted-foreground"
                        : "text-foreground"
                    }
                  >
                    {s.label}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="text-xs tabular-nums text-muted-foreground">
            Elapsed {formatElapsed(elapsedMs)} · times out at 90s
          </p>
        </div>
      ) : error ? (
        <p className="mt-2 text-sm text-destructive">{error}</p>
      ) : result ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {result.heldBack
            ? `Re-extracted — still held back (validation: ${result.validationStatus}, score ${result.validationScore}).`
            : "Re-extracted successfully — it passed validation and left the queue."}
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Re-fetches the original URL and re-runs extraction. If it now passes
          validation it leaves the queue automatically.
        </p>
      )}
    </div>
  );
}

export default function HeldBackPage() {
  const { data, isLoading, isError } = useListCmsHeldBackArticles();
  const articles = data?.articles ?? [];
  const [selected, setSelected] = useState<HeldBackArticle | null>(null);
  const [open, setOpen] = useState(false);

  function openArticle(article: HeldBackArticle) {
    setSelected(article);
    setOpen(true);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-2">
        <h1 className="font-serif text-4xl tracking-tight">Review queue</h1>
        <p className="text-muted-foreground">
          Articles held back from the public site because content-fidelity
          validation failed. Each verdict is re-scored live, so the reason shown
          always reflects the current rules. Open an article to review the
          source vs. parsed counts and publish or dismiss it.
        </p>
      </div>

      <div className="rounded-lg border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Article</TableHead>
              <TableHead className="w-32">Status</TableHead>
              <TableHead className="w-20 text-right">Score</TableHead>
              <TableHead>Why it's held back</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-8 w-64" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="ml-auto h-4 w-10" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-48" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="ml-auto h-8 w-16" />
                  </TableCell>
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  Failed to load the review queue.
                </TableCell>
              </TableRow>
            ) : articles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No articles are held back. Everything passed validation.
                </TableCell>
              </TableRow>
            ) : (
              articles.map((article) => (
                <TableRow key={article.id} className="align-top">
                  <TableCell>
                    <div className="min-w-0">
                      <div className="font-medium">
                        {article.title ?? "Untitled"}
                      </div>
                      {article.url ? (
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
                        >
                          {article.url}
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {article.slug}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{statusBadge(article.validationStatus)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                    {article.validationScore ?? "—"}
                  </TableCell>
                  <TableCell>
                    <FailIssues issues={article.issues} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openArticle(article)}
                    >
                      Review
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {!isLoading && !isError && articles.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {articles.length} {articles.length === 1 ? "article" : "articles"} held
          back.
        </p>
      ) : null}

      <ArticleDrawer article={selected} open={open} onOpenChange={setOpen} />
    </div>
  );
}
