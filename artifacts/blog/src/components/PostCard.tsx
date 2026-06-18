import { Link } from "wouter";
import type { PostSummary } from "@workspace/api-client-react";
import { postPath, categoryPath, formatDate, readingTimeLabel } from "@/lib/blog";

interface PostCardProps {
  post: PostSummary;
  variant?: "default" | "featured";
}

export function PostCard({ post, variant = "default" }: PostCardProps) {
  const date = formatDate(post.publishedAt);
  const reading = readingTimeLabel(post.readingTimeMinutes);

  if (variant === "featured") {
    return (
      <article className="group grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center">
        <Link
          href={postPath(post.slug)}
          className="block overflow-hidden rounded-3xl bg-muted aspect-[16/10]"
        >
          {post.featuredImageUrl ? (
            <img
              src={post.featuredImageUrl}
              alt={post.featuredImageAlt ?? post.title}
              loading="lazy"
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
          ) : null}
        </Link>
        <div>
          {post.primaryCategory ? (
            <Link
              href={categoryPath(post.primaryCategory.slug)}
              className="inline-block text-xs font-semibold uppercase tracking-widest text-primary hover:opacity-80 transition-opacity mb-4"
            >
              {post.primaryCategory.name}
            </Link>
          ) : null}
          <h2 className="font-serif text-3xl md:text-4xl leading-tight text-foreground mb-4">
            <Link
              href={postPath(post.slug)}
              className="hover:text-primary transition-colors"
            >
              {post.title}
            </Link>
          </h2>
          {post.excerpt ? (
            <p className="text-base md:text-lg text-foreground/70 leading-relaxed mb-6 max-w-xl">
              {post.excerpt}
            </p>
          ) : null}
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            {post.author ? <span>{post.author.name}</span> : null}
            {post.author && (date || reading) ? <span>&middot;</span> : null}
            {date ? <span>{date}</span> : null}
            {date && reading ? <span>&middot;</span> : null}
            {reading ? <span>{reading}</span> : null}
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="group flex flex-col h-full rounded-2xl overflow-hidden border border-border/50 bg-card hover-elevate">
      <Link
        href={postPath(post.slug)}
        className="block overflow-hidden bg-muted aspect-[16/10]"
      >
        {post.featuredImageUrl ? (
          <img
            src={post.featuredImageUrl}
            alt={post.featuredImageAlt ?? post.title}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
        ) : null}
      </Link>
      <div className="flex flex-col flex-1 p-6">
        {post.primaryCategory ? (
          <Link
            href={categoryPath(post.primaryCategory.slug)}
            className="inline-block text-xs font-semibold uppercase tracking-widest text-primary hover:opacity-80 transition-opacity mb-3 self-start"
          >
            {post.primaryCategory.name}
          </Link>
        ) : null}
        <h3 className="font-serif text-xl leading-snug text-foreground mb-3">
          <Link
            href={postPath(post.slug)}
            className="hover:text-primary transition-colors"
          >
            {post.title}
          </Link>
        </h3>
        {post.excerpt ? (
          <p className="text-sm text-foreground/70 leading-relaxed mb-5 line-clamp-3">
            {post.excerpt}
          </p>
        ) : null}
        <div className="mt-auto flex items-center gap-2 text-xs text-muted-foreground">
          {date ? <span>{date}</span> : null}
          {date && reading ? <span>&middot;</span> : null}
          {reading ? <span>{reading}</span> : null}
        </div>
      </div>
    </article>
  );
}
