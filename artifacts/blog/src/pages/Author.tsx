import { useRoute, useSearch } from "wouter";
import { useGetAuthorBySlug, useListPosts } from "@workspace/api-client-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PostCard } from "@/components/PostCard";
import { Pagination } from "@/components/Pagination";
import { LoadingState, ErrorState, EmptyState } from "@/components/StateViews";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useSeo } from "@/hooks/use-seo";
import { authorPath } from "@/lib/blog";
import { authorSeo } from "@workspace/blog-seo";

const PAGE_SIZE = 9;

export default function Author() {
  const [, params] = useRoute("/author/:slug");
  const slug = params?.slug ?? "";
  const searchString = useSearch();
  const pageParam = new URLSearchParams(searchString).get("page");
  const page = Math.max(1, Number(pageParam) || 1);

  const { data: author, isError: authorError } = useGetAuthorBySlug(slug);
  const {
    data,
    isLoading,
    isError: postsError,
  } = useListPosts({ author: slug, page, limit: PAGE_SIZE });

  const items = data?.items ?? [];

  useSeo(
    author ? authorSeo(author) : authorSeo({ name: "Author", bio: null }),
  );

  return (
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/20">
      <Header />

      <main className="flex-1 w-full">
        <section className="border-b border-border/40 bg-card">
          <div className="max-w-3xl mx-auto px-6 lg:px-12 py-16 md:py-20 text-center flex flex-col items-center">
            <Avatar className="w-20 h-20 border-2 border-primary/10 mb-5">
              {author?.avatarUrl ? (
                <AvatarImage src={author.avatarUrl} alt={author.name} />
              ) : null}
              <AvatarFallback>{(author?.name ?? slug).charAt(0)}</AvatarFallback>
            </Avatar>
            {author?.role ? (
              <p className="text-primary font-semibold tracking-widest uppercase text-xs mb-3">
                {author.role}
              </p>
            ) : null}
            <h1 className="font-serif text-4xl md:text-5xl leading-tight text-foreground mb-4">
              {author?.name ?? slug}
            </h1>
            {author?.bio ? (
              <p className="text-lg text-foreground/70 max-w-2xl mx-auto">
                {author.bio}
              </p>
            ) : null}
          </div>
        </section>

        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-12 md:py-16">
          {isLoading ? (
            <LoadingState label="Loading articles…" />
          ) : postsError || authorError ? (
            <ErrorState />
          ) : items.length === 0 ? (
            <EmptyState
              title="No articles by this author yet"
              message="Check back soon for new stories."
            />
          ) : (
            <>
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
                    p === 1 ? authorPath(slug) : `${authorPath(slug)}?page=${p}`
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
