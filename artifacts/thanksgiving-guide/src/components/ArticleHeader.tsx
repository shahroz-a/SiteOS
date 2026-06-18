import { siteMeta } from "@/data/content";

export function ArticleHeader() {
  return (
    <header className="w-full py-8 md:py-12 px-6 flex flex-col items-center border-b border-border/40">
      <a
        href={siteMeta.blogHref}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-8 hover:opacity-80 transition-opacity"
      >
        <img 
          src={siteMeta.logo} 
          alt={siteMeta.blogName} 
          className="h-8 md:h-10 w-auto"
        />
      </a>
      <div className="max-w-4xl mx-auto text-center space-y-6">
        <div className="text-primary font-medium tracking-wide uppercase text-sm">
          {siteMeta.category}
        </div>
        <h1 className="text-4xl md:text-5xl lg:text-7xl font-serif text-foreground leading-tight max-w-3xl mx-auto">
          {siteMeta.title}
        </h1>
      </div>
    </header>
  );
}
