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
    "%The Good%", // review takeaway cue → renderVerdictCallouts (positive assertion)
    "%The Bad%", // review takeaway cue → renderVerdictCallouts (positive assertion)
    "%Pros and Cons of%", // comparison cue → renderVerdictCallouts (positive assertion)
    "%[star%", // star-rated review header → renderReviewSpecCard (positive assertion)
    "%Review by%", // review-header title cue → renderReviewSpecCard (positive assertion)
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

/* --------------------------------------------------------------------- */
/* Positive verdict/pros-cons card assertion (the inverse of the residue   */
/* detectors above). The residue detectors only check that BROKEN markup   */
/* doesn't survive — they would NOT notice if `renderVerdictCallouts`      */
/* silently stopped promoting a takeaway heading (a change to              */
/* `prepareArticleHtml` ordering, or to the cue list). This oracle asserts  */
/* the opposite: every page that DOES carry a takeaway cue heading         */
/* immediately followed by its prose actually receives a well-formed        */
/* `.verdict-callout--{variant}` card with the heading still inside it (so   */
/* the later heading-id/TOC pass still anchors it).                         */
/* --------------------------------------------------------------------- */

type VerdictVariant = "good" | "bad" | "pros" | "cons" | "proscons" | "verdict";

/**
 * Independent copy of `lib/blog-renderer`'s verdict heading cues. It is
 * DELIBERATELY not imported from the lib: if the lib's cue list were emptied or
 * a cue dropped, an imported copy would agree (no expectation → no failure) and
 * the silent regression would slip through. Re-declaring the cues here means the
 * oracle still expects a card the lib no longer produces, so the gate fails.
 * Keep in sync with `VERDICT_CUES` in `lib/blog-renderer/src/parse.ts`.
 */
const VERDICT_CUES: { re: RegExp; variant: VerdictVariant }[] = [
  { re: /^the\s+good$/i, variant: "good" },
  { re: /^the\s+bad$/i, variant: "bad" },
  { re: /^pros\s*(?:and|&|&amp;)\s*cons\b/i, variant: "proscons" },
  { re: /^pros$/i, variant: "pros" },
  { re: /^cons$/i, variant: "cons" },
  { re: /^(?:the\s+|our\s+|final\s+)?verdict\b/i, variant: "verdict" },
  { re: /[-–—:]\s*verdict$/i, variant: "verdict" },
  { re: /^bottom\s+line$/i, variant: "verdict" },
];

/** Plain text of a heading's inner HTML (tags stripped, key entities decoded). */
function headingPlainText(innerHtml: string): string {
  return innerHtml
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The verdict variant for a heading's plain text, or null if it isn't a cue. */
function verdictCueVariant(text: string): VerdictVariant | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  for (const cue of VERDICT_CUES) {
    if (cue.re.test(t)) return cue.variant;
  }
  return null;
}

/**
 * End index (exclusive) of one balanced `<p>`/`<ul>`/`<ol>` block starting at
 * `start`, or -1 if `start` is not such an open tag. Mirrors the lib's
 * `contentBlockEnd` so the oracle's "is immediately followed by content" gate
 * matches `renderVerdictCallouts` exactly — a cue heading followed by something
 * that is NOT a balanced content block (an `<hr>`, a `<div>` wrapper, an
 * unclosed tag) is one the lib intentionally leaves alone, so the oracle must
 * not expect a card for it (avoids false positives on the real corpus).
 */
function balancedContentBlockEnd(html: string, start: number): number {
  const open = /^<(p|ul|ol)\b/i.exec(html.slice(start, start + 6));
  if (!open) return -1;
  const tag = open[1].toLowerCase();
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = start;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1]) {
      depth--;
      if (depth === 0) return re.lastIndex;
    } else {
      depth++;
    }
  }
  return -1;
}

