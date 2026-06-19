import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { format } from "date-fns";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarClock,
  ChevronsUpDown,
  Download,
  FolderTree,
  Search as SearchIcon,
  Send,
  Tag as TagIcon,
  UserPen,
} from "lucide-react";
import {
  useListContentExplorer,
  useBulkTransitionContent,
  useBulkUpdateContentCategory,
  useBulkUpdateContentAuthor,
  useBulkUpdateContentSeo,
  useBulkExportContent,
  useListCmsCategories,
  useListCmsAuthors,
  getListContentExplorerQueryKey,
  getListCmsCategoriesQueryKey,
  getListCmsAuthorsQueryKey,
  type ContentExplorerItem,
  type ListContentExplorerParams,
  type ListContentExplorerSort,
  type ListContentExplorerOrder,
  type PageStatus,
  type BulkActionResult,
} from "@workspace/api-client-react";
import { Badge } from "@workspace/ui/badge";
import { Button } from "@workspace/ui/button";
import { Checkbox } from "@workspace/ui/checkbox";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@workspace/ui/hover-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/dropdown-menu";
import { Input } from "@workspace/ui/input";
import { Label } from "@workspace/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/select";
import { useToast } from "@workspace/ui";
import { useCmsAuth } from "@/lib/cms-auth-context";

const PAGE_SIZE = 50;
const ANY = "__any__";
const NONE = "__none__";
const ROW_HEIGHT = 52;

const STATUS_OPTIONS: { value: PageStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "review", label: "Review" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

const STATUS_VARIANT: Record<PageStatus, "default" | "secondary" | "outline"> = {
  published: "default",
  scheduled: "secondary",
  review: "secondary",
  draft: "outline",
  archived: "outline",
};

// Bulk lifecycle targets offered in the toolbar. `scheduled` opens a date picker.
const TRANSITION_OPTIONS: { value: PageStatus; label: string }[] = [
  { value: "published", label: "Publish" },
  { value: "scheduled", label: "Schedule…" },
  { value: "review", label: "Move to review" },
  { value: "draft", label: "Move to draft" },
  { value: "archived", label: "Archive" },
];

interface SortColumn {
  key: ListContentExplorerSort;
  label: string;
  className: string;
  numeric?: boolean;
}

// Column layout shared by the header row and every virtualized body row, so they
// stay aligned. The leading checkbox column is added separately.
const COLUMNS: SortColumn[] = [
  { key: "title", label: "Title", className: "min-w-0 flex-1" },
  { key: "slug", label: "Slug", className: "w-48 shrink-0" },
  { key: "status", label: "Status", className: "w-28 shrink-0" },
  { key: "modified", label: "Modified", className: "w-28 shrink-0" },
  { key: "published", label: "Published", className: "w-28 shrink-0" },
  { key: "seo", label: "SEO", className: "w-20 shrink-0 text-right", numeric: true },
  {
    key: "validation",
    label: "Valid.",
    className: "w-20 shrink-0 text-right",
    numeric: true,
  },
];

interface FilterState {
  q: string;
  status: PageStatus | typeof ANY;
  author: string;
  category: string;
}

const INITIAL_FILTERS: FilterState = { q: "", status: ANY, author: "", category: "" };

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : format(d, "MMM d, yyyy");
}

