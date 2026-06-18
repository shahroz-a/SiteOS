import { useEffect, useState } from "react";
import { Destination, tocHeading } from "@/data/content";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

interface TableOfContentsProps {
  destinations: Destination[];
}

export function TableOfContents({ destinations }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>("");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const observers = new Map<string, IntersectionObserver>();
    
    destinations.forEach((dest) => {
      const element = document.getElementById(dest.id);
      if (element) {
        const observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                setActiveId(dest.id);
              }
            });
          },
          { rootMargin: "-20% 0px -80% 0px" }
        );
        observer.observe(element);
        observers.set(dest.id, observer);
      }
    });

    return () => {
      observers.forEach((observer) => observer.disconnect());
    };
  }, [destinations]);

  const scrollTo = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setMobileOpen(false);
  };

  const links = (
    <ul className="space-y-4">
      {destinations.map((dest) => (
        <li key={dest.id}>
          <a
            href={`#${dest.id}`}
            onClick={(e) => scrollTo(e, dest.id)}
            className={cn(
              "text-sm transition-all duration-200 flex items-center gap-3 group",
              activeId === dest.id
                ? "text-primary font-medium lg:translate-x-1"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span className={cn(
              "text-xs font-mono w-5 opacity-50 transition-opacity group-hover:opacity-100",
              activeId === dest.id && "opacity-100 text-primary"
            )}>
              {dest.number.toString().padStart(2, '0')}
            </span>
            {dest.name}
          </a>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      {/* Desktop: sticky sidebar */}
      <nav
        aria-label="Table of contents"
        className="sticky top-20 lg:top-28 max-h-[calc(100vh-8rem)] overflow-y-auto hidden lg:block pr-8 w-64 shrink-0"
      >
        <h3 className="font-serif text-lg font-medium text-foreground mb-6 pb-4 border-b border-border/50">
          {tocHeading}
        </h3>
        {links}
      </nav>

      {/* Mobile/tablet: collapsible disclosure */}
      <nav aria-label="Table of contents" className="lg:hidden mb-12">
        <button
          type="button"
          onClick={() => setMobileOpen((o) => !o)}
          aria-expanded={mobileOpen}
          className="w-full flex items-center justify-between rounded-2xl border border-border/60 bg-card px-5 py-4 text-left"
        >
          <span className="font-serif text-lg font-medium text-foreground">
            {tocHeading}
          </span>
          <ChevronDown
            className={cn(
              "w-5 h-5 text-muted-foreground transition-transform duration-300",
              mobileOpen && "rotate-180"
            )}
          />
        </button>
        {mobileOpen && (
          <div className="mt-3 rounded-2xl border border-border/60 bg-card px-5 py-5">
            {links}
          </div>
        )}
      </nav>
    </>
  );
}
