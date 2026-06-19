import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import {
  useGetCmsAnalytics,
  type CmsAnalytics,
  type AnalyticsLeader,
  type AnalyticsTimePoint,
} from "@workspace/api-client-react";
import {
  Eye,
  CalendarRange,
  CalendarDays,
  Gauge,
  CheckCircle2,
  AlertTriangle,
  Unlink,
  ShieldAlert,
  FileEdit,
  CalendarClock,
  ArrowUpRight,
  BarChart3,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/card";
import { Button } from "@workspace/ui/button";
import { Skeleton } from "@workspace/ui/skeleton";
import { Separator } from "@workspace/ui/separator";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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
  icon: typeof Eye;
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

function ChartCardSkeleton() {
  return (
    <Card className="border-border/60">
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-56" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-64 w-full" />
      </CardContent>
    </Card>
  );
}

function nf(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function formatDay(period: string): string {
  try {
    return format(parseISO(period), "MMM d");
  } catch {
    return period;
  }
}

function formatMonth(period: string): string {
  try {
    return format(parseISO(`${period}-01`), "MMM ''yy");
  } catch {
    return period;
  }
}

const AXIS = {
  fontSize: 11,
  stroke: "var(--muted-foreground)",
} as const;

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number | string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border/60 bg-background px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{label}</p>
      <p className="text-muted-foreground">
        {nf(Number(payload[0]?.value ?? 0))}
      </p>
    </div>
  );
}

function ViewsChart({ daily }: { daily: AnalyticsTimePoint[] }) {
  const data = useMemo(
    () => daily.map((d) => ({ ...d, label: formatDay(d.period) })),
    [daily],
  );
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="text-lg">Page views</CardTitle>
        <CardDescription>Daily views over the last 30 days.</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <defs>
              <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
            <Tooltip content={<ChartTooltip />} />
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--primary)"
              strokeWidth={2}
              fill="url(#viewsFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function VelocityChart({ data }: { data: AnalyticsTimePoint[] }) {
  const series = useMemo(
    () => data.map((d) => ({ ...d, label: formatMonth(d.period) })),
    [data],
  );
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="text-lg">Publishing velocity</CardTitle>
        <CardDescription>Posts published per month (last 12).</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={8} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
            <Bar dataKey="value" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function GrowthChart({ data }: { data: AnalyticsTimePoint[] }) {
  const series = useMemo(
    () => data.map((d) => ({ ...d, label: formatMonth(d.period) })),
    [data],
  );
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="text-lg">Content growth</CardTitle>
        <CardDescription>Cumulative posts over the last 12 months.</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={8} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
            <Tooltip content={<ChartTooltip />} />
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--primary)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function Leaderboard({
  title,
  description,
  rows,
  emptyLabel,
}: {
  title: string;
  description: string;
  rows: AnalyticsLeader[];
  emptyLabel: string;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.views), 0) || 1;
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {emptyLabel}
          </p>
        ) : (
          <ol className="space-y-2.5">
            {rows.map((row, i) => (
              <li key={`${row.slug}-${i}`} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="truncate text-sm font-medium">
                      {row.name || row.slug}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {nf(row.views)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted/60">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${Math.max(2, (row.views / max) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function StatGrid({ data }: { data: CmsAnalytics }) {
  const { views, seo, health } = data;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      <StatTile icon={Eye} label="Total views" value={nf(views.total)} />
      <StatTile
        icon={CalendarRange}
        label="Last 7 days"
        value={nf(views.last7Days)}
      />
      <StatTile
        icon={CalendarDays}
        label="Last 30 days"
        value={nf(views.last30Days)}
      />
      <StatTile
        icon={Gauge}
        label="Avg SEO score"
        value={seo.averageScore}
        tone={seo.averageScore >= 80 ? "good" : seo.averageScore < 50 ? "bad" : "warn"}
        hint={`across ${nf(seo.total)} posts`}
      />
      <StatTile
        icon={CheckCircle2}
        label="Fully optimized"
        value={nf(seo.fullyOptimized)}
        tone="good"
        hint="SEO score ≥ 80"
      />
      <StatTile
        icon={AlertTriangle}
        label="SEO needs work"
        value={nf(seo.needsWork)}
        tone={seo.needsWork > 0 ? "warn" : "good"}
        hint="SEO score < 50"
      />
      <StatTile
        icon={Unlink}
        label="Broken links"
        value={nf(health.brokenLinks)}
        tone={health.brokenLinks > 0 ? "bad" : "good"}
        hint={health.brokenLinks > 0 ? "Unresolved" : "All resolved"}
      />
      <StatTile
        icon={ShieldAlert}
        label="Validation failures"
        value={nf(health.validationFailures)}
        tone={health.validationFailures > 0 ? "bad" : "good"}
        hint={health.validationFailures > 0 ? "Failing checks" : "All passing"}
      />
      <StatTile
        icon={FileEdit}
        label="Drafts"
        value={nf(health.drafts)}
        hint="Unpublished posts"
      />
      <StatTile
        icon={CalendarClock}
        label="Scheduled"
        value={nf(health.scheduled)}
        hint="Future publish dates"
      />
    </div>
  );
}

export default function AnalyticsPage() {
  const { data, isLoading, isError, refetch, isFetching } =
    useGetCmsAnalytics();

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="font-serif text-4xl tracking-tight">Content analytics</h1>
          <p className="text-muted-foreground">
            How the blog is performing across views, SEO and content health.
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
              <p className="font-medium">Couldn't load analytics</p>
              <p className="text-sm text-muted-foreground">
                Something went wrong while fetching metrics.
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
            {Array.from({ length: 10 }).map((_, i) => (
              <StatTileSkeleton key={i} />
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCardSkeleton />
            <ChartCardSkeleton />
          </div>
        </>
      ) : (
        <>
          <StatGrid data={data} />

          <ViewsChart daily={data.views.daily} />

          <div className="grid gap-6 lg:grid-cols-2">
            <VelocityChart data={data.publishingVelocity} />
            <GrowthChart data={data.contentGrowth} />
          </div>

          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            <Leaderboard
              title="Top pages"
              description="Most-viewed articles."
              rows={data.topPages}
              emptyLabel="No views recorded yet."
            />
            <Leaderboard
              title="Top authors"
              description="Most-viewed by author."
              rows={data.topAuthors}
              emptyLabel="No views recorded yet."
            />
            <Leaderboard
              title="Top categories"
              description="Most-viewed by category."
              rows={data.topCategories}
              emptyLabel="No views recorded yet."
            />
            <Leaderboard
              title="Top tags"
              description="Most-viewed by tag."
              rows={data.topTags}
              emptyLabel="No views recorded yet."
            />
          </div>

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <BarChart3 className="size-3.5" />
            Snapshot generated {format(parseISO(data.generatedAt), "PPpp")}
          </p>
        </>
      )}
    </div>
  );
}
