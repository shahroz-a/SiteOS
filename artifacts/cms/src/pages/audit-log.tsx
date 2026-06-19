import { useState } from "react";
import { format } from "date-fns";
import { ImageOff } from "lucide-react";
import { useListCmsAuditLogs, type AuditLogEntry } from "@workspace/api-client-react";
import { isRole, ROLE_META } from "@workspace/cms-auth";
import { Avatar, AvatarFallback } from "@workspace/ui/avatar";
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

const PAGE_SIZE = 20;

const MEDIA_UPDATE_ACTION = "media.metadata.update";

const ACTION_LABELS: Record<string, string> = {
  "user.role.update": "Changed user role",
  [MEDIA_UPDATE_ACTION]: "Edited image description",
};

const ALT_STATUS_LABELS: Record<string, string> = {
  ok: "Alt text OK",
  missing: "Missing alt text",
  poor: "Poor alt text",
};

/** Human label for the changed metadata fields of a media edit. */
const MEDIA_FIELD_LABELS: Record<string, string> = {
  alt: "Alt text",
  title: "Title",
  caption: "Caption",
  altStatus: "Status",
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

function isMediaUpdate(entry: AuditLogEntry): boolean {
  return entry.action === MEDIA_UPDATE_ACTION;
}

/** Best-effort CDN URL of the edited image: the entityId is the stable
 * identifier, with metadata/before/after fallbacks. */
function mediaImageUrl(entry: AuditLogEntry): string | null {
  const candidates: unknown[] = [
    entry.entityId,
    entry.metadata?.url,
    entry.after?.url,
    entry.before?.url,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && /^https?:\/\//.test(c)) return c;
  }
  return null;
}

/** Friendly value for a media metadata field (alt status gets a label). */
function mediaFieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (key === "altStatus" && typeof value === "string") {
    return ALT_STATUS_LABELS[value] ?? value;
  }
  if (typeof value === "string") return value.trim() ? value : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function MediaThumb({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted text-muted-foreground">
        <ImageOff className="h-5 w-5" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      className="h-14 w-14 shrink-0 rounded-md border border-border/60 object-cover"
      onError={() => setFailed(true)}
    />
  );
}

/** Rich rendering of a media.metadata.update entry: thumbnail + readable
 * before → after of each changed metadata field (alt text first). */
function MediaChange({ entry }: { entry: AuditLogEntry }) {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const url = mediaImageUrl(entry);
  const ordered = ["alt", "title", "caption", "altStatus"];
  const keys = Array.from(
    new Set([...ordered, ...Object.keys(before), ...Object.keys(after)]),
  ).filter((k) => k !== "url" && (k in before || k in after));

  const changed = keys.filter(
    (k) => mediaFieldValue(k, before[k]) !== mediaFieldValue(k, after[k]),
  );
  const rows = changed.length > 0 ? changed : keys;

  return (
    <div className="flex gap-3">
      <MediaThumb url={url} />
      <div className="min-w-0 flex-1 space-y-1.5">
        {rows.length === 0 ? (
          <span className="text-sm text-muted-foreground">No details</span>
        ) : (
          rows.map((key) => {
            const prev = mediaFieldValue(key, before[key]);
            const next = mediaFieldValue(key, after[key]);
            return (
              <div
                key={key}
                className="flex flex-wrap items-baseline gap-2 text-sm"
              >
                <span className="font-medium text-muted-foreground">
                  {MEDIA_FIELD_LABELS[key] ?? key}
                </span>
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs line-through decoration-muted-foreground/60">
                  {prev}
                </code>
                <span className="text-muted-foreground">→</span>
                <code className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                  {next}
                </code>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [mediaOnly, setMediaOnly] = useState(false);
  const { data, isLoading, isError, isFetching } = useListCmsAuditLogs({
    page,
    limit: PAGE_SIZE,
    ...(mediaOnly ? { action: MEDIA_UPDATE_ACTION } : {}),
  });

  function setFilter(next: boolean) {
    setMediaOnly(next);
    setPage(1);
  }

  const entries = data?.items ?? [];
  const pagination = data?.pagination;
  const totalPages = pagination?.totalPages ?? 1;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-serif text-4xl tracking-tight">Audit log</h1>
          <p className="text-muted-foreground">
            A record of privileged actions — who changed what, and when.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={mediaOnly ? "outline" : "default"}
            size="sm"
            onClick={() => setFilter(false)}
          >
            All actions
          </Button>
          <Button
            variant={mediaOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(true)}
          >
            Image edits
          </Button>
        </div>
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
                      {isMediaUpdate(entry) ? (
                        <MediaChange entry={entry} />
                      ) : (
                        <DiffView before={entry.before} after={entry.after} />
                      )}
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
