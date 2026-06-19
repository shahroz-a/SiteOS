import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useTransitionCmsPost,
  useCreateCmsPreviewLink,
  useChangeCmsPostUrl,
  getGetCmsPostQueryKey,
  getListCmsPostQueryKey,
  type CmsPostDetail,
  type PageStatus,
} from "@workspace/api-client-react";
import type { SeoCheck } from "@workspace/seo-validation";
import {
  ChevronDown,
  Send,
  CalendarClock,
  Archive,
  Globe,
  FileEdit,
  Link2,
  Copy,
  Check,
  AlertTriangle,
  XCircle,
  Search,
} from "lucide-react";
import { Button } from "@workspace/ui/button";
import { Input } from "@workspace/ui/input";
import { Label } from "@workspace/ui/label";
import { Badge } from "@workspace/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@workspace/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@workspace/ui/dialog";
import { useToast } from "@workspace/ui";
import { useCmsAuth } from "@/lib/cms-auth-context";

const STATUS_META: Record<PageStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  review: { label: "In review", className: "bg-amber-100 text-amber-800" },
  scheduled: { label: "Scheduled", className: "bg-blue-100 text-blue-800" },
  published: { label: "Published", className: "bg-green-100 text-green-800" },
  archived: { label: "Archived", className: "bg-stone-200 text-stone-700" },
};

/** Format a Date as the value a `datetime-local` input expects. */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The 422 body the publish gate returns when critical SEO checks fail. */
interface PublishBlock {
  message: string;
  blocking: SeoCheck[];
}

/**
 * Pull the publish-gate block (status 422 + `{ error, blocking[] }`) out of a
 * mutation error, or return null for any other failure so it falls through to
 * the generic toast.
 */
