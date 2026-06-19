import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, GitCompare, RotateCcw } from "lucide-react";
import {
  useGetCmsPost,
  useListCmsPostVersions,
  useCompareCmsPostVersions,
  useRestoreCmsPostVersion,
  getListCmsPostVersionsQueryKey,
  getGetCmsPostQueryKey,
  getCompareCmsPostVersionsQueryKey,
  type PageVersionSummary,
  type VersionFieldChange,
  type PageStatus,
} from "@workspace/api-client-react";
import { Badge } from "@workspace/ui/badge";
import { Button } from "@workspace/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/alert-dialog";
import { Skeleton } from "@workspace/ui/skeleton";
import { useToast } from "@workspace/ui";
import { ContentRenderer } from "@workspace/blog-renderer";
import { useCmsAuth } from "@/lib/cms-auth-context";
import { diffWords, diffHtml } from "@/lib/word-diff";

const STATUS_VARIANTS: Record<PageStatus, "default" | "secondary" | "outline"> =
  {
    published: "default",
    draft: "secondary",
    review: "secondary",
    scheduled: "secondary",
    archived: "outline",
  };

function statusLabel(status: PageStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.length ? value : "—";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function isTextValue(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || typeof value === "string";
}

function DiffLegend() {
  return (
    <div className="flex items-center gap-3 text-[10px] uppercase tracking-wide text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-sm bg-emerald-500/40" />
        Added
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-sm bg-rose-500/40" />
        Removed
      </span>
    </div>
  );
}

function InlineWordDiff({
  before,
  after,
}: {
  before: string;
  after: string;
}) {
  const segments = useMemo(() => diffWords(before, after), [before, after]);
  return (
    <div className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-border/60 bg-muted/30 px-2 py-1.5 text-xs leading-relaxed text-foreground">
      {segments.map((seg, i) => {
        if (seg.op === "insert") {
          return (
            <ins
              key={i}
              className="rounded-sm bg-emerald-500/15 text-emerald-700 no-underline dark:text-emerald-300"
            >
              {seg.text}
            </ins>
          );
        }
        if (seg.op === "delete") {
          return (
            <del
              key={i}
              className="rounded-sm bg-rose-500/15 text-rose-700 line-through dark:text-rose-300"
            >
              {seg.text}
            </del>
          );
        }
        return <span key={i}>{seg.text}</span>;
      })}
    </div>
  );
}

function RenderedHtmlDiff({
  before,
  after,
}: {
  before: string;
  after: string;
}) {
  const diffed = useMemo(() => diffHtml(before, after), [before, after]);
  return (
    <div
      className={
        "max-h-[32rem] overflow-auto rounded border border-border/60 bg-background px-3 py-2 " +
        "[&_ins.diff-ins]:rounded-sm [&_ins.diff-ins]:bg-emerald-500/15 [&_ins.diff-ins]:text-emerald-700 [&_ins.diff-ins]:no-underline dark:[&_ins.diff-ins]:text-emerald-300 " +
        "[&_del.diff-del]:rounded-sm [&_del.diff-del]:bg-rose-500/15 [&_del.diff-del]:text-rose-700 [&_del.diff-del]:line-through dark:[&_del.diff-del]:text-rose-300"
      }
    >
      <ContentRenderer post={{ contentHtml: diffed }} />
    </div>
  );
}

function ValueSwap({ change }: { change: VersionFieldChange }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="space-y-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Before
        </div>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-destructive/5 px-2 py-1 text-xs text-foreground">
          {formatFieldValue(change.before)}
        </pre>
      </div>
      <div className="space-y-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          After
        </div>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-primary/5 px-2 py-1 text-xs text-foreground">
          {formatFieldValue(change.after)}
        </pre>
      </div>
    </div>
  );
}

type BodyDiffMode = "source" | "rendered";

