import { useState } from "react";
import {
  useListPosts,
  useListCategories,
} from "@workspace/api-client-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { NewsletterCTA } from "@/components/NewsletterCTA";
import { PostCard } from "@/components/PostCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import { useSeo } from "@/lib/seo";

const PAGE_SIZE = 9;

export default function PostList() {
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState<string | undefined>(undefined);

  useSeo({
    title: "Headout Blog — Travel guides, tips & destination ideas",
    description:
      "Explore travel guides, destination deep-dives and trip-planning tips from the Headout Blog.",
  });

  const { data: categories } = useListCategories();
  const { data, isLoading, isError, error } = useListPosts({
    page,
    limit: PAGE_SIZE,
    category,
  });

  const selectCategory = (slug?: string) => {
    setCategory(slug);
    setPage(1);
  };

  const pagination = data?.pagination;
  const totalPages = pagination?.totalPages ?? 1;

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
        {/* Category filters */}
        {categories && categories.length > 0 && (
          <div className="flex items-center flex-wrap gap-2 mb-12">
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
            {data.items.length === 0 ? (
              <div className="text-center py-24">
                <h2 className="font-serif text-2xl text-foreground mb-2">
                  No posts found
                </h2>
                <p className="text-muted-foreground">
                  Try a different category.
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
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
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
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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
