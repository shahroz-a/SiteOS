import { useListPosts } from "@workspace/api-client-react";
import { PostCard } from "@/components/PostCard";

interface RelatedArticlesProps {
  categorySlug: string;
  currentSlug: string;
}

export function RelatedArticles({
  categorySlug,
  currentSlug,
}: RelatedArticlesProps) {
  const { data } = useListPosts({
    category: categorySlug,
    limit: 4,
  });

  const related = (data?.items ?? [])
    .filter((post) => post.slug !== currentSlug)
    .slice(0, 3);

  if (related.length === 0) {
    return null;
  }

  return (
    <section className="mt-20 pt-12 border-t border-border/40">
      <h2 className="font-serif text-2xl md:text-3xl text-foreground mb-8">
        Related articles
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
        {related.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
    </section>
  );
}
