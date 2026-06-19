import { useQueryClient } from "@tanstack/react-query";
import {
  useListCmsDeactivatedRedirects,
  useReactivateCmsRedirect,
  getListCmsDeactivatedRedirectsQueryKey,
  type DeactivatedRedirect,
} from "@workspace/api-client-react";
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
import { useToast } from "@workspace/ui";

const REASON_LABELS: Record<string, string> = {
  "on-blog-target-missing": "Blog target missing",
  "off-blog-target-dead": "External target dead",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function kindBadge(kind: DeactivatedRedirect["kind"]) {
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {kind === "on-blog" ? "On-blog" : "Off-blog"}
    </Badge>
  );
}

function PathCell({ from, to }: { from: string; to: string }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <div className="truncate font-medium" title={from}>
        {from}
      </div>
      <div className="truncate text-xs text-muted-foreground" title={to}>
        → {to}
      </div>
    </div>
  );
}

export default function RedirectsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useListCmsDeactivatedRedirects();

  const reactivate = useReactivateCmsRedirect({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListCmsDeactivatedRedirectsQueryKey(),
        });
        toast({ title: "Redirect re-activated" });
      },
      onError: () => {
        toast({
          title: "Could not re-activate redirect",
          description:
            "You may not have permission, or something went wrong.",
          variant: "destructive",
        });
      },
    },
  });

  const deactivated = data?.deactivated ?? [];
  const atRisk = data?.atRisk ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div className="space-y-2">
        <h1 className="font-serif text-4xl tracking-tight">Redirects</h1>
        <p className="text-muted-foreground">
          Redirects the target-health job switched off because their destination
          is confirmed dead. Review each one and re-activate it if the
          destination is back or the deactivation was wrong.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl tracking-tight">
          Auto-deactivated
        </h2>
        <div className="rounded-lg border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Redirect</TableHead>
                <TableHead className="w-28">Type</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="w-44">Deactivated</TableHead>
                <TableHead className="w-20 text-right">Status</TableHead>
                <TableHead className="w-32 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-8 w-64" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="ml-auto h-4 w-10" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="ml-auto h-9 w-24" />
                    </TableCell>
                  </TableRow>
                ))
              ) : isError ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Failed to load redirects.
                  </TableCell>
                </TableRow>
              ) : deactivated.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No redirects have been auto-deactivated.
                  </TableCell>
                </TableRow>
              ) : (
                deactivated.map((r) => {
                  const pending =
                    reactivate.isPending && reactivate.variables?.id === r.id;
                  return (
                    <TableRow key={r.id} className="align-top">
                      <TableCell>
                        <PathCell from={r.fromPath} to={r.toPath} />
                      </TableCell>
                      <TableCell>{kindBadge(r.kind)}</TableCell>
                      <TableCell className="text-sm">
                        {r.deactivatedReason
                          ? (REASON_LABELS[r.deactivatedReason] ??
                            r.deactivatedReason)
                          : "—"}
                        {r.targetCheckFailures > 0 ? (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({r.targetCheckFailures} failed{" "}
                            {r.targetCheckFailures === 1 ? "check" : "checks"})
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(r.deactivatedAt)}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                        {r.targetLastStatus ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => reactivate.mutate({ id: r.id })}
                        >
                          {pending ? "Re-activating…" : "Re-activate"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl tracking-tight">At risk</h2>
        <p className="text-sm text-muted-foreground">
          Still active, but the external target has failed at least one health
          check. These are watched and only deactivated if failures keep
          accumulating.
        </p>
        <div className="rounded-lg border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Redirect</TableHead>
                <TableHead className="w-28">Type</TableHead>
                <TableHead className="w-44">Last checked</TableHead>
                <TableHead className="w-24 text-right">Failures</TableHead>
                <TableHead className="w-20 text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 2 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-8 w-64" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="ml-auto h-4 w-8" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="ml-auto h-4 w-10" />
                    </TableCell>
                  </TableRow>
                ))
              ) : isError ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Failed to load redirects.
                  </TableCell>
                </TableRow>
              ) : atRisk.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No redirects are currently at risk.
                  </TableCell>
                </TableRow>
              ) : (
                atRisk.map((r) => (
                  <TableRow key={r.id} className="align-top">
                    <TableCell>
                      <PathCell from={r.fromPath} to={r.toPath} />
                    </TableCell>
                    <TableCell>{kindBadge(r.kind)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(r.targetCheckedAt)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {r.targetCheckFailures}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {r.targetLastStatus ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
