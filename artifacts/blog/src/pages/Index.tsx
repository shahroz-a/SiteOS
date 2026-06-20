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
        <section className="relative overflow-hidden bg-background pt-16 pb-12 md:pt-24 md:pb-20 border-b border-border/40">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 -right-24 h-[28rem] w-[28rem] rounded-full bg-primary/10 blur-3xl"
          />
          <div className="relative max-w-7xl mx-auto px-6 lg:px-12">
            <span className="inline-flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.25em] text-primary mb-7">
              <span className="h-px w-8 bg-primary/50" />
              Travel stories &amp; guides
            </span>
            <h1 className="font-serif text-5xl md:text-7xl lg:text-8xl leading-[1.05] tracking-tight text-foreground max-w-4xl">
              Find your next<br className="hidden md:block"/> <span className="text-primary italic font-light">great adventure.</span>
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mt-8 leading-relaxed font-light">
              Curated travel guides, local secrets and weekend getaways from the people who've been there.
            </p>
          </div>
        </section>

        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-16 md:py-24">
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
                <div className="mb-16 md:mb-20">
                  <PostCard post={featured} variant="featured" />
                </div>
              ) : null}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-12">
                {rest.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}
              </div>

              {data && data.pagination.totalPages > 1 ? (
                <div className="mt-20">
                  <Pagination
                    page={data.pagination.page}
                    totalPages={data.pagination.totalPages}
                    hrefFor={(p) => (p === 1 ? "/" : `/?page=${p}`)}
                  />
                </div>
              ) : null}
            </>
          )}

          <div className="mt-24">
            <NewsletterCTA />
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
