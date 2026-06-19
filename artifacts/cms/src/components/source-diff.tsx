import { useLayoutEffect, useRef, useState } from "react";
import { ContentRenderer } from "@workspace/blog-renderer";
import { Badge } from "@workspace/ui/badge";
import { Button } from "@workspace/ui/button";
import { Skeleton } from "@workspace/ui/skeleton";
import { diffBlocks, normalizeUrl } from "@workspace/content-diff";

/* ------------------------------------------------------------------ */
/* Source-vs-parsed visual diff                                        */
/*                                                                     */
/* The faithful source article body is rendered on the left with every */
/* dropped/changed paragraph, missing image, and dropped link visually */
/* annotated; the parsed (imported) body is rendered on the right. The */
/* block/word/URL diff math lives in the pure `content-diff.ts`        */
/* helpers — this component only does the DOM extraction + annotation. */
/*                                                                     */
/* Both the held-back review queue and the editor reuse this component */
/* by passing in the result of a source endpoint (held-back or the     */
/* general per-post source), so the diff can't drift between surfaces. */
/* ------------------------------------------------------------------ */

/**
 * The structural shape the diff needs from a source endpoint. Both
 * `GetCmsHeldBackArticleSourceResponse` and `GetCmsPostSourceResponse` satisfy
 * it, so the component is agnostic to which one loaded the data.
 */
export interface SourceDiffData {
  sourceHtml: string | null;
  sourceKind: "cleaned" | "original" | null;
  componentTree: unknown;
  richText: unknown;
}

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

