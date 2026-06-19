/**
 * Image-source policy guard.
 *
 * Project rule (see replit.md "User preferences"): migrated blog images MUST
 * always be referenced by their ORIGINAL `https://cdn-img.headout.com/...` URLs
 * and never re-hosted or duplicated in object storage. The database keeps only
 * image metadata (URL, alt, caption, dimensions, position, usage). Only
 * genuinely new, editor-supplied images may live behind the self-hosted
 * `/api/storage/...` serving route.
 *
 * This module is the single chokepoint that enforces the rule when images are
 * serialized out of the API — every client (public blog, CMS, mobile) reads
 * image URLs from the API, so guarding here covers them all. The helpers are
 * pure (no DB, no network) so they can be unit-tested directly.
 */

/**
 * True when `url` points at the self-hosted object-storage serving route
 * (`/api/storage/objects/...`) or the raw object path it proxies
 * (`/objects/...`). Matches whether the URL is relative or absolute.
 */
export function isSelfHostedStoragePath(
  url: string | null | undefined,
): boolean {
  if (!url) return false;
  const v = url.trim();
  if (!v) return false;
  // `/api/storage/objects/...` (or any `.../storage/objects/...`) and the raw
  // object path `/objects/...` that the storage route serves.
  return /(^|\/)storage\/objects\//i.test(v) || /(^|\/)objects\//i.test(v);
}

/**
 * True when `url` is an absolute external CDN URL (e.g. cdn-img.headout.com) —
 * i.e. an http(s) URL that is NOT a self-hosted storage path. A migrated image
 * is identified by its `originalUrl` being such a URL.
 */
export function isExternalCdnUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const v = url.trim();
  return /^https?:\/\//i.test(v) && !isSelfHostedStoragePath(v);
}

/**
 * A migrated image is one whose `originalUrl` is an external CDN URL (it was
 * extracted from a crawled/imported source page, not uploaded by an editor).
 */
export function isMigratedImage(img: {
  originalUrl: string | null | undefined;
}): boolean {
  return isExternalCdnUrl(img.originalUrl);
}

/**
 * The URL a client should render for an image, enforcing the no-rehost rule.
 *
 * For a MIGRATED image (external CDN `originalUrl`) the serving `url` must never
 * be a self-hosted storage path — if it somehow is, fall back to the original
 * CDN URL so migrated content is always served straight from Headout's CDN.
 * Editor-uploaded images (whose `originalUrl` is itself a storage path or not an
 * external CDN URL) are served exactly as stored.
 */
export function resolveImageServingUrl(img: {
  url: string;
  originalUrl: string | null | undefined;
}): string {
  if (isMigratedImage(img) && isSelfHostedStoragePath(img.url)) {
    return img.originalUrl as string;
  }
  return img.url;
}

/**
 * Strict guard: throws if a migrated image's serving `url` has been rewritten to
 * a self-hosted storage path. Used by tests (and available for dev-time checks)
 * so an accidental re-host of migrated content fails loudly instead of silently
 * duplicating images into object storage.
 */
export function assertNoRehostedMigratedImage(img: {
  url: string;
  originalUrl: string | null | undefined;
}): void {
  if (isMigratedImage(img) && isSelfHostedStoragePath(img.url)) {
    throw new Error(
      `Migrated image must keep its original CDN URL, not a self-hosted path: ` +
        `url=${img.url} originalUrl=${img.originalUrl}`,
    );
  }
}
