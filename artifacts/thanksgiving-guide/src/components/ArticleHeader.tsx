import { siteMeta } from "@/data/content";
import { ChevronRight } from "lucide-react";

/**
 * Article-specific header: the full-width hero banner (category eyebrow, title,
 * "Last Updated" date over the banner image) followed by the breadcrumb trail.
 * Kept separate from the reusable site chrome in Header.tsx.
 */
export function ArticleHeader() {
  const { category, pageTitle, lastUpdated, heroImage, breadcrumb } = siteMeta;

  return (
    <>
      {/* Hero banner */}
      <section className="relative w-full overflow-hidden bg-foreground text-background">
        <div className="absolute inset-0">
          <img
            src={heroImage}
            alt={pageTitle}
            className="w-full h-full object-cover opacity-35"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-foreground/75 via-foreground/65 to-foreground/85" />
        </div>

        <div className="relative max-w-4xl mx-auto px-6 lg:px-12 py-20 md:py-28 lg:py-32 text-center">
          <a
            href={category.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-xs md:text-sm font-semibold uppercase tracking-widest text-primary hover:opacity-80 transition-opacity mb-5"
          >
            {category.label}
          </a>
          <h1 className="font-serif text-3xl md:text-5xl lg:text-6xl leading-tight text-background mb-6">
            {pageTitle}
          </h1>
          <p className="text-sm md:text-base text-background/70">
            Last Updated: {lastUpdated}
          </p>
        </div>
      </section>

      {/* Breadcrumb */}
      <div className="w-full bg-background border-b border-border/40">
        <nav
          aria-label="Breadcrumb"
          className="max-w-7xl mx-auto px-6 lg:px-12 py-4 flex items-center flex-wrap gap-x-2 gap-y-1 text-sm"
        >
          {breadcrumb.map((crumb, idx) => {
            const isLast = idx === breadcrumb.length - 1;
            return (
              <span key={idx} className="flex items-center gap-x-2">
                {crumb.href && !isLast ? (
                  <a
                    href={crumb.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {crumb.label}
                  </a>
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
    </>
  );
}
