import { Link } from "wouter";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaginationProps {
  page: number;
  totalPages: number;
  /** Build the href for a given page number. */
  hrefFor: (page: number) => string;
}

export function Pagination({ page, totalPages, hrefFor }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  const baseLink =
    "inline-flex items-center justify-center h-10 min-w-10 px-3 rounded-full text-sm font-medium transition-colors";

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-center gap-2 mt-16"
    >
      {hasPrev ? (
        <Link
          href={hrefFor(page - 1)}
          className={cn(baseLink, "border border-border/60 hover-elevate")}
          aria-label="Previous page"
        >
          <ChevronLeft className="w-4 h-4" />
        </Link>
      ) : (
        <span
          className={cn(baseLink, "border border-border/40 text-muted-foreground/40")}
          aria-disabled="true"
        >
          <ChevronLeft className="w-4 h-4" />
        </span>
      )}

      {pages.map((p) => (
        <Link
          key={p}
          href={hrefFor(p)}
          aria-current={p === page ? "page" : undefined}
          className={cn(
            baseLink,
            p === page
              ? "bg-primary text-primary-foreground"
              : "border border-border/60 hover-elevate",
          )}
        >
          {p}
        </Link>
      ))}

      {hasNext ? (
        <Link
          href={hrefFor(page + 1)}
          className={cn(baseLink, "border border-border/60 hover-elevate")}
          aria-label="Next page"
        >
          <ChevronRight className="w-4 h-4" />
        </Link>
      ) : (
        <span
          className={cn(baseLink, "border border-border/40 text-muted-foreground/40")}
          aria-disabled="true"
        >
          <ChevronRight className="w-4 h-4" />
        </span>
      )}
    </nav>
  );
}