function extractPublishBlock(err: unknown): PublishBlock | null {
  if (!err || typeof err !== "object") return null;
  if ((err as { status?: unknown }).status !== 422) return null;
  const data = (err as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const blocking = (data as { blocking?: unknown }).blocking;
  if (!Array.isArray(blocking) || blocking.length === 0) return null;
  const error = (data as { error?: unknown }).error;
  return {
    message:
      typeof error === "string" && error.trim()
        ? error
        : "This article has critical SEO issues that must be fixed before publishing.",
    blocking: blocking as SeoCheck[],
  };
}

export function PublishPanel({
  detail,
  onOpenSeoPanel,
}: {
  detail: CmsPostDetail;
  onOpenSeoPanel?: () => void;
}) {
  const { can } = useCmsAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const canPublish = can("content.publish");
  const canManageUrl = can("url.manage");

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [block, setBlock] = useState<PublishBlock | null>(null);
  const [scheduleAt, setScheduleAt] = useState(() => {
    const base = detail.scheduledFor
      ? new Date(detail.scheduledFor)
      : new Date(Date.now() + 60 * 60 * 1000);
    return toLocalInputValue(base);
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetCmsPostQueryKey(detail.id) });
    queryClient.invalidateQueries({ queryKey: getListCmsPostQueryKey() });
  };

  const transition = useTransitionCmsPost({
    mutation: {
      onSuccess: (_data, vars) => {
        invalidate();
        toast({ title: `Moved to ${vars.data.to}` });
        setScheduleOpen(false);
      },
      onError: (err: unknown) => {
        const publishBlock = extractPublishBlock(err);
        if (publishBlock) {
          setScheduleOpen(false);
          setBlock(publishBlock);
          return;
        }
        toast({
          title: "Transition failed",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const move = (to: PageStatus, scheduledFor?: string) => {
    transition.mutate({ id: detail.id, data: { to, scheduledFor: scheduledFor ?? null } });
  };

  const current = STATUS_META[detail.status];

  return (
    <div className="flex items-center gap-2">
      <Badge variant="secondary" className={current.className}>
        {current.label}
      </Badge>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={transition.isPending}>
            Status <ChevronDown className="ml-1 h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>Move article to…</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {detail.status !== "draft" && (
            <DropdownMenuItem onClick={() => move("draft")}>
              <FileEdit className="mr-2 h-4 w-4" /> Back to draft
            </DropdownMenuItem>
          )}
          {detail.status !== "review" && (
            <DropdownMenuItem onClick={() => move("review")}>
              <Send className="mr-2 h-4 w-4" /> Submit for review
            </DropdownMenuItem>
          )}
          {canPublish && detail.status !== "published" && (
            <DropdownMenuItem onClick={() => move("published")}>
              <Globe className="mr-2 h-4 w-4" /> Publish now
            </DropdownMenuItem>
          )}
          {canPublish && (
            <DropdownMenuItem onClick={() => setScheduleOpen(true)}>
              <CalendarClock className="mr-2 h-4 w-4" /> Schedule…
            </DropdownMenuItem>
          )}
          {detail.status !== "archived" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => move("archived")}>
                <Archive className="mr-2 h-4 w-4" /> Archive
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <PreviewLinkButton detail={detail} />
      <UrlPanelButton detail={detail} canManageUrl={canManageUrl} onChanged={invalidate} />

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule publication</DialogTitle>
            <DialogDescription>
              The article will go live automatically at the chosen time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="schedule-at">Publish at</Label>
            <Input
              id="schedule-at"
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={transition.isPending}
              onClick={() => {
                const when = new Date(scheduleAt);
                if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
                  toast({
                    title: "Pick a future time",
                    description: "The scheduled time must be in the future.",
                    variant: "destructive",
                  });
                  return;
                }
                move("scheduled", when.toISOString());
              }}
            >
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={block !== null} onOpenChange={(open) => !open && setBlock(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              SEO issues blocking publish
            </DialogTitle>
            <DialogDescription>
              {block?.message}
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {block?.blocking.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-sm">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <span className="flex-1">
                  <span className="font-medium">{c.label}.</span>{" "}
                  <span className="text-muted-foreground">{c.message}</span>
                </span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlock(null)}>
              Dismiss
            </Button>
            {onOpenSeoPanel && (
              <Button
                onClick={() => {
                  setBlock(null);
                  onOpenSeoPanel();
                }}
              >
                <Search className="mr-1 h-4 w-4" /> Open SEO panel
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PreviewLinkButton({ detail }: { detail: CmsPostDetail }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const createLink = useCreateCmsPreviewLink({
    mutation: {
      onSuccess: async (data) => {
        const url = new URL(data.url, window.location.origin).toString();
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
          toast({ title: "Preview link copied", description: "Anyone with the link can view this draft until it expires." });
        } catch {
          toast({ title: "Preview link created", description: url });
        }
      },
      onError: () => {
        toast({ title: "Couldn't create preview link", variant: "destructive" });
      },
    },
  });

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={createLink.isPending}
      onClick={() => createLink.mutate({ id: detail.id, data: { expiresInHours: 72 } })}
      title="Create a shareable preview link"
    >
      {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Link2 className="mr-1 h-3.5 w-3.5" />}
      Preview link
    </Button>
  );
}

function UrlPanelButton({
  detail,
  canManageUrl,
  onChanged,
}: {
  detail: CmsPostDetail;
  canManageUrl: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState(detail.slug);
  const [createRedirect, setCreateRedirect] = useState(true);

  const changeUrl = useChangeCmsPostUrl({
    mutation: {
      onSuccess: () => {
        onChanged();
        toast({ title: "URL updated", description: createRedirect ? "A redirect from the old URL was created." : undefined });
        setOpen(false);
      },
      onError: (err: unknown) => {
        toast({
          title: "URL change failed",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const dirty = slug.trim() !== detail.slug;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} title="Manage URL & redirects">
        <Globe className="mr-1 h-3.5 w-3.5" /> URL
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>URL & redirects</DialogTitle>
            <DialogDescription>
              Manage this article's public address. Changing the slug can break
              inbound links unless a redirect is created.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-[7rem_1fr] items-center gap-x-3 gap-y-1.5">
              <span className="text-muted-foreground">Original URL</span>
              <span className="truncate font-mono text-xs">{detail.originalUrl ?? "—"}</span>
              <span className="text-muted-foreground">Current path</span>
              <span className="truncate font-mono text-xs">{detail.pathname}</span>
              <span className="text-muted-foreground">Canonical</span>
              <span className="truncate font-mono text-xs">{detail.canonicalUrl}</span>
            </div>

            {detail.redirects.length > 0 && (
              <div className="rounded-md border border-border/60 p-2">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Redirects pointing here
                </p>
                <ul className="space-y-1">
                  {detail.redirects.map((r) => (
                    <li key={r.id} className="flex items-center gap-2 font-mono text-xs">
                      <span className="truncate">{r.fromPath}</span>
                      <span className="text-muted-foreground">→ {r.statusCode}</span>
                      {!r.isActive && <Badge variant="outline">inactive</Badge>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {canManageUrl ? (
              <div className="space-y-2 border-t border-border/60 pt-3">
                <Label htmlFor="slug-input">Slug</Label>
                <Input
                  id="slug-input"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="article-slug"
                />
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={createRedirect}
                    onChange={(e) => setCreateRedirect(e.target.checked)}
                  />
                  Create a 301 redirect from the old URL
                </label>
                {dirty && (
                  <p className="flex items-center gap-1.5 text-xs text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    This changes the public URL of a live article.
                  </p>
                )}
              </div>
            ) : (
              <p className="border-t border-border/60 pt-3 text-xs text-muted-foreground">
                You don't have permission to change URLs.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            {canManageUrl && (
              <Button
                disabled={!dirty || !slug.trim() || changeUrl.isPending}
                onClick={() =>
                  changeUrl.mutate({
                    id: detail.id,
                    data: { slug: slug.trim(), confirm: true, createRedirect },
                  })
                }
              >
                <Copy className="mr-1 h-3.5 w-3.5" /> Apply URL change
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