/**
 * Scan RENDERED article HTML for takeaway cue headings and assert each one that
 * is immediately followed by its prose is wrapped in the matching
 * `.verdict-callout--{variant}` card. Returns the missing-card failures plus the
 * count of cards positively verified (so the gate can prove it isn't vacuous).
 *
 * Runs on the FINAL rendered HTML (post-`prepareArticleHtml`): the cue heading
 * always survives promotion (the lib wraps it, never removes it), and the lib
 * emits the wrapper `<div>` immediately before the heading with no whitespace —
 * so a correctly promoted heading's open tag is preceded by exactly that
 * wrapper. A heading followed by content but NOT preceded by the wrapper is a
 * dropped promotion. A heading whose following sibling is no longer a content
 * block (e.g. an earlier transform turned it into a `.review-spec-card`) fails
 * the adjacency gate and is skipped, so this can't false-positive.
 */
function verdictCalloutCheck(
  pathname: string,
  html: string,
): { failures: string[]; verified: number } {
  const failures: string[] = [];
  let verified = 0;
  const headingRe = /<h([2-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(html))) {
    const variant = verdictCueVariant(headingPlainText(m[2]));
    if (!variant) continue;
    const afterHeading = m.index + m[0].length;
    const lead = /^\s*/.exec(html.slice(afterHeading))?.[0].length ?? 0;
    if (balancedContentBlockEnd(html, afterHeading + lead) < 0) continue;
    const wrapper = `<div class="verdict-callout verdict-callout--${variant}">`;
    if (html.slice(0, m.index).endsWith(wrapper)) {
      verified += 1;
    } else {
      const label = headingPlainText(m[2]).slice(0, 80);
      failures.push(
        `[verdict-callout missing] ${pathname} :: expected ` +
          `verdict-callout--${variant} card around "${label}"`,
      );
    }
  }
  return { failures, verified };
}

/* --------------------------------------------------------------------- */
/* Positive review "spec card" assertion (sibling of the verdict oracle).   */
/* `renderReviewSpecCard` folds a migrated Thrive review header (the first   */
/* `<p>` carrying a `[star …]` marker AND a "Review by" title / spec-label   */
/* cue — "Theatre:", "Show Runtime:", "Rating:") into one `.review-spec-card`*/
/* (title + badges + `<dl>` grid + CTA). The residue DETECTORS only check    */
/* that BROKEN markup doesn't survive — they would NOT notice if this        */
/* promotion silently stopped firing (a change to `prepareArticleHtml`       */
/* ordering — it MUST run BEFORE `stripWidgetShortcodes` — or to             */
/* `REVIEW_SPEC_LABELS`). This oracle asserts the opposite: every page whose */
/* raw HTML carries a qualifying star-rated review header actually receives a */
/* well-formed `.review-spec-card` in the rendered output.                   */
/* --------------------------------------------------------------------- */

/** A bare `[star …]` shortcode marker anywhere in a string. */
const STAR_MARKER = /\[star\b[^\]]*\]/i;

/**
 * Independent copies of the lib's review-header cues — the "Review by" title
 * cue and the spec labels. DELIBERATELY re-declared here, NOT imported from
 * `lib/blog-renderer`: if the lib's `REVIEW_SPEC_LABELS` were emptied or the
 * title cue dropped, an imported copy would agree (no expectation → no failure)
 * and the silent regression would slip through. Re-declaring them means the
 * oracle still expects a card the lib no longer produces, so the gate fails.
 * Keep in sync with `REVIEW_TITLE_RE` + `REVIEW_SPEC_LABELS` in
 * `lib/blog-renderer/src/parse.ts`.
 */
const REVIEW_TITLE_CUE = /\breview(?:ed)?\s+by\b/i;
const REVIEW_SPEC_LABEL_CUES = [
  "Show Runtime",
  "Runtime",
  "Theatre",
  "Theater",
  "Directed by",
  "Director",
  "Choreographer",
  "Choreography",
  "Starring",
  "Music",
  "Lyrics",
  "Genre",
  "Venue",
  "Location",
  "Book",
  "Rating",
];

/** Matches a `Label:` spec cue anywhere in a line (any of the curated labels). */
function reviewLabelCue(): RegExp {
  return new RegExp(`\\b(?:${REVIEW_SPEC_LABEL_CUES.join("|")})\\b\\s*:\\s*`, "i");
}

