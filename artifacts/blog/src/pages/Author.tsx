import { useRoute, useSearch } from "wouter";
import { useGetAuthorBySlug, useListPosts } from "@workspace/api-client-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PostCard } from "@/components/PostCard";
import { Pagination } from "@/components/Pagination";
import { LoadingState, ErrorState, EmptyState } from "@/components/StateViews";
import { Avatar, AvatarImage, AvatarFallback } from "@workspace/ui/avatar";
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
        <section className="bg-background pt-16 pb-12 md:pt-24 md:pb-20 border-b border-border/40">
          <div className="max-w-7xl mx-auto px-6 lg:px-12 flex flex-col md:flex-row items-center md:items-start gap-8 md:gap-12">
            <Avatar className="w-24 h-24 md:w-32 md:h-32 border border-border">
              {author?.avatarUrl ? (
                <AvatarImage src={author.avatarUrl} alt={author.name} className="object-cover" />
              ) : null}
              <AvatarFallback className="text-2xl bg-muted text-muted-foreground">{(author?.name ?? slug).charAt(0)}</AvatarFallback>
            </Avatar>
            
            <div className="flex-1 text-center md:text-left">
              {author?.role ? (
                <p className="text-primary font-semibold tracking-widest uppercase text-sm mb-4">
                  {author.role}
                </p>
              ) : null}
              <h1 className="font-serif text-4xl md:text-6xl leading-[1.1] tracking-tight text-foreground mb-6">
                {author?.name ?? slug}
              </h1>
              {author?.bio ? (
                <p className="text-lg md:text-xl text-muted-foreground max-w-2xl font-light leading-relaxed">
                  {author.bio}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-16 md:py-24">
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
                      p === 1 ? authorPath(slug) : `${authorPath(slug)}?page=${p}`
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
