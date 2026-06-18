/**
 * Curated set of real Headout blog article URLs to import. The first is the
 * flagship Thanksgiving guide; the rest are pages it links to internally so the
 * internal-link resolver has real targets to connect.
 *
 * Extra URLs can also be passed as CLI args to the importer.
 */
export const DEFAULT_SOURCE_URLS: string[] = [
  // Flagship guide.
  "https://www.headout.com/blog/thanksgiving-vacation-ideas-for-families/",
  // Attraction pages the flagship links to in-content, so the internal-link
  // resolver has real cross-page targets to connect.
  "https://www.headout.com/blog/universal-studios-singapore/",
  "https://www.headout.com/blog/singapore-flyer/",
  "https://www.headout.com/blog/barcelona-aquarium/",
  "https://www.headout.com/blog/burj-khalifa-dubai/",
  "https://www.headout.com/blog/seaworld-orlando/",
  "https://www.headout.com/blog/prague-castle/",
  "https://www.headout.com/blog/edinburgh-castle/",
];

export const SITE_ORIGIN = "https://www.headout.com";
