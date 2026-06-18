import { useEffect } from "react";
import { siteMeta, intro, destinations, author, shareLinks } from "@/data/content";
import { Header } from "@/components/Header";
import { ArticleHeader } from "@/components/ArticleHeader";
import { RichText } from "@/components/RichText";
import { TableOfContents } from "@/components/TableOfContents";
import { DestinationSection } from "@/components/DestinationSection";
import { NewsletterCTA } from "@/components/NewsletterCTA";
import { Footer } from "@/components/Footer";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

export default function Article() {
  useEffect(() => {
    document.title = siteMeta.pageTitle;
    
    // Update meta tags
    const updateMeta = (name: string, content: string) => {
      let meta = document.querySelector(`meta[name="${name}"]`);
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", name);
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", content);
    };

    updateMeta("description", siteMeta.metaDescription);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/20">
      <Header />
      <ArticleHeader />
      
      <main className="flex-1 w-full max-w-7xl mx-auto px-6 lg:px-12 py-12 md:py-16">
        
        {/* Author & Share */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-16 border-b border-border/40 pb-8">
          <a href={author.href} className="flex items-center gap-4 group hover:opacity-80 transition-opacity">
            <Avatar className="w-12 h-12 border-2 border-primary/10">
              <AvatarImage src={author.avatar} alt={author.name} />
              <AvatarFallback>{author.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <div>
              <div className="text-sm text-muted-foreground">Written by</div>
              <div className="font-medium text-foreground group-hover:text-primary transition-colors">
                {author.name}
              </div>
            </div>
          </a>
          
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">Share</span>
            <div className="flex items-center gap-2">
              {shareLinks.map((link, idx) => (
                <a
                  key={idx}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium px-4 py-2 rounded-full bg-secondary text-secondary-foreground hover:bg-primary hover:text-primary-foreground transition-colors"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Intro */}
        <div className="max-w-3xl text-base md:text-lg leading-relaxed text-foreground/80 mb-16">
          <RichText segments={intro} />
        </div>

        {/* Main Content Area */}
        <div className="flex flex-col lg:flex-row gap-16 relative items-start">
          <TableOfContents destinations={destinations} />
          
          <div className="flex-1 min-w-0">
            {destinations.map((destination) => (
              <DestinationSection key={destination.id} destination={destination} />
            ))}

            {/*
              TODO: "More reads" / related-articles section.
              Intentionally NOT built yet. The original article ends with a
              "More reads" block of links to other Headout blog posts. Building
              it requires a full-site scrape + cross-page link data (sitemap),
              which the user will provide later. Do not implement until then.
            */}
          </div>
        </div>

        <NewsletterCTA />
      </main>

      <Footer />
    </div>
  );
}
