import { useState } from "react";
import { useSearch, useLocation } from "wouter";
import { Search as SearchIcon } from "lucide-react";
import {
  useSearchPosts,
  getSearchPostsQueryKey,
} from "@workspace/api-client-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PostCard } from "@/components/PostCard";
import { Pagination } from "@/components/Pagination";
import { LoadingState, ErrorState, EmptyState } from "@/components/StateViews";
import { useSeo } from "@/hooks/use-seo";
import { searchPath, defaultOgImage } from "@/lib/blog";

const PAGE_SIZE = 9;

export default function Search() {
  const searchString = useSearch();
  const sp = new URLSearchParams(searchString);
  const q = sp.get("q") ?? "";
  const page = Math.max(1, Number(sp.get("page")) || 1);

  const [, navigate] = useLocation();
  const [input, setInput] = useState(q);

  const { data, isLoading, isError } = useSearchPosts(
    { q, page, limit: PAGE_SIZE },
    {
      query: {
        queryKey: getSearchPostsQueryKey({ q, page, limit: PAGE_SIZE }),
        enabled: q.trim().length > 0,
      },
    },
  );

  useSeo({
    title: q ? `Search: ${q} | Headout Blog` : "Search | Headout Blog",
    description: "Search travel guides and articles on the Headout Blog.",
    ogImage: defaultOgImage(),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (trimmed) navigate(searchPath(trimmed));
  };

  const items = data?.items ?? [];

  return (
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/20">
      <Header />

      <main className="flex-1 w-full">
        <section className="border-b border-border/40 bg-card">
          <div className="max-w-3xl mx-auto px-6 lg:px-12 py-16 md:py-20 text-center">
            <h1 className="font-serif text-4xl md:text-5xl leading-tight text-foreground mb-8">
              Search the blog
            </h1>
            <form onSubmit={submit} className="relative max-w-xl mx-auto" role="search">
              <SearchIcon className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Search articles, destinations, tips…"
                aria-label="Search articles"
                autoFocus
                className="h-14 w-full rounded-full border border-border/60 bg-background pl-14 pr-6 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-all"
              />
            </form>
          </div>
        </section>

        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-12 md:py-16">
          {q.trim().length === 0 ? (
            <EmptyState
              title="Start typing to search"
              message="Find guides, destinations and travel tips across the blog."
            />
          ) : isLoading ? (
            <LoadingState label="Searching…" />
          ) : isError ? (
            <ErrorState />
          ) : items.length === 0 ? (
            <EmptyState
              title={`No results for "${q}"`}
              message="Try a different search term."
            />
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-8">
                {data?.pagination.total} result
                {data?.pagination.total === 1 ? "" : "s"} for{" "}
                <span className="text-foreground font-medium">"{q}"</span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                {items.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}
              </div>

              {data ? (
                <Pagination
                  page={data.pagination.page}
                  totalPages={data.pagination.totalPages}
                  hrefFor={(p) =>
                    `${searchPath(q)}${p > 1 ? `&page=${p}` : ""}`
                  }
                />
              ) : null}
            </>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
