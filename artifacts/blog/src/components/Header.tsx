import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, Search, X, Loader2 } from "lucide-react";
import {
  useListCategories,
  useSearchPosts,
  getSearchPostsQueryKey,
} from "@workspace/api-client-react";
import { cn } from "@workspace/ui";
import { categoryPath, searchPath, postPath } from "@/lib/blog";
import { useDebounce } from "@/hooks/use-debounce";
import { useRef, useEffect } from "react";

const LOGO = "https://cdn-imgix-open.headout.com/logo/svg/Headout_blog.svg";

const MAX_NAV_CATEGORIES = 8;

export function Header() {
  const { data: categories } = useListCategories();
  const [location, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  
  const debouncedQuery = useDebounce(query, 300);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropdownOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const navCategories = (categories ?? []).slice(0, MAX_NAV_CATEGORIES);

  useEffect(() => {
    setMobileOpen(false);
    setDropdownOpen(false);
    setQuery("");
  }, [location]);

  const { data: searchData, isFetching: isSearching } = useSearchPosts(
    { q: debouncedQuery, page: 1, limit: 5 },
    {
      query: {
        queryKey: getSearchPostsQueryKey({ q: debouncedQuery, page: 1, limit: 5 }),
        enabled: debouncedQuery.trim().length >= 2,
      },
    }
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q) {
      navigate(searchPath(q));
      setQuery("");
      setDropdownOpen(false);
    }
  };

  const handleSearchFocus = () => {
    if (query.trim().length >= 2) {
      setDropdownOpen(true);
    }
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    if (e.target.value.trim().length >= 2) {
      setDropdownOpen(true);
    } else {
      setDropdownOpen(false);
    }
  };

  return (
    <header className="w-full bg-card border-b border-border/40 sticky top-0 z-50 shadow-sm">
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

        <div className="relative hidden md:block shrink-0" ref={dropdownRef}>
          <form
            onSubmit={submit}
            className="relative flex items-center shrink-0 group"
            role="search"
          >
            <Search className="absolute left-3 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
            <input
              type="search"
              value={query}
              onChange={handleSearchChange}
              onFocus={handleSearchFocus}
              placeholder="Search articles"
              aria-label="Search articles"
              className="h-10 w-56 lg:w-64 rounded-full border border-border/60 bg-muted/30 pl-10 pr-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:bg-background transition-all"
            />
          </form>

          {dropdownOpen && query.trim().length >= 2 && (
            <div className="absolute top-full right-0 mt-2 w-80 bg-popover rounded-2xl shadow-xl border border-border overflow-hidden flex flex-col z-50">
              {isSearching ? (
                <div className="p-8 flex justify-center text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : searchData?.items.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No results found for "{query}"
                </div>
              ) : (
                <div className="py-2 flex flex-col">
                  {searchData?.items.map((item) => (
                    <Link
                      key={item.id}
                      href={postPath(item.slug)}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                      onClick={() => setDropdownOpen(false)}
                    >
                      {item.featuredImageUrl ? (
                        <img
                          src={item.featuredImageUrl}
                          alt=""
                          className="w-10 h-10 rounded-md object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                          <Search className="w-4 h-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground truncate">
                          {item.title}
                        </div>
                        {item.primaryCategory && (
                          <div className="text-xs text-primary truncate uppercase tracking-widest mt-0.5">
                            {item.primaryCategory.name}
                          </div>
                        )}
                      </div>
                    </Link>
                  ))}
                  <Link
                    href={searchPath(query)}
                    className="mt-2 mx-4 py-2 text-center text-sm font-medium text-primary hover:bg-primary/5 rounded-lg transition-colors"
                    onClick={() => setDropdownOpen(false)}
                  >
                    View all results
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          aria-controls="mobile-menu"
          className="md:hidden inline-flex items-center justify-center h-10 w-10 -mr-2 rounded-full text-foreground hover:bg-muted transition-colors"
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
          "md:hidden absolute top-full left-0 w-full bg-card border-b border-border shadow-lg transition-all duration-300 ease-out z-40 origin-top",
          mobileOpen
            ? "scale-y-100 opacity-100"
            : "scale-y-0 opacity-0 pointer-events-none"
        )}
      >
        <div className="max-w-7xl mx-auto px-6 py-6 space-y-6 max-h-[calc(100vh-4rem)] overflow-y-auto">
          <div className="relative">
            <form onSubmit={submit} className="relative flex items-center group" role="search">
              <Search className="absolute left-4 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search articles..."
                aria-label="Search articles"
                className="h-12 w-full rounded-2xl border border-border bg-muted/30 pl-11 pr-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:bg-background transition-all"
              />
            </form>
            
            {query.trim().length >= 2 && (
              <div className="mt-4 border border-border rounded-2xl bg-background overflow-hidden">
                {isSearching ? (
                  <div className="p-6 flex justify-center text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                ) : searchData?.items.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    No results found for "{query}"
                  </div>
                ) : (
                  <div className="py-2">
                    {searchData?.items.map((item) => (
                      <Link
                        key={item.id}
                        href={postPath(item.slug)}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                      >
                        {item.featuredImageUrl ? (
                          <img
                            src={item.featuredImageUrl}
                            alt=""
                            className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                          />
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-foreground line-clamp-2 leading-snug">
                            {item.title}
                          </div>
                          {item.primaryCategory && (
                            <div className="text-xs text-primary uppercase tracking-widest mt-1">
                              {item.primaryCategory.name}
                            </div>
                          )}
                        </div>
                      </Link>
                    ))}
                    <Link
                      href={searchPath(query)}
                      className="block mt-2 mx-4 py-3 text-center text-sm font-medium bg-muted/50 text-foreground rounded-xl"
                    >
                      View all results
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>

          <nav aria-label="Mobile" className="flex flex-col gap-2">
            {navCategories.map((cat) => (
              <Link
                key={cat.id}
                href={categoryPath(cat.slug)}
                className="text-base font-semibold text-foreground hover:text-primary transition-colors py-3 px-4 rounded-xl hover:bg-muted/50"
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