function ChangeRow({ change }: { change: VersionFieldChange }) {
  // Inline word diffs read far better for text fields (article body, excerpt,
  // subtitle, SEO copy, etc.). Non-text fields (numbers, arrays, objects) fall
  // back to the side-by-side value swap.
  const useInlineDiff =
    (typeof change.before === "string" || typeof change.after === "string") &&
    isTextValue(change.before) &&
    isTextValue(change.after);

  // The article body is stored as HTML. Offer a "rendered" view so reviewers can
  // compare how the article actually looks, not its raw markup.
  const isHtmlBody = change.field === "contentHtml" && useInlineDiff;
  const [mode, setMode] = useState<BodyDiffMode>("rendered");

  const before = (change.before as string | null | undefined) ?? "";
  const after = (change.after as string | null | undefined) ?? "";

  return (
    <div className="space-y-1.5 rounded-md border border-border/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">{change.label}</div>
        <div className="flex flex-wrap items-center gap-3">
          {useInlineDiff ? <DiffLegend /> : null}
          {isHtmlBody ? (
            <div className="inline-flex overflow-hidden rounded-md border border-border/60 text-xs">
              <button
                type="button"
                onClick={() => setMode("rendered")}
                aria-pressed={mode === "rendered"}
                className={
                  mode === "rendered"
                    ? "bg-primary px-2.5 py-1 font-medium text-primary-foreground"
                    : "bg-transparent px-2.5 py-1 text-muted-foreground hover:text-foreground"
                }
              >
                Rendered
              </button>
              <button
                type="button"
                onClick={() => setMode("source")}
                aria-pressed={mode === "source"}
                className={
                  mode === "source"
                    ? "bg-primary px-2.5 py-1 font-medium text-primary-foreground"
                    : "bg-transparent px-2.5 py-1 text-muted-foreground hover:text-foreground"
                }
              >
                Source
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {isHtmlBody && mode === "rendered" ? (
        <RenderedHtmlDiff before={before} after={after} />
      ) : useInlineDiff ? (
        <InlineWordDiff before={before} after={after} />
      ) : (
        <ValueSwap change={change} />
      )}
    </div>
  );
}

export default function ContentHistoryPage({ id }: { id: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { can } = useCmsAuth();
  const canRestore = can("content.edit");

  const post = useGetCmsPost(id);
  const versionsQuery = useListCmsPostVersions(id);

  const [fromVersion, setFromVersion] = useState<number | null>(null);
  const [toVersion, setToVersion] = useState<number | null>(null);
  const [restoreTarget, setRestoreTarget] =
    useState<PageVersionSummary | null>(null);

  const versions = useMemo(
    () => versionsQuery.data?.items ?? [],
    [versionsQuery.data],
  );
  const latestVersion = versionsQuery.data?.latestVersion ?? null;

  const compareReady = fromVersion !== null && toVersion !== null;
  const compareFrom = compareReady ? fromVersion : 0;
  const compareTo = compareReady ? toVersion : 0;
  const compare = useCompareCmsPostVersions(id, compareFrom, compareTo, {
    query: {
      queryKey: getCompareCmsPostVersionsQueryKey(id, compareFrom, compareTo),
      enabled: compareReady,
    },
  });

  const restore = useRestoreCmsPostVersion({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListCmsPostVersionsQueryKey(id),
        });
        queryClient.invalidateQueries({
          queryKey: getGetCmsPostQueryKey(id),
        });
        toast({
          title: "Version restored",
          description: restoreTarget
            ? `Restored from version ${restoreTarget.versionNumber}. A new version was created.`
            : undefined,
        });
        setRestoreTarget(null);
      },
      onError: () => {
        toast({
          title: "Could not restore version",
          description: "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const title = post.data?.title ?? "Article";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-3">
        <Link
          href="/content"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to content
        </Link>
        <div className="space-y-1">
          <h1 className="font-serif text-4xl tracking-tight">{title}</h1>
          <p className="text-muted-foreground">Version history</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <GitCompare className="h-5 w-5" />
            Compare versions
          </CardTitle>
          <CardDescription>
            Pick two versions to see what changed between them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={fromVersion !== null ? String(fromVersion) : undefined}
              onValueChange={(v) => setFromVersion(Number(v))}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="From version" />
              </SelectTrigger>
              <SelectContent>
                {versions.map((v) => (
                  <SelectItem
                    key={v.versionNumber}
                    value={String(v.versionNumber)}
                  >
                    Version {v.versionNumber}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground">→</span>
            <Select
              value={toVersion !== null ? String(toVersion) : undefined}
              onValueChange={(v) => setToVersion(Number(v))}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="To version" />
              </SelectTrigger>
              <SelectContent>
                {versions.map((v) => (
                  <SelectItem
                    key={v.versionNumber}
                    value={String(v.versionNumber)}
                  >
                    Version {v.versionNumber}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!compareReady ? (
            <p className="text-sm text-muted-foreground">
              Select both versions to view the diff.
            </p>
          ) : compare.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : compare.isError ? (
            <p className="text-sm text-muted-foreground">
              Failed to compare these versions.
            </p>
          ) : compare.data && compare.data.changes.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {compare.data.changes.length}{" "}
                {compare.data.changes.length === 1 ? "field" : "fields"} changed
                between version {compare.data.fromVersion} and version{" "}
                {compare.data.toVersion}.
              </p>
              {compare.data.changes.map((change) => (
                <ChangeRow key={change.field} change={change} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No differences between these versions.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="font-serif text-2xl tracking-tight">All versions</h2>
        {versionsQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : versionsQuery.isError ? (
          <p className="text-muted-foreground">
            Failed to load version history.
          </p>
        ) : versions.length === 0 ? (
          <p className="text-muted-foreground">
            No versions recorded for this article yet.
          </p>
        ) : (
          <div className="space-y-2">
            {versions.map((version) => {
              const isLatest = version.versionNumber === latestVersion;
              return (
                <div
                  key={version.versionNumber}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/60 p-4"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        Version {version.versionNumber}
                      </span>
                      {isLatest ? (
                        <Badge variant="default" className="font-normal">
                          Current
                        </Badge>
                      ) : null}
                      <Badge
                        variant={STATUS_VARIANTS[version.status]}
                        className="font-normal"
                      >
                        {statusLabel(version.status)}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {version.changeSummary ?? "No change summary"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {version.author?.name ? `${version.author.name} · ` : ""}
                      {format(
                        new Date(version.createdAt),
                        "MMM d, yyyy 'at' h:mm a",
                      )}
                    </div>
                  </div>
                  {canRestore && !isLatest ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRestoreTarget(version)}
                    >
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      Restore
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AlertDialog
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Restore version {restoreTarget?.versionNumber}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This creates a new version with the content from version{" "}
              {restoreTarget?.versionNumber}. Your existing history is preserved
              — nothing is overwritten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restore.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={restore.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (!restoreTarget) return;
                restore.mutate({
                  id,
                  versionNumber: restoreTarget.versionNumber,
                });
              }}
            >
              {restore.isPending ? "Restoring…" : "Restore"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
