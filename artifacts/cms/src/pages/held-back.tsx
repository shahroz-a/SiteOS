import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCmsHeldBackArticles,
  useResolveCmsHeldBackArticle,
  useGetCmsHeldBackArticleSource,
  getListCmsHeldBackArticlesQueryKey,
  type HeldBackArticle,
  type HeldBackValidationIssue,
} from "@workspace/api-client-react";
import { ContentRenderer } from "@workspace/blog-renderer";
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

function SourceComparison({ articleId }: { articleId: string }) {
  const { data, isLoading, isError } = useGetCmsHeldBackArticleSource(articleId);

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

  const hasSource = Boolean(data.sourceHtml && data.sourceHtml.trim().length);
  const hasParsed =
    (Array.isArray(data.componentTree)
      ? data.componentTree.length > 0
      : Boolean(data.componentTree)) || Boolean(data.richText);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-medium">Original article</h4>
          {data.sourceKind === "original" ? (
            <Badge variant="outline" className="text-[10px] uppercase">
              Raw HTML
            </Badge>
          ) : null}
        </div>
        <div className="h-[60vh] overflow-y-auto rounded-md border border-border/60 bg-muted/20 p-4">
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
        <div className="h-[60vh] overflow-y-auto rounded-md border border-border/60 p-4">
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
                  <Button
                    disabled={pending}
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
                    disabled={pending}
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
