import { format } from "date-fns";

/** Internal route helpers (relative to the wouter base `/blog`). */
export function postPath(slug: string): string {
  return `/${slug}/`;
}

export function categoryPath(slug: string): string {
  return `/category/${slug}`;
}

export function authorPath(slug: string): string {
  return `/author/${slug}`;
}

export function searchPath(q: string): string {
  return `/search?q=${encodeURIComponent(q)}`;
}

export function formatDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return format(d, "MMMM d, yyyy");
}

export function readingTimeLabel(minutes?: number | null): string | null {
  if (!minutes) return null;
  return `${minutes} min read`;
}
