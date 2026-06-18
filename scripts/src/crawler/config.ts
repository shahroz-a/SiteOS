/**
 * Central configuration for the Headout blog migration crawler.
 *
 * Everything here is intentionally declarative so the engine can be tuned
 * (concurrency, politeness, sitemap roots) without touching pipeline code.
 */

export const SITE_ORIGIN = "https://www.headout.com";

/** Only URLs under this prefix are considered part of the blog ecosystem. */
export const BLOG_PREFIX = `${SITE_ORIGIN}/blog`;

/** The seven seed sitemaps. Nested sitemaps are discovered recursively. */
export const SEED_SITEMAPS: readonly string[] = [
  `${SITE_ORIGIN}/blog/post-sitemap.xml`,
  `${SITE_ORIGIN}/blog/post-sitemap2.xml`,
  `${SITE_ORIGIN}/blog/post-sitemap3.xml`,
  `${SITE_ORIGIN}/blog/page-sitemap.xml`,
  `${SITE_ORIGIN}/blog/web-story-sitemap.xml`,
  `${SITE_ORIGIN}/blog/category-sitemap.xml`,
  `${SITE_ORIGIN}/blog/author-sitemap.xml`,
];

export interface CrawlerConfig {
  /** Number of pages processed concurrently. */
  concurrency: number;
  /** Minimum delay (ms) between requests per worker — polite rate limiting. */
  perRequestDelayMs: number;
  /** Network/navigation timeout per page (ms). */
  requestTimeoutMs: number;
  /** Max attempts before a queue item is marked permanently failed. */
  maxAttempts: number;
  /** Max redirect hops to follow before treating it as a loop. */
  maxRedirects: number;
  /** Use Playwright rendering when a browser is available. */
  useBrowser: boolean;
  /** User agent presented to the origin. */
  userAgent: string;
  /** Directory (relative to repo root) where deliverable reports are written. */
  reportDir: string;
  /** Words-per-minute used to derive reading time when the source omits it. */
  wordsPerMinute: number;
}

export const DEFAULT_CONFIG: CrawlerConfig = {
  concurrency: 4,
  perRequestDelayMs: 400,
  requestTimeoutMs: 45_000,
  maxAttempts: 3,
  maxRedirects: 10,
  useBrowser: true,
  userAgent:
    "Mozilla/5.0 (compatible; HeadoutMigrationBot/1.0; +content-preservation)",
  reportDir: "reports",
  wordsPerMinute: 200,
};
