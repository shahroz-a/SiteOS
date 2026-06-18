import {
  useListPosts,
  getListPostsQueryKey,
} from "@workspace/api-client-react";
import type { PostSummary, TagSummary } from "@workspace/api-client-react";
import { PostCard } from "@/components/PostCard";

interface RelatedArticlesProps {
  categorySlug?: string;
  currentSlug: string;
  tags: TagSummary[];
}

const MAX_RELATED = 3;

export function RelatedArticles({
  categorySlug,
  currentSlug,
  tags,
}: RelatedArticlesProps) {
  const categoryParams = { category: categorySlug, limit: MAX_RELATED + 1 };
  const { data: categoryData } = useListPosts(categoryParams, {
    query: {
      enabled: !!categorySlug,
      queryKey: getListPostsQueryKey(categoryParams),
    },
  });

  // A single OR-match across all of the post's tags (comma-separated) searches
  // the whole catalog in one request, rather than firing one request per tag.
  const tagSlugs = tags.map((tag) => tag.slug).join(",");
  const tagParams = { tag: tagSlugs, limit: MAX_RELATED + tags.length + 1 };
  const { data: tagData } = useListPosts(tagParams, {
    query: {
      enabled: tagSlugs.length > 0,
      queryKey: getListPostsQueryKey(tagParams),
    },
  });

  const { data: recentData } = useListPosts({ limit: MAX_RELATED + 1 });

  const categoryPosts = categoryData?.items ?? [];
  const tagPosts = tagData?.items ?? [];
  const recentPosts = recentData?.items ?? [];

  const related: PostSummary[] = [];
  const seen = new Set<string>([currentSlug]);

  for (const list of [categoryPosts, tagPosts, recentPosts]) {
    for (const post of list) {
      if (related.length >= MAX_RELATED) break;
      if (seen.has(post.slug)) continue;
      seen.add(post.slug);
      related.push(post);
    }
  }

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
