import { useState } from "react";
import { format } from "date-fns";
import { useListCmsAuditLogs, type AuditLogEntry } from "@workspace/api-client-react";
import { isRole, ROLE_META } from "@workspace/cms-auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

const PAGE_SIZE = 20;

const ACTION_LABELS: Record<string, string> = {
  "user.role.update": "Changed user role",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function actorName(entry: AuditLogEntry): string {
  return entry.actorEmail ?? entry.actorId ?? "Unknown actor";
}

function initials(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "?";
  return trimmed.slice(0, 2).toUpperCase();
}

function roleLabel(role: string): string {
  return isRole(role) ? ROLE_META[role].label : role;
}

function entityLabel(entry: AuditLogEntry): string | null {
  if (!entry.entityType) return null;
  return entry.entityId
    ? `${entry.entityType} · ${entry.entityId}`
    : entry.entityType;
}

type JsonObject = Record<string, unknown>;

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") {
    return isRole(value) ? roleLabel(value) : value;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Render a readable before → after diff over the union of changed keys. */
function DiffView({
  before,
  after,
}: {
  before: JsonObject | null;
  after: JsonObject | null;
}) {
  const keys = Array.from(
    new Set([
      ...Object.keys(before ?? {}),
      ...Object.keys(after ?? {}),
    ]),
  );

  if (keys.length === 0) {
    return <span className="text-sm text-muted-foreground">No details</span>;
  }

  return (
    <div className="space-y-1.5">
      {keys.map((key) => {
        const prev = before?.[key];
        const next = after?.[key];
        const changed = formatValue(prev) !== formatValue(next);
        return (
          <div key={key} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-muted-foreground">{key}</span>
            {before ? (
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs line-through decoration-muted-foreground/60">
                {formatValue(prev)}
              </code>
            ) : null}
            {before && after ? (
              <span className="text-muted-foreground">→</span>
            ) : null}
            {after ? (
              <code
                className={
                  changed
                    ? "rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
                    : "rounded bg-muted px-1.5 py-0.5 text-xs"
                }
              >
                {formatValue(next)}
              </code>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function AuditLogPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, isFetching } = useListCmsAuditLogs({
    page,
    limit: PAGE_SIZE,
  });

  const entries = data?.items ?? [];
  const pagination = data?.pagination;
  const totalPages = pagination?.totalPages ?? 1;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-2">
        <h1 className="font-serif text-4xl tracking-tight">Audit log</h1>
        <p className="text-muted-foreground">
          A record of privileged actions — who changed what, and when.
        </p>
      </div>

      <div className="rounded-lg border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-56">Actor</TableHead>
              <TableHead className="w-48">Action</TableHead>
              <TableHead>Change</TableHead>
              <TableHead className="w-44 text-right">When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-8 w-40" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-32" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-48" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="ml-auto h-4 w-28" />
                  </TableCell>
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  Failed to load the audit log.
                </TableCell>
              </TableRow>
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  No audit entries yet. Privileged actions will appear here.
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => {
                const name = actorName(entry);
                const entity = entityLabel(entry);
                return (
                  <TableRow key={entry.id} className="align-top">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback>{initials(name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{name}</div>
                          {entry.actorRole ? (
                            <span className="text-xs text-muted-foreground">
                              {roleLabel(entry.actorRole)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal">
                        {actionLabel(entry.action)}
                      </Badge>
                      {entity ? (
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {entity}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <DiffView before={entry.before} after={entry.after} />
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {format(new Date(entry.createdAt), "MMM d, yyyy")}
                      <div className="text-xs">
                        {format(new Date(entry.createdAt), "h:mm a")}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {pagination && pagination.total > 0 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {pagination.page} of {totalPages} · {pagination.total}{" "}
            {pagination.total === 1 ? "entry" : "entries"}
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
    </div>
  );
}
