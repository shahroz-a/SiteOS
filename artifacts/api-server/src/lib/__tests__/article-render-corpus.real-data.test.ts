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
 * itinerary, or an off-domain link. This test renders real published articles and
 * asserts none of the known-broken residue survives.
 *
 * TWO MODES (both opt-in + read-only, gated on `VERIFY_REAL_DATA=1`):
 *
 *  - SAMPLE mode (default — the fast per-PR gate, `verify:corpus-render`):
 *    scans the two documented stress slugs (`/blog/best-road-trips-world/`,
 *    `/blog/most-beautiful-islands-in-the-world/`) + a few pages per known-broken
 *    marker (so every transform is always exercised) + a `random()` sweep of N
 *    more pages (so NEW corpus shapes get caught over repeated/scheduled runs).
 *    Fast enough for a gate, but the un-sampled tail can hide a new shape until a
 *    random run happens to hit it.
 *
 *  - FULL mode (`CORPUS_RENDER_FULL=1` — the corpus-wide scan,
 *    `verify:corpus-render:full`): no random sampling, no per-marker cap — scans
 *    EVERY published `post`. Mirrors `verify:cms-io:full`: the corpus is processed
 *    in fixed-size BATCHES (`CORPUS_RENDER_BATCH_SIZE`, default 200) so peak memory
 *    tracks one batch's HTML rather than materializing all ~2.9k pages at once.
 *    Designed to run unattended as a Replit Scheduled Deployment so formatting
 *    regressions in the long tail are caught corpus-wide.
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
 * SELECTs only — it never mutates a row, so it is safe to point at production.
 *
 * Run on demand with:
 *   pnpm --filter @workspace/api-server run verify:corpus-render        (sample)
 *   pnpm --filter @workspace/api-server run verify:corpus-render:full   (full)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db, pagesTable } from "@workspace/db";
import { prepareArticleHtml } from "@workspace/blog-renderer";

const RUN = process.env.VERIFY_REAL_DATA === "1";

/** FULL mode: scan every published post in batches (no sampling). */
const FULL = process.env.CORPUS_RENDER_FULL === "1";

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

/**
 * FULL-mode batch size: how many pages' HTML are loaded + rendered + scanned at
 * once. Tunable via `CORPUS_RENDER_BATCH_SIZE` (positive integer); defaults to
 * 200. Smaller batches lower peak memory at the cost of more per-batch overhead.
 */
const BATCH_SIZE = (() => {
  const raw = process.env.CORPUS_RENDER_BATCH_SIZE;
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : 200;
})();

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

/** The fixed documented stress-slug page ids (present in either mode). */
async function loadFixedIds(): Promise<string[]> {
  const rows = await db
    .select({ id: pagesTable.id })
    .from(pagesTable)
    .where(and(publishedPosts, inArray(pagesTable.slug, FIXED_SLUGS)));
  return rows.map((r) => r.id);
}

/**
 * SAMPLE mode id set: fixed stress slugs + a per-marker floor (so every
 * transform is exercised) + a random sweep (so NEW shapes surface over time).
 */
