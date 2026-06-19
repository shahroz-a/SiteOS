import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCmsPost,
  useScaffoldCmsPost,
  useDuplicateCmsPost,
  useDeleteCmsPost,
  getListCmsPostQueryKey,
  type CmsPostSummary,
  type PageStatus,
} from "@workspace/api-client-react";
import { CalendarClock, Copy, FileText, History, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@workspace/ui/button";
import { Input } from "@workspace/ui/input";
import { Badge } from "@workspace/ui/badge";
import { Skeleton } from "@workspace/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/dialog";
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
import { Label } from "@workspace/ui/label";
import { useToast } from "@workspace/ui";
import { useCmsAuth } from "@/lib/cms-auth-context";

const STATUS_VARIANT: Record<PageStatus, "default" | "secondary" | "outline"> = {
  published: "default",
  draft: "secondary",
  review: "secondary",
  scheduled: "secondary",
  archived: "outline",
};

const STATUS_LABEL: Record<PageStatus, string> = {
  draft: "Draft",
  review: "In review",
  scheduled: "Scheduled",
  published: "Published",
  archived: "Archived",
};

/** Status tabs shown above the list. `all` keeps the original unfiltered view. */
const STATUS_TABS: { value: PageStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "review", label: "In review" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
  { value: "draft", label: "Draft" },
  { value: "archived", label: "Archived" },
];

function formatWhen(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Human "goes live in X" / "overdue" copy for a scheduled post relative to now.
 * A scheduled time in the past means the publish job hasn't flipped it yet.
 */
function formatCountdown(iso?: string | null): { text: string; overdue: boolean } | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return null;
  const diffMs = target - Date.now();
  const overdue = diffMs <= 0;
  const mins = Math.round(Math.abs(diffMs) / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const remMins = mins % 60;

  let amount: string;
  if (days > 0) amount = `${days}d ${hours}h`;
  else if (hours > 0) amount = `${hours}h ${remMins}m`;
  else amount = `${remMins}m`;

  return overdue
    ? { text: `overdue by ${amount}`, overdue: true }
    : { text: `goes live in ${amount}`, overdue: false };
}

export default function ContentPage() {
  const [, navigate] = useLocation();
  const { can } = useCmsAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const canCreate = can("content.create");
  const canDelete = can("content.delete");

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<PageStatus | "all">("all");
  const [page, setPage] = useState(1);

  const params = useMemo(
    () => ({
      q: q.trim() || undefined,
      status: status === "all" ? undefined : status,
      page,
      limit: 20,
    }),
    [q, status, page],
  );

  const { data, isLoading, isError } = useListCmsPost(params);

  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: getListCmsPostQueryKey() });

  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const scaffold = useScaffoldCmsPost({
    mutation: {
      onSuccess: (created) => {
        invalidateList();
        setNewOpen(false);
        setNewTitle("");
        navigate(`/content/${created.id}`);
      },
      onError: () =>
        toast({ title: "Could not create draft", variant: "destructive" }),
    },
  });

  const duplicate = useDuplicateCmsPost({
    mutation: {
      onSuccess: (created) => {
        invalidateList();
        toast({ title: "Duplicated", description: "A draft copy was created." });
        navigate(`/content/${created.id}`);
      },
      onError: () => toast({ title: "Could not duplicate", variant: "destructive" }),
    },
  });

  const [deleteTarget, setDeleteTarget] = useState<CmsPostSummary | null>(null);
  const remove = useDeleteCmsPost({
    mutation: {
      onSuccess: () => {
        invalidateList();
        setDeleteTarget(null);
        toast({ title: "Deleted" });
      },
      onError: () => toast({ title: "Could not delete", variant: "destructive" }),
    },
  });

  const items = data?.items ?? [];
  const pagination = data?.pagination;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-serif text-4xl tracking-tight">Content</h1>
          <p className="text-muted-foreground">
            Browse, create and edit articles with the block editor.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> New article
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-border/60">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => {
              setStatus(tab.value);
              setPage(1);
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              status === tab.value
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[16rem]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search by title or slug…"
            className="pl-9"
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as PageStatus | "all");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="review">In review</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)
        ) : isError ? (
          <div className="rounded-lg border border-border/60 py-12 text-center text-muted-foreground">
            Failed to load content.
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-16 text-center">
            <FileText className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-muted-foreground">No articles found.</p>
          </div>
        ) : (
          items.map((post) => (
            <div
              key={post.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/content/${post.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter") navigate(`/content/${post.id}`);
              }}
              className="group flex items-center gap-4 rounded-lg border border-border/60 p-4 text-left transition-colors hover:border-border hover:bg-muted/40"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{post.title || "Untitled"}</span>
                  <Badge variant={STATUS_VARIANT[post.status]} className="shrink-0">
                    {STATUS_LABEL[post.status]}
                  </Badge>
                  {post.status === "scheduled" && post.scheduledFor
                    ? (() => {
                        const countdown = formatCountdown(post.scheduledFor);
                        return countdown ? (
                          <Badge
                            variant="outline"
                            className={`shrink-0 ${
                              countdown.overdue
                                ? "border-red-300 text-red-700"
                                : "border-blue-300 text-blue-700"
                            }`}
                          >
                            <CalendarClock className="mr-1 h-3 w-3" />
                            {countdown.text}
                          </Badge>
                        ) : null;
                      })()
                    : null}
                </div>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  /{post.slug} ·{" "}
                  {post.status === "scheduled" && post.scheduledFor
                    ? `Goes live ${formatDateTime(post.scheduledFor)}`
                    : post.status === "published" && post.publishedAt
                      ? `Published ${formatWhen(post.publishedAt)}`
                      : `Updated ${formatWhen(post.updatedAt)}`}
                </p>
              </div>
              <div
                className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  title="Version history"
                  onClick={() => navigate(`/content/${post.id}/history`)}
                >
                  <History className="h-4 w-4" />
                </Button>
                {canCreate ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Duplicate"
                    disabled={duplicate.isPending}
                    onClick={() => duplicate.mutate({ id: post.id, data: {} })}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                ) : null}
                {canDelete ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Delete"
                    onClick={() => setDeleteTarget(post)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      {pagination && pagination.totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages} · {pagination.total} total
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New article</DialogTitle>
            <DialogDescription>
              Start a blank draft. You can edit everything in the block editor.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-title">Title</Label>
            <Input
              id="new-title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Untitled article"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTitle.trim()) {
                  scaffold.mutate({ data: { title: newTitle.trim() } });
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!newTitle.trim() || scaffold.isPending}
              onClick={() => scaffold.mutate({ data: { title: newTitle.trim() } })}
            >
              Create draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this article?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.title}" will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && remove.mutate({ id: deleteTarget.id })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
