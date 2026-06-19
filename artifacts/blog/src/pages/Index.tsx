import { useSearch } from "wouter";
import { useListPosts } from "@workspace/api-client-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PostCard } from "@/components/PostCard";
import { Pagination } from "@/components/Pagination";
import { NewsletterCTA } from "@/components/NewsletterCTA";
import { LoadingState, ErrorState, EmptyState } from "@/components/StateViews";
import { useSeo } from "@/hooks/use-seo";
import { indexSeo } from "@workspace/blog-seo";

const PAGE_SIZE = 9;

export default function Index() {
  const searchString = useSearch();
  const pageParam = new URLSearchParams(searchString).get("page");
  const page = Math.max(1, Number(pageParam) || 1);

  const { data, isLoading, isError } = useListPosts({
    page,
    limit: PAGE_SIZE,
  });

  useSeo(indexSeo());

  const items = data?.items ?? [];
  const featured = page === 1 ? items[0] : undefined;
  const rest = featured ? items.slice(1) : items;

  return (
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/20">
      <Header />

      <main className="flex-1 w-full">
        {/* Masthead */}
        <section className="border-b border-border/40 bg-card">
          <div className="max-w-7xl mx-auto px-6 lg:px-12 py-16 md:py-20 text-center">
            <p className="text-primary font-semibold tracking-widest uppercase text-sm mb-4">
              The Headout Blog
            </p>
            <h1 className="font-serif text-4xl md:text-6xl leading-tight text-foreground mb-6">
              Stories to spark your next adventure
            </h1>
            <p className="text-lg text-foreground/70 max-w-2xl mx-auto">
              Curated travel guides, family getaways and holiday ideas from
              writers who've been there.
            </p>
          </div>
        </section>

        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-12 md:py-16">
          {isLoading ? (
            <LoadingState label="Loading articles…" />
          ) : isError ? (
            <ErrorState />
          ) : items.length === 0 ? (
            <EmptyState
              title="No articles yet"
              message="Check back soon for new stories."
            />
          ) : (
            <>
              {featured ? (
                <div className="mb-16 pb-16 border-b border-border/40">
                  <PostCard post={featured} variant="featured" />
                </div>
              ) : null}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                {rest.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}
              </div>

              {data ? (
                <Pagination
                  page={data.pagination.page}
                  totalPages={data.pagination.totalPages}
                  hrefFor={(p) => (p === 1 ? "/" : `/?page=${p}`)}
                />
              ) : null}
            </>
          )}

          <NewsletterCTA />
        </div>
      </main>

      <Footer />
    </div>
  );
}
