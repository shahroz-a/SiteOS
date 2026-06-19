import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import {
  useListCmsHeldBackArticles,
  useResolveCmsHeldBackArticle,
  useApproveCmsHeldBackArticle,
  approveCmsHeldBackArticle,
  useReparseCmsHeldBackArticle,
  useGetCmsHeldBackArticleSource,
  useListCmsAuditLogs,
  getGetCmsHeldBackArticleSourceQueryKey,
  getListCmsHeldBackArticlesQueryKey,
  getListCmsAuditLogsQueryKey,
  type HeldBackArticle,
  type HeldBackValidationIssue,
  type ReparseHeldBackArticleResponse,
  type ListCmsHeldBackArticlesIssue,
  type AuditLogEntry,
} from "@workspace/api-client-react";
import { ContentRenderer } from "@workspace/blog-renderer";
import {
  streamReextract,
  type ReextractStage,
  type ReextractResultEvent,
} from "@/lib/reextract-client";
import { Badge } from "@workspace/ui/badge";
import { Checkbox } from "@workspace/ui/checkbox";
import { Input } from "@workspace/ui/input";
import { Button } from "@workspace/ui/button";
import { Textarea } from "@workspace/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/select";
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
import { SourceDiff } from "@/components/source-diff";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

const PAGE_SIZE = 25;

const ALL_ISSUES = "all";

// Failure types the live validator can hold an article back on (fail-severity
// issue fields). Mirrors the `issue` enum in the OpenAPI spec.
const ISSUE_OPTIONS: { value: ListCmsHeldBackArticlesIssue; label: string }[] = [
  { value: "title", label: "Missing title" },
  { value: "components", label: "Empty component tree" },
];

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


export function reparseVerdictToast(
  result: ReparseHeldBackArticleResponse,
): { title: string; description: string } {
  const action = result.mode === "edit" ? "Edited body re-checked" : "Re-parsed";
  if (result.validationStatus === "fail") {
    return {
      title: action,
      description: `Still failing content-fidelity checks (score ${result.validationScore}). Review the parsed result and edit again if needed.`,
    };
  }
  return {
    title: action,
    description: `Now ${
      result.validationStatus === "pass" ? "passing" : "warning-only"
    } (score ${result.validationScore}). It can be published.`,
  };
}

// Lets an editor fix a garbled import in place: re-run the parser on the stored
// source, or hand-edit the body HTML and re-parse that. Both persist to the
// page's componentTree/richText and write a fresh content-fidelity report, so
// the parsed preview and the verdict reflect the correction immediately.
function ReparsePanel({ article }: { article: HeldBackArticle }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: source } = useGetCmsHeldBackArticleSource(article.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const reparse = useReparseCmsHeldBackArticle({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({
          queryKey: getListCmsHeldBackArticlesQueryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: getGetCmsHeldBackArticleSourceQueryKey(article.id),
        });
        setEditing(false);
        toast(reparseVerdictToast(result));
      },
      onError: () => {
        toast({
          title: "Could not re-parse",
          description:
            "The body could not be parsed, or something went wrong. Check the HTML and try again.",
          variant: "destructive",
        });
      },
    },
  });

  const pending = reparse.isPending;
  const sourceHtml = source?.sourceHtml ?? "";

  function startEditing() {
    setDraft(sourceHtml);
    setEditing(true);
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="font-medium">Fix the import</h3>
        <p className="text-sm text-muted-foreground">
          Re-run the parser on the stored source, or hand-edit the article HTML
          and re-parse it. The fix is saved to the article and the checks above
          re-run against the corrected body.
        </p>
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="h-64 font-mono text-xs"
            placeholder="Edit the article body HTML…"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending || draft.trim().length === 0}
              onClick={() =>
                reparse.mutate({ id: article.id, data: { html: draft } })
              }
            >
              Save &amp; re-check
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => reparse.mutate({ id: article.id, data: {} })}
          >
            Re-parse stored source
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pending || sourceHtml.trim().length === 0}
            onClick={startEditing}
          >
            Edit body HTML
          </Button>
        </div>
      )}
    </div>
  );
}

// Human-readable labels for the page-scoped audit actions that show up in a
// held-back article's decision trail.
const AUDIT_ACTION_LABELS: Record<string, string> = {
  "article.publish": "Published",
  "article.dismiss": "Dismissed",
  "article.approve": "Approved",
  "article.reextract": "Re-extracted",
  "article.reparse": "Re-parsed",
  "article.edit": "Edited body",
};

function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

function formatAuditTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function auditActor(entry: AuditLogEntry): string {
  const who = entry.actorEmail ?? entry.actorId ?? "Unknown user";
  return entry.actorRole ? `${who} (${entry.actorRole})` : who;
}

