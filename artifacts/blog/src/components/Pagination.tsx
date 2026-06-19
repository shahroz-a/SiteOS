import { Link } from "wouter";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@workspace/ui";

interface PaginationProps {
  page: number;
  totalPages: number;
  /** Build the href for a given page number. */
  hrefFor: (page: number) => string;
  /** How many page links to show on each side of the current page. */
  siblingCount?: number;
}

type PageSlot = number | "gap-left" | "gap-right";

/**
 * Compact, windowed page list: always shows the first and last page, the
 * current page with `siblingCount` neighbours on each side, and an ellipsis
 * wherever there's a gap. This keeps the control to ~7 page slots no matter how
 * many pages exist (the blog corpus is hundreds of pages, so rendering every
 * number overflows the bar).
 */
function buildPageSlots(
  page: number,
  totalPages: number,
  siblingCount: number,
): PageSlot[] {
  const start = Math.max(2, page - siblingCount);
  const end = Math.min(totalPages - 1, page + siblingCount);

  const slots: PageSlot[] = [1];

  // Left gap: if exactly one page is omitted (page 2), show it rather than an
  // ellipsis — a "…" that hides a single page is wasteful and harder to use.
  if (start === 3) slots.push(2);
  else if (start > 3) slots.push("gap-left");

  for (let p = start; p <= end; p++) slots.push(p);

  // Right gap: same single-page rule on the trailing side.
  if (end === totalPages - 2) slots.push(totalPages - 1);
  else if (end < totalPages - 2) slots.push("gap-right");

  if (totalPages > 1) slots.push(totalPages);

  return slots;
}

export function Pagination({
  page,
  totalPages,
  hrefFor,
  siblingCount = 1,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const hasPrev = page > 1;
  const hasNext = page < totalPages;
  const slots = buildPageSlots(page, totalPages, siblingCount);

  const baseLink =
    "inline-flex items-center justify-center h-10 min-w-10 px-3 rounded-full text-sm font-medium transition-colors";

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-center gap-1.5 sm:gap-2 mt-16"
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
          className={cn(
            baseLink,
            "border border-border/40 text-muted-foreground/40",
          )}
          aria-disabled="true"
        >
          <ChevronLeft className="w-4 h-4" />
        </span>
      )}

      {slots.map((slot) =>
        slot === "gap-left" || slot === "gap-right" ? (
          <span
            key={slot}
            aria-hidden="true"
            className="inline-flex items-center justify-center h-10 w-7 text-sm text-muted-foreground/60 select-none"
          >
            &hellip;
          </span>
        ) : (
          <Link
            key={slot}
            href={hrefFor(slot)}
            aria-current={slot === page ? "page" : undefined}
            aria-label={`Page ${slot}`}
            className={cn(
              baseLink,
              slot === page
                ? "bg-primary text-primary-foreground"
                : "border border-border/60 hover-elevate",
            )}
          >
            {slot}
          </Link>
        ),
      )}

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
          className={cn(
            baseLink,
            "border border-border/40 text-muted-foreground/40",
          )}
          aria-disabled="true"
        >
          <ChevronRight className="w-4 h-4" />
        </span>
      )}
    </nav>
  );
}
