import { useState } from "react";
import { useSearch, useLocation, Link } from "wouter";
import {
  useListPosts,
  useListCategories,
  useListAuthors,
  type PostSummary,
} from "@workspace/api-client-react";
import { Search, TrendingUp } from "lucide-react";
import { cn } from "@workspace/ui";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PostCard } from "@/components/PostCard";
import { Pagination } from "@/components/Pagination";
import { NewsletterCTA } from "@/components/NewsletterCTA";
import { LoadingState, ErrorState, EmptyState } from "@/components/StateViews";
import { useSeo } from "@/hooks/use-seo";
import { indexSeo } from "@workspace/blog-seo";
import { postPath, searchPath, formatDate, readingTimeLabel } from "@/lib/blog";

const PAGE_SIZE = 9;

function roundDown(n: number, step: number): number {
  return Math.floor(n / step) * step;
}

function statValue(n: number | null, step: number): string {
  if (n == null) return "—";
  if (n < step) return `${n}`;
  return `${roundDown(n, step).toLocaleString()}+`;
}

function HeroSearch() {
  const [, navigate] = useLocation();
  const [q, setQ] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = q.trim();
    if (value) navigate(searchPath(value));
  };

  return (
    <form
      onSubmit={submit}
      role="search"
      className="flex items-center gap-2 w-full max-w-xl rounded-full border border-border/70 bg-card p-1.5 pl-4 shadow-sm focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10 transition-all"
    >
      <Search className="w-5 h-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search destinations, guides, tips…"
        aria-label="Search articles"
        className="flex-1 min-w-0 bg-transparent text-sm sm:text-base text-foreground placeholder:text-muted-foreground outline-none"
      />
      <button
        type="submit"
        className="shrink-0 rounded-full bg-primary px-5 sm:px-6 h-11 text-sm font-semibold text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all"
      >
        Search
      </button>
    </form>
  );
}

