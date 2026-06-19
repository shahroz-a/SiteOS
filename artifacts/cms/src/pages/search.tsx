import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  Bookmark,
  BookmarkPlus,
  Mail,
  Pencil,
  Search as SearchIcon,
  Trash2,
  Users,
} from "lucide-react";
import {
  useSearchCmsContent,
  useSearchReadiness,
  getSearchReadinessQueryKey,
  useListSavedViews,
  useCreateSavedView,
  useUpdateSavedView,
  useDeleteSavedView,
  getListSavedViewsQueryKey,
  type SavedView,
  type SearchReadiness,
  type SearchCmsContentParams,
  type SearchCmsContentStatus,
  type SearchCmsContentPageType,
  type SearchCmsContentSort,
} from "@workspace/api-client-react";
import { Badge } from "@workspace/ui/badge";
import { Button } from "@workspace/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/dialog";
import { Input } from "@workspace/ui/input";
import { Label } from "@workspace/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/select";
import { Skeleton } from "@workspace/ui/skeleton";
import { Switch } from "@workspace/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/table";
import { Textarea } from "@workspace/ui/textarea";
import { useToast } from "@workspace/ui";

const PAGE_SIZE = 20;
const ANY = "__any__";

const STATUS_OPTIONS: { value: SearchCmsContentStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

const PAGE_TYPE_OPTIONS: { value: SearchCmsContentPageType; label: string }[] = [
  { value: "post", label: "Post" },
  { value: "page", label: "Page" },
  { value: "category", label: "Category" },
  { value: "author", label: "Author" },
  { value: "tag", label: "Tag" },
  { value: "landing", label: "Landing" },
  { value: "web-story", label: "Web story" },
];

const SORT_OPTIONS: { value: SearchCmsContentSort; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "updated", label: "Recently updated" },
  { value: "published", label: "Recently published" },
  { value: "created", label: "Recently created" },
  { value: "title", label: "Title (A–Z)" },
];

const STATUS_VARIANT: Record<
  SearchCmsContentStatus,
  "default" | "secondary" | "outline"
> = {
  published: "default",
  draft: "secondary",
  archived: "outline",
};

interface SearchState {
  q: string;
  status: SearchCmsContentStatus | typeof ANY;
  pageType: SearchCmsContentPageType | typeof ANY;
  language: string;
  category: string;
  author: string;
  tag: string;
  sort: SearchCmsContentSort;
}

const INITIAL_STATE: SearchState = {
  q: "",
  status: ANY,
  pageType: ANY,
  language: "",
  category: "",
  author: "",
  tag: "",
  sort: "relevance",
};

/** Build the API params object from the current UI state. */
function toParams(state: SearchState, page: number): SearchCmsContentParams {
  const tags = state.tag
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const params: SearchCmsContentParams = { page, limit: PAGE_SIZE, sort: state.sort };
  if (state.q.trim()) params.q = state.q.trim();
  if (state.status !== ANY) params.status = state.status;
  if (state.pageType !== ANY) params.pageType = state.pageType;
  if (state.language.trim()) params.language = state.language.trim();
  if (state.category.trim()) params.category = state.category.trim();
  if (state.author.trim()) params.author = state.author.trim();
  if (tags.length > 0) params.tag = tags;
  return params;
}

/** Human-readable summary of the active filters in the current UI state. */
function describeFilters(state: SearchState): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (state.q.trim()) out.push({ label: "Search", value: state.q.trim() });
  if (state.status !== ANY) {
    const o = STATUS_OPTIONS.find((s) => s.value === state.status);
    out.push({ label: "Status", value: o?.label ?? state.status });
  }
  if (state.pageType !== ANY) {
    const o = PAGE_TYPE_OPTIONS.find((p) => p.value === state.pageType);
    out.push({ label: "Type", value: o?.label ?? state.pageType });
  }
  if (state.language.trim())
    out.push({ label: "Language", value: state.language.trim() });
  if (state.category.trim())
    out.push({ label: "Category", value: state.category.trim() });
  if (state.author.trim())
    out.push({ label: "Author", value: state.author.trim() });
  const tags = state.tag
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tags.length > 0) out.push({ label: "Tags", value: tags.join(", ") });
  if (state.sort !== "relevance") {
    const sort = SORT_OPTIONS.find((s) => s.value === state.sort);
    out.push({ label: "Sort", value: sort?.label ?? state.sort });
  }
  return out;
}

