import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import {
  useGetCmsDashboard,
  type CmsDashboard,
  type CmsDashboardPost,
  type CmsDashboardActivity,
} from "@workspace/api-client-react";
import {
  FileText,
  CheckCircle2,
  FileEdit,
  CalendarClock,
  Archive,
  Users,
  FolderTree,
  Tags,
  SearchX,
  Unlink,
  ShieldAlert,
  ListChecks,
  Radar,
  Database,
  HardDrive,
  ArrowUpRight,
  Activity as ActivityIcon,
  ScrollText,
  ExternalLink,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/card";
import { Badge } from "@workspace/ui/badge";
import { Button } from "@workspace/ui/button";
import { Skeleton } from "@workspace/ui/skeleton";
import { Separator } from "@workspace/ui/separator";
import { useCmsAuth } from "@/lib/cms-auth-context";

type Dashboard = CmsDashboard;

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "—";
  }
}

const STATUS_VARIANT: Record<
  CmsDashboardPost["status"],
  "default" | "secondary" | "outline"
> = {
  published: "default",
  draft: "secondary",
  archived: "outline",
};

type Tone = "neutral" | "good" | "warn" | "bad";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
};

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "neutral",
}: {
  icon: typeof FileText;
  label: string;
  value: string | number;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <Card className="border-border/60">
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="font-serif text-3xl leading-none tracking-tight">
            {value}
          </p>
          {hint ? (
            <p className={`truncate text-xs ${TONE_CLASS[tone]}`}>{hint}</p>
          ) : null}
        </div>
        <span
          className={`shrink-0 rounded-lg bg-muted/60 p-2 ${TONE_CLASS[tone]}`}
        >
          <Icon className="size-5" aria-hidden />
        </span>
      </CardContent>
    </Card>
  );
}

function StatTileSkeleton() {
  return (
    <Card className="border-border/60">
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-12" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="size-9 rounded-lg" />
      </CardContent>
    </Card>
  );
}

function PostRow({ post }: { post: CmsDashboardPost }) {
  const timestamp =
    post.status === "published" && post.publishedAt
      ? post.publishedAt
      : post.updatedAt;
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-medium leading-snug">
          {post.title || post.slug}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {post.authorName ? `${post.authorName} · ` : ""}
          {relativeTime(timestamp)}
        </p>
      </div>
      <Badge variant={STATUS_VARIANT[post.status]} className="shrink-0 capitalize">
        {post.status}
      </Badge>
    </div>
  );
}

