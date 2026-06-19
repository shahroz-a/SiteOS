import { useEffect, useMemo } from "react";
import { Link, useRoute } from "wouter";
import { ChevronRight } from "lucide-react";
import {
  useGetPostBySlug,
  useListPosts,
  useRecordPageView,
  type PostDetail,
} from "@workspace/api-client-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import {
  ContentRenderer,
  asComponentTree,
  tocFromComponentTree,
  prepareArticleHtml,
} from "@workspace/blog-renderer";
import { TableOfContents } from "@/components/TableOfContents";
import { FaqAccordion } from "@/components/FaqAccordion";
import { NewsletterCTA } from "@/components/NewsletterCTA";
import { PostCard } from "@/components/PostCard";
import { LoadingState, ErrorState } from "@/components/StateViews";
import { Avatar, AvatarImage, AvatarFallback } from "@workspace/ui/avatar";
import { useSeo } from "@/hooks/use-seo";
import {
  authorPath,
  categoryPath,
  formatDate,
  readingTimeLabel,
} from "@/lib/blog";

function ArticleHero({ post }: { post: PostDetail }) {
  const date = formatDate(post.publishedAt ?? post.modifiedAt);
  return (
    <section className="relative w-full overflow-hidden bg-foreground text-background">
      {post.featuredImageUrl ? (
        <div className="absolute inset-0">
          <img
            src={post.featuredImageUrl}
            alt={post.featuredImageAlt ?? post.title}
            className="w-full h-full object-cover opacity-35"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-foreground/75 via-foreground/65 to-foreground/85" />
        </div>
      ) : null}

      <div className="relative max-w-4xl mx-auto px-6 lg:px-12 py-20 md:py-28 text-center">
        {post.primaryCategory ? (
          <Link
            href={categoryPath(post.primaryCategory.slug)}
            className="inline-block text-xs md:text-sm font-semibold uppercase tracking-widest text-primary hover:opacity-80 transition-opacity mb-5"
          >
            {post.primaryCategory.name}
          </Link>
        ) : null}
        <h1 className="font-serif text-3xl md:text-5xl lg:text-6xl leading-tight text-background mb-6">
          {post.title}
        </h1>
        {post.subtitle ? (
          <p className="text-lg md:text-xl text-background/80 max-w-2xl mx-auto mb-6">
            {post.subtitle}
          </p>
        ) : null}
        {date ? (
          <p className="text-sm md:text-base text-background/70">
            Last Updated: {date}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Breadcrumbs({ post }: { post: PostDetail }) {
  const trail: { label: string; href?: string }[] = [
    { label: "Blog", href: "/" },
  ];
  if (post.primaryCategory) {
    trail.push({
      label: post.primaryCategory.name,
      href: categoryPath(post.primaryCategory.slug),
    });
  }
  trail.push({ label: post.title });

  return (
    <div className="w-full bg-background border-b border-border/40">
      <nav
        aria-label="Breadcrumb"
        className="max-w-7xl mx-auto px-6 lg:px-12 py-4 flex items-center flex-wrap gap-x-2 gap-y-1 text-sm"
      >
        {trail.map((crumb, idx) => {
          const isLast = idx === trail.length - 1;
          return (
            <span key={idx} className="flex items-center gap-x-2">
              {crumb.href && !isLast ? (
                <Link href={crumb.href} className="text-primary hover:underline">
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={isLast ? "text-muted-foreground" : "text-primary"}
                  {...(isLast ? { "aria-current": "page" as const } : {})}
                >
                  {crumb.label}
                </span>
              )}
              {!isLast && (
                <ChevronRight
                  className="w-3.5 h-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
            </span>
          );
        })}
      </nav>
    </div>
  );
}

function RelatedArticles({ post }: { post: PostDetail }) {
  const categorySlug = post.primaryCategory?.slug;
  const { data } = useListPosts(
    categorySlug ? { category: categorySlug, limit: 4 } : { limit: 4 },
  );

  const related = (data?.items ?? [])
    .filter((p) => p.slug !== post.slug)
    .slice(0, 3);

  if (related.length === 0) return null;

  return (
    <section className="my-20 pt-16 border-t border-border/40">
      <h2 className="font-serif text-2xl md:text-3xl text-foreground mb-8">
        More reads
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
        {related.map((p) => (
          <PostCard key={p.id} post={p} />
        ))}
      </div>
    </section>
  );
}

export default function Article() {
  const [, params] = useRoute("/:slug");
  const slug = params?.slug ?? "";
  const { data: post, isLoading, isError } = useGetPostBySlug(slug);

  // Fire-and-forget, privacy-respecting page-view capture once the article
  // resolves. Errors are swallowed so analytics never disrupts reading.
  const { mutate: recordView } = useRecordPageView();
  useEffect(() => {
    if (post?.slug) {
      recordView({ data: { slug: post.slug } });
    }
  }, [post?.slug, recordView]);

  // The cleaned raw HTML is the body we actually render, so derive the TOC from
  // it (heading ids are injected during the same pass) to guarantee anchors
  // resolve. Fall back to the componentTree only when there's no HTML body.
  const tocItems = useMemo(() => {
    if (post?.contentHtml && post.contentHtml.trim().length > 0) {
      return prepareArticleHtml(post.contentHtml).toc;
    }
    return tocFromComponentTree(asComponentTree(post?.componentTree));
  }, [post?.contentHtml, post?.componentTree]);

  const jsonLd = useMemo(
    () => (post?.jsonld ?? []).map((b) => b.data),
    [post?.jsonld],
  );

  useSeo({
    title: post
      ? `${post.seo?.metaTitle ?? post.title} | Headout Blog`
      : "Headout Blog",
    description: post?.seo?.metaDescription ?? post?.excerpt,
    canonicalUrl: post?.seo?.canonicalUrl ?? post?.canonicalUrl,
    ogTitle: post?.seo?.ogTitle ?? post?.title,
    ogDescription: post?.seo?.ogDescription ?? post?.excerpt,
    ogImage: post?.seo?.ogImage ?? post?.featuredImageUrl,
    ogType: "article",
    jsonLd,
  });

  return (
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/20">
      <Header />

      {isLoading ? (
        <LoadingState label="Loading article…" />
      ) : isError || !post ? (
        <ErrorState
          title="Article not found"
          message="The article you're looking for doesn't exist or may have moved."
        />
      ) : (
        <>
          <ArticleHero post={post} />
          <Breadcrumbs post={post} />

          <main className="flex-1 w-full max-w-7xl mx-auto px-6 lg:px-12 py-12 md:py-16">
            {/* Author & share */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-12 border-b border-border/40 pb-8">
              {post.author ? (
                <Link
                  href={authorPath(post.author.slug)}
                  className="flex items-center gap-4 group hover:opacity-80 transition-opacity"
                >
                  <Avatar className="w-12 h-12 border-2 border-primary/10">
                    {post.author.avatarUrl ? (
                      <AvatarImage
                        src={post.author.avatarUrl}
                        alt={post.author.name}
                      />
                    ) : null}
                    <AvatarFallback>
                      {post.author.name.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="text-sm text-muted-foreground">
                      Written by
                    </div>
                    <div className="font-medium text-foreground group-hover:text-primary transition-colors">
                      {post.author.name}
                    </div>
                  </div>
                </Link>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                {readingTimeLabel(post.readingTimeMinutes) ? (
                  <span>{readingTimeLabel(post.readingTimeMinutes)}</span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-16 relative items-start">
              <TableOfContents items={tocItems} />

              <div className="flex-1 min-w-0 max-w-3xl">
                <ContentRenderer post={post} />
                <FaqAccordion items={post.faq} />
              </div>
            </div>

            <NewsletterCTA />
            <RelatedArticles post={post} />
          </main>
        </>
      )}

      <Footer />
    </div>
  );
}
