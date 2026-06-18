import { siteMeta } from "@/data/content";
import { ChevronRight } from "lucide-react";

export function ArticleHeader() {
  return (
    <header className="w-full border-b border-border/40">
      <div className="max-w-7xl mx-auto px-6 lg:px-12 py-8 md:py-10">
        <a
          href={siteMeta.blogHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mb-8 hover:opacity-80 transition-opacity"
        >
          <img
            src={siteMeta.logo}
            alt={siteMeta.blogName}
            className="h-7 md:h-8 w-auto"
          />
        </a>

        <nav
          aria-label="Breadcrumb"
          className="flex items-center flex-wrap gap-x-2 gap-y-1 text-sm text-muted-foreground mb-5"
        >
          <a
            href={siteMeta.blogHref}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-primary transition-colors"
          >
            {siteMeta.blogName}
          </a>
          <ChevronRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="text-foreground/70">{siteMeta.category}</span>
        </nav>

        <h1 className="text-3xl md:text-4xl lg:text-5xl font-serif text-foreground leading-tight max-w-3xl">
          {siteMeta.title}
        </h1>
      </div>
    </header>
  );
}