async function loadSampleIds(): Promise<string[]> {
  const ids = new Set<string>();

  // 1. Fixed documented stress slugs.
  for (const id of await loadFixedIds()) ids.add(id);

  // 2. A few pages per known-broken marker so every transform is exercised even
  //    when the random sweep misses them.
  const markers = [
    "%heateor%", // Sassy Social Share blob icons → stripSocialShare
    "%open-summary-mobile%", // dead Thrive Summary toggle → stripSummaryWidget
    "%summary-wrapper-mobile%", // its empty list panel → stripSummaryWidget
    "%attr-list-title%", // attraction listicle number span → mergeNumberedHeadings
    '%class="number"%', // timeline listicle number orphan → mergeNumberedHeadings
    "%hhttp%", // malformed hhttp(s) scheme → fixMalformedUrlScheme
    "%[tcb-script]%", // dead Thrive script shortcode kept as plain text → prepareArticleHtml
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

  return [...ids];
}

/** FULL mode id set: every published post, stable order, no cap. */
async function loadAllPublishedIds(): Promise<string[]> {
  const rows = await db
    .select({ id: pagesTable.id })
    .from(pagesTable)
    .where(publishedPosts)
    .orderBy(asc(pagesTable.slug));
  return rows.map((r) => r.id);
}

/** Split `items` into fixed-size chunks (the last chunk may be smaller). */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
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
    // stripScriptShortcodes: no `[tcb-script]…[/tcb-script]` shortcode markers (or
    // their leftover JS body) leak into the rendered article as bare text.
    name: "tcb-script shortcode residue",
    find: (h) => firstMatch(h, /\[\/?tcb-script\b[^\]]*\]/i),
  },
  {
    // General page-builder shortcode detector (catches NEW shapes in the long
    // tail, not just `[tcb-script]` / `[show_link_exp]` / `[star]`). Migrated
    // WordPress/Thrive shortcodes survive as PLAIN TEXT, so after rendering they
    // sit in TEXT positions (between tags), e.g. `[show_link_exp poi-id="616"]`,
    // `[/show_link_exp]`, `[star rating="8"]`. Strip every HTML tag first so the
    // ONLY false-positive source — CSS/Tailwind arbitrary-value brackets baked
    // into `class`/`style` attributes (`bg-[linear-gradient(…)]`,
    // `shadow-[inset_0_0_0_1px_token(…)]`, `animate-[opacity_0]`) — can't fire.
    // In the remaining text, flag a bracket token that looks like a shortcode:
    // a multi-part snake_case OR kebab-case name (`show_link_exp`, `et_pb_section`,
    // `tcb-inline`, `[/tcb-foo]`) OR any name carrying a `key="value"`-style
    // attribute. The multi-part requirement + lowercase-only match (no `i` flag —
    // real page-builder shortcodes are lowercase) leaves plain bracket prose
    // alone: citations (`[1]`), single words (`[Supplement]`), and capitalised
    // ranges (`[June-November]`) have no lowercase `_`/`-`-joined token.
    name: "leaked page-builder shortcode",
    find: (h) => {
      const text = h.replace(/<[^>]+>/g, " ");
      return firstMatch(
        text,
        /\[\/?[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+(?:\s[^\]]*)?\]|\[[a-z][a-z0-9_-]*\s+[a-z][a-z0-9_-]*=[^\]]*\]/,
      );
    },
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
    // mergeNumberedHeadings (timeline): NO orphan number paragraph survives —
    // digit-bearing ones are folded into "N. Title" and empty
    // `<p class="number"></p>` ones (no digit, e.g. /blog/best-time-to-visit-
    // melbourne/) are dropped so they can't render as a stray blank badge.
    name: "orphan timeline number paragraph",
    find: (h) => firstMatch(h, /<p\b[^>]*\bnumber\b[^>]*>[\s\S]*?<\/p>/i),
  },
  {
    // stripEmptyTimelineDecorations: the timeline number-circle's connector line
    // (`<div class="timeline-line"></div>`) is always empty and its CSS was never
    // migrated, so it must be dropped — none may survive into the rendered body.
    name: "empty timeline-line connector",
    find: (h) => firstMatch(h, /<div\b[^>]*\btimeline-line\b[^>]*>\s*<\/div>/i),
  },
  {
    // stripEmptyTimelineDecorations: an EMPTY card subtitle row
    // (`<p class="card-title-subtext …"></p>`, whitespace-only) renders as a stray
    // blank gap and must be dropped. Rows WITH text are kept, so this only flags
    // the empty residue — `\S` would match nothing inside an emptied row.
    name: "empty card-title-subtext row",
    find: (h) =>
      firstMatch(
        h,
        /<p\b[^>]*\bcard-title-subtext\b[^>]*>(?:\s|&nbsp;|&#0?160;)*<\/p>/i,
      ),
  },
];

// Pure unit coverage for the general "leaked page-builder shortcode" detector
// (runs in the normal suite, NOT gated on VERIFY_REAL_DATA) so its regex stays
// honest about which bracket shapes it flags vs. ignores.
describe("leaked page-builder shortcode detector", () => {
  const det = DETECTORS.find((d) => d.name === "leaked page-builder shortcode")!;
  it("flags hyphenated tcb-* markers even with no attributes", () => {
    expect(det.find("<p>x</p>[tcb-inline]<p>y</p>")).not.toBeNull();
    expect(det.find("<p>[tcb-foo]</p>")).not.toBeNull();
    expect(det.find("<p>[/tcb-foo]</p>")).not.toBeNull();
  });
  it("flags snake_case names and attribute-bearing shortcodes", () => {
    expect(det.find('<p>[show_link_exp poi-id="6"]</p>')).not.toBeNull();
    expect(det.find("<p>[/show_link_exp]</p>")).not.toBeNull();
    expect(det.find('<p>[star rating="8" max="10"]</p>')).not.toBeNull();
  });
  it("ignores prose brackets and tag-embedded Tailwind arbitrary values", () => {
    expect(
      det.find("<p>cite [1] and [Supplement] in [June-November]</p>"),
    ).toBeNull();
    expect(
      det.find(
        '<div class="shadow-[inset_0_0_0_1px_token(x)] animate-[opacity_0]">x</div>',
      ),
    ).toBeNull();
  });
});

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

