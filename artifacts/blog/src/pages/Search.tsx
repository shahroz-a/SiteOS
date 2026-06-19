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
import { searchPath } from "@/lib/blog";
import { searchSeo } from "@workspace/blog-seo";

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

  const items = data?.items ?? [];

  useSeo(searchSeo(q));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (trimmed) navigate(searchPath(trimmed));
  };

  return (
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/20">
      <Header />

      <main className="flex-1 w-full">
        <section className="bg-background pt-16 pb-12 md:pt-24 md:pb-20 border-b border-border/40">
          <div className="max-w-3xl mx-auto px-6 lg:px-12 text-center">
            <h1 className="font-serif text-4xl md:text-6xl leading-[1.1] tracking-tight text-foreground mb-10">
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
                className="h-14 md:h-16 w-full rounded-full border border-border/80 bg-card pl-14 pr-6 text-base md:text-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50 transition-all shadow-sm"
              />
            </form>
          </div>
        </section>

        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-16 md:py-24">
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
              <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground mb-10 border-b border-border/40 pb-6">
                {data?.pagination.total} result
                {data?.pagination.total === 1 ? "" : "s"} for{" "}
                <span className="text-foreground">"{q}"</span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-12">
                {items.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}
              </div>

              {data && data.pagination.totalPages > 1 ? (
                <div className="mt-20">
                  <Pagination
                    page={data.pagination.page}
                    totalPages={data.pagination.totalPages}
                    hrefFor={(p) =>
                      `${searchPath(q)}${p > 1 ? `&page=${p}` : ""}`
                    }
                  />
                </div>
              ) : null}
            </>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
