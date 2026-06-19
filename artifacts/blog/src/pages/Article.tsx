import { useEffect, useMemo } from "react";
import { Link, useRoute } from "wouter";
import { ChevronRight } from "lucide-react";
import { cn } from "@workspace/ui";
import {
  useGetPostBySlug,
  useListPosts,
  useRecordPageView,
  useResolveRedirect,
  getResolveRedirectQueryKey,
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
import { ShareBar } from "@/components/ShareBar";
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
            className="w-full h-full object-cover opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-foreground/80 via-foreground/60 to-foreground/95" />
        </div>
      ) : null}

      <div className="relative max-w-4xl mx-auto px-6 lg:px-12 py-24 md:py-32 text-center">
        {post.primaryCategory ? (
          <Link
            href={categoryPath(post.primaryCategory.slug)}
            className="inline-flex items-center justify-center px-4 py-1.5 rounded-full bg-primary/20 text-primary-foreground text-xs md:text-sm font-semibold uppercase tracking-widest backdrop-blur-sm hover:bg-primary/30 transition-colors mb-8 border border-primary/30"
          >
            {post.primaryCategory.name}
          </Link>
        ) : null}
        <h1 className="font-serif text-4xl md:text-6xl lg:text-7xl leading-[1.1] tracking-tight text-background mb-8">
          {post.title}
        </h1>
        {post.subtitle ? (
          <p className="text-lg md:text-2xl text-background/80 max-w-3xl mx-auto mb-8 font-light leading-relaxed">
            {post.subtitle}
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
    <div className="w-full bg-background border-b border-border/40 sticky top-16 md:top-20 z-40 backdrop-blur-md bg-background/80">
      <nav
        aria-label="Breadcrumb"
        className="max-w-7xl mx-auto px-6 lg:px-12 py-3 flex items-center flex-wrap gap-x-2 gap-y-1 text-sm overflow-hidden"
      >
        {trail.map((crumb, idx) => {
          const isLast = idx === trail.length - 1;
          return (
            <span key={idx} className="flex items-center gap-x-2 shrink-0">
              {crumb.href && !isLast ? (
                <Link href={crumb.href} className="text-muted-foreground hover:text-primary transition-colors">
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={isLast ? "text-foreground font-medium truncate max-w-[200px] md:max-w-[400px]" : "text-primary"}
                  {...(isLast ? { "aria-current": "page" as const } : {})}
                >
                  {crumb.label}
                </span>
              )}
              {!isLast && (
                <ChevronRight
                  className="w-3.5 h-3.5 shrink-0 text-muted-foreground/50"
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
    <section className="my-24 pt-16 border-t border-border/40">
      <h2 className="font-serif text-3xl md:text-4xl text-foreground mb-12 tracking-tight">
        Keep exploring
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {related.map((p) => (
          <PostCard key={p.id} post={p} />
        ))}
      </div>
    </section>
  );
}

export function ArticleView({
  post,
  isPreview = false,
}: {
  post: PostDetail;
  isPreview?: boolean;
}) {
  const tocItems = useMemo(() => {
    if (post.contentHtml && post.contentHtml.trim().length > 0) {
      return prepareArticleHtml(post.contentHtml).toc;
    }
    return tocFromComponentTree(asComponentTree(post.componentTree));
  }, [post.contentHtml, post.componentTree]);

  const jsonLd = useMemo(
    () => (post.jsonld ?? []).map((b) => b.data),
    [post.jsonld],
  );

  useSeo({
    title: `${post.seo?.metaTitle ?? post.title} | Headout Blog`,
    description: post.seo?.metaDescription ?? post.excerpt,
    canonicalUrl: post.seo?.canonicalUrl ?? post.canonicalUrl,
    ogTitle: post.seo?.ogTitle ?? post.title,
    ogDescription: post.seo?.ogDescription ?? post.excerpt,
    ogImage: post.seo?.ogImage ?? post.featuredImageUrl,
    ogType: "article",
    jsonLd: isPreview ? [] : jsonLd,
  });

  useEffect(() => {
    if (!isPreview) return;
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex,nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, [isPreview]);

  const date = formatDate(post.publishedAt ?? post.modifiedAt);

  return (
    <>
      {isPreview ? (
        <div className="w-full bg-amber-500 text-amber-950 text-center text-sm font-medium py-2 px-4 sticky top-0 z-[60]">
          Preview — this is an unpublished draft. Don't share beyond your team.
        </div>
      ) : null}
      <ArticleHero post={post} />
      <Breadcrumbs post={post} />

      <main className="flex-1 w-full max-w-7xl mx-auto px-6 lg:px-12 py-12 md:py-20">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-16 pb-8 border-b border-border/40">
          <div className="flex items-center gap-5">
            {post.author ? (
              <Link
                href={authorPath(post.author.slug)}
                className="group shrink-0"
              >
                <Avatar className="w-14 h-14 border border-border group-hover:border-primary transition-colors">
                  {post.author.avatarUrl ? (
                    <AvatarImage
                      src={post.author.avatarUrl}
                      alt={post.author.name}
                      className="object-cover"
                    />
                  ) : null}
                  <AvatarFallback className="bg-muted text-muted-foreground group-hover:text-primary transition-colors">
                    {post.author.name.charAt(0)}
                  </AvatarFallback>
                </Avatar>
              </Link>
            ) : null}
            <div>
              {post.author ? (
                <Link
                  href={authorPath(post.author.slug)}
                  className="font-medium text-foreground hover:text-primary transition-colors text-base"
                >
                  {post.author.name}
                </Link>
              ) : null}
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                {date ? <span>{date}</span> : null}
                {date && readingTimeLabel(post.readingTimeMinutes) ? <span>&middot;</span> : null}
                {readingTimeLabel(post.readingTimeMinutes) ? (
                  <span>{readingTimeLabel(post.readingTimeMinutes)}</span>
                ) : null}
              </div>
            </div>
          </div>

          <ShareBar url={post.canonicalUrl} title={post.title} />
        </div>

        <div
          className={cn(
            "flex flex-col lg:flex-row gap-16 relative lg:items-start",
            tocItems.length === 0 && "lg:justify-center",
          )}
        >
          <TableOfContents items={tocItems} />

          <div className="w-full flex-1 min-w-0 max-w-3xl">
            <ContentRenderer post={post} />
            <FaqAccordion items={post.faq} />
          </div>
        </div>

        <NewsletterCTA />
        {isPreview ? null : <RelatedArticles post={post} />}
      </main>
    </>
  );
}

export default function Article() {
  const [, params] = useRoute("/:slug");
  const slug = params?.slug ?? "";
  const { data: post, isLoading, isError } = useGetPostBySlug(slug);

  const { mutate: recordView } = useRecordPageView();
  useEffect(() => {
    if (post?.slug) {
      recordView({ data: { slug: post.slug } });
    }
  }, [post?.slug, recordView]);

  return (
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/20">
      <Header />

      {isLoading ? (
        <LoadingState label="Loading article…" />
      ) : isError || !post ? (
        <RedirectOrNotFound slug={slug} />
      ) : (
        <ArticleView post={post} />
      )}

      <Footer />
    </div>
  );
}

function RedirectOrNotFound({ slug }: { slug: string }) {
  const path = useMemo(() => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    return `${base}/${slug}`;
  }, [slug]);

  const { data, isLoading } = useResolveRedirect(
    { path },
    {
      query: {
        enabled: slug.length > 0,
        queryKey: getResolveRedirectQueryKey({ path }),
      },
    },
  );

  useEffect(() => {
    if (data?.found && data.toPath) {
      window.location.replace(data.toPath);
    }
  }, [data]);

  if (isLoading || data?.found) {
    return <LoadingState label="Redirecting…" />;
  }

  return (
    <ErrorState
      title="Article not found"
      message="The article you're looking for doesn't exist or may have moved."
    />
  );
}
