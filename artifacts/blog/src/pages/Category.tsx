import { useRoute, useSearch } from "wouter";
import {
  useGetCategoryBySlug,
  useListPosts,
} from "@workspace/api-client-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PostCard } from "@/components/PostCard";
import { Pagination } from "@/components/Pagination";
import { LoadingState, ErrorState, EmptyState } from "@/components/StateViews";
import { useSeo } from "@/hooks/use-seo";
import { categoryPath } from "@/lib/blog";
import { categorySeo } from "@workspace/blog-seo";

const PAGE_SIZE = 9;

export default function Category() {
  const [, params] = useRoute("/category/:slug");
  const slug = params?.slug ?? "";
  const searchString = useSearch();
  const pageParam = new URLSearchParams(searchString).get("page");
  const page = Math.max(1, Number(pageParam) || 1);

  const { data: category, isError: catError } = useGetCategoryBySlug(slug);
  const {
    data,
    isLoading,
    isError: postsError,
  } = useListPosts({ category: slug, page, limit: PAGE_SIZE });

  const items = data?.items ?? [];

  useSeo(
    category
      ? categorySeo(category)
      : categorySeo({ name: "Category", description: null }),
  );

  return (
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/20">
      <Header />

      <main className="flex-1 w-full">
        <section className="bg-background pt-16 pb-12 md:pt-24 md:pb-20 border-b border-border/40">
          <div className="max-w-7xl mx-auto px-6 lg:px-12">
            <p className="text-primary font-semibold tracking-widest uppercase text-sm mb-6">
              Category
            </p>
            <h1 className="font-serif text-5xl md:text-7xl leading-[1.05] tracking-tight text-foreground max-w-4xl mb-8">
              {category?.name ?? slug}
            </h1>
            {category?.description ? (
              <p className="text-xl text-muted-foreground max-w-2xl leading-relaxed font-light">
                {category.description}
              </p>
            ) : null}
          </div>
        </section>

        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-16 md:py-24">
          {isLoading ? (
            <LoadingState label="Loading articles…" />
          ) : postsError || catError ? (
            <ErrorState />
          ) : items.length === 0 ? (
            <EmptyState
              title="No articles in this category yet"
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
                      p === 1
                        ? categoryPath(slug)
                        : `${categoryPath(slug)}?page=${p}`
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
