import { ChevronRight } from "lucide-react";
import type { Breadcrumb } from "@workspace/api-client-react";

interface BreadcrumbsProps {
  items: Breadcrumb[];
}

/**
 * Renders the API-provided breadcrumb trail for a post. Non-final crumbs with a
 * URL become links; the final crumb is the current page.
 */
export function Breadcrumbs({ items }: BreadcrumbsProps) {
  if (items.length === 0) return null;
  const ordered = [...items].sort((a, b) => a.position - b.position);

  return (
    <div className="w-full bg-background border-b border-border/40">
      <nav
        aria-label="Breadcrumb"
        className="max-w-7xl mx-auto px-6 lg:px-12 py-4 flex items-center flex-wrap gap-x-2 gap-y-1 text-sm"
      >
        {ordered.map((crumb, idx) => {
          const isLast = idx === ordered.length - 1;
          return (
            <span key={`${crumb.label}-${idx}`} className="flex items-center gap-x-2">
              {crumb.url && !isLast ? (
                <a
                  href={crumb.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {crumb.label}
                </a>
              ) : (
                <span
                  className={isLast ? "text-muted-foreground" : "text-primary"}
                  {...(isLast ? { "aria-current": "page" as const } : {})}
                >
                  {crumb.label}
                </span>
              )}
              {!isLast && (
                <ChevronRight
                  className="w-3.5 h-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
            </span>
          );
        })}
      </nav>
    </div>
  );
}
