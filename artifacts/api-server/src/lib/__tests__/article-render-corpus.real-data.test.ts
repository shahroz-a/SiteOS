/**
 * Opt-in live-DB regression test that the article HTML cleanup transforms in
 * `prepareArticleHtml` (`@workspace/blog-renderer`) hold across the REAL migrated
 * corpus — not just the synthetic fixtures in
 * `lib/blog-renderer/src/__tests__/parse.test.ts`.
 *
 * `prepareArticleHtml` is exactly the function the blog feeds into
 * `dangerouslySetInnerHTML` (`artifacts/blog/src/pages/Article.tsx`), so it is the
 * true "what readers see" boundary. The transforms it runs were each derived from
 * a specific broken shape in the migrated WordPress/Thrive markup, and that markup
 * is irregular: the listicle-number trap alone shipped in several distinct shapes
 * (`<span id="attr-1">N</span>`, bare `<span>N</span>`, legacy `<span>#N</span>`,
 * and a sibling `<p class="number">N</p>` orphan). The 36 unit tests only assert
 * against hand-written HTML, so a NEW corpus shape can slip past them and reach
 * readers as a glued number, a broken "blob" share/summary icon, an unbalanced
 * itinerary, or an off-domain link. This test renders a representative sample of
 * real published articles and asserts none of the known-broken residue survives.
 *
 * Sample = the two documented stress slugs (`/blog/best-road-trips-world/`,
 * `/blog/most-beautiful-islands-in-the-world/`) + a few pages per known-broken
 * marker (so every transform is always exercised) + a `random()` sweep of N more
 * pages (so NEW corpus shapes get caught over repeated/scheduled runs).
 *
 * Deliberately NOT asserted: the presence of inline `<svg>` icons. Per the
 * documented corpus fact (`.agents/memory/blog-listicle-numbering.md`) every inline
 * prose `<svg>` is an icon, intentionally left in the markup and size-capped by a
 * global `.blog-prose svg` CSS rule — NOT stripped by `prepareArticleHtml`. The
 * reader-facing "gray blob icon" failure mode this guards is the broken Sassy
 * Social Share sprite boxes (`heateor_sss_*`) and the dead Thrive "Summary" toggle
 * glyph (`open-summary-mobile` / `summary-wrapper-mobile`), both of which the
 * transforms DO remove — so those are what we assert are gone.
 *
 * OPT-IN + READ-ONLY. Like the other real-DB checks it touches the live database,
 * so it only runs when `VERIFY_REAL_DATA=1`; the normal suite skips it. It issues
 * SELECTs only — it never mutates a row.
 *
 * Run on demand with:
 *   pnpm --filter @workspace/api-server run verify:corpus-render
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";

import { db, pagesTable } from "@workspace/db";
import { prepareArticleHtml } from "@workspace/blog-renderer";

const RUN = process.env.VERIFY_REAL_DATA === "1";

/** Documented stress pages that exercise the trickiest listicle-number shapes. */
const FIXED_SLUGS = [
  "best-road-trips-world",
  "most-beautiful-islands-in-the-world",
];

/** Size of the random sweep (catches new corpus shapes over repeated runs). */
const SWEEP_LIMIT = (() => {
  const raw = process.env.CORPUS_RENDER_LIMIT;
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : 60;
})();

/** How many pages to pull per known-broken marker (always-exercise floor). */
const PER_MARKER = 4;

interface SamplePage {
  slug: string;
  pathname: string;
  html: string;
}

/**
 * The `published` `post` corpus, source-of-truth base predicate. We render the
 * SAME column the blog renders (`cleanedHtml` → serialized as `contentHtml`).
 */
const publishedPosts = and(
  eq(pagesTable.status, "published"),
  eq(pagesTable.pageType, "post"),
  isNotNull(pagesTable.cleanedHtml),
);

/** Collect page ids whose stored HTML matches `like` (a known-broken marker). */
async function idsWithMarker(like: string, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: pagesTable.id })
    .from(pagesTable)
    .where(and(publishedPosts, sql`${pagesTable.cleanedHtml} ilike ${like}`))
    .limit(limit);
  return rows.map((r) => r.id);
}