/**
 * Return the inner HTML of the FIRST `<p>` that qualifies as a star-rated review
 * header (mirrors `renderReviewSpecCard`'s gate: a `[star …]` marker AND the
 * "Review by" title cue OR a recognized `Label:` spec cue), or null when no
 * qualifying header exists. This is the exact paragraph the lib folds into a
 * `.review-spec-card`, so the finer CTA/badge oracle classifies its lines. A
 * stray `[star …]` in ordinary prose (no review cue) does NOT qualify, so the
 * oracle never expects a card the lib intentionally leaves alone.
 */
function reviewHeaderInner(rawHtml: string): string | null {
  if (!STAR_MARKER.test(rawHtml)) return null;
  const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(rawHtml))) {
    const inner = m[1];
    if (!STAR_MARKER.test(inner)) continue;
    const text = headingPlainText(inner);
    if (REVIEW_TITLE_CUE.test(text) || reviewLabelCue().test(text)) return inner;
  }
  return null;
}

/** Plain text of one `<br>`-separated header line, with `[star …]` removed. */
function segmentPlainText(seg: string): string {
  return seg
    .replace(/\[star\b[^\]]*\]/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classify the lines of a qualifying review header `<p>` to decide whether the
 * card MUST carry a trailing tickets CTA and/or a bare badge line. This is an
 * INDEPENDENT re-implementation of `buildReviewCard`'s per-line classification
 * (deliberately NOT imported from `lib/blog-renderer`): if a future change to
 * `buildReviewCard` dropped the CTA anchor or mis-routed a bare badge into the
 * `<dl>` grid, an imported copy would agree (no expectation → no failure) and
 * the silent regression would slip through. Re-declaring the branch logic here
 * means the oracle still expects the part the lib no longer emits, so the gate
 * fails. The branch order mirrors `buildReviewCard` exactly: title → label rows
 * → rating row → CTA (anchor whose line is just the link) → bare badge.
 * Keep in sync with `buildReviewCard` in `lib/blog-renderer/src/parse.ts`.
 */
function reviewHeaderExpectations(
  rawHtml: string,
): { wantsCta: boolean; wantsBadges: boolean } | null {
  const inner = reviewHeaderInner(rawHtml);
  if (inner === null) return null;
  let wantsCta = false;
  let wantsBadges = false;
  for (const seg of inner.split(/<br\s*\/?>/i)) {
    const hasStar = STAR_MARKER.test(seg);
    const anchor = seg.match(/<a\b[^>]*>[\s\S]*?<\/a>/i)?.[0] ?? null;
    const text = segmentPlainText(seg);
    if (!text && !hasStar && !anchor) continue; // empty line
    if (text && REVIEW_TITLE_CUE.test(text)) continue; // → title
    if (reviewLabelCue().test(text)) continue; // → <dl> grid rows
    if (hasStar) continue; // → lone rating row
    if (anchor && segmentPlainText(seg.replace(anchor, "")) === "") {
      wantsCta = true; // → trailing tickets CTA
      continue;
    }
    if (text) wantsBadges = true; // → bare badge line
  }
  return { wantsCta, wantsBadges };
}

/**
 * Assert that a page whose RAW HTML carries a qualifying star-rated review
 * header receives a well-formed `.review-spec-card` in the RENDERED output (the
 * wrapper plus at least one of its structural parts — title / badges / `<dl>`
 * grid / CTA, so an empty shell wouldn't count). On top of that whole-card
 * check it verifies the FINER parts independently: a header line that is a
 * trailing tickets `<a>` (CTA) must produce a `.review-spec-card__cta`, and a
 * bare badge line must produce a `.review-spec-card__badges` — so a regression
 * that drops the CTA anchor or mis-routes a badge (without dropping the card
 * outright, which the current whole-card check would miss) fails the gate. Pages
 * with no review header are skipped (no expectation), so this can't
 * false-positive. Returns the failures plus the counts positively verified
 * (whole card, plus CTA/badge wanted/verified for the non-vacuous assertion).
 */
function reviewSpecCardCheck(
  pathname: string,
  rawHtml: string,
  renderedHtml: string,
): {
  failures: string[];
  verified: number;
  wantedCta: number;
  verifiedCta: number;
  wantedBadges: number;
  verifiedBadges: number;
} {
  const expectations = reviewHeaderExpectations(rawHtml);
  const none = {
    failures: [],
    verified: 0,
    wantedCta: 0,
    verifiedCta: 0,
    wantedBadges: 0,
    verifiedBadges: 0,
  };
  if (expectations === null) return none;

  const failures: string[] = [];
  const hasCard = /<div class="review-spec-card">/.test(renderedHtml);
  const hasPart = /class="review-spec-card__(?:title|badges|grid|cta)"/.test(
    renderedHtml,
  );
  let verified = 0;
  if (hasCard && hasPart) {
    verified = 1;
  } else {
    failures.push(
      `[review-spec-card missing] ${pathname} :: expected a .review-spec-card ` +
        `(title/badges/<dl> grid/cta) for a star-rated review header`,
    );
  }

  let verifiedCta = 0;
  if (expectations.wantsCta) {
    if (/<p class="review-spec-card__cta">/.test(renderedHtml)) {
      verifiedCta = 1;
    } else {
      failures.push(
        `[review-spec-card cta missing] ${pathname} :: review header carries a ` +
          `trailing tickets link but no .review-spec-card__cta was emitted`,
      );
    }
  }

  let verifiedBadges = 0;
  if (expectations.wantsBadges) {
    if (/<p class="review-spec-card__badges">/.test(renderedHtml)) {
      verifiedBadges = 1;
    } else {
      failures.push(
        `[review-spec-card badges missing] ${pathname} :: review header carries ` +
          `a bare badge line but no .review-spec-card__badges was emitted`,
      );
    }
  }

  return {
    failures,
    verified,
    wantedCta: expectations.wantsCta ? 1 : 0,
    verifiedCta,
    wantedBadges: expectations.wantsBadges ? 1 : 0,
    verifiedBadges,
  };
}

/** Render one stored article and collect every broken-formatting hit. */
function scanHtml(
  pathname: string,
  rawHtml: string,
): {
  failures: string[];
  verifiedVerdicts: number;
  verifiedSpecCards: number;
  verifiedCtas: number;
  verifiedBadges: number;
} {
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
  const verdict = verdictCalloutCheck(pathname, html);
  failures.push(...verdict.failures);
  const specCard = reviewSpecCardCheck(pathname, rawHtml, html);
  failures.push(...specCard.failures);
  return {
    failures,
    verifiedVerdicts: verdict.verified,
    verifiedSpecCards: specCard.verified,
    verifiedCtas: specCard.verifiedCta,
    verifiedBadges: specCard.verifiedBadges,
  };
}

/**
 * Scan ONE batch of pages: load only those pages' HTML, render + scan each, and
 * return the count scanned plus any failures. The HTML for the batch is scoped
 * to this call so it is GC'd before the next batch — peak memory tracks one
 * batch, not the whole corpus (the same memory-safety contract as
 * `verify:cms-io:full`).
 */
async function checkBatch(pageIds: string[]): Promise<{
  scanned: number;
  failures: string[];
  verifiedVerdicts: number;
  verifiedSpecCards: number;
  verifiedCtas: number;
  verifiedBadges: number;
}> {
  const rows = await db
    .select({ pathname: pagesTable.pathname, html: pagesTable.cleanedHtml })
    .from(pagesTable)
    .where(inArray(pagesTable.id, pageIds));
  let scanned = 0;
  let verifiedVerdicts = 0;
  let verifiedSpecCards = 0;
  let verifiedCtas = 0;
  let verifiedBadges = 0;
  const failures: string[] = [];
  for (const r of rows) {
    if (typeof r.html !== "string" || r.html.length === 0) continue;
    scanned += 1;
    const res = scanHtml(r.pathname, r.html);
    failures.push(...res.failures);
    verifiedVerdicts += res.verifiedVerdicts;
    verifiedSpecCards += res.verifiedSpecCards;
    verifiedCtas += res.verifiedCtas;
    verifiedBadges += res.verifiedBadges;
  }
  return {
    scanned,
    failures,
    verifiedVerdicts,
    verifiedSpecCards,
    verifiedCtas,
    verifiedBadges,
  };
}

// Pure unit coverage for the positive verdict-callout oracle (runs in the
// normal suite, NOT gated on VERIFY_REAL_DATA) so the assertion stays honest:
// it must verify a real promotion, fire on a dropped promotion, and never
// false-positive on cue WORDS that aren't standalone takeaway headings.
describe("verdict-callout positive assertion (oracle)", () => {
  it("verifies a card when prepareArticleHtml promotes a cue heading", () => {
    const { html } = prepareArticleHtml(
      "<h3><strong>The Good</strong></h3><p>Thrilling rides all day.</p>" +
        "<h3><strong>The Bad</strong></h3><p>Long queues at peak.</p>",
    );
    const { failures, verified } = verdictCalloutCheck("/p", html);
    expect(failures).toEqual([]);
    expect(verified).toBe(2);
  });

  it("fails when a cue heading + content is NOT wrapped (dropped promotion)", () => {
    // Simulates the regression this gate guards: the verdict transform stopped
    // firing, so the cue heading reaches the reader as loose stacked text.
    const unwrapped =
      '<h3 id="the-good"><strong>The Good</strong></h3><p>Thrilling rides.</p>';
    const { failures, verified } = verdictCalloutCheck("/p", unwrapped);
    expect(verified).toBe(0);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("verdict-callout missing");
    expect(failures[0]).toContain("verdict-callout--good");
  });

  it("flags a card promoted to the WRONG variant", () => {
    const wrongVariant =
      '<div class="verdict-callout verdict-callout--verdict">' +
      '<h3 id="the-good">The Good</h3><p>Body.</p></div>';
    const { failures, verified } = verdictCalloutCheck("/p", wrongVariant);
    expect(verified).toBe(0);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("verdict-callout--good");
  });

  it("ignores a cue word inside an ordinary section heading", () => {
    const { html } = prepareArticleHtml(
      "<h2>What was the final verdict of the trial?</h2><p>Guilty.</p>" +
        "<h2>Pros of an early start</h2><p>Beat the crowds.</p>",
    );
    const { failures, verified } = verdictCalloutCheck("/p", html);
    expect(failures).toEqual([]);
    expect(verified).toBe(0);
  });

  it("does not expect a card when the cue heading isn't followed by content", () => {
    // The separate-div "Verdict — …" header shape the lib intentionally skips.
    const { html } = prepareArticleHtml(
      '<div><h2 class="add-to-summary">Verdict</h2><hr></div>' +
        "<div><p>Body.</p></div>",
    );
    const { failures, verified } = verdictCalloutCheck("/p", html);
    expect(failures).toEqual([]);
    expect(verified).toBe(0);
  });
});

// Pure unit coverage for the positive review-spec-card oracle (runs in the
// normal suite, NOT gated on VERIFY_REAL_DATA) so the assertion stays honest:
// it must verify a real promotion, fire on a dropped promotion, and never
// false-positive on a stray star marker in ordinary prose.
describe("review-spec-card positive assertion (oracle)", () => {
  // A migrated Thrive review header: title ("Review by"), a star rating, and
  // two spec labels packed into one `<p>` of `<br>`-separated lines.
  const reviewHeader =
    "<p><strong>Hamilton Review by: Jane Critic<br>" +
    'Rating: [star rating="9"]<br>' +
    "Theatre: Victoria Palace<br>Show Runtime: 2h 45m</strong></p>" +
    "<p>The body of the review.</p>";

  it("verifies a card when prepareArticleHtml promotes a review header", () => {
    const { html } = prepareArticleHtml(reviewHeader);
    const { failures, verified } = reviewSpecCardCheck("/p", reviewHeader, html);
    expect(failures).toEqual([]);
    expect(verified).toBe(1);
    // The card carries the structural parts the oracle requires.
    expect(html).toContain('class="review-spec-card__title"');
    expect(html).toContain('class="review-spec-card__grid"');
  });

  it("fails when a qualifying review header is NOT carded (dropped promotion)", () => {
    // Simulates the regression this gate guards: the spec-card transform stopped
    // firing (e.g. `prepareArticleHtml` ordering broke, or `REVIEW_SPEC_LABELS`
    // was emptied), so the header reaches the reader as loose `<p>` prose. The
    // RAW HTML still qualifies, but the "rendered" HTML carries no card.
    const { failures, verified } = reviewSpecCardCheck(
      "/p",
      reviewHeader,
      reviewHeader,
    );
    expect(verified).toBe(0);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("review-spec-card missing");
  });

  it("ignores a stray star marker in ordinary prose (no review cue)", () => {
    const prose =
      '<p>The hotel scored [star rating="8"] from our team.</p><p>Body.</p>';
    const { html } = prepareArticleHtml(prose);
    const { failures, verified } = reviewSpecCardCheck("/p", prose, html);
    expect(failures).toEqual([]);
    expect(verified).toBe(0);
    // The lone rating still renders as a `.star-rating` badge, NOT a spec card.
    expect(html).not.toContain('class="review-spec-card"');
  });

  // A richer migrated header that ALSO carries a bare badge line ("Critic's
  // Pic") and a trailing tickets CTA (`<a>` whose line is just the link) — the
  // finer parts Task #480 guards independently of the whole-card check.
  const reviewHeaderWithCtaAndBadge =
    "<p><strong>Hamilton Review by: Jane Critic<br>" +
    "Critic's Pic<br>" +
    'Rating: [star rating="9"]<br>' +
    "Theatre: Victoria Palace<br>" +
    '<a href="https://www.headout.com/hamilton/">Book tickets</a></strong></p>' +
    "<p>The body of the review.</p>";

  it("verifies the CTA and badge parts when the header carries them", () => {
    const { html } = prepareArticleHtml(reviewHeaderWithCtaAndBadge);
    const res = reviewSpecCardCheck("/p", reviewHeaderWithCtaAndBadge, html);
    expect(res.failures).toEqual([]);
    expect(res.verified).toBe(1);
    expect(res.wantedCta).toBe(1);
    expect(res.verifiedCta).toBe(1);
    expect(res.wantedBadges).toBe(1);
    expect(res.verifiedBadges).toBe(1);
    // The lib actually emits both finer parts.
    expect(html).toContain('class="review-spec-card__cta"');
    expect(html).toContain('class="review-spec-card__badges"');
  });

  it("does not expect CTA/badge parts when the header has neither", () => {
    // `reviewHeader` is title + rating + two spec rows only — no bare badge line
    // and no trailing tickets link, so the finer oracle stays silent.
    const { html } = prepareArticleHtml(reviewHeader);
    const res = reviewSpecCardCheck("/p", reviewHeader, html);
    expect(res.wantedCta).toBe(0);
    expect(res.wantedBadges).toBe(0);
    expect(res.failures).toEqual([]);
  });

  it("fails when the CTA part is dropped but the card survives", () => {
    // Simulates the targeted regression: `buildReviewCard` stops emitting the
    // trailing CTA anchor, but the rest of the card (title/grid) still renders —
    // so the whole-card check passes while the CTA silently vanishes. Hand-build
    // a rendered card WITHOUT the `__cta` part to prove the finer check fires.
    const renderedNoCta =
      '<div class="review-spec-card">' +
      '<p class="review-spec-card__title">Hamilton Review by: Jane Critic</p>' +
      '<p class="review-spec-card__badges">' +
      '<span class="review-spec-card__badge">Critic\'s Pic</span></p>' +
      '<dl class="review-spec-card__grid"><div class="review-spec-card__row">' +
      '<dt class="review-spec-card__label">Theatre</dt>' +
      '<dd class="review-spec-card__value">Victoria Palace</dd></div></dl>' +
      "</div><p>The body of the review.</p>";
    const res = reviewSpecCardCheck(
      "/p",
      reviewHeaderWithCtaAndBadge,
      renderedNoCta,
    );
    // The whole card + the badge part are still present...
    expect(res.verified).toBe(1);
    expect(res.verifiedBadges).toBe(1);
    // ...but the dropped CTA is caught.
    expect(res.verifiedCta).toBe(0);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]).toContain("review-spec-card cta missing");
  });

  it("fails when a bare badge is mis-routed but the card survives", () => {
    // Simulates the other targeted regression: `buildReviewCard` mis-routes the
    // bare badge into the `<dl>` grid (or drops it), so no `__badges` part is
    // emitted even though the card and CTA still render.
    const renderedNoBadges =
      '<div class="review-spec-card">' +
      '<p class="review-spec-card__title">Hamilton Review by: Jane Critic</p>' +
      '<dl class="review-spec-card__grid"><div class="review-spec-card__row">' +
      '<dt class="review-spec-card__label">Theatre</dt>' +
      '<dd class="review-spec-card__value">Victoria Palace</dd></div></dl>' +
      '<p class="review-spec-card__cta">' +
      '<a href="https://www.headout.com/hamilton/">Book tickets</a></p>' +
      "</div><p>The body of the review.</p>";
    const res = reviewSpecCardCheck(
      "/p",
      reviewHeaderWithCtaAndBadge,
      renderedNoBadges,
    );
    expect(res.verified).toBe(1);
    expect(res.verifiedCta).toBe(1);
    expect(res.verifiedBadges).toBe(0);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]).toContain("review-spec-card badges missing");
  });
});

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
      let verifiedVerdicts = 0;
      let verifiedSpecCards = 0;
      let verifiedCtas = 0;
      let verifiedBadges = 0;
      const failures: string[] = [];
      for (const batch of batches) {
        const res = await checkBatch(batch);
        scanned += res.scanned;
        verifiedVerdicts += res.verifiedVerdicts;
        verifiedSpecCards += res.verifiedSpecCards;
        verifiedCtas += res.verifiedCtas;
        verifiedBadges += res.verifiedBadges;
        failures.push(...res.failures);
      }
      // Run summary to stdout for the deployment logs (`fetchDeploymentLogs`).
      // `verdicts=` is the count of verdict/pros-cons cards positively verified
      // (heading wrapped in the matching `.verdict-callout--{variant}`);
      // `speccards=` the count of star-rated review headers folded into a
      // well-formed `.review-spec-card`; `ctas=`/`badges=` the count of those
      // cards whose review header carried a trailing tickets link / a bare badge
      // line and produced the matching `.review-spec-card__cta`/`__badges` part.
      console.log(
        `[corpus-render] mode=${FULL ? "full" : "sample"} ` +
          `batches=${batches.length} scanned=${scanned} ` +
          `verdicts=${verifiedVerdicts} speccards=${verifiedSpecCards} ` +
          `ctas=${verifiedCtas} badges=${verifiedBadges} ` +
          `failures=${failures.length}`,
      );
      expect(
        failures,
        `broken formatting reached the rendered body:\n${failures.join("\n")}`,
      ).toEqual([]);
    }, 3_600_000);

    // Positive, non-vacuous coverage: load pages that carry the takeaway cue
    // markup and assert the corpus actually PRODUCES well-formed verdict/pros-cons
    // cards (heading preserved inside a `.verdict-callout--{variant}` wrapper).
    // This is the inverse of the residue scan above: it fails if a future change
    // to `prepareArticleHtml` ordering or the cue list silently stops promoting
    // these shapes — a regression the broken-markup detectors can't see.
    it("promotes takeaway cue headings into well-formed verdict cards", async () => {
      const cueMarkers = ["%The Good%", "%The Bad%", "%Pros and Cons of%"];
      const ids = new Set<string>();
      for (const marker of cueMarkers) {
        for (const id of await idsWithMarker(marker, 40)) ids.add(id);
      }
      expect(ids.size, "cue-marker pages to inspect").toBeGreaterThan(0);

      const rows = await db
        .select({ pathname: pagesTable.pathname, html: pagesTable.cleanedHtml })
        .from(pagesTable)
        .where(inArray(pagesTable.id, [...ids]));

      let verified = 0;
      const failures: string[] = [];
      for (const r of rows) {
        if (typeof r.html !== "string" || r.html.length === 0) continue;
        const { html } = prepareArticleHtml(r.html);
        const res = verdictCalloutCheck(r.pathname, html);
        verified += res.verified;
        failures.push(...res.failures);
      }
      expect(
        failures,
        `takeaway cue heading reached the reader without its card:\n${failures.join(
          "\n",
        )}`,
      ).toEqual([]);
      // The cue markup is present in the corpus, so promotion MUST fire on at
      // least one page — a zero here means the transform stopped running.
      expect(
        verified,
        "at least one takeaway cue heading was carded",
      ).toBeGreaterThan(0);
    }, 600_000);

    // Positive, non-vacuous coverage for the review "spec card": load pages that
    // carry the migrated star-rated review-header markup and assert the corpus
    // actually PRODUCES well-formed `.review-spec-card`s. This is the inverse of
    // the residue scan above: it fails if a future change to `prepareArticleHtml`
    // ordering (it MUST run BEFORE `stripWidgetShortcodes`) or to
    // `REVIEW_SPEC_LABELS` silently stops carding these headers — a regression
    // the broken-markup detectors can't see.
    it("promotes star-rated review headers into well-formed spec cards", async () => {
      // The star shortcode marker is the spine of every review header; pull pages
      // carrying it plus the "Review by" title cue (the migrated header shape).
      const specMarkers = ["%[star%", "%Review by%"];
      const ids = new Set<string>();
      for (const marker of specMarkers) {
        for (const id of await idsWithMarker(marker, 40)) ids.add(id);
      }
      expect(ids.size, "review-header pages to inspect").toBeGreaterThan(0);

      const rows = await db
        .select({ pathname: pagesTable.pathname, html: pagesTable.cleanedHtml })
        .from(pagesTable)
        .where(inArray(pagesTable.id, [...ids]));

      let verified = 0;
      let wantedCta = 0;
      let verifiedCta = 0;
      let wantedBadges = 0;
      let verifiedBadges = 0;
      const failures: string[] = [];
      for (const r of rows) {
        if (typeof r.html !== "string" || r.html.length === 0) continue;
        const { html } = prepareArticleHtml(r.html);
        const res = reviewSpecCardCheck(r.pathname, r.html, html);
        verified += res.verified;
        wantedCta += res.wantedCta;
        verifiedCta += res.verifiedCta;
        wantedBadges += res.wantedBadges;
        verifiedBadges += res.verifiedBadges;
        failures.push(...res.failures);
      }
      expect(
        failures,
        `star-rated review header reached the reader without its spec card:\n${failures.join(
          "\n",
        )}`,
      ).toEqual([]);
      // The review-header markup is present in the corpus, so promotion MUST fire
      // on at least one page — a zero here means the transform stopped running.
      expect(
        verified,
        "at least one star-rated review header was carded",
      ).toBeGreaterThan(0);
      // Non-vacuous CTA/badge coverage: ONLY if the inspected corpus actually has
      // a review header carrying a trailing tickets link / a bare badge line do we
      // demand the matching part was produced (a header without either shape
      // leaves nothing to assert). When such pages exist, at least one must have
      // emitted the `.review-spec-card__cta` / `.review-spec-card__badges` part —
      // a zero with a positive `wanted` count means the CTA/badge routing in
      // `buildReviewCard` regressed without dropping the card outright.
      if (wantedCta > 0) {
        expect(
          verifiedCta,
          "at least one review header's trailing tickets CTA was carded",
        ).toBeGreaterThan(0);
      }
      if (wantedBadges > 0) {
        expect(
          verifiedBadges,
          "at least one review header's bare badge line was carded",
        ).toBeGreaterThan(0);
      }
    }, 600_000);

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
