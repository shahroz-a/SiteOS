import { Link, useParams } from "wouter";
import { useGetPostBySlug } from "@workspace/api-client-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { NewsletterCTA } from "@/components/NewsletterCTA";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ContentToc } from "@/components/ContentToc";
import { ContentTree } from "@/components/ContentTree";
import { FaqSection } from "@/components/FaqSection";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Clock, AlertCircle, ArrowLeft } from "lucide-react";
import { useSeo } from "@/lib/seo";
import {
  getComponentTree,
  buildToc,
  formatDate,
} from "@/lib/post-content";

export default function PostDetail() {
  const params = useParams();
  const slug = params.slug ?? "";

  const { data: post, isLoading, isError, error } = useGetPostBySlug(slug);

  useSeo({
    title: post?.title,
    description: post?.excerpt,
    seo: post?.seo ?? null,
    jsonld: post?.jsonld,
  });

  if (isLoading) {
    return (
      <PageShell>
        <div className="max-w-3xl mx-auto px-6 py-20 space-y-6">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </PageShell>
    );
  }

  if (isError || !post) {
    const notFound = !!error && (error as { status?: number }).status === 404;
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center text-center py-32 px-6 gap-4">
          <AlertCircle className="w-12 h-12 text-destructive" />
          <h1 className="font-serif text-3xl text-foreground">
            {notFound ? "Article not found" : "Couldn't load this article"}
          </h1>
          <p className="text-muted-foreground max-w-md">
            {notFound
              ? "The article you're looking for doesn't exist or may have moved."
              : error instanceof Error
                ? error.message
                : "Please try again later."}
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-primary font-medium hover:underline"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to all articles
          </Link>
        </div>
      </PageShell>
    );
  }

  const tree = getComponentTree(post);
  const toc = buildToc(tree);
  const published = formatDate(post.publishedAt);
  const updated = formatDate(post.modifiedAt);
  const inlineImages = post.images
    .filter((img) => img.role !== "featured")
    .sort((a, b) => a.position - b.position);

  return (
    <PageShell>
      {/* Hero */}
      <section className="relative w-full overflow-hidden bg-foreground text-background">
        {post.featuredImageUrl && (
          <div className="absolute inset-0">
            <img
              src={post.featuredImageUrl}
              alt={post.featuredImageAlt ?? post.title}
              className="w-full h-full object-cover opacity-35"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-foreground/75 via-foreground/65 to-foreground/85" />
          </div>
        )}
        <div className="relative max-w-4xl mx-auto px-6 lg:px-12 py-20 md:py-28 lg:py-32 text-center">
          {post.primaryCategory && (
            <span className="inline-block text-xs md:text-sm font-semibold uppercase tracking-widest text-primary mb-5">
              {post.primaryCategory.name}
            </span>
          )}
          <h1 className="font-serif text-3xl md:text-5xl lg:text-6xl leading-tight text-background mb-6">
            {post.title}
          </h1>
          {post.subtitle && (
            <p className="text-lg md:text-xl text-background/80 max-w-2xl mx-auto mb-6">
              {post.subtitle}
            </p>
          )}
          <div className="flex items-center justify-center gap-4 text-sm text-background/70">
            {(updated || published) && (
              <span>
                {updated ? "Updated" : "Published"}: {updated ?? published}
              </span>
            )}
            {typeof post.readingTimeMinutes === "number" && (
              <span className="inline-flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {post.readingTimeMinutes} min read
              </span>
            )}
          </div>
        </div>
      </section>

      <Breadcrumbs items={post.breadcrumbs} />

      <main className="flex-1 w-full max-w-7xl mx-auto px-6 lg:px-12 py-12 md:py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors mb-10"
        >
          <ArrowLeft className="w-4 h-4" />
          All articles
        </Link>

        {/* Author */}
        {post.author && (
          <div className="flex items-center gap-4 mb-16 border-b border-border/40 pb-8">
            <Avatar className="w-12 h-12 border-2 border-primary/10">
              {post.author.avatarUrl && (
                <AvatarImage src={post.author.avatarUrl} alt={post.author.name} />
              )}
              <AvatarFallback>{post.author.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <div>
              <div className="text-sm text-muted-foreground">Written by</div>
              <div className="font-medium text-foreground">{post.author.name}</div>
              {post.author.role && (
                <div className="text-xs text-muted-foreground">{post.author.role}</div>
              )}
            </div>
          </div>
        )}

        {/* Lead */}
        {post.excerpt && (
          <div className="max-w-3xl text-base md:text-lg leading-relaxed text-foreground/80 mb-16">
            {post.excerpt}
          </div>
        )}

        {/* Body */}
        <div className="flex flex-col lg:flex-row gap-16 relative items-start">
          <ContentToc entries={toc} />
          <div className="flex-1 min-w-0">
            {tree?.children ? (
              <ContentTree nodes={tree.children} postTitle={post.title} />
            ) : post.contentHtml ? (
              <div
                className="prose prose-stone max-w-none"
                dangerouslySetInnerHTML={{ __html: post.contentHtml }}
              />
            ) : (
              <p className="text-muted-foreground">No content available.</p>
            )}

            {/* Inline images */}
            {inlineImages.length > 0 && (
              <div className="space-y-10 mt-16">
                {inlineImages.map((img) => (
                  <figure key={img.id}>
                    <div className="rounded-2xl overflow-hidden shadow-md">
                      <AspectRatio ratio={16 / 9}>
                        <img
                          src={img.url}
                          alt={img.alt ?? ""}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      </AspectRatio>
                    </div>
                    {(img.caption || img.credit) && (
                      <figcaption className="mt-3 text-sm text-muted-foreground text-center">
                        {img.caption}
                        {img.credit && (
                          <span className="opacity-70">
                            {img.caption ? " · " : ""}
                            {img.credit}
                          </span>
                        )}
                      </figcaption>
                    )}
                  </figure>
                ))}
              </div>
            )}

            {/* Tags */}
            {post.tags.length > 0 && (
              <div className="flex items-center flex-wrap gap-2 mt-16 pt-8 border-t border-border/40">
                <span className="text-sm text-muted-foreground mr-1">Tags:</span>
                {post.tags.map((tag) => (
                  <Badge key={tag.id} variant="secondary" className="rounded-full">
                    {tag.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        <FaqSection items={post.faq} />

        <NewsletterCTA />
      </main>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/20">
      <Header />
      {children}
      <Footer />
    </div>
  );
}
