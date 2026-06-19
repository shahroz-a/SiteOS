import { type MediaItem } from "@workspace/api-client-react";
import { type BulkSuggestSession } from "@/components/bulk-alt-review-dialog";

/** Page size used when paging the flagged-image list to fill a window. */
export const GATHER_PAGE_SIZE = 100;

/** Default max flagged images gathered into a single review window. */
export const BULK_SUGGEST_CEILING = 200;

/** Minimal shape of one flagged-list page the gather depends on. */
export interface GatherListResult {
  items: MediaItem[];
  pagination: { totalPages: number };
}

/**
 * Injected list fetcher (`listCmsMedia` in production). Kept structural so the
 * gather logic can be unit-tested with a fake corpus, no page render required.
 */
export type GatherListMedia = (params: {
  q?: string;
  onlyIssues?: boolean;
  page: number;
  limit: number;
}) => Promise<GatherListResult>;

/**
 * Gather one bounded window of still-flagged images for a search filter,
 * excluding any URLs already handled this session. Forces `onlyIssues` on and
 * pages the list (`GATHER_PAGE_SIZE` per request) until the window hits
 * `ceiling` or the corpus is exhausted. Pure aside from the injected fetcher,
 * so the review dialog can call it repeatedly to walk the whole backlog one
 * window at a time.
 */
export async function gatherFlaggedWindow({
  listMedia,
  q,
  exclude,
  ceiling = BULK_SUGGEST_CEILING,
}: {
  listMedia: GatherListMedia;
  q: string;
  exclude: Set<string>;
  ceiling?: number;
}): Promise<MediaItem[]> {
  const gathered: MediaItem[] = [];
  let pageNum = 1;
  while (gathered.length < ceiling) {
    const res = await listMedia({
      q: q || undefined,
      onlyIssues: true,
      page: pageNum,
      limit: GATHER_PAGE_SIZE,
    });
    for (const it of res.items) {
      if (exclude.has(it.url)) continue;
      gathered.push(it);
      if (gathered.length >= ceiling) break;
    }
    if (pageNum >= res.pagination.totalPages) break;
    pageNum += 1;
  }
  return gathered;
}

/**
 * Build the opening bulk-suggestion session for a search filter: gather the
 * first flagged window (excluding URLs skipped in an earlier, interrupted run)
 * and assemble the session the review dialog consumes. Returns `null` when
 * nothing is left to review, so the caller can clear stale skip state and toast.
 */
export async function buildBulkSuggestSession({
  listMedia,
  filter,
  skipped,
  total,
  ceiling = BULK_SUGGEST_CEILING,
}: {
  listMedia: GatherListMedia;
  /** Search filter snapshotted at session start (scopes gather + persistence). */
  filter: string;
  /** URLs skipped in a prior interrupted run, restored from persistence. */
  skipped: string[];
  /** Total flagged images across the whole filtered set at session start. */
  total: number;
  ceiling?: number;
}): Promise<BulkSuggestSession | null> {
  const first = await gatherFlaggedWindow({
    listMedia,
    q: filter,
    exclude: new Set(skipped),
    ceiling,
  });
  if (first.length === 0) return null;
  return { filter, items: first, total, skipped };
}
