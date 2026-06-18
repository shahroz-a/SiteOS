import { XMLParser } from "fast-xml-parser";
import { DEFAULT_CONFIG, SEED_SITEMAPS } from "./config";
import type { DiscoveredUrl } from "./types";
import {
  canonicalizeUrl,
  classifyUrl,
  isBlogUrl,
  parseDate,
  priorityForType,
} from "./util";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

async function fetchXml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": DEFAULT_CONFIG.userAgent, accept: "application/xml,text/xml,*/*" },
      signal: AbortSignal.timeout(DEFAULT_CONFIG.requestTimeoutMs),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

interface SitemapEntry {
  loc?: string;
  lastmod?: string;
}

/**
 * Recursively discover every URL reachable from the seven seed sitemaps. A
 * sitemap index points to nested sitemaps; those are followed until no new
 * sitemap remains. URLs are deduplicated by canonical form.
 *
 * @param onLog optional progress callback.
 */
export async function discoverFromSitemaps(
  seeds: readonly string[] = SEED_SITEMAPS,
  onLog?: (msg: string) => void,
): Promise<DiscoveredUrl[]> {
  const seenSitemaps = new Set<string>();
  const sitemapQueue: string[] = [...seeds];
  const discovered = new Map<string, DiscoveredUrl>();

  while (sitemapQueue.length > 0) {
    const sitemapUrl = sitemapQueue.shift()!;
    if (seenSitemaps.has(sitemapUrl)) continue;
    seenSitemaps.add(sitemapUrl);

    const xml = await fetchXml(sitemapUrl);
    if (!xml) {
      onLog?.(`sitemap fetch failed: ${sitemapUrl}`);
      continue;
    }

    const doc = parser.parse(xml) as Record<string, unknown>;

    // A <sitemapindex> nests further sitemaps.
    const indexNode = doc["sitemapindex"] as { sitemap?: unknown } | undefined;
    if (indexNode) {
      const nested = asArray<SitemapEntry>(indexNode.sitemap as SitemapEntry[]);
      for (const entry of nested) {
        if (entry.loc && !seenSitemaps.has(entry.loc)) sitemapQueue.push(entry.loc);
      }
      onLog?.(`sitemap index ${sitemapUrl}: +${nested.length} nested`);
      continue;
    }

    // A <urlset> lists page URLs.
    const urlSet = doc["urlset"] as { url?: unknown } | undefined;
    const entries = asArray<SitemapEntry>(urlSet?.url as SitemapEntry[]);
    let added = 0;
    for (const entry of entries) {
      if (!entry.loc) continue;
      const canonical = canonicalizeUrl(entry.loc);
      if (!canonical || !isBlogUrl(canonical)) continue;
      if (discovered.has(canonical)) continue;
      const pageType = classifyUrl(canonical, sitemapUrl);
      discovered.set(canonical, {
        url: canonical,
        sitemapSource: sitemapUrl,
        lastmod: parseDate(entry.lastmod),
        pageType,
        priority: priorityForType(pageType),
      });
      added += 1;
    }
    onLog?.(`sitemap ${sitemapUrl}: +${added} urls (total ${discovered.size})`);
  }

  return [...discovered.values()];
}