// Read-only trail of approve/dismiss/publish/reparse/edit decisions already
// recorded for this page, newest first. Reuses the shared audit-log read path
// filtered by entityType=page + entityId. Only rendered for users who can view
// the audit log (the endpoint is gated on audit.view), so reviewers without
// that permission never trigger a 403.
function DecisionHistory({ articleId }: { articleId: string }) {
  const params = {
    entityType: "page",
    entityId: articleId,
    limit: 20,
  } as const;

  const { data, isLoading, isError } = useListCmsAuditLogs(params, {
    query: {
      enabled: Boolean(articleId),
      queryKey: getListCmsAuditLogsQueryKey(params),
    },
  });

  const entries = data?.items ?? [];

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="font-medium">Decision history</h3>
        <p className="text-sm text-muted-foreground">
          Who approved, dismissed, published, or re-checked this article, newest
          first.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : isError ? (
        <p className="text-sm text-muted-foreground">
          Could not load the decision history.
        </p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No decisions recorded for this article yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="rounded-md border border-border/60 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {auditActionLabel(entry.action)}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatAuditTimestamp(entry.createdAt)}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {auditActor(entry)}
              </p>
            </li>
          ))}
        </ul>
      )}
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
  const canViewHistory = can("audit.view");

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

  const source = useGetCmsHeldBackArticleSource(article?.id ?? "", {
    query: {
      enabled: Boolean(article?.id),
      queryKey: getGetCmsHeldBackArticleSourceQueryKey(article?.id ?? ""),
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
        const changedNote = current.changed
          ? "Content changed."
          : "Content unchanged.";
        toast({
          title: current.heldBack
            ? "Re-extracted — still held back"
            : "Re-extracted — article cleared the queue",
          description: current.heldBack
            ? `Validation: ${current.validationStatus} (${current.validationScore}). ${changedNote}`
            : `It passed validation and was published. ${changedNote}`,
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

              {canViewHistory ? (
                <>
                  <Separator />
                  <DecisionHistory articleId={article.id} />
                </>
              ) : null}

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

              <SourceDiff
                data={source.data}
                isLoading={source.isLoading}
                isError={source.isError}
              />

              {canResolve ? (
                <>
                  <Separator />
                  <ReparsePanel article={article} />
                </>
              ) : null}
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

export function ReextractPanel({
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
            : "Re-extracted successfully — it passed validation and left the queue."}{" "}
          {result.changed
            ? "The extracted content changed."
            : "The extracted content is unchanged."}
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
  const { toast } = useToast();
  const { can } = useCmsAuth();
  const queryClient = useQueryClient();
  const canApprove = can("review.approve");
  const [search, setSearch] = useState("");
  const [issue, setIssue] = useState<ListCmsHeldBackArticlesIssue | typeof ALL_ISSUES>(
    ALL_ISSUES,
  );
  const [page, setPage] = useState(1);

  const q = useDebouncedValue(search, 300);

  // Per-row "Approve" action. The endpoint re-validates server-side and only
  // publishes when the article now passes; if it still fails it stays a draft
  // and reports why. On a successful approval the list refetches so the row
  // drops off the queue.
  const approve = useApproveCmsHeldBackArticle({
    mutation: {
      onSuccess: (result) => {
        if (result.approved) {
          queryClient.invalidateQueries({
            queryKey: getListCmsHeldBackArticlesQueryKey(),
          });
          toast({ title: "Article approved", description: "It passed validation and was published." });
        } else {
          toast({
            title: "Not approved yet",
            description:
              result.validationStatus === null
                ? "There's no validation data to confirm a pass. Open it to re-extract first."
                : "It still fails content-fidelity checks. Open it to review and fix the import.",
            variant: "destructive",
          });
        }
      },
      onError: () => {
        toast({
          title: "Could not approve article",
          description: "You may not have permission, or something went wrong.",
          variant: "destructive",
        });
      },
    },
  });

  // Reset to the first page whenever the filters change.
  useEffect(() => {
    setPage(1);
  }, [q, issue]);

  const { data, isLoading, isError, isFetching } = useListCmsHeldBackArticles({
    q: q || undefined,
    issue: issue === ALL_ISSUES ? undefined : issue,
    page,
    limit: PAGE_SIZE,
  });

  const articles = data?.articles ?? [];
  const [selected, setSelected] = useState<HeldBackArticle | null>(null);
  const [open, setOpen] = useState(false);

  // Bulk approval: a set of selected row ids plus an in-flight flag. Each id is
  // approved by calling the same per-id endpoint, so every approval still
  // re-validates server-side and is audited individually as `article.approve`.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkApproving, setBulkApproving] = useState(false);

  function openArticle(article: HeldBackArticle) {
    setSelected(article);
    setOpen(true);
  }

  const pagination = data?.pagination;
  const totalPages = pagination?.totalPages ?? 1;
  const hasFilters = q.trim() !== "" || issue !== ALL_ISSUES;

  // Rows whose live verdict already passes — the only ones a bulk approve can
  // actually publish. Failing rows can still be selected, but are skipped and
  // reported when "Approve selected" runs.
  const approvableIds = new Set(
    articles
      .filter(
        (a) =>
          a.validationStatus === "pass" || a.validationStatus === "warn",
      )
      .map((a) => a.id),
  );

  // Keep selection scoped to rows currently on the page (a page/filter change
  // swaps the visible rows, so stale ids would silently linger otherwise).
  useEffect(() => {
    const visible = new Set(articles.map((a) => a.id));
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [articles]);

  const colSpan = canApprove ? 6 : 5;
  const selectableIds = articles.map((a) => a.id);
  const allSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0 && !allSelected;
  const selectedCount = selectedIds.size;

  function toggleRow(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(selectableIds) : new Set());
  }

  async function approveSelected() {
    const ids = [...selectedIds];
    const toApprove = ids.filter((id) => approvableIds.has(id));
    const skipped = ids.length - toApprove.length;

    if (toApprove.length === 0) {
      toast({
        title: "Nothing to approve",
        description:
          "None of the selected articles currently pass validation. Open them to review and fix the import.",
        variant: "destructive",
      });
      return;
    }

    setBulkApproving(true);
    let approved = 0;
    let notReady = 0;
    let failed = 0;

    for (const id of toApprove) {
      try {
        const result = await approveCmsHeldBackArticle(id);
        if (result.approved) approved += 1;
        else notReady += 1;
      } catch {
        failed += 1;
      }
    }

    setBulkApproving(false);
    setSelectedIds(new Set());
    await queryClient.invalidateQueries({
      queryKey: getListCmsHeldBackArticlesQueryKey(),
    });

    const parts: string[] = [];
    if (notReady > 0) parts.push(`${notReady} no longer passed`);
    if (skipped > 0) parts.push(`${skipped} skipped (still failing)`);
    if (failed > 0) parts.push(`${failed} errored`);
    const description =
      parts.length > 0
        ? `${approved} published. ${parts.join(", ")}.`
        : `${approved} published.`;

    toast({
      title:
        approved > 0
          ? `Approved ${approved} ${approved === 1 ? "article" : "articles"}`
          : "No articles approved",
      description,
      variant: approved > 0 ? undefined : "destructive",
    });
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

      <div className="flex flex-wrap items-center gap-4">
        <Input
          placeholder="Search by title or slug…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        <Select
          value={issue}
          onValueChange={(v) =>
            setIssue(v as ListCmsHeldBackArticlesIssue | typeof ALL_ISSUES)
          }
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="All issues" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_ISSUES}>All issues</SelectItem>
            {ISSUE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {canApprove ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={selectedCount === 0 || bulkApproving}
            onClick={approveSelected}
          >
            {bulkApproving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Approving…
              </>
            ) : (
              `Approve selected${selectedCount > 0 ? ` (${selectedCount})` : ""}`
            )}
          </Button>
          {selectedCount > 0 ? (
            <span className="text-sm text-muted-foreground">
              {selectedCount} selected. Only rows that currently pass validation
              are published; failing rows are skipped.
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-lg border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              {canApprove ? (
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all on page"
                    checked={
                      allSelected ? true : someSelected ? "indeterminate" : false
                    }
                    disabled={selectableIds.length === 0 || bulkApproving}
                    onCheckedChange={(checked) => toggleAll(checked === true)}
                  />
                </TableHead>
              ) : null}
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
                  {canApprove ? (
                    <TableCell>
                      <Skeleton className="h-4 w-4" />
                    </TableCell>
                  ) : null}
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
                <TableCell colSpan={colSpan} className="py-8 text-center text-muted-foreground">
                  Failed to load the review queue.
                </TableCell>
              </TableRow>
            ) : articles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-8 text-center text-muted-foreground">
                  {hasFilters
                    ? "No held-back articles match these filters."
                    : "No articles are held back. Everything passed validation."}
                </TableCell>
              </TableRow>
            ) : (
              articles.map((article) => (
                <TableRow key={article.id} className="align-top">
                  {canApprove ? (
                    <TableCell>
                      <Checkbox
                        aria-label={`Select ${article.title ?? article.slug}`}
                        checked={selectedIds.has(article.id)}
                        disabled={bulkApproving}
                        onCheckedChange={(checked) =>
                          toggleRow(article.id, checked === true)
                        }
                      />
                    </TableCell>
                  ) : null}
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
                    <div className="flex justify-end gap-2">
                      {canApprove &&
                      (article.validationStatus === "pass" ||
                        article.validationStatus === "warn") ? (
                        <Button
                          size="sm"
                          disabled={
                            approve.isPending &&
                            approve.variables?.id === article.id
                          }
                          onClick={() => approve.mutate({ id: article.id })}
                        >
                          {approve.isPending &&
                          approve.variables?.id === article.id ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />{" "}
                              Approving…
                            </>
                          ) : (
                            "Approve"
                          )}
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openArticle(article)}
                      >
                        Review
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {!isLoading && !isError && pagination && pagination.total > 0 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {pagination.page} of {totalPages} ·{" "}
            {pagination.total.toLocaleString()}{" "}
            {pagination.total === 1 ? "article" : "articles"} held back
            {hasFilters ? " (filtered)" : ""}.
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

      <ArticleDrawer article={selected} open={open} onOpenChange={setOpen} />
    </div>
  );
}