const MARKER_META: Record<MarkerType, { dot: string; verb: string }> = {
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

/**
 * Side-by-side source-vs-parsed importer diff for one article. Pass the result
 * of a source endpoint (`useGetCmsHeldBackArticleSource` or
 * `useGetCmsPostSource`) — the component renders both bodies, annotates the
 * differences, and provides count chips + Prev/Next navigation. The `key`-able
 * `data` reference re-runs the diff whenever a new article loads.
 */
/**
 * A re-findable description of one annotated source element. Highlights are NOT
 * stored as live element references — those go stale (and their out-of-band
 * classes get wiped) whenever React re-commits the `dangerouslySetInnerHTML`
 * source pane. Instead each marker records how to re-locate its element by
 * stable document-order index, so the highlight can be re-applied after every
 * render. See `.agents/memory/annotate-rendered-dom-react.md`.
 */
type Annotation =
  | { kind: "removed" | "changed"; classes: string[]; blockIndex: number }
  | { kind: "image" | "link"; classes: string[]; mediaIndex: number };

/** Re-locate an annotation's live element from a freshly-queried DOM snapshot. */
function resolveAnnotation(
  ann: Annotation,
  blocks: HTMLElement[],
  imgs: HTMLImageElement[],
  links: HTMLAnchorElement[],
): HTMLElement | undefined {
  switch (ann.kind) {
    case "removed":
    case "changed":
      return blocks[ann.blockIndex];
    case "image":
      return imgs[ann.mediaIndex];
    case "link":
      return links[ann.mediaIndex];
  }
}

export function SourceDiff({
  data,
  isLoading,
  isError,
}: {
  data: SourceDiffData | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  const sourceRef = useRef<HTMLDivElement>(null);
  const parsedRef = useRef<HTMLDivElement>(null);
  const planRef = useRef<Annotation[]>([]);
  const scrollPendingRef = useRef(false);
  const [diff, setDiff] = useState<DiffViewState | null>(null);
  const [active, setActive] = useState(-1);

  /**
   * Apply (or re-apply) every highlight + the active ring to the live source
   * DOM. Re-queries the DOM each call so it is resilient to React resetting the
   * `dangerouslySetInnerHTML` subtree — running it from a layout effect means
   * the classes are restored before the browser paints, so the user never sees
   * a flicker even if a re-render momentarily wipes them.
   */
  function applyHighlights(activeIdx: number, scroll: boolean) {
    const root = sourceRef.current;
    if (!root) return;
    const plan = planRef.current;
    if (plan.length === 0) return;
    const blocks = leafBlockEls(root);
    const imgs = Array.from(
      root.querySelectorAll<HTMLImageElement>("img[src]"),
    );
    const links = Array.from(
      root.querySelectorAll<HTMLAnchorElement>("a[href]"),
    );
    plan.forEach((ann, i) => {
      const el = resolveAnnotation(ann, blocks, imgs, links);
      if (!el) return;
      el.classList.add(...ann.classes);
      el.style.scrollMarginTop = "1rem";
      if (i === activeIdx) {
        el.classList.add(...ACTIVE_CLS);
        if (scroll) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      } else {
        el.classList.remove(...ACTIVE_CLS);
      }
    });
  }

  const hasSource = Boolean(data?.sourceHtml && data.sourceHtml.trim().length);
  const hasParsed = Boolean(
    data &&
      ((Array.isArray(data.componentTree)
        ? data.componentTree.length > 0
        : Boolean(data.componentTree)) ||
        data.richText),
  );

  // Compute the diff and build the re-findable annotation plan whenever a new
  // article loads. This runs in a layout effect (before paint) and only does
  // DOM *reads* + state writes — the actual class application is delegated to
  // `applyHighlights`, which the apply effect below re-runs after every render
  // so the highlights survive React re-committing the source pane.
  useLayoutEffect(() => {
    setActive(-1);
    scrollPendingRef.current = false;
    planRef.current = [];

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

    // Collect each annotated source element alongside a re-findable descriptor
    // (its index within the relevant document-order node list) and a marker
    // label. We keep the live element only to order markers top-to-bottom; the
    // persisted plan references elements by index, not identity.
    interface Pending {
      el: HTMLElement;
      ann: Annotation;
      marker: MarkerInfo;
    }
    const pending: Pending[] = [];

    for (const block of blocks) {
      if (block.sourceIndex === null) continue;
      const el = sourceBlocks[block.sourceIndex];
      if (!el) continue;
      if (block.kind === "removed") {
        pending.push({
          el,
          ann: {
            kind: "removed",
            classes: REMOVED_CLS,
            blockIndex: block.sourceIndex,
          },
          marker: { type: "removed", label: truncate(el.textContent ?? "") },
        });
      } else if (block.kind === "changed") {
        pending.push({
          el,
          ann: {
            kind: "changed",
            classes: CHANGED_CLS,
            blockIndex: block.sourceIndex,
          },
          marker: { type: "changed", label: truncate(el.textContent ?? "") },
        });
      }
    }

    let missingImages = 0;
    Array.from(
      sourceRoot.querySelectorAll<HTMLImageElement>("img[src]"),
    ).forEach((img, mediaIndex) => {
      const n = normalizeUrl(img.getAttribute("src") ?? "");
      if (!n || parsedImgSet.has(n)) return;
      missingImages++;
      pending.push({
        el: img,
        ann: { kind: "image", classes: IMG_CLS, mediaIndex },
        marker: {
          type: "image",
          label: truncate(
            img.getAttribute("alt") || img.getAttribute("src") || "",
          ),
        },
      });
    });

    let missingLinks = 0;
    Array.from(
      sourceRoot.querySelectorAll<HTMLAnchorElement>("a[href]"),
    ).forEach((a, mediaIndex) => {
      const n = normalizeUrl(a.getAttribute("href") ?? "");
      if (!n || parsedLinkSet.has(n)) return;
      missingLinks++;
      pending.push({
        el: a,
        ann: { kind: "link", classes: LINK_CLS, mediaIndex },
        marker: {
          type: "link",
          label: truncate(a.textContent || a.getAttribute("href") || ""),
        },
      });
    });

    // Order every annotated element by its position in the source document so
    // Prev/Next walks the article top-to-bottom.
    pending.sort((x, y) => {
      const pos = x.el.compareDocumentPosition(y.el);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    planRef.current = pending.map((p) => p.ann);

    setDiff({
      dropped,
      changed,
      added,
      missingImages,
      missingLinks,
      markers: pending.map((p) => p.marker),
    });

    // Paint the highlights immediately for this freshly-loaded article (active
    // ring is reset above, so pass -1 / no scroll).
    applyHighlights(-1, false);
    // `data` is a stable react-query reference per article, so re-run whenever
    // the loaded body changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, hasSource, hasParsed]);

  // Re-apply highlights (and the active ring) after every commit that changes
  // the diff or the selected difference. Because React can reset the
  // `dangerouslySetInnerHTML` source subtree on re-render — wiping our
  // out-of-band classes — restoring them here (in a layout effect, pre-paint)
  // is what makes the highlighting actually persist on screen.
  useLayoutEffect(() => {
    applyHighlights(active, scrollPendingRef.current);
    scrollPendingRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diff, active]);

  function jumpTo(index: number) {
    const plan = planRef.current;
    if (plan.length === 0) return;
    const i = ((index % plan.length) + plan.length) % plan.length;
    // Defer the class/ring/scroll work to the apply layout effect so it lands
    // after the resulting re-render (and survives any innerHTML reset).
    scrollPendingRef.current = true;
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
