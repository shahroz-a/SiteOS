import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import type { TocEntry } from "@/lib/post-content";

interface ContentTocProps {
  entries: TocEntry[];
  heading?: string;
}

/**
 * Sticky, scroll-spying table of contents built from a post's section anchors.
 * Collapses into a disclosure on small screens.
 */
export function ContentToc({ entries, heading = "In this article" }: ContentTocProps) {
  const [activeId, setActiveId] = useState<string>("");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const observers = new Map<string, IntersectionObserver>();

    entries.forEach((entry) => {
      const element = document.getElementById(entry.id);
      if (!element) return;
      const observer = new IntersectionObserver(
        (obsEntries) => {
          obsEntries.forEach((e) => {
            if (e.isIntersecting) setActiveId(entry.id);
          });
        },
        { rootMargin: "-20% 0px -80% 0px" },
      );
      observer.observe(element);
      observers.set(entry.id, observer);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, [entries]);

  if (entries.length === 0) return null;

  const scrollTo = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setMobileOpen(false);
  };

  const links = (
    <ul className="space-y-4">
      {entries.map((entry, idx) => (
        <li key={entry.id}>
          <a
            href={`#${entry.id}`}
            onClick={(e) => scrollTo(e, entry.id)}
            className={cn(
              "text-sm transition-all duration-200 flex items-center gap-3 group",
              activeId === entry.id
                ? "text-primary font-medium lg:translate-x-1"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "text-xs font-mono w-5 opacity-50 transition-opacity group-hover:opacity-100",
                activeId === entry.id && "opacity-100 text-primary",
              )}
            >
              {(idx + 1).toString().padStart(2, "0")}
            </span>
            {entry.label}
          </a>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <nav
        aria-label="Table of contents"
        className="sticky top-20 lg:top-28 max-h-[calc(100vh-8rem)] overflow-y-auto hidden lg:block pr-8 w-64 shrink-0"
      >
        <h3 className="font-serif text-lg font-medium text-foreground mb-6 pb-4 border-b border-border/50">
          {heading}
        </h3>
        {links}
      </nav>

      <nav aria-label="Table of contents" className="lg:hidden mb-12">
        <button
          type="button"
          onClick={() => setMobileOpen((o) => !o)}
          aria-expanded={mobileOpen}
          className="w-full flex items-center justify-between rounded-2xl border border-border/60 bg-card px-5 py-4 text-left"
        >
          <span className="font-serif text-lg font-medium text-foreground">{heading}</span>
          <ChevronDown
            className={cn(
              "w-5 h-5 text-muted-foreground transition-transform duration-300",
              mobileOpen && "rotate-180",
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
