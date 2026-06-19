import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Bookmark, BookmarkPlus, Search as SearchIcon, Trash2 } from "lucide-react";
import {
  useSearchCmsContent,
  useListSavedViews,
  useCreateSavedView,
  useDeleteSavedView,
  getListSavedViewsQueryKey,
  type SavedView,
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

  const params = useMemo(() => toParams(applied, page), [applied, page]);

  const { data, isLoading, isError, isFetching } = useSearchCmsContent(params);
  const savedViews = useListSavedViews();

  const createView = useCreateSavedView({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSavedViewsQueryKey() });
        setSaveOpen(false);
        setViewName("");
        setViewDescription("");
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
      },
    });
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
                  title={view.description ?? undefined}
                >
                  <Bookmark className="h-3.5 w-3.5" />
                  {view.name}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  disabled={
                    deleteView.isPending && deleteView.variables?.id === view.id
                  }
                  onClick={() => deleteView.mutate({ id: view.id })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
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
                  Search failed. Please try again.
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
    </div>
  );
}
