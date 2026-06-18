import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  useListPosts,
  useListCategories,
  useListAuthors,
  useListTags,
  useSearchPosts,
  getListPostsQueryKey,
  getSearchPostsQueryKey,
} from "@workspace/api-client-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { NewsletterCTA } from "@/components/NewsletterCTA";
import { PostCard } from "@/components/PostCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Search,
  X,
} from "lucide-react";
import { useSeo } from "@/lib/seo";

const PAGE_SIZE = 9;
const ALL = "__all__";

export default function PostList() {
  const [, navigate] = useLocation();
  const search = useSearch();

  // The URL is the single source of truth for every listing control, so any
  // filtered/searched view is shareable and survives a reload.
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const tag = params.get("tag") ?? undefined;
  const category = params.get("category") ?? undefined;
  const author = params.get("author") ?? undefined;
  const query = params.get("q") ?? "";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);

  const [searchInput, setSearchInput] = useState(query);

  const { data: categories } = useListCategories();
  const { data: authors } = useListAuthors();
  const { data: tags } = useListTags();

  // Build a title/description/canonical that reflect the active filter or
  // search so shared links read descriptively and search engines don't treat
  // every filtered view as duplicate content.
  const seoMeta = useMemo(() => {
    const SITE = "Headout Blog";
    let title = `${SITE} — Travel guides, tips & destination ideas`;
    let description =
      "Explore travel guides, destination deep-dives and trip-planning tips from the Headout Blog.";

    if (query) {
      title = `Search results for “${query}” — ${SITE}`;
      description = `Articles matching “${query}” on the ${SITE}.`;
    } else if (category) {
      const name = categories?.find((c) => c.slug === category)?.name ?? category;
      title = `${name} — ${SITE}`;
      description = `Travel guides and destination ideas about ${name} from the ${SITE}.`;
    } else if (author) {
      const name = authors?.find((a) => a.slug === author)?.name ?? author;
      title = `Articles by ${name} — ${SITE}`;
      description = `Read travel guides and stories written by ${name} on the ${SITE}.`;
    } else if (tag) {
      const name = tags?.find((t) => t.slug === tag)?.name ?? tag;
      title = `${name} — ${SITE}`;
      description = `Browse ${SITE} articles tagged “${name}”.`;
    }

    // Canonical: origin + base path + the meaningful filter/search params
    // (page included only past page 1). Keeps a stable, deduplicated URL.
    let canonical: string | undefined;
    if (typeof window !== "undefined") {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const canonicalParams = new URLSearchParams();
      if (query) canonicalParams.set("q", query);
      if (category) canonicalParams.set("category", category);
      if (author) canonicalParams.set("author", author);
      if (tag) canonicalParams.set("tag", tag);
      if (page > 1) canonicalParams.set("page", String(page));
      const qs = canonicalParams.toString();
      canonical = `${window.location.origin}${base}/${qs ? `?${qs}` : ""}`;
    }

    return { title, description, canonical };
  }, [query, category, author, tag, page, categories, authors, tags]);

  useSeo(seoMeta);

  // Apply a partial update to the URL search params. Removing/clearing a value
  // is done by passing undefined. Resetting to page 1 is the caller's job (pass
  // page: undefined) whenever a filter or the query changes.
  const updateParams = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    navigate(qs ? `/?${qs}` : "/");
  };

  // Debounce the search box, then push the trimmed query into the URL.
  useEffect(() => {
    const handle = setTimeout(() => {
      const trimmed = searchInput.trim();
      if (trimmed !== query) {
        updateParams({ q: trimmed || undefined, page: undefined });
      }
    }, 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, query]);

  // Reflect external query changes (clear search, back/forward) in the input.
  useEffect(() => {
    setSearchInput((current) =>
      current.trim() === query ? current : query,
    );
  }, [query]);

  const isSearching = query.length > 0;

  const listParams = { page, limit: PAGE_SIZE, category, author, tag };
  const searchParams = { q: query, page, limit: PAGE_SIZE };

  const listQuery = useListPosts(listParams, {
    query: { enabled: !isSearching, queryKey: getListPostsQueryKey(listParams) },
  });
  const searchQuery = useSearchPosts(searchParams, {
    query: {
      enabled: isSearching,
      queryKey: getSearchPostsQueryKey(searchParams),
    },
  });

  const { data, isLoading, isError, error } = isSearching
    ? searchQuery
    : listQuery;

  const selectCategory = (slug?: string) => {
    updateParams({ category: slug, page: undefined });
  };

  const selectAuthor = (slug?: string) => {
    updateParams({ author: slug, page: undefined });
  };

  const selectTag = (slug?: string) => {
    updateParams({ tag: slug, page: undefined });
  };

  const goToPage = (p: number) => {
    updateParams({ page: p <= 1 ? undefined : String(p) });
  };

  const clearSearch = () => {
    setSearchInput("");
    updateParams({ q: undefined, page: undefined });
  };

  const pagination = data?.pagination;
  const totalPages = pagination?.totalPages ?? 1;
  const totalResults = pagination?.total ?? data?.items.length;

  // Build the set of currently-applied filters as removable chips. Search and
  // the category/author/tag filters are mutually exclusive (search ignores
  // them), so we only surface whichever set is active.
  const categoryName =
    categories?.find((c) => c.slug === category)?.name ?? category;
  const authorName = authors?.find((a) => a.slug === author)?.name ?? author;
  const tagName = tags?.find((t) => t.slug === tag)?.name ?? tag;

  const activeFilters: {
    key: string;
    prefix: string;
    label: string;
    onRemove: () => void;
  }[] = [];
  if (isSearching) {
    if (query)
      activeFilters.push({
        key: "q",
        prefix: "Search",
        label: `“${query}”`,
        onRemove: clearSearch,
      });
  } else {
    if (category && categoryName)
      activeFilters.push({
        key: "category",
        prefix: "Category",
        label: categoryName,
        onRemove: () => selectCategory(undefined),
      });
    if (author && authorName)
      activeFilters.push({
        key: "author",
        prefix: "Writer",
        label: authorName,
        onRemove: () => selectAuthor(undefined),
      });
    if (tag && tagName)
      activeFilters.push({
        key: "tag",
        prefix: "Tag",
        label: tagName,
        onRemove: () => selectTag(undefined),
      });
  }

  return (
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/20">
      <Header />

      {/* Masthead */}
      <section className="relative w-full overflow-hidden bg-foreground text-background">
        <div className="relative max-w-4xl mx-auto px-6 lg:px-12 py-20 md:py-28 text-center">
          <p className="text-xs md:text-sm font-semibold uppercase tracking-widest text-primary mb-5">
            The Headout Blog
          </p>
          <h1 className="font-serif text-3xl md:text-5xl lg:text-6xl leading-tight text-background mb-6">
            Travel stories worth the trip
          </h1>
          <p className="text-sm md:text-base text-background/70 max-w-2xl mx-auto">
            Guides, tips and destination ideas to help you plan your next family
            adventure.
          </p>
        </div>
      </section>

      <main className="flex-1 w-full max-w-7xl mx-auto px-6 lg:px-12 py-12 md:py-16">
        {/* Search */}
        <div className="relative max-w-xl mx-auto mb-8">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search articles…"
            aria-label="Search articles"
            className="pl-11 pr-11 h-12 rounded-full text-base"
          />
          {searchInput && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear search"
              className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filters — hidden while searching since search ignores them */}
        {!isSearching && (
          <div className="flex flex-col gap-4 mb-12">
            {categories && categories.length > 0 && (
              <div className="flex items-center flex-wrap gap-2">
                <FilterPill
                  label="All"
                  active={!category}
                  onClick={() => selectCategory(undefined)}
                />
                {categories.map((c) => (
                  <FilterPill
                    key={c.id}
                    label={c.name}
                    active={category === c.slug}
                    onClick={() => selectCategory(c.slug)}
                  />
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Select
                value={author ?? ALL}
                onValueChange={(v) => selectAuthor(v === ALL ? undefined : v)}
              >
                <SelectTrigger className="w-[180px] rounded-full" aria-label="Filter by writer">
                  <SelectValue placeholder="All writers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All writers</SelectItem>
                  {(authors ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.slug}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={tag ?? ALL}
                onValueChange={(v) => selectTag(v === ALL ? undefined : v)}
              >
                <SelectTrigger className="w-[180px] rounded-full" aria-label="Filter by tag">
                  <SelectValue placeholder="All tags" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All tags</SelectItem>
                  {(tags ?? []).map((t) => (
                    <SelectItem key={t.slug} value={t.slug}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {(author || tag) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full text-muted-foreground"
                  onClick={() =>
                    updateParams({
                      author: undefined,
                      tag: undefined,
                      page: undefined,
                    })
                  }
                >
                  <X className="w-3.5 h-3.5 mr-1" />
                  Clear filters
                </Button>
              )}
            </div>
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center text-center py-24 gap-3">
            <AlertCircle className="w-10 h-10 text-destructive" />
            <h2 className="font-serif text-2xl text-foreground">
              Couldn't load posts
            </h2>
            <p className="text-muted-foreground max-w-md">
              {error instanceof Error ? error.message : "Please try again later."}
            </p>
          </div>
        )}

        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="rounded-2xl overflow-hidden border border-card-border">
                <Skeleton className="w-full aspect-video" />
                <div className="p-6 space-y-3">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading && !isError && data && (
          <>
            {activeFilters.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-8">
                <span className="text-sm text-muted-foreground mr-1">
                  {totalResults} result{totalResults === 1 ? "" : "s"} for
                </span>
                {activeFilters.map((f) => (
                  <ActiveFilterChip
                    key={f.key}
                    prefix={f.prefix}
                    label={f.label}
                    onRemove={f.onRemove}
                  />
                ))}
              </div>
            )}

            {data.items.length === 0 ? (
              <div className="text-center py-24">
                <h2 className="font-serif text-2xl text-foreground mb-2">
                  No posts found
                </h2>
                <p className="text-muted-foreground">
                  {isSearching
                    ? `No results for “${query}”. Try another search.`
                    : "Try a different filter."}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                {data.items.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}
              </div>
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 mt-16">
                <Button
                  variant="outline"
                  className="rounded-full"
                  disabled={page <= 1}
                  onClick={() => goToPage(page - 1)}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {pagination?.page ?? page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  className="rounded-full"
                  disabled={page >= totalPages}
                  onClick={() => goToPage(page + 1)}
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            )}
          </>
        )}

        <NewsletterCTA />
      </main>

      <Footer />
    </div>
  );
}

function ActiveFilterChip({
  prefix,
  label,
  onRemove,
}: {
  prefix: string;
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium pl-3 pr-1.5 py-1 rounded-full bg-secondary text-secondary-foreground">
      <span className="text-muted-foreground font-normal">{prefix}:</span>
      <span>{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${prefix} filter`}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </span>
  );
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-sm font-medium px-4 py-2 rounded-full transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-secondary-foreground hover:bg-primary/10 hover:text-primary",
      )}
    >
      {label}
    </button>
  );
}
