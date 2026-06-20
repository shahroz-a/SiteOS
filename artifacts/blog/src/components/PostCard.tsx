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
      <article className="group relative overflow-hidden rounded-3xl border border-border/60 bg-card shadow-sm transition-shadow duration-500 hover:shadow-xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 items-stretch">
          <Link
            href={postPath(post.slug)}
            className="relative block overflow-hidden bg-muted aspect-[16/10] lg:aspect-auto lg:min-h-[26rem]"
          >
            {post.featuredImageUrl ? (
              <img
                src={post.featuredImageUrl}
                alt={post.featuredImageAlt ?? post.title}
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105"
              />
            ) : null}
            <div className="absolute inset-0 bg-black/5 group-hover:bg-transparent transition-colors duration-500" />
          </Link>
          <div className="flex flex-col justify-center p-7 sm:p-10 lg:p-14">
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                Featured
              </span>
              {post.primaryCategory ? (
                <Link
                  href={categoryPath(post.primaryCategory.slug)}
                  className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground hover:text-primary transition-colors"
                >
                  {post.primaryCategory.name}
                </Link>
              ) : null}
            </div>
            <h2 className="font-serif text-3xl md:text-4xl lg:text-5xl leading-[1.12] tracking-tight text-foreground mb-5">
              <Link
                href={postPath(post.slug)}
                className="hover:text-primary transition-colors"
              >
                {post.title}
              </Link>
            </h2>
            {post.excerpt ? (
              <p className="text-base md:text-lg text-muted-foreground leading-relaxed mb-8 max-w-xl line-clamp-3">
                {post.excerpt}
              </p>
            ) : null}
            <div className="flex items-center gap-3 mb-8">
              {post.author?.avatarUrl ? (
                <img
                  src={post.author.avatarUrl}
                  alt={post.author.name}
                  className="w-10 h-10 rounded-full object-cover border border-border"
                />
              ) : null}
              <div className="flex flex-col">
                {post.author ? (
                  <span className="text-sm font-medium text-foreground">
                    {post.author.name}
                  </span>
                ) : null}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                  {date ? <span>{date}</span> : null}
                  {date && reading ? <span>&middot;</span> : null}
                  {reading ? <span>{reading}</span> : null}
                </div>
              </div>
            </div>
            <Link
              href={postPath(post.slug)}
              className="inline-flex items-center gap-2 text-sm font-semibold text-primary group/cta self-start"
            >
              Read the story
              <span
                aria-hidden="true"
                className="transition-transform duration-300 group-hover/cta:translate-x-1"
              >
                &rarr;
              </span>
            </Link>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="group flex flex-col h-full">
      <Link
        href={postPath(post.slug)}
        className="block overflow-hidden rounded-2xl bg-muted aspect-[4/3] mb-5 relative"
      >
        {post.featuredImageUrl ? (
          <img
            src={post.featuredImageUrl}
            alt={post.featuredImageAlt ?? post.title}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
        ) : null}
        <div className="absolute inset-0 bg-black/5 group-hover:bg-transparent transition-colors duration-500" />
      </Link>
      
      <div className="flex flex-col flex-1 px-1">
        {post.primaryCategory ? (
          <Link
            href={categoryPath(post.primaryCategory.slug)}
            className="inline-block text-xs font-semibold uppercase tracking-widest text-primary hover:text-foreground transition-colors mb-3 self-start"
          >
            {post.primaryCategory.name}
          </Link>
        ) : null}
        
        <h3 className="font-serif text-xl md:text-2xl leading-[1.2] tracking-tight text-foreground mb-3 line-clamp-3">
          <Link
            href={postPath(post.slug)}
            className="hover:text-primary transition-colors decoration-2 underline-offset-4"
          >
            {post.title}
          </Link>
        </h3>
        
        {post.excerpt ? (
          <p className="text-muted-foreground leading-relaxed mb-6 line-clamp-2 text-sm md:text-base">
            {post.excerpt}
          </p>
        ) : null}
        
        <div className="mt-auto flex items-center gap-2 text-xs md:text-sm text-muted-foreground pt-4 border-t border-border/40">
          {post.author ? <span className="font-medium text-foreground">{post.author.name}</span> : null}
          {post.author && (date || reading) ? <span>&middot;</span> : null}
          {date ? <span>{date}</span> : null}
          {date && reading ? <span>&middot;</span> : null}
          {reading ? <span>{reading}</span> : null}
        </div>
      </div>
    </article>
  );
}