async function loadSample(): Promise<SamplePage[]> {
  const ids = new Set<string>();

  // 1. Fixed documented stress slugs.
  const fixed = await db
    .select({ id: pagesTable.id })
    .from(pagesTable)
    .where(and(publishedPosts, inArray(pagesTable.slug, FIXED_SLUGS)));
  for (const r of fixed) ids.add(r.id);

  // 2. A few pages per known-broken marker so every transform is exercised even
  //    when the random sweep misses them.
  const markers = [
    "%heateor%", // Sassy Social Share blob icons → stripSocialShare
    "%open-summary-mobile%", // dead Thrive Summary toggle → stripSummaryWidget
    "%summary-wrapper-mobile%", // its empty list panel → stripSummaryWidget
    "%attr-list-title%", // attraction listicle number span → mergeNumberedHeadings
    '%class="number"%', // timeline listicle number orphan → mergeNumberedHeadings
    "%hhttp%", // malformed hhttp(s) scheme → fixMalformedUrlScheme
  ];
  for (const m of markers) {
    for (const id of await idsWithMarker(m, PER_MARKER)) ids.add(id);
  }

  // 3. Random sweep — different pages each run so new shapes surface over time.
  const sweep = await db
    .select({ id: pagesTable.id })
    .from(pagesTable)
    .where(publishedPosts)
    .orderBy(sql`random()`)
    .limit(SWEEP_LIMIT);
  for (const r of sweep) ids.add(r.id);

  const rows = await db
    .select({
      slug: pagesTable.slug,
      pathname: pagesTable.pathname,
      html: pagesTable.cleanedHtml,
    })
    .from(pagesTable)
    .where(inArray(pagesTable.id, [...ids]));

  return rows
    .filter((r): r is SamplePage => typeof r.html === "string" && r.html.length > 0)
    .map((r) => ({ slug: r.slug, pathname: r.pathname, html: r.html }));
}

/* --------------------------------------------------------------------- */
/* Residue detectors — each returns the offending snippet, or null.       */
/* Every check targets the EXACT broken markup a transform is supposed to */
/* consume, so a hit means a real shape reached the reader unfixed.        */
/* --------------------------------------------------------------------- */

type Detector = { name: string; find: (html: string) => string | null };

const firstMatch = (html: string, re: RegExp): string | null => {
  const m = html.match(re);
  return m ? m[0].slice(0, 160) : null;
};

const DETECTORS: Detector[] = [
  {
    // stripSocialShare: no Sassy Social Share markup (the broken sprite boxes).
    name: "heateor social-share blob",
    find: (h) => firstMatch(h, /heateor[_]?sss/i),
  },
  {
    // stripSummaryWidget: no dead Thrive "Summary" toggle / list panel.
    name: "Thrive summary widget",
    find: (h) => firstMatch(h, /open-summary-mobile|summary-wrapper-mobile/i),
  },
  {
    // fixMalformedUrlScheme: no duplicated-h `hhttp(s)://` scheme.
    name: "malformed hhttp(s) scheme",
    find: (h) => firstMatch(h, /hhttps?:\/\//i),
  },
  {
    // rewriteInternalLinks: no absolute link back to the blog's own pages.
    name: "absolute /blog/ self-link",
    find: (h) =>
      firstMatch(
        h,
        /href\s*=\s*["'](?:https?:)?\/\/(?:www\.)?headout\.com\/blog\//i,
      ),
  },
  {
    // on* handler strip: no inline event handlers survive into the DOM.
    name: "inline on* handler",
    find: (h) => firstMatch(h, /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i),
  },
  {
    // mergeNumberedHeadings (attraction): no un-merged number span left INSIDE
    // an attr-list-title heading (the shape the transform folds into "N. ").
    name: "un-merged attr-list-title number span",
    find: (h) =>
      firstMatch(
        h,
        /<h[2-6]\b[^>]*\battr-list-title\b[^>]*>\s*<span\b[^>]*>\s*#?\s*\d+[^<]*<\/span>/i,
      ),
  },
  {
    // mergeNumberedHeadings (timeline): no digit-bearing orphan number paragraph
    // (empty `<p class="number"></p>` is intentionally left — it renders nothing).
    name: "orphan timeline number paragraph",
    find: (h) => firstMatch(h, /<p\b[^>]*\bnumber\b[^>]*>\s*\d+\s*<\/p>/i),
  },
];

/** Count `.days` blocks nested inside another `.days` (balanceItineraryDays). */
function countNestedDays(html: string): number {
  const tokenRe = /<div\b[^>]*>|<\/div>/gi;
  const stack: boolean[] = [];
  let nested = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(html))) {
    const tok = m[0];
    if (tok[1] === "/") {
      stack.pop();
      continue;
    }
    const clsM = tok.match(/\sclass\s*=\s*("([^"]*)"|'([^']*)')/i);
    const cls = clsM ? (clsM[2] ?? clsM[3] ?? "") : "";
    const isDays = cls.split(/\s+/).includes("days");
    if (isDays && stack.includes(true)) nested += 1;
    stack.push(isDays);
  }
  return nested;
}

