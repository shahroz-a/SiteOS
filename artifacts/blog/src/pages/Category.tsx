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
import { categoryPath, defaultOgImage } from "@/lib/blog";

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

  useSeo({
    title: category
      ? `${category.name} | Headout Blog`
      : "Category | Headout Blog",
    description: category?.description,
    ogImage: defaultOgImage(),
  });

  const items = data?.items ?? [];

  return (
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/20">
      <Header />

      <main className="flex-1 w-full">
        <section className="border-b border-border/40 bg-card">
          <div className="max-w-7xl mx-auto px-6 lg:px-12 py-16 md:py-20 text-center">
            <p className="text-primary font-semibold tracking-widest uppercase text-sm mb-4">
              Category
            </p>
            <h1 className="font-serif text-4xl md:text-5xl leading-tight text-foreground mb-4">
              {category?.name ?? slug}
            </h1>
            {category?.description ? (
              <p className="text-lg text-foreground/70 max-w-2xl mx-auto">
                {category.description}
              </p>
            ) : null}
          </div>
        </section>

        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-12 md:py-16">
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
                    p === 1
                      ? categoryPath(slug)
                      : `${categoryPath(slug)}?page=${p}`
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
