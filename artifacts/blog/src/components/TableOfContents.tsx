import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@workspace/ui";
import type { TocItem } from "@workspace/blog-renderer";

export function TableOfContents({ items }: { items: TocItem[] }) {
  const [activeId, setActiveId] = useState<string>("");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    items.forEach((item) => {
      const el = document.getElementById(item.id);
      if (el) {
        const observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) setActiveId(item.id);
            });
          },
          { rootMargin: "-20% 0px -80% 0px" },
        );
        observer.observe(el);
        observers.push(observer);
      }
    });
    return () => observers.forEach((o) => o.disconnect());
  }, [items]);

  if (items.length === 0) return null;

  const scrollTo = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setMobileOpen(false);
  };

  const links = (
    <ul className="space-y-4">
      {items.map((item, idx) => (
        <li key={item.id}>
          <a
            href={`#${item.id}`}
            onClick={(e) => scrollTo(e, item.id)}
            className={cn(
              "text-sm transition-all duration-200 flex items-center gap-3 group",
              activeId === item.id
                ? "text-primary font-medium lg:translate-x-1"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "text-xs font-mono w-5 opacity-50 transition-opacity group-hover:opacity-100",
                activeId === item.id && "opacity-100 text-primary",
              )}
            >
              {(idx + 1).toString().padStart(2, "0")}
            </span>
            {item.label}
          </a>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <nav
        aria-label="Table of contents"
        className="sticky top-24 lg:top-28 max-h-[calc(100vh-8rem)] overflow-y-auto hidden lg:block pr-8 w-64 shrink-0"
      >
        <h3 className="font-serif text-lg font-medium text-foreground mb-6 pb-4 border-b border-border/50">
          In this article
        </h3>
        {links}
      </nav>

      <nav aria-label="Table of contents" className="lg:hidden mb-10">
        <button
          type="button"
          onClick={() => setMobileOpen((o) => !o)}
          aria-expanded={mobileOpen}
          className="w-full flex items-center justify-between rounded-2xl border border-border/60 bg-card px-5 py-4 text-left"
        >
          <span className="font-serif text-lg font-medium text-foreground">
            In this article
          </span>
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