function scoreClass(score: number): string {
  if (score >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 40) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

const SEVERITY_LABEL: Record<string, string> = {
  error: "Critical",
  warn: "Warning",
  info: "Suggestion",
};

const SEVERITY_DOT: Record<string, string> = {
  error: "bg-rose-500",
  warn: "bg-amber-500",
  info: "bg-sky-500",
};

const VALIDATION_STATUS_LABEL: Record<string, string> = {
  pass: "Passing",
  warn: "Has warnings",
  fail: "Failing",
};

/** Hover drill-down for a row's SEO completeness score. */
function SeoScoreCell({ item }: { item: ContentExplorerItem }) {
  const missing = item.seoFactors.filter((f) => !f.present);
  return (
    <HoverCard openDelay={120} closeDelay={60}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className={`w-20 shrink-0 text-right font-medium underline decoration-dotted decoration-muted-foreground/40 underline-offset-4 ${scoreClass(item.seoScore)}`}
        >
          {item.seoScore}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-72">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">SEO completeness</span>
          <span className={`text-sm font-semibold ${scoreClass(item.seoScore)}`}>
            {item.seoScore}/100
          </span>
        </div>
        <ul className="space-y-1.5">
          {item.seoFactors.map((f) => (
            <li key={f.id} className="flex items-center gap-2 text-xs">
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  f.present
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                }`}
              >
                {f.present ? "✓" : "✕"}
              </span>
              <span className={f.present ? "text-muted-foreground" : "font-medium"}>
                {f.label}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {missing.length === 0
            ? "All SEO fields are filled in."
            : `${missing.length} field${missing.length === 1 ? "" : "s"} missing · 20 points each.`}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}

/** Hover drill-down for a row's latest validation score / failing checks. */
function ValidationScoreCell({ item }: { item: ContentExplorerItem }) {
  const score = item.validationScore;
  const trigger =
    score == null ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      <span className={scoreClass(score)}>{score}</span>
    );

  if (score == null) {
    return (
      <HoverCard openDelay={120} closeDelay={60}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            className="w-20 shrink-0 text-right font-medium underline decoration-dotted decoration-muted-foreground/40 underline-offset-4"
          >
            {trigger}
          </button>
        </HoverCardTrigger>
        <HoverCardContent align="end" className="w-72">
          <p className="text-sm font-medium">Not validated yet</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            No validation report exists for this article. It runs automatically on
            the next publish attempt.
          </p>
        </HoverCardContent>
      </HoverCard>
    );
  }

  const issues = item.validationIssues;
  const statusLabel = item.validationStatus
    ? VALIDATION_STATUS_LABEL[item.validationStatus] ?? item.validationStatus
    : null;

  return (
    <HoverCard openDelay={120} closeDelay={60}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="w-20 shrink-0 text-right font-medium underline decoration-dotted decoration-muted-foreground/40 underline-offset-4"
        >
          {trigger}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-80">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">
            Validation{statusLabel ? ` · ${statusLabel}` : ""}
          </span>
          <span className={`text-sm font-semibold ${scoreClass(score)}`}>
            {score}/100
          </span>
        </div>
        {issues.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            All checks passed in the latest report.
          </p>
        ) : (
          <ul className="space-y-2">
            {issues.map((issue) => (
              <li key={issue.id} className="flex items-start gap-2 text-xs">
                <span
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                    SEVERITY_DOT[issue.severity] ?? "bg-muted-foreground"
                  }`}
                />
                <span>
                  <span className="font-medium">{issue.label}</span>
                  <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {SEVERITY_LABEL[issue.severity] ?? issue.severity}
                  </span>
                  {issue.message ? (
                    <span className="block text-muted-foreground">{issue.message}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

/** Summarize a bulk action's per-id result as a toast description. */
function describeResult(result: BulkActionResult): string {
  const ok = result.succeeded.length;
  const failed = result.failed.length;
  if (failed === 0) return `${ok} updated.`;
  const firstError = result.failed[0]?.error;
  return `${ok} updated, ${failed} failed${firstError ? ` — e.g. ${firstError}` : ""}.`;
}

export default function ContentExplorerPage() {
  const { toast } = useToast();
  const { can } = useCmsAuth();
  const queryClient = useQueryClient();

  const canEdit = can("content.edit");
  const canPublish = can("content.publish");
  const canSeo = can("seo.edit");

  const [draft, setDraft] = useState<FilterState>(INITIAL_FILTERS);
  const [applied, setApplied] = useState<FilterState>(INITIAL_FILTERS);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<ListContentExplorerSort>("updated");
  const [order, setOrder] = useState<ListContentExplorerOrder>("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Dialog state for the input-requiring bulk actions.
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryChoice, setCategoryChoice] = useState<string>(NONE);
  const [authorOpen, setAuthorOpen] = useState(false);
  const [authorChoice, setAuthorChoice] = useState<string>(NONE);
  const [seoOpen, setSeoOpen] = useState(false);
  const [seoFields, setSeoFields] = useState({
    metaTitle: "",
    metaDescription: "",
    focusKeyword: "",
    robots: "",
  });

  const params = useMemo<ListContentExplorerParams>(() => {
    const p: ListContentExplorerParams = { page, limit: PAGE_SIZE, sort, order };
    if (applied.q.trim()) p.q = applied.q.trim();
    if (applied.status !== ANY) p.status = applied.status;
    if (applied.author.trim()) p.author = applied.author.trim();
    if (applied.category.trim()) p.category = applied.category.trim();
    return p;
  }, [applied, page, sort, order]);

  const { data, isLoading, isError, isFetching } = useListContentExplorer(params);
  const categoriesQuery = useListCmsCategories({
    query: { enabled: canEdit, queryKey: getListCmsCategoriesQueryKey() },
  });
  const authorsQuery = useListCmsAuthors({
    query: { enabled: canEdit, queryKey: getListCmsAuthorsQueryKey() },
  });

  const items = data?.items ?? [];
  const pagination = data?.pagination;
  const totalPages = pagination?.totalPages ?? 1;

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getListContentExplorerQueryKey(),
    });

  const onBulkSuccess = (title: string) => (result: BulkActionResult) => {
    invalidate();
    setSelected(new Set());
    toast({ title, description: describeResult(result) });
  };

  const onBulkError = () =>
    toast({ title: "Bulk action failed", description: "Please try again.", variant: "destructive" });

  const transition = useBulkTransitionContent({
    mutation: { onSuccess: onBulkSuccess("Lifecycle updated"), onError: onBulkError },
  });
  const setCategory = useBulkUpdateContentCategory({
    mutation: {
      onSuccess: (r) => {
        onBulkSuccess("Category updated")(r);
        setCategoryOpen(false);
      },
      onError: onBulkError,
    },
  });
  const setAuthor = useBulkUpdateContentAuthor({
    mutation: {
      onSuccess: (r) => {
        onBulkSuccess("Author updated")(r);
        setAuthorOpen(false);
      },
      onError: onBulkError,
    },
  });
  const setSeo = useBulkUpdateContentSeo({
    mutation: {
      onSuccess: (r) => {
        onBulkSuccess("SEO updated")(r);
        setSeoOpen(false);
        setSeoFields({ metaTitle: "", metaDescription: "", focusKeyword: "", robots: "" });
      },
      onError: onBulkError,
    },
  });
  const exporter = useBulkExportContent({
    mutation: {
      onSuccess: ({ filename, contentType, content }) => {
        const blob = new Blob([content], { type: contentType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        toast({ title: "Export ready", description: filename });
      },
      onError: onBulkError,
    },
  });

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const anySelected = selectedIds.length > 0;
  const busy =
    transition.isPending ||
    setCategory.isPending ||
    setAuthor.isPending ||
    setSeo.isPending ||
    exporter.isPending;

  const pageIds = items.map((i) => i.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPageSelected = pageIds.some((id) => selected.has(id));

  function applyFilters() {
    setPage(1);
    setApplied(draft);
  }

  function resetFilters() {
    setDraft(INITIAL_FILTERS);
    setApplied(INITIAL_FILTERS);
    setPage(1);
  }

  function toggleSort(key: ListContentExplorerSort) {
    if (sort === key) {
      setOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      setOrder(key === "title" || key === "slug" || key === "status" ? "asc" : "desc");
    }
    setPage(1);
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function runTransition(to: PageStatus) {
    if (to === "scheduled") {
      setScheduleOpen(true);
      return;
    }
    transition.mutate({ data: { ids: selectedIds, to } });
  }

  function confirmSchedule() {
    if (!scheduleAt) return;
    const when = new Date(scheduleAt);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      toast({
        title: "Pick a future date",
        description: "Scheduled publishing needs a date in the future.",
        variant: "destructive",
      });
      return;
    }
    transition.mutate(
      { data: { ids: selectedIds, to: "scheduled", scheduledFor: when.toISOString() } },
      {
        onSuccess: () => {
          setScheduleOpen(false);
          setScheduleAt("");
        },
      },
    );
  }

  function confirmCategory() {
    setCategory.mutate({
      data: { ids: selectedIds, categoryId: categoryChoice === NONE ? null : categoryChoice },
    });
  }

  function confirmAuthor() {
    setAuthor.mutate({
      data: { ids: selectedIds, authorId: authorChoice === NONE ? null : authorChoice },
    });
  }

  function confirmSeo() {
    const data: Record<string, string> = {};
    if (seoFields.metaTitle.trim()) data.metaTitle = seoFields.metaTitle.trim();
    if (seoFields.metaDescription.trim()) data.metaDescription = seoFields.metaDescription.trim();
    if (seoFields.focusKeyword.trim()) data.focusKeyword = seoFields.focusKeyword.trim();
    if (seoFields.robots.trim()) data.robots = seoFields.robots.trim();
    if (Object.keys(data).length === 0) {
      toast({ title: "Nothing to apply", description: "Fill at least one field." });
      return;
    }
    setSeo.mutate({ data: { ids: selectedIds, ...data } });
  }

  function runExport(fmt: "json" | "csv") {
    exporter.mutate({ data: { ids: selectedIds, format: fmt } });
  }

  // Virtualized body.
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const categories = categoriesQuery.data ?? [];
  const authors = authorsQuery.data ?? [];

  return (
    <div className="mx-auto flex h-[calc(100vh-7rem)] max-w-[1400px] flex-col space-y-4">
      <div className="space-y-1">
        <h1 className="font-serif text-4xl tracking-tight">Content Explorer</h1>
        <p className="text-muted-foreground">
          Browse, sort, filter and bulk-manage every article. Select rows to act
          on many at once.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border/60 p-3">
        <div className="relative min-w-[220px] flex-1">
          <Label className="mb-1.5 block text-xs text-muted-foreground">
            Title or slug
          </Label>
          <SearchIcon className="absolute left-3 top-[34px] h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={draft.q}
            onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyFilters();
            }}
            placeholder="Search…"
            className="pl-9"
          />
        </div>
        <div className="w-40 space-y-1.5">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select
            value={draft.status}
            onValueChange={(v) => setDraft({ ...draft, status: v as FilterState["status"] })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any status</SelectItem>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40 space-y-1.5">
          <Label className="text-xs text-muted-foreground">Category slug</Label>
          <Input
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyFilters();
            }}
            placeholder="category-slug"
          />
        </div>
        <div className="w-40 space-y-1.5">
          <Label className="text-xs text-muted-foreground">Author slug</Label>
          <Input
            value={draft.author}
            onChange={(e) => setDraft({ ...draft, author: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyFilters();
            }}
            placeholder="author-slug"
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={applyFilters} disabled={isFetching}>
            Apply
          </Button>
          <Button variant="outline" onClick={resetFilters}>
            Reset
          </Button>
        </div>
      </div>

      {/* Bulk toolbar */}
      {anySelected ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-sm font-medium">
            {selectedIds.length} selected
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
            className="text-muted-foreground"
          >
            Clear
          </Button>
          <div className="mx-1 h-5 w-px bg-border" />

          {(canEdit || canPublish) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={busy}>
                  <Send className="h-4 w-4" />
                  Lifecycle
                  <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Move selected to…</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {TRANSITION_OPTIONS.map((o) => (
                  <DropdownMenuItem key={o.value} onClick={() => runTransition(o.value)}>
                    {o.value === "scheduled" ? (
                      <CalendarClock className="h-4 w-4" />
                    ) : null}
                    {o.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {canEdit && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setCategoryChoice(NONE);
                  setCategoryOpen(true);
                }}
              >
                <FolderTree className="h-4 w-4" />
                Category
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setAuthorChoice(NONE);
                  setAuthorOpen(true);
                }}
              >
                <UserPen className="h-4 w-4" />
                Author
              </Button>
            </>
          )}

          {canSeo && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setSeoOpen(true)}
            >
              <TagIcon className="h-4 w-4" />
              SEO
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={busy}>
                <Download className="h-4 w-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => runExport("json")}>JSON</DropdownMenuItem>
              <DropdownMenuItem onClick={() => runExport("csv")}>CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}

      {/* Table */}
      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border/60">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border/60 bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
          <div className="w-5 shrink-0">
            <Checkbox
              checked={
                allOnPageSelected ? true : someOnPageSelected ? "indeterminate" : false
              }
              onCheckedChange={toggleAllOnPage}
              aria-label="Select all on page"
            />
          </div>
          {COLUMNS.map((col) => {
            const active = sort === col.key;
            return (
              <button
                key={col.key}
                type="button"
                onClick={() => toggleSort(col.key)}
                className={`flex items-center gap-1 hover:text-foreground ${col.className} ${
                  col.numeric ? "justify-end" : ""
                }`}
              >
                {col.label}
                {active ? (
                  order === "asc" ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : (
                    <ArrowDown className="h-3 w-3" />
                  )
                ) : (
                  <ArrowUpDown className="h-3 w-3 opacity-40" />
                )}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          {isLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-9 animate-pulse rounded bg-muted/60" />
              ))}
            </div>
          ) : isError ? (
            <div className="py-16 text-center text-muted-foreground">
              Failed to load content. Please try again.
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              No matching articles.
            </div>
          ) : (
            <div
              style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}
            >
              {rowVirtualizer.getVirtualItems().map((vRow) => {
                const item: ContentExplorerItem = items[vRow.index]!;
                const isSel = selected.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={`absolute left-0 flex w-full items-center gap-3 border-b border-border/40 px-3 text-sm ${
                      isSel ? "bg-primary/5" : "hover:bg-muted/40"
                    }`}
                    style={{
                      height: vRow.size,
                      transform: `translateY(${vRow.start}px)`,
                    }}
                  >
                    <div className="w-5 shrink-0">
                      <Checkbox
                        checked={isSel}
                        onCheckedChange={() => toggleRow(item.id)}
                        aria-label={`Select ${item.title}`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <a
                        href={item.canonicalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate font-medium hover:text-primary hover:underline"
                        title={item.title}
                      >
                        {item.title}
                      </a>
                      <div className="truncate text-xs text-muted-foreground">
                        {item.author?.name ?? "No author"}
                        {item.primaryCategory ? ` · ${item.primaryCategory.name}` : ""}
                      </div>
                    </div>
                    <div className="w-48 shrink-0 truncate text-xs text-muted-foreground" title={item.slug}>
                      {item.slug}
                    </div>
                    <div className="w-28 shrink-0">
                      <Badge
                        variant={STATUS_VARIANT[item.status]}
                        className="font-normal capitalize"
                      >
                        {item.status}
                      </Badge>
                    </div>
                    <div className="w-28 shrink-0 text-xs text-muted-foreground">
                      {fmtDate(item.modifiedAt)}
                    </div>
                    <div className="w-28 shrink-0 text-xs text-muted-foreground">
                      {item.status === "scheduled" && item.scheduledFor
                        ? `→ ${fmtDate(item.scheduledFor)}`
                        : fmtDate(item.publishedAt)}
                    </div>
                    <SeoScoreCell item={item} />
                    <ValidationScoreCell item={item} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer / pagination */}
        <div className="flex items-center justify-between border-t border-border/60 px-3 py-2 text-sm text-muted-foreground">
          <span>
            {pagination
              ? `Page ${pagination.page} of ${totalPages} · ${pagination.total} ${
                  pagination.total === 1 ? "article" : "articles"
                }`
              : "—"}
          </span>
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
      </div>

      {/* Schedule dialog */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule publishing</DialogTitle>
            <DialogDescription>
              Publish {selectedIds.length} selected{" "}
              {selectedIds.length === 1 ? "article" : "articles"} at a future
              date and time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
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
            <Button onClick={confirmSchedule} disabled={transition.isPending}>
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category dialog */}
      <Dialog open={categoryOpen} onOpenChange={setCategoryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set primary category</DialogTitle>
            <DialogDescription>
              Apply to {selectedIds.length} selected{" "}
              {selectedIds.length === 1 ? "article" : "articles"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={categoryChoice} onValueChange={setCategoryChoice}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Clear category</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoryOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmCategory} disabled={setCategory.isPending}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Author dialog */}
      <Dialog open={authorOpen} onOpenChange={setAuthorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set author</DialogTitle>
            <DialogDescription>
              Apply to {selectedIds.length} selected{" "}
              {selectedIds.length === 1 ? "article" : "articles"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Author</Label>
            <Select value={authorChoice} onValueChange={setAuthorChoice}>
              <SelectTrigger>
                <SelectValue placeholder="Choose an author" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Clear author</SelectItem>
                {authors.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAuthorOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmAuthor} disabled={setAuthor.isPending}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SEO dialog */}
      <Dialog open={seoOpen} onOpenChange={setSeoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk SEO update</DialogTitle>
            <DialogDescription>
              Only filled fields are applied to the {selectedIds.length} selected{" "}
              {selectedIds.length === 1 ? "article" : "articles"}; blank fields
              are left untouched.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="seo-meta-title">Meta title</Label>
              <Input
                id="seo-meta-title"
                value={seoFields.metaTitle}
                onChange={(e) => setSeoFields({ ...seoFields, metaTitle: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seo-meta-desc">Meta description</Label>
              <Input
                id="seo-meta-desc"
                value={seoFields.metaDescription}
                onChange={(e) =>
                  setSeoFields({ ...seoFields, metaDescription: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seo-focus">Focus keyword</Label>
              <Input
                id="seo-focus"
                value={seoFields.focusKeyword}
                onChange={(e) => setSeoFields({ ...seoFields, focusKeyword: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seo-robots">Robots</Label>
              <Input
                id="seo-robots"
                value={seoFields.robots}
                onChange={(e) => setSeoFields({ ...seoFields, robots: e.target.value })}
                placeholder="e.g. index,follow"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSeoOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmSeo} disabled={setSeo.isPending}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
