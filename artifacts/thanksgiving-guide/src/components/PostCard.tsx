import { Link } from "wouter";
import { Clock } from "lucide-react";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { formatDate } from "@/lib/post-content";
import type { PostSummary } from "@workspace/api-client-react";

interface PostCardProps {
  post: PostSummary;
}

export function PostCard({ post }: PostCardProps) {
  const published = formatDate(post.publishedAt);

  return (
    <Link
      href={`/posts/${post.slug}`}
      className="group flex flex-col rounded-2xl overflow-hidden bg-card border border-card-border shadow-sm hover-elevate transition-all duration-300"
    >
      <div className="overflow-hidden">
        <AspectRatio ratio={16 / 9}>
          {post.featuredImageUrl ? (
            <img
              src={post.featuredImageUrl}
              alt={post.featuredImageAlt ?? post.title}
              loading="lazy"
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
          ) : (
            <div className="w-full h-full bg-muted" />
          )}
        </AspectRatio>
      </div>

      <div className="flex flex-col flex-1 p-6">
        {post.primaryCategory && (
          <span className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">
            {post.primaryCategory.name}
          </span>
        )}
        <h2 className="font-serif text-xl md:text-2xl text-foreground leading-snug mb-3 group-hover:text-primary transition-colors">
          {post.title}
        </h2>
        {post.excerpt && (
          <p className="text-sm text-muted-foreground leading-relaxed mb-6 line-clamp-3">
            {post.excerpt}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-4 pt-4 border-t border-border/40">
          {post.author ? (
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar className="w-8 h-8 border border-primary/10">
                {post.author.avatarUrl && (
                  <AvatarImage src={post.author.avatarUrl} alt={post.author.name} />
                )}
                <AvatarFallback>{post.author.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <span className="text-sm text-foreground/80 truncate">
                {post.author.name}
              </span>
            </div>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
            {typeof post.readingTimeMinutes === "number" && (
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {post.readingTimeMinutes} min
              </span>
            )}
            {published && <span>{published}</span>}
          </div>
        </div>
      </div>
    </Link>
  );
}
