import { useEffect } from "react";
import { siteMeta, intro, destinations, summary, author, shareLinks } from "@/data/content";
import { ArticleHeader } from "@/components/ArticleHeader";
import { RichText } from "@/components/RichText";
import { TableOfContents } from "@/components/TableOfContents";
import { DestinationSection } from "@/components/DestinationSection";
import { NewsletterCTA } from "@/components/NewsletterCTA";
import { Footer } from "@/components/Footer";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

export default function Article() {
  useEffect(() => {
    document.title = siteMeta.title;
    
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
        <div className="max-w-3xl mx-auto text-xl md:text-2xl leading-relaxed text-foreground/80 font-serif mb-20 text-center">
          <RichText segments={intro} />
        </div>

        {/* Main Content Area */}
        <div className="flex flex-col lg:flex-row gap-16 relative items-start">
          <TableOfContents destinations={destinations} />
          
          <div className="flex-1 min-w-0">
            {destinations.map((destination) => (
              <DestinationSection key={destination.id} destination={destination} />
            ))}

            {/* Summary Section */}
            <section id="summary" className="scroll-mt-24 mb-24 bg-card rounded-3xl p-8 md:p-12 shadow-sm border border-card-border">
              <h2 className="text-sm font-bold tracking-widest uppercase text-primary mb-4">
                {summary.heading}
              </h2>
              <h3 className="text-3xl font-serif text-foreground mb-8">
                {summary.title}
              </h3>
              <ol className="grid sm:grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-8">
                {destinations.map((dest) => (
                  <li key={dest.id} className="flex items-center gap-3">
                    <span className="text-primary font-mono text-sm">
                      {dest.number.toString().padStart(2, '0')}
                    </span>
                    <a 
                      href={`#${dest.id}`}
                      className="font-medium hover:text-primary transition-colors"
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById(dest.id)?.scrollIntoView({ behavior: "smooth" });
                      }}
                    >
                      {dest.name}
                    </a>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </div>

        <NewsletterCTA />
      </main>

      <Footer />
    </div>
  );
}