/**
 * Glued-number signature: a listicle heading whose visible text begins with a
 * digit run immediately followed by a letter ("2National", "1Peka") — i.e. the
 * number was NOT folded into "N. Title". A legit title that merely starts with a
 * number ("100 Montaditos", "9/11 Museum", "24 Hours in Paris") has a space or
 * punctuation after the digits and is NOT flagged, so this catches a brand-new
 * shape the residue detectors above (which match known markup) would miss.
 */
function gluedListicleHeading(html: string): string | null {
  const re =
    /<h[2-6]\b[^>]*\b(?:attr-list-title|card-title)\b[^>]*>([\s\S]*?)<\/h[2-6]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const text = m[1]
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (/^\d+[A-Za-z]/.test(text)) return text.slice(0, 120);
  }
  return null;
}

describe.skipIf(!RUN)(
  "prepareArticleHtml — real corpus (no broken formatting reaches readers)",
  () => {
    let sample: SamplePage[] = [];

    beforeAll(async () => {
      sample = await loadSample();
    });

    afterAll(async () => {
      try {
        const { pool } = await import("@workspace/db");
        await pool.end();
      } catch {
        // pool may already be closed; ignore.
      }
    });

    it("loads a non-trivial sample of published articles", () => {
      // Fixed slugs + per-marker floor guarantee the sample is never empty.
      expect(sample.length).toBeGreaterThan(0);
    });

    it("includes the documented stress slugs", () => {
      for (const slug of FIXED_SLUGS) {
        expect(
          sample.some((p) => p.slug === slug),
          `expected fixed slug ${slug} in sample`,
        ).toBe(true);
      }
    });

    it("leaves no known-broken markup in any rendered article", () => {
      const failures: string[] = [];
      for (const page of sample) {
        const { html } = prepareArticleHtml(page.html);
        for (const det of DETECTORS) {
          const hit = det.find(html);
          if (hit) failures.push(`[${det.name}] ${page.pathname} :: ${hit}`);
        }
        const nested = countNestedDays(html);
        if (nested > 0) {
          failures.push(`[nested itinerary days] ${page.pathname} :: ${nested}`);
        }
        const glued = gluedListicleHeading(html);
        if (glued) {
          failures.push(`[glued listicle number] ${page.pathname} :: ${glued}`);
        }
      }
      expect(
        failures,
        `broken formatting reached the rendered body:\n${failures.join("\n")}`,
      ).toEqual([]);
    });

    it("renders the fixed listicle slugs with merged 'N. ' numbering + toc", () => {
      for (const slug of FIXED_SLUGS) {
        const page = sample.find((p) => p.slug === slug);
        if (!page) continue; // covered by the dedicated presence assertion above
        const { html, toc } = prepareArticleHtml(page.html);
        // At least one heading folded to the "N. Title" form, and that merged
        // label flows through to the table of contents.
        expect(html, `${slug} should contain merged 'N. ' numbering`).toMatch(
          /<h[2-6]\b[^>]*>\s*\d+\.\s/,
        );
        expect(
          toc.some((t) => /^\d+\.\s/.test(t.label)),
          `${slug} toc should carry a numbered label`,
        ).toBe(true);
      }
    });
  },
);