/** Render one stored article and collect every broken-formatting hit. */
function scanHtml(pathname: string, rawHtml: string): string[] {
  const { html } = prepareArticleHtml(rawHtml);
  const failures: string[] = [];
  for (const det of DETECTORS) {
    const hit = det.find(html);
    if (hit) failures.push(`[${det.name}] ${pathname} :: ${hit}`);
  }
  const nested = countNestedDays(html);
  if (nested > 0) {
    failures.push(`[nested itinerary days] ${pathname} :: ${nested}`);
  }
  const glued = gluedListicleHeading(html);
  if (glued) {
    failures.push(`[glued listicle number] ${pathname} :: ${glued}`);
  }
  return failures;
}

/**
 * Scan ONE batch of pages: load only those pages' HTML, render + scan each, and
 * return the count scanned plus any failures. The HTML for the batch is scoped
 * to this call so it is GC'd before the next batch — peak memory tracks one
 * batch, not the whole corpus (the same memory-safety contract as
 * `verify:cms-io:full`).
 */
async function checkBatch(
  pageIds: string[],
): Promise<{ scanned: number; failures: string[] }> {
  const rows = await db
    .select({ pathname: pagesTable.pathname, html: pagesTable.cleanedHtml })
    .from(pagesTable)
    .where(inArray(pagesTable.id, pageIds));
  let scanned = 0;
  const failures: string[] = [];
  for (const r of rows) {
    if (typeof r.html !== "string" || r.html.length === 0) continue;
    scanned += 1;
    failures.push(...scanHtml(r.pathname, r.html));
  }
  return { scanned, failures };
}

describe.skipIf(!RUN)(
  "prepareArticleHtml — real corpus (no broken formatting reaches readers)",
  () => {
    let fixedIds: string[] = [];
    let batches: string[][] = [];
    let totalIds = 0;

    beforeAll(async () => {
      fixedIds = await loadFixedIds();
      const ids = FULL ? await loadAllPublishedIds() : await loadSampleIds();
      totalIds = ids.length;
      batches = chunk(ids, BATCH_SIZE);
    }, 600_000);

    afterAll(async () => {
      try {
        const { pool } = await import("@workspace/db");
        await pool.end();
      } catch {
        // pool may already be closed; ignore.
      }
    });

    it("resolves a non-empty set of articles to scan", () => {
      // Fixed slugs + per-marker floor (sample) or the whole corpus (full)
      // guarantee the scan set is never empty.
      expect(totalIds).toBeGreaterThan(0);
    });

    it("includes the documented stress slugs", () => {
      expect(fixedIds.length, "both fixed stress slugs resolved").toBe(
        FIXED_SLUGS.length,
      );
      const scanned = new Set(batches.flat());
      for (const id of fixedIds) {
        expect(scanned.has(id), "fixed stress slug is in the scan set").toBe(
          true,
        );
      }
    });

    it("leaves no known-broken markup in any scanned article (batched)", async () => {
      expect(batches.length, "batches to scan").toBeGreaterThan(0);
      let scanned = 0;
      const failures: string[] = [];
      for (const batch of batches) {
        const res = await checkBatch(batch);
        scanned += res.scanned;
        failures.push(...res.failures);
      }
      // Run summary to stdout for the deployment logs (`fetchDeploymentLogs`).
      console.log(
        `[corpus-render] mode=${FULL ? "full" : "sample"} ` +
          `batches=${batches.length} scanned=${scanned} ` +
          `failures=${failures.length}`,
      );
      expect(
        failures,
        `broken formatting reached the rendered body:\n${failures.join("\n")}`,
      ).toEqual([]);
    }, 3_600_000);

    it("renders the fixed listicle slugs with merged 'N. ' numbering + toc", async () => {
      const rows = await db
        .select({ slug: pagesTable.slug, html: pagesTable.cleanedHtml })
        .from(pagesTable)
        .where(and(publishedPosts, inArray(pagesTable.slug, FIXED_SLUGS)));
      for (const slug of FIXED_SLUGS) {
        const page = rows.find((p) => p.slug === slug);
        if (!page || typeof page.html !== "string") continue;
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