function TrendingCard({ post }: { post: PostSummary }) {
  const date = formatDate(post.publishedAt);
  const reading = readingTimeLabel(post.readingTimeMinutes);
  const meta = [date, reading].filter(Boolean).join(" · ");

  return (
    <Link
      href={postPath(post.slug)}
      className="group relative block overflow-hidden rounded-[1.75rem] bg-muted shadow-xl ring-1 ring-border/50 aspect-[4/5] sm:aspect-[3/2] lg:aspect-auto lg:h-full lg:min-h-[34rem]"
    >
      {post.featuredImageUrl ? (
        <img
          src={post.featuredImageUrl}
          alt={post.featuredImageAlt ?? post.title}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-105"
        />
      ) : null}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/5"
      />

      <span className="absolute left-4 top-4 sm:left-5 sm:top-5 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-foreground shadow-sm">
        <TrendingUp className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
        Currently trending
      </span>

      <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
        {post.primaryCategory ? (
          <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-white backdrop-blur-sm">
            {post.primaryCategory.name}
          </span>
        ) : null}
        <h2 className="font-serif text-2xl sm:text-3xl lg:text-[2rem] leading-[1.15] text-white mt-3 line-clamp-3 [text-wrap:balance]">
          {post.title}
        </h2>
        <div className="flex items-center gap-3 mt-5">
          {post.author?.avatarUrl ? (
            <img
              src={post.author.avatarUrl}
              alt={post.author.name}
              className="w-9 h-9 rounded-full object-cover ring-2 ring-white/40"
            />
          ) : null}
          <div className="min-w-0">
            {post.author ? (
              <div className="text-sm font-medium text-white truncate">
                {post.author.name}
              </div>
            ) : null}
            {meta ? (
              <div className="text-xs text-white/70 truncate">{meta}</div>
            ) : null}
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function Index() {
  const searchString = useSearch();
  const pageParam = new URLSearchParams(searchString).get("page");
  const page = Math.max(1, Number(pageParam) || 1);
  const isFirstPage = page === 1;

  const { data, isLoading, isError } = useListPosts({
    page,
    limit: PAGE_SIZE,
  });
  const { data: categories } = useListCategories();
  const { data: authors } = useListAuthors();

  useSeo(indexSeo());

  const items = data?.items ?? [];
  const heroPost = isFirstPage ? items[0] : undefined;
  const rest = heroPost ? items.slice(1) : items;

  const total = data?.pagination.total ?? null;
  const destinations = categories ? categories.length : null;
  const writers = authors ? authors.length : null;

  const destinationsPhrase =
    destinations != null && destinations >= 10
      ? `${roundDown(destinations, 10)}+ destinations`
      : "destinations worldwide";

  const avatarUrls = Array.from(
    new Set(
      items
        .map((i) => i.author?.avatarUrl)
        .filter((u): u is string => Boolean(u)),
    ),
  ).slice(0, 4);

  const showHeroCard = isFirstPage && (Boolean(heroPost) || isLoading);

  const stats = [
    { value: statValue(total, 100), label: "Stories" },
    { value: statValue(destinations, 10), label: "Destinations" },
    { value: statValue(writers, 10), label: "Writers" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/20">
      <Header />

      <main className="flex-1 w-full">
        <section className="relative overflow-hidden border-b border-border/40 bg-gradient-to-b from-primary/[0.04] to-background pt-12 pb-12 md:pt-20 md:pb-20">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 -right-24 h-[28rem] w-[28rem] rounded-full bg-primary/10 blur-3xl"
          />
          <div className="relative max-w-7xl mx-auto px-6 lg:px-12">
            {isFirstPage ? (
              <div
                className={cn(
                  "grid items-center gap-10 lg:gap-14",
                  showHeroCard && "lg:grid-cols-[1.1fr_0.9fr]",
                )}
              >
                <div className="min-w-0 max-w-2xl">
                  <div className="inline-flex items-center gap-3 rounded-full border border-border/60 bg-card/70 py-1.5 pl-2 pr-4 shadow-sm backdrop-blur">
                    {avatarUrls.length > 0 ? (
                      <div className="flex -space-x-2">
                        {avatarUrls.map((src, i) => (
                          <img
                            key={i}
                            src={src}
                            alt=""
                            className="w-6 h-6 rounded-full border-2 border-card object-cover"
                          />
                        ))}
                      </div>
                    ) : (
                      <span className="ml-1 inline-block w-2 h-2 rounded-full bg-primary" />
                    )}
                    <span className="text-xs font-medium text-muted-foreground">
                      Stories from travellers who&apos;ve been there
                    </span>
                  </div>

                  <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl xl:text-7xl leading-[1.05] tracking-tight text-foreground mt-7 [text-wrap:balance]">
                    Travel that{" "}
                    <span className="text-primary italic font-light">stays</span>{" "}
                    with you, long after you&apos;re home.
                  </h1>

                  <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed font-light max-w-xl mt-6">
                    Hand-picked guides, city itineraries and traveller-tested tips
                    across {destinationsPhrase} — from quick city breaks to
                    once-in-a-lifetime journeys.
                  </p>

                  <div className="mt-8">
                    <HeroSearch />
                  </div>

                  <dl className="grid grid-cols-3 gap-3 sm:gap-6 max-w-md mt-10">
                    {stats.map((stat) => (
                      <div key={stat.label} className="flex flex-col">
                        <dt className="font-serif text-2xl sm:text-3xl text-foreground">
                          {stat.value}
                        </dt>
                        <dd className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                          {stat.label}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>

                {showHeroCard ? (
                  <div className="min-w-0">
                    {heroPost ? (
                      <TrendingCard post={heroPost} />
                    ) : (
                      <div className="aspect-[4/5] sm:aspect-[3/2] lg:aspect-auto lg:min-h-[34rem] rounded-[1.75rem] bg-muted animate-pulse" />
                    )}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="max-w-3xl">
                <span className="inline-flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.25em] text-primary mb-6">
                  <span className="h-px w-8 bg-primary/50" />
                  Page {page}
                </span>
                <h1 className="font-serif text-4xl md:text-6xl leading-[1.05] tracking-tight text-foreground">
                  More stories{" "}
                  <span className="text-primary italic font-light">to explore.</span>
                </h1>
              </div>
            )}
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
              {rest.length > 0 ? (
                <div className="flex items-end justify-between gap-4 mb-10">
                  <h2 className="font-serif text-2xl md:text-3xl tracking-tight text-foreground">
                    Latest stories
                  </h2>
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
