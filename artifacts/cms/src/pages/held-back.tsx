import {
  useListCmsHeldBackArticles,
  type HeldBackArticle,
  type HeldBackValidationIssue,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

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

export default function HeldBackPage() {
  const { data, isLoading, isError } = useListCmsHeldBackArticles();
  const articles = data?.articles ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-2">
        <h1 className="font-serif text-4xl tracking-tight">Review queue</h1>
        <p className="text-muted-foreground">
          Articles held back from the public site because content-fidelity
          validation failed. Each verdict is re-scored live, so the reason shown
          always reflects the current rules.
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
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  Failed to load the review queue.
                </TableCell>
              </TableRow>
            ) : articles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
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
    </div>
  );
}
