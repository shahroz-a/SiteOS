/**
 * Pure helpers for deriving a clean two-level blog category taxonomy from the
 * per-post BreadcrumbList JSON-LD captured during the crawl.
 *
 * The source signal: each post has a BreadcrumbList whose deepest item under
 * `/blog/category/` is the post's real (leaf) category. The category @id encodes
 * the full hierarchy, e.g.
 *   /blog/category/things-to-do-city-london/wp-london-travel-guide/wcp-festivals-celebrations-london/
 * We collapse that to a TWO-level model:
 *   - a top-level parent: the CITY (things-to-do-city-<city>) or the first
 *     editorial/topic segment (e.g. wcp-travel -> "Travel"); standalone
 *     single-segment categories are their own top level.
 *   - a leaf: the breadcrumb's deepest category (skipped when it equals the root).
 *
 * Everything here is deterministic and side-effect free so it can be unit tested
 * and re-run idempotently by the backfill script.
 */

const CATEGORY_MARKER = "/blog/category/";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  eacute: "\u00e9",
};

/** Decode the HTML entities that appear in JSON-LD category names. */
export function decodeEntities(input: string): string {
  let out = input;
  // A couple of passes handle the occasional double-encoded value.
  for (let pass = 0; pass < 3; pass++) {
    const next = out.replace(
      /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
      (match, code: string) => {
        if (code[0] === "#") {
          const isHex = code[1] === "x" || code[1] === "X";
          const cp = isHex
            ? Number.parseInt(code.slice(2), 16)
            : Number.parseInt(code.slice(1), 10);
          return Number.isFinite(cp) ? String.fromCodePoint(cp) : match;
        }
        return NAMED_ENTITIES[code.toLowerCase()] ?? match;
      },
    );
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Build a URL/route-safe slug from a (possibly entity-encoded) display name. */
export function slugify(name: string): string {
  return decodeEntities(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Title-case a hyphenated slug fragment, e.g. `new-york` -> `New York`. */
export function titleCaseFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Return the path segments after `/blog/category/`, or null when the url is not
 * a category url.
 */
export function parseCategoryPath(url: string): string[] | null {
  const i = url.indexOf(CATEGORY_MARKER);
  if (i === -1) return null;
  const rest = url.slice(i + CATEGORY_MARKER.length).split("#")[0].split("?")[0];
  const segs = rest.split("/").filter(Boolean);
  return segs.length ? segs : null;
}

/** Extract the city key from a `things-to-do-city-<city>` segment, else null. */
export function cityFromSegment(segment: string): string | null {
  const m = /^things-to-do-city-(.+)$/.exec(segment);
  return m ? m[1] : null;
}

/** Best-effort readable name for a raw url segment (parent fallback only). */
export function cleanSegmentName(segment: string): string {
  let s = segment.replace(/^(wcp|wp)-/, "");
  s = s.replace(/-(c|ca|sc|cat)-\d+(__\d+)?$/i, "");
  s = s.replace(/[-_]+/g, " ").trim();
  return titleCaseFromSlug(s.replace(/\s+/g, "-"));
}

export interface BreadcrumbListItem {
  position?: number;
  name?: string;
  item?: { "@id"?: string; name?: string } | string;
}

/**
 * Pick the deepest `/blog/category/` entry from a BreadcrumbList's
 * `itemListElement`. Returns the decoded name + url, or null when the breadcrumb
 * has no category level (e.g. Home > Article).
 */
export function extractLeafCategory(
  itemListElement: unknown,
): { name: string; url: string } | null {
  if (!Array.isArray(itemListElement)) return null;
  const cats: { position: number; name: string; url: string }[] = [];
  itemListElement.forEach((raw, idx) => {
    const li = raw as BreadcrumbListItem;
    const item = li?.item;
    const url = typeof item === "string" ? item : item?.["@id"];
    const name =
      (typeof item === "object" && item ? item.name : undefined) ?? li?.name;
    if (typeof url === "string" && url.includes(CATEGORY_MARKER)) {
      cats.push({
        position: typeof li?.position === "number" ? li.position : idx,
        name: typeof name === "string" ? name : "",
        url,
      });
    }
  });
  if (cats.length === 0) return null;
  cats.sort((a, b) => a.position - b.position);
  const leaf = cats[cats.length - 1];
  return { name: decodeEntities(leaf.name).trim(), url: leaf.url };
}

/** Allocate a unique slug, suffixing `-2`, `-3`, … on collision. Mutates `taken`. */
export function allocateSlug(desired: string, taken: Set<string>): string {
  const base = desired || "category";
  let slug = base;
  let n = 2;
  while (taken.has(slug)) slug = `${base}-${n++}`;
  taken.add(slug);
  return slug;
}

export interface DerivedCategory {
  originalUrl: string;
  name: string;
  parentUrl: string | null;
  citySlug: string | null;
  desiredSlug: string;
  isTopLevel: boolean;
}

export interface PostAssignment {
  postId: string;
  /** Most specific category (leaf when present, else the top-level). */
  primaryUrl: string;
  /** Category urls to link via page_categories (top-level + leaf, deduped). */
  linkUrls: string[];
}

export interface DerivedGraph {
  categories: DerivedCategory[];
  assignments: PostAssignment[];
}

export interface PostLeafInput {
  postId: string;
  leafName: string;
  leafUrl: string;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "https://www.headout.com";
  }
}

function buildCategoryUrl(origin: string, segments: string[]): string {
  return `${origin}${CATEGORY_MARKER}${segments.join("/")}/`;
}

/**
 * Build the deduped category set (two-level) and per-post assignments from the
 * extracted leaf category of every post. Pure: slugs returned are *desired*
 * slugs (collision resolution against the live DB happens in the backfill via
 * {@link allocateSlugs}).
 */
export function deriveCategoryGraph(posts: PostLeafInput[]): DerivedGraph {
  // segment -> clean name, learned from any post whose leaf IS that segment.
  const segmentName = new Map<string, string>();
  for (const p of posts) {
    const segs = parseCategoryPath(p.leafUrl);
    if (!segs) continue;
    const last = segs[segs.length - 1];
    if (!segmentName.has(last)) segmentName.set(last, decodeEntities(p.leafName).trim());
  }

  const categories = new Map<string, DerivedCategory>();
  const assignments: PostAssignment[] = [];

  const register = (cat: DerivedCategory) => {
    if (!categories.has(cat.originalUrl)) categories.set(cat.originalUrl, cat);
    return categories.get(cat.originalUrl)!;
  };

  for (const p of posts) {
    const segs = parseCategoryPath(p.leafUrl);
    if (!segs) continue;
    const origin = originOf(p.leafUrl);
    const leafName = decodeEntities(p.leafName).trim();
    const topSeg = segs[0];
    const city = cityFromSegment(topSeg);

    const parentUrl = buildCategoryUrl(origin, [topSeg]);
    const parent = register(
      city
        ? {
            originalUrl: parentUrl,
            name: titleCaseFromSlug(city),
            parentUrl: null,
            citySlug: city,
            desiredSlug: `city-${city}`,
            isTopLevel: true,
          }
        : {
            originalUrl: parentUrl,
            name: segmentName.get(topSeg) ?? cleanSegmentName(topSeg),
            parentUrl: null,
            citySlug: null,
            desiredSlug: slugify(segmentName.get(topSeg) ?? cleanSegmentName(topSeg)),
            isTopLevel: true,
          },
    );

    if (segs.length === 1) {
      assignments.push({
        postId: p.postId,
        primaryUrl: parent.originalUrl,
        linkUrls: [parent.originalUrl],
      });
      continue;
    }

    const leaf = register({
      originalUrl: p.leafUrl,
      name: leafName,
      parentUrl: parent.originalUrl,
      citySlug: city,
      desiredSlug: slugify(leafName),
      isTopLevel: false,
    });

    assignments.push({
      postId: p.postId,
      primaryUrl: leaf.originalUrl,
      linkUrls: [parent.originalUrl, leaf.originalUrl],
    });
  }

  // Deterministic order: top-level first, then leaves; each by url.
  const ordered = Array.from(categories.values()).sort((a, b) => {
    if (a.isTopLevel !== b.isTopLevel) return a.isTopLevel ? -1 : 1;
    return a.originalUrl.localeCompare(b.originalUrl);
  });

  return { categories: ordered, assignments };
}

/**
 * Resolve final unique slugs for the derived categories against the set of slugs
 * already taken by rows we are NOT going to reuse. Deterministic given the input
 * ordering. Returns originalUrl -> final slug.
 */
export function allocateSlugs(
  categories: DerivedCategory[],
  takenSlugs: Iterable<string>,
): Map<string, string> {
  const taken = new Set(takenSlugs);
  const out = new Map<string, string>();
  for (const c of categories) {
    out.set(c.originalUrl, allocateSlug(c.desiredSlug, taken));
  }
  return out;
}