function PostListCard({
  title,
  description,
  posts,
  emptyLabel,
}: {
  title: string;
  description: string;
  posts: CmsDashboardPost[];
  emptyLabel: string;
}) {
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {posts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {emptyLabel}
          </p>
        ) : (
          <div className="divide-y divide-border/60">
            {posts.map((post) => (
              <PostRow key={post.id} post={post} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ListCardSkeleton() {
  return (
    <Card className="border-border/60">
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-56" />
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function activitySummary(entry: CmsDashboardActivity): string {
  const actor = entry.actorEmail ?? "Someone";
  const verb = entry.action.replace(/[._]/g, " ");
  return `${actor} · ${verb}`;
}

function ActivityCard({ activity }: { activity: CmsDashboardActivity[] }) {
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ActivityIcon className="size-4 text-muted-foreground" />
          Activity feed
        </CardTitle>
        <CardDescription>Recent content changes across the studio.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {activity.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No recent activity.
          </p>
        ) : (
          <ol className="space-y-3">
            {activity.map((entry) => (
              <li key={entry.id} className="flex gap-3">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary/60" />
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate text-sm leading-snug">
                    {activitySummary(entry)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {relativeTime(entry.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function QuickActions() {
  const { can } = useCmsAuth();
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="text-lg">Quick actions</CardTitle>
        <CardDescription>Jump to where the work happens.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0">
        {can("audit.view") ? (
          <Button asChild variant="outline" className="justify-start">
            <Link href="/audit-log">
              <ScrollText className="size-4" />
              View audit log
            </Link>
          </Button>
        ) : null}
        {can("users.manage") ? (
          <Button asChild variant="outline" className="justify-start">
            <Link href="/users">
              <Users className="size-4" />
              Manage users
            </Link>
          </Button>
        ) : null}
        <Button asChild variant="outline" className="justify-start">
          <a href="/blog/" target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" />
            Open public blog
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

function DatabaseTone(status: Dashboard["stats"]["database"]["status"]): Tone {
  if (status === "healthy") return "good";
  if (status === "degraded") return "warn";
  return "bad";
}

function StatGrid({ stats }: { stats: Dashboard["stats"] }) {
  const crawlActive = stats.crawl.inProgress > 0 || stats.crawl.pending > 0;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      <StatTile icon={FileText} label="Total Blogs" value={stats.totalBlogs} />
      <StatTile
        icon={CheckCircle2}
        label="Published"
        value={stats.published}
        tone="good"
      />
      <StatTile icon={FileEdit} label="Drafts" value={stats.drafts} />
      <StatTile
        icon={CalendarClock}
        label="Scheduled"
        value={stats.scheduled}
      />
      <StatTile icon={Archive} label="Archived" value={stats.archived} />
      <StatTile icon={Users} label="Authors" value={stats.authors} />
      <StatTile icon={FolderTree} label="Categories" value={stats.categories} />
      <StatTile icon={Tags} label="Tags" value={stats.tags} />
      <StatTile
        icon={SearchX}
        label="Missing SEO"
        value={stats.missingSeo}
        tone={stats.missingSeo > 0 ? "warn" : "good"}
        hint={stats.missingSeo > 0 ? "Needs metadata" : "All set"}
      />
      <StatTile
        icon={Unlink}
        label="Broken Links"
        value={stats.brokenLinks}
        tone={stats.brokenLinks > 0 ? "bad" : "good"}
        hint={stats.brokenLinks > 0 ? "Unresolved" : "All resolved"}
      />
      <StatTile
        icon={ShieldAlert}
        label="Validation Errors"
        value={stats.validationErrors}
        tone={stats.validationErrors > 0 ? "bad" : "good"}
        hint={stats.validationErrors > 0 ? "Failing checks" : "All passing"}
      />
      <StatTile
        icon={ListChecks}
        label="Publishing Queue"
        value={stats.publishingQueue}
        tone={stats.publishingQueue > 0 ? "warn" : "neutral"}
        hint={stats.publishingQueue > 0 ? "Items waiting" : "Empty"}
      />
      <StatTile
        icon={Radar}
        label="Crawl Status"
        value={stats.crawl.completed}
        tone={crawlActive ? "warn" : "good"}
        hint={
          crawlActive
            ? `${stats.crawl.inProgress} running · ${stats.crawl.pending} queued`
            : `Last ${relativeTime(stats.crawl.lastCompletedAt)}`
        }
      />
      <StatTile
        icon={Database}
        label="Database Health"
        value={`${stats.database.latencyMs}ms`}
        tone={DatabaseTone(stats.database.status)}
        hint={stats.database.status}
      />
      <StatTile
        icon={HardDrive}
        label="Storage Usage"
        value={formatBytes(stats.storage.bytes)}
        hint="Database size"
      />
    </div>
  );
}

export default function HomePage() {
  const { user } = useCmsAuth();
  const firstName = user?.firstName || user?.email || "there";
  const { data, isLoading, isError, refetch, isFetching } =
    useGetCmsDashboard();

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="font-serif text-4xl tracking-tight">
            Welcome back, {firstName}
          </h1>
          <p className="text-muted-foreground">
            An operational overview of the Blog Studio.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <ArrowUpRight className="size-4" />
          {isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <Separator className="bg-border/60" />

      {isError ? (
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <ShieldAlert className="size-8 text-destructive" />
            <div className="space-y-1">
              <p className="font-medium">Couldn't load the dashboard</p>
              <p className="text-sm text-muted-foreground">
                Something went wrong while fetching live metrics.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : isLoading || !data ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 15 }).map((_, i) => (
              <StatTileSkeleton key={i} />
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ListCardSkeleton />
            </div>
            <ListCardSkeleton />
          </div>
        </>
      ) : (
        <>
          <StatGrid stats={data.stats} />

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <div className="grid gap-6 md:grid-cols-2">
                <PostListCard
                  title="Recently edited"
                  description="Latest updates across all posts."
                  posts={data.recentlyEdited}
                  emptyLabel="No posts yet."
                />
                <PostListCard
                  title="Recently published"
                  description="Freshly live articles."
                  posts={data.recentlyPublished}
                  emptyLabel="Nothing published yet."
                />
              </div>
              <ActivityCard activity={data.activity} />
            </div>
            <QuickActions />
          </div>
        </>
      )}
    </div>
  );
}
