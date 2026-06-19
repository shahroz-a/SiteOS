import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Search } from "lucide-react";
import { useListCategories } from "@workspace/api-client-react";
import { categoryPath, searchPath } from "@/lib/blog";

const LOGO = "https://cdn-imgix-open.headout.com/logo/svg/Headout_blog.svg";

const MAX_NAV_CATEGORIES = 8;

export function Header() {
  const { data: categories } = useListCategories();
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");

  // The API returns the navigable top-level categories already ordered by post
  // count, so the first few are the most popular destinations/topics.
  const navCategories = (categories ?? []).slice(0, MAX_NAV_CATEGORIES);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q) navigate(searchPath(q));
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
          className="relative hidden sm:flex items-center shrink-0"
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
      </div>
    </header>
  );
}
