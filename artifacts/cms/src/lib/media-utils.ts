import type { MediaAltStatus } from "@workspace/api-client-react";

export interface AltStatusMeta {
  label: string;
  /** Short label for compact badges. */
  shortLabel: string;
  /** Tailwind classes for the badge surface. */
  badgeClass: string;
}

export const ALT_STATUS_META: Record<MediaAltStatus, AltStatusMeta> = {
  ok: {
    label: "Alt text OK",
    shortLabel: "OK",
    badgeClass:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  missing: {
    label: "Missing alt text",
    shortLabel: "Missing alt",
    badgeClass:
      "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  },
  poor: {
    label: "Poor alt text",
    shortLabel: "Poor alt",
    badgeClass:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
};

/** Human dimensions string, e.g. "1280 × 720" or null when unknown. */
export function formatDimensions(
  width: number | null,
  height: number | null,
): string | null {
  if (width == null || height == null) return null;
  return `${width} × ${height}`;
}

/** Best-effort filename from a CDN URL, for display. */
export function fileNameFromUrl(url: string): string {
  try {
    const { pathname } = new URL(url);
    const last = pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : url;
  } catch {
    return url;
  }
}