/** Coerce a persisted saved-view query blob back into UI state. */
function fromQuery(query: Record<string, unknown>): SearchState {
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const tag = Array.isArray(query.tag)
    ? query.tag.filter((t): t is string => typeof t === "string").join(", ")
    : str(query.tag);
  return {
    q: str(query.q),
    status: (str(query.status) || ANY) as SearchState["status"],
    pageType: (str(query.pageType) || ANY) as SearchState["pageType"],
    language: str(query.language),
    category: str(query.category),
    author: str(query.author),
    tag,
    sort: (str(query.sort) || "relevance") as SearchCmsContentSort,
  };
}

export default function SearchPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<SearchState>(INITIAL_STATE);
  const [applied, setApplied] = useState<SearchState>(INITIAL_STATE);
  const [page, setPage] = useState(1);
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [viewDescription, setViewDescription] = useState("");
  const [viewShared, setViewShared] = useState(false);
  const [editView, setEditView] = useState<SavedView | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [confirmUpdateFilters, setConfirmUpdateFilters] = useState(false);
  const [editShared, setEditShared] = useState(false);

  const params = useMemo(() => toParams(applied, page), [applied, page]);

  const { data, isLoading, isError, isFetching } = useSearchCmsContent(params);
  const savedViews = useListSavedViews();

  // Readiness of the CMS-search prerequisites (`pg_trgm` extension + trigram
  // indexes). The endpoint returns 200 with `ready: true` when search works
  // and 503 (which the fetch layer surfaces as an error carrying the same
  // payload) when prerequisites are missing.
  const readinessQuery = useSearchReadiness({
    query: {
      queryKey: getSearchReadinessQueryKey(),
      retry: false,
      refetchOnWindowFocus: false,
    },
  });
  const readiness: SearchReadiness | undefined =
    readinessQuery.data ??
    (readinessQuery.error?.status === 503
      ? (readinessQuery.error.data ?? undefined)
      : undefined);
  const searchUnavailable = readiness ? !readiness.ready : false;

  const createView = useCreateSavedView({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSavedViewsQueryKey() });
        setSaveOpen(false);
        setViewName("");
        setViewDescription("");
        setViewShared(false);
        toast({ title: "View saved" });
      },
      onError: () => {
        toast({
          title: "Could not save view",
          description: "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const updateView = useUpdateSavedView({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSavedViewsQueryKey() });
      },
      onError: () => {
        toast({
          title: "Could not update view",
          description: "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const deleteView = useDeleteSavedView({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSavedViewsQueryKey() });
        toast({ title: "View deleted" });
      },
      onError: () => {
        toast({ title: "Could not delete view", variant: "destructive" });
      },
    },
  });

  function runSearch() {
    setPage(1);
    setApplied(draft);
  }

  function resetSearch() {
    setDraft(INITIAL_STATE);
    setApplied(INITIAL_STATE);
    setPage(1);
  }

  function applyView(view: SavedView) {
    const next = fromQuery(view.query);
    setDraft(next);
    setApplied(next);
    setPage(1);
  }

  function saveCurrentView() {
    const name = viewName.trim();
    if (!name) return;
    const { page: _omit, limit: _omit2, ...query } = toParams(draft, 1);
    createView.mutate({
      data: {
        name,
        description: viewDescription.trim() || null,
        query,
        shared: viewShared,
      },
    });
  }

  function openEditView(view: SavedView) {
    setEditView(view);
    setEditName(view.name);
    setEditDescription(view.description ?? "");
    setEditShared(view.shared);
    setConfirmUpdateFilters(false);
  }

  function closeEditView() {
    setEditView(null);
    setConfirmUpdateFilters(false);
  }

  function saveEditedView() {
    if (!editView) return;
    const name = editName.trim();
    if (!name) return;
    updateView.mutate(
      {
        id: editView.id,
        data: {
          name,
          description: editDescription.trim() || null,
          shared: editShared,
        },
      },
      {
        onSuccess: () => {
          closeEditView();
          toast({ title: "View updated" });
        },
      },
    );
  }

  function updateViewToCurrentFilters() {
    if (!editView) return;
    const { page: _omit, limit: _omit2, ...query } = toParams(draft, 1);
    updateView.mutate(
      {
        id: editView.id,
        data: { query },
      },
      {
        onSuccess: () => {
          closeEditView();
          toast({ title: "View updated to current filters" });
        },
      },
    );
  }

  const items = data?.items ?? [];
  const pagination = data?.pagination;
  const totalPages = pagination?.totalPages ?? 1;
  const views = savedViews.data?.items ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-2">
        <h1 className="font-serif text-4xl tracking-tight">Search</h1>
        <p className="text-muted-foreground">
          Fuzzy search across every content field — titles, body, SEO, FAQs,
          links and more. Save filter combinations as views to reuse later.
        </p>
      </div>

      {searchUnavailable ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1 space-y-1">
            <p className="font-medium">Search is currently unavailable</p>
            <p>
              The database isn’t fully set up for search
              {readiness && !readiness.extensionPresent
                ? " (the pg_trgm extension is missing)"
                : readiness && readiness.missingIndexes.length > 0
                  ? ` (${readiness.missingIndexes.length} of ${readiness.expectedIndexCount} search ${
                      readiness.missingIndexes.length === 1 ? "index is" : "indexes are"
                    } missing)`
                  : ""}
              , so results may be incomplete or fail. Re-publishing the app
              usually restores it; if it persists, contact an administrator.
            </p>
          </div>
        </div>
      ) : null}

      <div className="space-y-4 rounded-lg border border-border/60 p-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={draft.q}
              onChange={(e) => setDraft({ ...draft, q: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
              }}
              placeholder="Search content…"
              className="pl-9"
            />
          </div>
          <Button onClick={runSearch} disabled={isFetching}>
            Search
          </Button>
          <Button variant="outline" onClick={resetSearch}>
            Reset
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select
              value={draft.status}
              onValueChange={(v) =>
                setDraft({ ...draft, status: v as SearchState["status"] })
              }
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

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Type</Label>
            <Select
              value={draft.pageType}
              onValueChange={(v) =>
                setDraft({ ...draft, pageType: v as SearchState["pageType"] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any type</SelectItem>
                {PAGE_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Sort</Label>
            <Select
              value={draft.sort}
              onValueChange={(v) =>
                setDraft({ ...draft, sort: v as SearchCmsContentSort })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Language</Label>
            <Input
              value={draft.language}
              onChange={(e) => setDraft({ ...draft, language: e.target.value })}
              placeholder="e.g. en"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Category slug</Label>
            <Input
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              placeholder="category-slug"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Author slug</Label>
            <Input
              value={draft.author}
              onChange={(e) => setDraft({ ...draft, author: e.target.value })}
              placeholder="author-slug"
            />
          </div>

          <div className="space-y-1.5 md:col-span-1 lg:col-span-2">
            <Label className="text-xs text-muted-foreground">
              Tags (comma-separated slugs)
            </Label>
            <Input
              value={draft.tag}
              onChange={(e) => setDraft({ ...draft, tag: e.target.value })}
              placeholder="tag-a, tag-b"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setSaveOpen(true)}
          >
            <BookmarkPlus className="h-4 w-4" />
            Save view
          </Button>
          {savedViews.isLoading ? (
            <Skeleton className="h-8 w-32" />
          ) : views.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              No saved views yet.
            </span>
          ) : (
            views.map((view) => (
              <div
                key={view.id}
                className="flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 py-1 pl-3 pr-1 text-sm"
              >
                <button
                  type="button"
                  className="flex items-center gap-1.5 font-medium hover:text-primary"
                  onClick={() => applyView(view)}
                  title={
                    view.isOwner
                      ? (view.description ?? undefined)
                      : [
                          view.description,
                          view.ownerName
                            ? `Shared by ${view.ownerName}`
                            : "Shared by a teammate",
                        ]
                          .filter(Boolean)
                          .join(" · ")
                  }
                >
                  {view.shared ? (
                    <Users className="h-3.5 w-3.5" />
                  ) : (
                    <Bookmark className="h-3.5 w-3.5" />
                  )}
                  {view.name}
                </button>
                {view.shared && view.isOwner ? (
                  <Badge
                    variant="secondary"
                    className="px-1.5 py-0 text-[10px] font-normal"
                  >
                    Shared
                  </Badge>
                ) : null}
                {view.isOwner ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-primary"
                      onClick={() => openEditView(view)}
                      title="Edit view"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      disabled={
                        deleteView.isPending &&
                        deleteView.variables?.id === view.id
                      }
                      onClick={() => deleteView.mutate({ id: view.id })}
                      title="Delete view"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : view.ownerEmail ? (
                  <a
                    href={`mailto:${view.ownerEmail}?subject=${encodeURIComponent(
                      `Question about your shared view "${view.name}"`,
                    )}`}
                    title={`Email ${view.ownerName ?? "the owner"} (${view.ownerEmail}) about this view`}
                  >
                    <Badge
                      variant="outline"
                      className="flex items-center gap-1 px-1.5 py-0 text-[10px] font-normal transition-colors hover:bg-muted hover:text-primary"
                    >
                      {view.ownerImageUrl ? (
                        <img
                          src={view.ownerImageUrl}
                          alt=""
                          className="h-3.5 w-3.5 rounded-full object-cover"
                        />
                      ) : null}
                      {view.ownerName ?? "Team"}
                      <Mail className="h-3 w-3" />
                    </Badge>
                  </a>
                ) : (
                  <Badge
                    variant="outline"
                    className="flex items-center gap-1 px-1.5 py-0 text-[10px] font-normal"
                    title={
                      view.ownerName
                        ? `Shared by ${view.ownerName}`
                        : "Shared by a teammate"
                    }
                  >
                    {view.ownerImageUrl ? (
                      <img
                        src={view.ownerImageUrl}
                        alt=""
                        className="h-3.5 w-3.5 rounded-full object-cover"
                      />
                    ) : null}
                    {view.ownerName ?? "Team"}
                  </Badge>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead className="w-28">Type</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-40">Author</TableHead>
              <TableHead className="w-36 text-right">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-5 w-64" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="ml-auto h-4 w-24" />
                  </TableCell>
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-muted-foreground"
                >
                  {searchUnavailable
                    ? "Search is unavailable — see the notice above."
                    : "Search failed. Please try again."}
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-muted-foreground"
                >
                  No matching content.
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.id} className="align-top">
                  <TableCell>
                    <div className="font-medium">{item.title}</div>
                    {item.excerpt ? (
                      <div className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                        {item.excerpt}
                      </div>
                    ) : null}
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {item.pathname}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-normal">
                      {item.pageType}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={STATUS_VARIANT[item.status]}
                      className="font-normal capitalize"
                    >
                      {item.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {item.author?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {format(new Date(item.updatedAt), "MMM d, yyyy")}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {pagination && pagination.total > 0 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {pagination.page} of {totalPages} · {pagination.total}{" "}
            {pagination.total === 1 ? "result" : "results"}
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

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save this view</DialogTitle>
            <DialogDescription>
              Saves the current search query, filters and sort so you can reuse
              them later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="view-name">Name</Label>
              <Input
                id="view-name"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                placeholder="e.g. Draft posts needing SEO"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="view-description">Description (optional)</Label>
              <Textarea
                id="view-description"
                value={viewDescription}
                onChange={(e) => setViewDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex items-start justify-between gap-4 rounded-md border border-border/60 bg-muted/30 p-3">
              <div className="space-y-0.5">
                <Label htmlFor="view-shared" className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  Share with the team
                </Label>
                <p className="text-sm text-muted-foreground">
                  Other CMS users can see and apply this view. Only you can
                  rename, edit or delete it.
                </p>
              </div>
              <Switch
                id="view-shared"
                checked={viewShared}
                onCheckedChange={setViewShared}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={saveCurrentView}
              disabled={!viewName.trim() || createView.isPending}
            >
              Save view
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editView !== null}
        onOpenChange={(open) => {
          if (!open) closeEditView();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit view</DialogTitle>
            <DialogDescription>
              Rename this view or update its description. You can also overwrite
              its saved filters with the ones currently in the form above.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-view-name">Name</Label>
              <Input
                id="edit-view-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="e.g. Draft posts needing SEO"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-view-description">
                Description (optional)
              </Label>
              <Textarea
                id="edit-view-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex items-start justify-between gap-4 rounded-md border border-border/60 bg-muted/30 p-3">
              <div className="space-y-0.5">
                <Label
                  htmlFor="edit-view-shared"
                  className="flex items-center gap-1.5"
                >
                  <Users className="h-3.5 w-3.5" />
                  Share with the team
                </Label>
                <p className="text-sm text-muted-foreground">
                  Other CMS users can see and apply this view. Only you can
                  rename, edit or delete it.
                </p>
              </div>
              <Switch
                id="edit-view-shared"
                checked={editShared}
                onCheckedChange={setEditShared}
              />
            </div>
            <div className="rounded-md border border-border/60 bg-muted/30 p-3">
              <p className="text-sm font-medium">Filters</p>
              {confirmUpdateFilters ? (
                <>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    This replaces the view's saved filters with the ones below.
                    Saving the name or description alone won't touch them.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {describeFilters(draft).length === 0 ? (
                      <span className="text-sm text-muted-foreground">
                        No filters — saves an empty view (all content).
                      </span>
                    ) : (
                      describeFilters(draft).map((f) => (
                        <Badge
                          key={f.label}
                          variant="secondary"
                          className="font-normal"
                        >
                          <span className="font-medium">{f.label}:</span>&nbsp;
                          {f.value}
                        </Badge>
                      ))
                    )}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      onClick={updateViewToCurrentFilters}
                      disabled={updateView.isPending}
                    >
                      Confirm overwrite
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmUpdateFilters(false)}
                      disabled={updateView.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Overwrite this view's saved filters with the search and
                    filters currently in the form above.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => setConfirmUpdateFilters(true)}
                    disabled={updateView.isPending}
                  >
                    Update to current filters
                  </Button>
                </>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeEditView}>
              Cancel
            </Button>
            <Button
              onClick={saveEditedView}
              disabled={!editName.trim() || updateView.isPending}
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
