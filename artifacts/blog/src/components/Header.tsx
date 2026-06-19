import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, Search, X } from "lucide-react";
import { useListCategories } from "@workspace/api-client-react";
import { cn } from "@workspace/ui";
import { categoryPath, searchPath } from "@/lib/blog";

const LOGO = "https://cdn-imgix-open.headout.com/logo/svg/Headout_blog.svg";

const MAX_NAV_CATEGORIES = 8;

export function Header() {
  const { data: categories } = useListCategories();
  const [location, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  // The API returns the navigable top-level categories already ordered by post
  // count, so the first few are the most popular destinations/topics.
  const navCategories = (categories ?? []).slice(0, MAX_NAV_CATEGORIES);

  // Always close the mobile drawer once navigation lands on a new route.
  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q) {
      navigate(searchPath(q));
      setQuery("");
    }
  };

  return (
    <header className="w-full bg-card border-b border-border/40 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 lg:px-12 h-16 md:h-20 flex items-center justify-between gap-6">
        <Link
          href="/"
          className="inline-block shrink-0 hover:opacity-80 transition-opacity"
        >
          <img src={LOGO} alt="Headout Blog" className="h-6 md:h-7 w-auto" />
        </Link>

        <nav
          aria-label="Primary"
          className="hidden md:flex items-center gap-6 lg:gap-7"
        >
          {navCategories.map((cat) => (
            <Link
              key={cat.id}
              href={categoryPath(cat.slug)}
              className="text-xs font-semibold uppercase tracking-wide text-foreground/80 hover:text-primary transition-colors whitespace-nowrap"
            >
              {cat.name}
            </Link>
          ))}
        </nav>

        <form
          onSubmit={submit}
          className="relative hidden md:flex items-center shrink-0"
          role="search"
        >
          <Search className="absolute left-3 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search articles"
            aria-label="Search articles"
            className="h-9 w-40 lg:w-56 rounded-full border border-border/60 bg-background pl-9 pr-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-all"
          />
        </form>

        <button
          type="button"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          aria-controls="mobile-menu"
          className="md:hidden inline-flex items-center justify-center h-10 w-10 -mr-2 rounded-full text-foreground hover-elevate"
        >
          {mobileOpen ? (
            <X className="w-5 h-5" />
          ) : (
            <Menu className="w-5 h-5" />
          )}
        </button>
      </div>

      <div
        id="mobile-menu"
        inert={!mobileOpen}
        className={cn(
          "md:hidden border-t border-border/40 transition-[max-height,opacity] duration-300 ease-out",
          mobileOpen
            ? "max-h-[80vh] opacity-100 overflow-y-auto"
            : "max-h-0 opacity-0 overflow-hidden pointer-events-none border-t-0",
        )}
      >
        <div className="max-w-7xl mx-auto px-6 py-5 space-y-5">
          <form onSubmit={submit} className="relative flex items-center" role="search">
            <Search className="absolute left-4 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search articles"
              aria-label="Search articles"
              className="h-11 w-full rounded-full border border-border/60 bg-background pl-11 pr-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-all"
            />
          </form>

          <nav aria-label="Mobile" className="flex flex-col">
            {navCategories.map((cat) => (
              <Link
                key={cat.id}
                href={categoryPath(cat.slug)}
                className="text-sm font-semibold uppercase tracking-wide text-foreground/80 hover:text-primary transition-colors py-3 border-b border-border/40 last:border-b-0"
              >
                {cat.name}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
