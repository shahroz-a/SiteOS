/**
 * Content parsing, normalization and HTML-prep helpers shared by the blog and
 * the CMS. This module is intentionally free of React, DOM-only and DB
 * dependencies (the one optional `DOMParser` use is feature-detected) so it can
 * run in the browser, a Node prerender/test, and the CMS preview alike.
 */

/**
 * Slugify heading text the same way the crawler derives anchor ids
 * (`scripts/src/crawler/util.ts`): lowercase, non-alphanumerics → hyphen,
 * trim, cap length. Keeping this in sync lets table-of-contents anchors line
 * up with the ids we inject into the rendered article body.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

/* ------------------------------------------------------------------ */
/* Content tree (componentTree) types — covers BOTH shapes:            */
/*  • crawler array  (`type`-discriminated, top-level JSON array)       */
/*  • importer root  (`blockType`-discriminated, single root object)    */
/* ------------------------------------------------------------------ */

export interface CTNode {
  /** crawler-shape discriminator */
  type?: string;
  /** importer-shape discriminator */
  blockType?: string;
  text?: string;
  anchorId?: string;
  tag?: string;
  data?: {
    level?: number;
    heading?: string;
    ordered?: boolean;
    title?: string;
    items?: string[];
    src?: string;
    alt?: string;
    caption?: string | null;
    title_?: string;
    images?: Array<{ src: string; alt?: string }>;
    richText?: LexNode | { tag?: string; children?: LexNode[] };
    // Editor-authored block fields (added by the CMS block editor). Optional so
    // crawler/importer nodes that never set them still satisfy the type.
    subtitle?: string;
    eyebrow?: string;
    imageUrl?: string;
    imageAlt?: string;
    /** Sanitized rich-text HTML emitted by the CMS rich-text editor. */
    html?: string;
    cite?: string;
    /** Plain-cell table authored in the editor (vs. the Lexical `richText` table). */
    rows?: string[][];
    hasHeader?: boolean;
    /** Generic child rows reused by accordion / faq / related blocks. */
    entries?: Array<{
      title?: string;
      body?: string;
      question?: string;
      answer?: string;
      href?: string;
      imageUrl?: string;
      eyebrow?: string;
    }>;
    body?: string;
    buttonLabel?: string;
    buttonHref?: string;
    placeholder?: string;
    url?: string;
    provider?: string;
    layout?: string;
  };
  children?: CTNode[];
}

/**
 * Normalize a `componentTree` value to a flat top-level block list, accepting
 * either the crawler's array shape or the importer's `{ children: [...] }`
 * root object. Returns `null` when the value isn't a usable tree.
 */
export function asComponentTree(value: unknown): CTNode[] | null {
  if (Array.isArray(value)) return value as CTNode[];
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as { children?: unknown }).children)
  ) {
    return (value as { children: CTNode[] }).children;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Lexical / rich-text types                                           */
/* ------------------------------------------------------------------ */

export interface LexNode {
  type: string;
  tag?: string;
  text?: string;
  /** numeric bitmask (Lexical) OR array of mark names (crawler) */
  format?: number | string[];
  listType?: string;
  url?: string;
  fields?: { url?: string; newTab?: boolean };
  children?: LexNode[];
}

export interface LexRoot {
  root: LexNode;
}

export function asRichText(value: unknown): LexRoot | null {
  if (
    value &&
    typeof value === "object" &&
    "root" in value &&
    (value as LexRoot).root &&
    Array.isArray((value as LexRoot).root.children)
  ) {
    return value as LexRoot;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Raw HTML sanitization (for dangerouslySetInnerHTML)                  */
/* ------------------------------------------------------------------ */

/**
 * Strip inline event-handler attributes (`onload`, `onerror`, `onclick`, …)
 * from migrated HTML before it is injected via `dangerouslySetInnerHTML`.
 *
 * The source WordPress markup was served through Google's mod_pagespeed, which
 * rewrites `<img>` tags with handlers like
 * `onload="pagespeed.CriticalImages.checkImageForCriticality(this)"`. Once that
 * markup is parsed into the live DOM the handler fires against a `pagespeed`
 * global that doesn't exist here and throws `ReferenceError: pagespeed is not
 * defined` on every image. Inline handlers are also an XSS vector, so dropping
 * every `on*` attribute hardens rendering as a side benefit.
 *
 * NOTE: this strips inline event-handler attributes only — it is intentionally
 * not a full HTML sanitizer (it does not touch `javascript:` URLs, iframes,
 * `srcdoc`, etc.). If the source HTML ever becomes genuinely untrusted, swap in
 * a vetted allowlist sanitizer (e.g. DOMPurify) at the ingest/API boundary.
 */
export function sanitizeContentHtml(html: string): string {
  if (!html) return html;
  if (typeof DOMParser === "undefined") {
    // Non-browser fallback (SSR/tests): textual strip of `on*="..."` handlers.
    return html.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith("on")) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return doc.body.innerHTML;
}

const ON_ATTR_RE = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;

/** Pull an attribute's value out of a single tag string. */
function attrValue(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? (m[2] ?? m[3] ?? "") : null;
}

/**
 * Repair a mod_pagespeed lazy-loaded `<img>`: promote the real source out of
 * `data-pagespeed-lazy-src` / `data-lazy-src` / `data-src` (the live `src` is a
 * 1x1 placeholder beacon), then drop the pagespeed bookkeeping attributes.
 */
function repairImg(imgTag: string): string {
  let out = imgTag;
  const realSrc =
    attrValue(out, "data-pagespeed-lazy-src") ??
    attrValue(out, "data-lazy-src") ??
    attrValue(out, "data-src");
  if (realSrc) {
    out = /\ssrc\s*=\s*("[^"]*"|'[^']*')/i.test(out)
      ? out.replace(/\ssrc\s*=\s*("[^"]*"|'[^']*')/i, ` src="${realSrc}"`)
      : out.replace(/<img/i, `<img src="${realSrc}"`);
  }
  const realSrcset =
    attrValue(out, "data-pagespeed-lazy-srcset") ??
    attrValue(out, "data-lazy-srcset") ??
    attrValue(out, "data-srcset");
  if (realSrcset) {
    out = /\ssrcset\s*=\s*("[^"]*"|'[^']*')/i.test(out)
      ? out.replace(/\ssrcset\s*=\s*("[^"]*"|'[^']*')/i, ` srcset="${realSrcset}"`)
      : out.replace(/<img/i, `<img srcset="${realSrcset}"`);
  }
  out = out.replace(
    /\sdata-pagespeed-[a-z-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
    "",
  );
  out = out.replace(
    /\sdata-(lazy-)?src(set)?\s*=\s*("[^"]*"|'[^']*')/gi,
    "",
  );
  out = out.replace(
    /\spagespeed_[a-z_]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
    "",
  );
  // Normalize unit-bearing dimension attributes. mod_pagespeed / WordPress
  // sometimes emit `width="60px"` / `height="90px"`, but the HTML width/height
  // *attributes* must be unitless integers — a unit makes the browser ignore
  // the attribute entirely, so the icon falls back to `.blog-prose img`'s
  // `max-width:100%` and balloons to its intrinsic size. Strip the `px` unit so
  // the intended pixel dimension is honoured. (A CSS `style="width:90px"` is
  // valid and is deliberately left untouched.)
  out = out.replace(/(\s(?:width|height)\s*=\s*)(["'])(\d+)px\2/gi, "$1$2$3$2");
  return out;
}

/**
 * Repair malformed "day-by-day itinerary" widgets whose `<div class="days">`
 * blocks are missing their closing `</div>`.
 *
 * The migrated WordPress/Thrive itinerary widget (`.page-card > .days+`) is
 * meant to render each day as a *sibling* div. Part of the source corpus is
 * malformed: from roughly the third day onward the `</div>` that should close
 * one `.days` block is absent, so the next `<div class="days">` is parsed as a
 * *child* of the previous one. Because `<div>` is not a formatting element the
 * browser (and any spec HTML parser) nests them verbatim — each day indenting
 * one "day" column further right — which pushes the widget, and the whole
 * article, past the viewport on mobile (a runaway horizontal scrollbar).
 *
 * Browsers and `DOMParser` reproduce this nesting faithfully, so it cannot be
 * fixed by parse-and-reserialize: the missing tags must be re-inserted into the
 * markup *before* it is parsed. This isomorphic (no-DOM) string pass tracks div
 * nesting and, whenever a `.days` div opens while an ancestor `.days` is still
 * open, closes the open block(s) first so the days become proper siblings.
 */
export function balanceItineraryDays(html: string): string {
  if (!html || !/\sclass\s*=\s*["'][^"']*\bdays\b/i.test(html)) return html;
  const isDays = (openTag: string): boolean => {
    const m = openTag.match(/\sclass\s*=\s*("([^"]*)"|'([^']*)')/i);
    const cls = m ? (m[2] ?? m[3] ?? "") : "";
    return cls.split(/\s+/).includes("days");
  };
  const tokenRe = /<div\b[^>]*>|<\/div>/gi;
  const stack: boolean[] = []; // one entry per open <div>; true = a `.days` div
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(html))) {
    out += html.slice(last, m.index);
    last = tokenRe.lastIndex;
    const tok = m[0];
    if (tok[1] === "/") {
      stack.pop();
      out += tok;
      continue;
    }
    const days = isDays(tok);
    if (days && stack.includes(true)) {
      // Close down to and including the nearest still-open `.days` so this new
      // day can't nest inside it (also closes any intervening unclosed divs).
      while (stack.length) {
        const wasDays = stack.pop();
        out += "</div>";
        if (wasDays) break;
      }
    }
    out += tok;
    stack.push(days);
  }
  out += html.slice(last);
  return out;
}

/**
 * Remove a balanced `<div>…</div>` subtree whenever its opening tag matches
 * `tagRe` (typically a class match). Stays no-DOM: it walks div open/close
 * tokens and, on entering a matching div, skips everything up to that div's own
 * matching `</div>`, correctly accounting for nested divs. Non-matching content
 * is preserved byte-for-byte.
 */
function removeBalancedDivsWithTag(html: string, tagRe: RegExp): string {
  const tokenRe = /<div\b[^>]*>|<\/div>/gi;
  let out = "";
  let last = 0;
  let removing = false;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(html))) {
    const tok = m[0];
    const isClose = tok[1] === "/";
    if (!removing) {
      if (!isClose && tagRe.test(tok)) {
        out += html.slice(last, m.index);
        removing = true;
        depth = 1;
        last = tokenRe.lastIndex;
      }
    } else if (isClose) {
      depth--;
      if (depth === 0) {
        removing = false;
        last = tokenRe.lastIndex;
      }
    } else {
      depth++;
    }
  }
  out += html.slice(last);
  return out;
}

/**
 * Remove a balanced `<tag>…</tag>` subtree whenever its opening tag matches
 * `openTagRe` — like `removeBalancedDivsWithTag` but TAG-AGNOSTIC: the element
 * carrying the class may be ANY tag (`<div>`, `<section>`, `<nav>`, `<aside>`,
 * …), not only `<div>`. It locates an opening tag matching `openTagRe`, derives
 * that element's tag name, then walks same-name open/close tokens to skip the
 * whole balanced subtree (correctly accounting for nested same-name elements);
 * intervening child elements of other tags are carried along inside the removed
 * span. Non-matching content is preserved byte-for-byte. Repeats until no
 * further matches remain. `openTagRe` should be a non-global regex matched
 * against the opening-tag string (e.g. `/\bsummary-wrapper-mobile\b/i`).
 */
function removeBalancedElementsWithClass(
  html: string,
  openTagRe: RegExp,
): string {
  const probe = /<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/gi;
  let out = "";
  let cursor = 0;
  for (;;) {
    probe.lastIndex = cursor;
    let open: RegExpExecArray | null = null;
    let m: RegExpExecArray | null;
    while ((m = probe.exec(html))) {
      if (openTagRe.test(m[0])) {
        open = m;
        break;
      }
    }
    if (!open) {
      out += html.slice(cursor);
      return out;
    }
    out += html.slice(cursor, open.index);
    const tag = open[1];
    const tokenRe = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, "gi");
    tokenRe.lastIndex = open.index;
    let depth = 0;
    let end = html.length;
    let t: RegExpExecArray | null;
    while ((t = tokenRe.exec(html))) {
      if (t[0][1] === "/") {
        depth--;
        if (depth === 0) {
          end = tokenRe.lastIndex;
          break;
        }
      } else {
        depth++;
      }
    }
    cursor = end;
  }
}

/**
 * Strip migrated WordPress "Sassy Social Share" (`heateor_sss_*`) share/follow
 * widgets from article HTML.
 *
 * The plugin renders its icons as CSS background-image sprites hosted on the old
 * WordPress origin; in the migrated corpus those sprites never load, so the
 * widget renders as a broken vertical stack of bare coloured boxes on every
 * article. It is chrome, not content — the blog provides its own share UI — so
 * remove it outright. Stays no-DOM/isomorphic (SSR byte-parity): first remove
 * any balanced container div carrying a `heateor_sss` class (handles the normal
 * `…_sharing_container` wrapper plus its nested `…_sharing_ul`/title divs), then
 * sweep up any loose anchors/spans and the plugin's `heateorSssClear` spacer
 * that weren't wrapped in a container.
 */
export function stripSocialShare(html: string): string {
  if (!html || !/heateor[_]?sss/i.test(html)) return html;
  let out = removeBalancedDivsWithTag(html, /<div\b[^>]*heateor[_]?sss/i);
  out = out.replace(/<a\b[^>]*heateor[_]?sss[^>]*>[\s\S]*?<\/a>/gi, "");
  out = out.replace(/<span\b[^>]*heateor[_]?sss[^>]*>[\s\S]*?<\/span>/gi, "");
  out = out.replace(/<div\b[^>]*heateorSssClear[^>]*>\s*<\/div>/gi, "");
  return out;
}

/**
 * Strip the migrated Thrive "mobile summary" widget (`.open-summary-mobile…` +
 * `#summary-wrapper-mobile.summary-list`) from article HTML.
 *
 * This is a JS-driven, mobile-only duplicate table of contents: a collapsed
 * "Summary" toggle (`<i class="fa fa-bars">` + the text "Summary") plus a
 * `summary-list` panel whose `<ul id="summary-mobile-ul">` is populated client
 * side by Thrive's runtime (which we don't ship). In the migrated corpus the
 * toggle's Font Awesome glyph never loads (so it renders as a stray grey box)
 * and the list stays empty — pure broken chrome. The blog renders its own
 * `TableOfContents`, so remove the widget outright. No-DOM/isomorphic (SSR
 * byte-parity): drop the balanced toggle wrapper, then the balanced list panel.
 *
 * The carrying tag varies across the corpus: most pages wrap the widget in a
 * `<div>`, but some wrap it in a non-`<div>` element (`<section>`, `<nav>`, …),
 * so we match the class on ANY tag via `removeBalancedElementsWithClass` rather
 * than only `<div>`. A further migrated shape carries no wrapper element at all:
 * the widget's behaviour lives in a Thrive `[tcb-script]…[/tcb-script]`
 * shortcode that references the summary nodes. The migrated corpus stores those
 * shortcodes as PLAIN TEXT (the `cleaned_html` has no real `<script>` tags), so
 * `prepareArticleHtml`'s `<script>` strip never reaches them and the raw JS
 * renders as visible code in the article body. Drop the summary-driving
 * `[tcb-script]` blocks too (only those referencing the summary nodes; other
 * `[tcb-script]` cruft is out of scope here).
 */
export function stripSummaryWidget(html: string): string {
  if (!html || !/open-summary-mobile|summary-wrapper-mobile/i.test(html)) {
    return html;
  }
  let out = removeBalancedElementsWithClass(
    html,
    /\bopen-summary-mobile-wrapper\b/i,
  );
  out = removeBalancedElementsWithClass(out, /\bsummary-wrapper-mobile\b/i);
  out = out.replace(/\[tcb-script\b[\s\S]*?\[\/tcb-script\]/gi, (block) =>
    /open-summary-mobile|summary-wrapper-mobile|summary-mobile-ul|summaryList/i.test(
      block,
    )
      ? ""
      : block,
  );
  return out;
}

/**
 * Strip migrated Thrive Architect "script shortcode" blocks (`[tcb-script]…
 * [/tcb-script]`) whose raw JavaScript leaks into the article body as bare text.
 *
 * Thrive Content Builder wrapped inline page scripts in a `[tcb-script]` BBCode-
 * style shortcode rather than a real `<script>` tag. The migration carried those
 * shortcodes across verbatim, so the `<script>…</script>` strip in
 * `prepareArticleHtml` never touches them and the JavaScript body renders as
 * visible code gibberish to readers — e.g. the dead mobile "Summary" widget's
 * `jQuery(document).ready(… document.getElementById("summary-wrapper-mobile") …)`
 * (this residue is also what makes the corpus-render "Thrive summary widget"
 * detector fire even after the real widget div is removed).
 *
 * The opening marker may carry attributes
 * (`[tcb-script src="…" integrity="…" crossorigin="…"]`), so match `[tcb-script`
 * + anything up to the first `]`, then everything (non-greedy) up to the matching
 * `[/tcb-script]`. After dropping the balanced blocks, sweep up any orphan
 * opening/closing markers left without a partner. No-DOM/isomorphic (SSR
 * byte-parity).
 */
export function stripScriptShortcodes(html: string): string {
  if (!html || !/\[\/?tcb-script\b/i.test(html)) return html;
  let out = html.replace(
    /\[tcb-script\b[^\]]*\][\s\S]*?\[\/tcb-script\]/gi,
    "",
  );
  // Sweep any orphan markers (opening or closing) left without a balanced partner.
  out = out.replace(/\[tcb-script\b[^\]]*\]/gi, "");
  out = out.replace(/\[\/tcb-script\]/gi, "");
  return out;
}

/**
 * Strip leaked WordPress/Thrive page-builder "widget" shortcode MARKERS that the
 * migration carried across the corpus as PLAIN TEXT, so the raw bracket tokens
 * render as visible gibberish in the article body.
 *
 * Unlike `[tcb-script]…[/tcb-script]` (whose whole body is dead JavaScript and is
 * removed wholesale by `stripScriptShortcodes`/`prepareArticleHtml`), these
 * shortcodes either wrap REAL visible content or are self-contained inline
 * widgets, so we drop ONLY the bracket marker tokens and keep any wrapped
 * content. The shapes found in the migrated corpus:
 *
 *  • `[show_link_exp poi-id="616"]…[/show_link_exp]` — Thrive "show link
 *    experience" booking widget. It wraps a real, still-functional "Find Best
 *    Seats" CTA (`<div class="book-strip">…` inside a live
 *    `<a href="https://www.headout.com/book/…">`), so only the opening/closing
 *    markers are removed; the CTA is preserved. A few corpus pages carry a
 *    TRUNCATED closer (`[/show_link_ex]`, missing the final `p`), so the name is
 *    matched as `show_link_ex` + an optional tail.
 *  • `[star rating="8" max="10"]` — a self-contained "star rating" widget (note
 *    the migrated curly quotes), rendered by a runtime we don't ship. There is
 *    no wrapped content and no closer. Rather than drop it (which would silently
 *    discard the rating value the author intended readers to see), we CONVERT it
 *    to a small visible rating element (`★ N/M`) carrying the parsed values, via
 *    `renderStarRating`. Both straight and migrated curly quotes are accepted,
 *    and a missing `max` defaults to a 10-point scale. A `[star …]` marker with
 *    no parseable `rating` value carries no information, so it is removed.
 *
 * Scoped to a curated allowlist of recognized page-builder shortcode names so it
 * can't touch legitimate bracket text (citations `[1]`, prose `[June-November]`,
 * `[Supplement]`) or CSS/Tailwind arbitrary-value brackets baked into
 * `class`/`style` attributes (`bg-[linear-gradient(…)]`,
 * `shadow-[inset_0_0_0_1px_token(…)]`, `animate-[opacity_0…]`). NEW shortcode
 * shapes in the long tail are surfaced by the corpus-render gate's general
 * "leaked page-builder shortcode" detector, then added here. No-DOM/isomorphic
 * (SSR byte-parity).
 */
const SHOW_LINK_SHORTCODE_RE = /\[\/?show_link_ex[a-z]*\b[^\]]*\]/gi;
const STAR_SHORTCODE_RE = /\[star\b[^\]]*\]/gi;

/**
 * Pull a numeric shortcode attribute (`rating="8"`, `max=”10”`, `rating=8.5`)
 * out of a `[star …]` marker. Accepts straight (`"` `'`), migrated curly
 * (`“ ” ‘ ’`), or no quotes, and integer or decimal values. Returns `null`
 * when the attribute is absent or non-numeric.
 */
function starAttrNumber(marker: string, name: string): string | null {
  const re = new RegExp(
    `${name}\\s*=\\s*["'\u201c\u201d\u2018\u2019]?\\s*(\\d+(?:\\.\\d+)?)`,
    "i",
  );
  const m = marker.match(re);
  return m ? m[1] : null;
}

/**
 * Convert a single `[star rating="N" max="M"]` marker to a small visible rating
 * element. Missing `max` defaults to a 10-point scale; a marker with no
 * parseable `rating` carries no information and renders as empty (removal).
 */
function renderStarRating(marker: string): string {
  const rating = starAttrNumber(marker, "rating");
  if (rating === null) return "";
  const max = starAttrNumber(marker, "max") ?? "10";
  return (
    `<span class="star-rating" role="img" ` +
    `aria-label="Rating: ${rating} out of ${max}">` +
    `<span class="star-rating__star" aria-hidden="true">\u2605</span>` +
    `<span class="star-rating__value">${rating}/${max}</span></span>`
  );
}

export function stripWidgetShortcodes(html: string): string {
  if (!html || !/\[\/?(?:show_link_ex|star\b)/i.test(html)) return html;
  let out = html.replace(SHOW_LINK_SHORTCODE_RE, "");
  out = out.replace(STAR_SHORTCODE_RE, (marker) => renderStarRating(marker));
  return out;
}

/* ------------------------------------------------------------------ */
/* Review "spec card" (migrated Thrive review header)                   */
/* ------------------------------------------------------------------ */

/** A bare `[star …]` marker anywhere in a string. */
const STAR_MARKER_RE = /\[star\b[^\]]*\]/i;

/**
 * A review header's title line — "<Show> Review by: <critic>". Matched against
 * a line's plain text to lift it out as the card title rather than a spec row.
 */
const REVIEW_TITLE_RE = /\breview(?:ed)?\s+by\b/i;

/**
 * Curated spec labels emitted by the migrated Thrive review-header template,
 * used to split the header's inline `<br>`-separated lines into label/value
 * rows. Order matters: a multi-word label MUST precede any single-word label it
 * contains ("Show Runtime" before "Runtime") so the longest label wins when a
 * single line packs several pairs ("Theatre: … Show Runtime: …"). "Review by"
 * is intentionally absent — it is the card title, handled separately.
 */
const REVIEW_SPEC_LABELS = [
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

/** Global label matcher (`Label:`), longest-first per `REVIEW_SPEC_LABELS`. */
function reviewLabelMatcher(): RegExp {
  return new RegExp(`\\b(${REVIEW_SPEC_LABELS.join("|")})\\b\\s*:\\s*`, "gi");
}

/** Escape text for safe insertion as HTML text content. */
function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Plain text of a raw header segment, with any `[star …]` marker removed. */
function segmentText(seg: string): string {
  return decodeEntities(stripTags(seg).replace(/\[star\b[^\]]*\]/gi, ""))
    .replace(/\s+/g, " ")
    .trim();
}

interface ReviewSpecRow {
  label: string;
  valueHtml: string;
}

/**
 * Build the structured "review spec card" markup from a header paragraph's
 * inner HTML, or return `null` when nothing card-worthy can be extracted.
 *
 * The migrated header is a single `<p>` whose lines are separated by `<br>`
 * (the `<br>`s are often nested inside `<strong>`/`<span>` colour wrappers).
 * Each line is one of: the title ("<Show> Review by: <critic>"), a bare badge
 * ("Critic's Pic"), one-or-more "Label: value" spec pairs ("Rating: ★",
 * "Theatre: … Show Runtime: …"), or a trailing CTA link. We classify each line
 * and re-emit them as a title + badges + a `<dl>` label/value grid + CTA so the
 * loose inline facts read as one intentional card.
 *
 * The rating value preserves the raw `[star …]` marker so the later
 * `stripWidgetShortcodes` pass converts it to the `.star-rating` badge — which
 * is why `renderReviewSpecCard` must run BEFORE `stripWidgetShortcodes`.
 * No-DOM/isomorphic (SSR byte-parity).
 */
function buildReviewCard(inner: string): string | null {
  const segments = inner.split(/<br\s*\/?>/i);
  let title: string | null = null;
  const badges: string[] = [];
  const rows: ReviewSpecRow[] = [];
  const ctas: string[] = [];

  for (const seg of segments) {
    const hasStar = STAR_MARKER_RE.test(seg);
    const starMarker = hasStar ? (seg.match(/\[star\b[^\]]*\]/i)?.[0] ?? "") : "";
    const anchor = seg.match(/<a\b[^>]*>[\s\S]*?<\/a>/i)?.[0] ?? null;
    const text = segmentText(seg);

    if (!text && !hasStar && !anchor) continue;

    if (text && REVIEW_TITLE_RE.test(text)) {
      if (title === null) title = text;
      continue;
    }

    const labelRe = reviewLabelMatcher();
    const matches = [...text.matchAll(labelRe)];
    if (matches.length > 0) {
      for (let i = 0; i < matches.length; i++) {
        const mm = matches[i];
        const label = mm[1];
        const valueStart = (mm.index ?? 0) + mm[0].length;
        const valueEnd = matches[i + 1]?.index ?? text.length;
        const value = text
          .slice(valueStart, valueEnd)
          .replace(/\s+/g, " ")
          .trim();
        const isRating = /^rating$/i.test(label);
        if (isRating && starMarker) {
          rows.push({ label, valueHtml: starMarker });
        } else if (value) {
          rows.push({ label, valueHtml: escapeHtmlText(value) });
        }
      }
      continue;
    }

    // No labels on this line: a lone rating, a CTA link, or a plain badge.
    if (hasStar && starMarker) {
      rows.push({ label: "Rating", valueHtml: starMarker });
      continue;
    }
    if (anchor && segmentText(seg.replace(anchor, "")) === "") {
      ctas.push(anchor);
      continue;
    }
    if (text) badges.push(text);
  }

  if (!title && badges.length === 0 && rows.length === 0 && ctas.length === 0) {
    return null;
  }

  let out = '<div class="review-spec-card">';
  if (title) {
    out += `<p class="review-spec-card__title">${escapeHtmlText(title)}</p>`;
  }
  if (badges.length > 0) {
    out +=
      '<p class="review-spec-card__badges">' +
      badges
        .map(
          (b) =>
            `<span class="review-spec-card__badge">${escapeHtmlText(b)}</span>`,
        )
        .join("") +
      "</p>";
  }
  if (rows.length > 0) {
    out += '<dl class="review-spec-card__grid">';
    for (const r of rows) {
      out +=
        '<div class="review-spec-card__row">' +
        `<dt class="review-spec-card__label">${escapeHtmlText(r.label)}</dt>` +
        `<dd class="review-spec-card__value">${r.valueHtml}</dd>` +
        "</div>";
    }
    out += "</dl>";
  }
  if (ctas.length > 0) {
    out += `<p class="review-spec-card__cta">${ctas.join("")}</p>`;
  }
  out += "</div>";
  return out;
}

/**
 * Promote the migrated Thrive "review header" — a loose `<p>` of inline facts
 * ("<Show> Review by:", "Critic's Pic", "Rating: [star …]", "Theatre:",
 * "Show Runtime:", a tickets link) emitted as plain `<strong>`/`<br>` prose —
 * into a single styled `.review-spec-card` (title + badges + label/value grid +
 * CTA) so the review header reads as an intentional component.
 *
 * Targets only the FIRST `<p>` that carries a `[star …]` marker AND at least
 * one recognized review label or the "Review by" title cue, so a stray star
 * widget in ordinary prose is left alone (it still renders as a `.star-rating`
 * badge via `stripWidgetShortcodes`). Must run BEFORE `stripWidgetShortcodes`
 * so the rating's raw `[star …]` marker (preserved into the card) is converted
 * there. No-DOM/isomorphic (SSR byte-parity).
 */
export function renderReviewSpecCard(html: string): string {
  if (!html || !STAR_MARKER_RE.test(html)) return html;
  const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(html))) {
    const inner = m[1];
    if (!STAR_MARKER_RE.test(inner)) continue;
    const text = decodeEntities(stripTags(inner));
    const isReviewHeader =
      REVIEW_TITLE_RE.test(text) || reviewLabelMatcher().test(text);
    if (!isReviewHeader) continue;
    const card = buildReviewCard(inner);
    if (!card) continue;
    return html.slice(0, m.index) + card + html.slice(m.index + m[0].length);
  }
  return html;
}

/**
 * Fold the standalone "section number" that the migrated Thrive listicle
 * widgets render *separately* from their heading back into the heading text, so
 * a numbered attraction reads "2. 9/11 Museum" instead of a stray digit
 * floating above the title.
 *
 * Two corpus formats are handled, both isomorphic string rewrites (no DOM):
 *
 *  • Attraction listicle (`.attr-list`): the number is a leading
 *    `<span id="attr-1">2</span>` (sometimes `<span>#2 </span>`) *inside* the
 *    `.attr-list-title` heading — rendered glued to the title ("2Title") with no
 *    separator. Normalise it to "2. ".
 *  • Timeline listicle (`.timeline`): the number is an orphaned
 *    `<p class="number">2</p>` in a sibling decoration block (the original
 *    number-circle + connector-line CSS was never migrated), followed by the
 *    item's title. The title element varies across the corpus: an `<h2-6>` of
 *    any class (`card-title`, `add-to-summary`, or no class), AND in some pages
 *    a non-heading `<span class="card-title">`. So we bind to the NEXT title —
 *    a heading of any class OR a `span.card-title` — whichever comes first (a
 *    `<p class="number">` orphan only ever appears inside a timeline item, so
 *    this can't over-match ordinary content). Drop the orphan paragraph and
 *    prefix its number onto that title. The `card-title(?![-\w])` guard avoids
 *    binding to the sibling `card-title-subtext` span.
 *  • Timeline listicle with an EMPTY number (`<p class="number"></p>`, no
 *    digit): some migrated pages (e.g. `/blog/best-time-to-visit-melbourne/`)
 *    carry the number paragraph with no digit at all — the source number was
 *    never populated. With the number-circle CSS gone it renders as a stray
 *    empty badge above the title and there is nothing to fold. We DROP the
 *    empty orphan outright rather than renumber it from its position: these
 *    timelines are frequently month/section sequences ("Melbourne in January",
 *    …), not ranked lists, so injecting a synthetic "1. " ordinal would invent
 *    an order the author never expressed. Removal runs AFTER the digit fold so
 *    a digit-bearing paragraph is consumed there first and only truly-empty
 *    orphans reach this step.
 *
 * Runs before heading-id/toc extraction so the merged "N. " becomes part of the
 * heading's slug id and table-of-contents label too.
 */
export function mergeNumberedHeadings(html: string): string {
  if (!html) return html;
  let out = html;

  // Attraction listicle: <h2 class="attr-list-title …"><span id="attr-1">2</span>Title…
  out = out.replace(
    /(<h[2-6]\b[^>]*\battr-list-title\b[^>]*>)\s*<span\b[^>]*>\s*#?\s*(\d+)[^<]*<\/span>\s*/gi,
    (_m, open: string, num: string) => `${open}${num}. `,
  );

  // Timeline listicle: <p class="number">2</p> … <title>. The title element
  // varies (h2-6 of any class, or a non-heading span.card-title), so bind to the
  // NEXT title — a heading OR a span.card-title — whichever comes first. The
  // `<p class="number">` orphan is unique to timeline items so this can't
  // over-match ordinary content; the `card-title(?![-\w])` guard skips the
  // sibling `card-title-subtext` span.
  out = out.replace(
    /<p\b[^>]*\bnumber\b[^>]*>\s*(\d+)\s*<\/p>((?:(?!<h[2-6]\b)(?!<span\b[^>]*card-title(?![-\w]))[\s\S])*?)(<h[2-6]\b[^>]*>|<span\b[^>]*card-title(?![-\w])[^>]*>)\s*/gi,
    (_m, num: string, between: string, open: string) =>
      `${between}${open}${num}. `,
  );

  // Empty timeline number orphan: <p class="number"></p> with no digit. Nothing
  // to fold, so drop it so it can't render as a stray empty badge above the
  // title. Runs after the digit fold so only truly-empty paragraphs remain here.
  out = out.replace(/<p\b[^>]*\bnumber\b[^>]*>\s*<\/p>/gi, "");

  return out;
}

/**
 * Drop leftover EMPTY decoration elements from the migrated Thrive timeline /
 * listicle "card" widgets whose original CSS was never brought across — the same
 * root cause as the empty `<p class="number"></p>` badge that
 * `mergeNumberedHeadings` removes.
 *
 * A timeline item is a left "decoration column" (a numbered circle joined by a
 * vertical connector line) beside a "text" column:
 *
 *   <div class="timeline">
 *     <div>                                <- decoration column
 *       <p class="number">N</p>            <- folded into the title by mergeNumberedHeadings
 *       <div class="timeline-line"></div>  <- the connector line (ALWAYS empty)
 *     </div>
 *     <div class="timeline-text">
 *       <h2 class="card-title">…</h2>
 *       <p class="card-title-subtext">…</p> <- a subtitle row, often EMPTY in the corpus
 *     </div>
 *   </div>
 *
 * Once the number-circle / connector CSS is gone, two decoration orphans survive
 * into the reader-facing body:
 *
 *  • `<div class="timeline-line"></div>` — the circle's vertical connector line.
 *    It is ALWAYS empty across the whole corpus (every occurrence is the exact
 *    empty div, 0 carry any content) and has no migrated styling, so it is pure
 *    orphan decoration with nothing left to show. Drop it.
 *  • An EMPTY `<p class="card-title-subtext …">` — the card's subtitle row. Many
 *    timeline cards ship it with no text at all (the source subtitle was never
 *    populated); the inline `display:block` it carries then renders it as a
 *    stray blank gap under the title (an empty `<p>` keeps its default block
 *    margins). Drop ONLY the empty / whitespace-only ones — subtitle rows that
 *    DO carry text ("Average Temperature: 16°C – 26°C") are real content and are
 *    left untouched.
 *
 * Deliberately NOT removed here: the now-childless class-less wrapper `<div>`
 * left around the dropped number + line. An empty, unstyled `<div>` has no
 * default margin and no CSS, so it collapses to zero height and is invisible —
 * it is not a "stray box" a reader can see, and a blind "drop empty class-less
 * divs" sweep would risk eating legitimate structural empties elsewhere. Other
 * empty Thrive/slider artifacts in the corpus (`tve-content-box-background`,
 * `swiper-*`, `tcb_flag`, `tve_iframe_cover`, …) are JS-hydrated widgets or
 * absolutely-positioned background layers, NOT orphan decoration, so they are
 * also intentionally out of scope.
 *
 * No-DOM/isomorphic (SSR byte-parity). Runs after `mergeNumberedHeadings` so the
 * digit fold / empty-number drop has already consumed the number paragraph.
 */
export function stripEmptyTimelineDecorations(html: string): string {
  if (!html) return html;
  let out = html;
  // The connector-line decoration — always empty in the corpus.
  out = out.replace(/<div\b[^>]*\btimeline-line\b[^>]*>\s*<\/div>/gi, "");
  // Empty card subtitle rows (whitespace-only); rows with text are kept.
  out = out.replace(
    /<p\b[^>]*\bcard-title-subtext\b[^>]*>(?:\s|&nbsp;|&#0?160;)*<\/p>/gi,
    "",
  );
  return out;
}

/**
 * Rewrite absolute links that point at the blog's *own* pages
 * (`https://www.headout.com/blog/…`, with or without scheme/`www`) to
 * root-relative `/blog/…` paths so in-content links — and the author bylines
 * baked into the migrated HTML — navigate within this app instead of bouncing
 * the reader out to the production marketing site.
 *
 * Only `/blog/` URLs are ours; every other `headout.com` link (tours, tickets,
 * city pages, …) belongs to the main site and is deliberately left absolute.
 * No-DOM/isomorphic so prerendered and hydrated markup stay byte-identical.
 */
export function rewriteInternalLinks(html: string): string {
  if (!html || !/headout\.com\/blog\//i.test(html)) return html;
  return html.replace(
    /(\bhref\s*=\s*)(["'])(?:https?:)?\/\/(?:www\.)?headout\.com(\/blog\/[^"']*)\2/gi,
    (_m, attr: string, q: string, path: string) => `${attr}${q}${path}${q}`,
  );
}

/**
 * Repair malformed `hhttp(s)://` URL schemes baked into migrated content.
 *
 * Some migrated WordPress image sources carry a duplicated leading character
 * (e.g. `data-src="hhttps://cdn-imgix.headout.com/..."`). The browser treats
 * `hhttps:` as an unknown scheme, which throws `ERR_UNKNOWN_URL_SCHEME` and
 * leaves a broken image. `hhttp`/`hhttps` is never a valid scheme, so this is an
 * unambiguous, isomorphic string repair.
 */
export function fixMalformedUrlScheme(html: string): string {
  if (!html) return html;
  return html
    .replace(/hhttps:\/\//gi, "https://")
    .replace(/hhttp:\/\//gi, "http://");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&hellip;|&#8230;/g, "…")
    .replace(/&#8217;|&rsquo;/g, "\u2019")
    .replace(/&#8216;|&lsquo;/g, "\u2018")
    .replace(/&#8220;|&ldquo;/g, "\u201C")
    .replace(/&#8221;|&rdquo;/g, "\u201D")
    .replace(/&#8211;|&ndash;/g, "\u2013")
    .replace(/&#8212;|&mdash;/g, "\u2014");
}

export interface TocItem {
  id: string;
  label: string;
}

export interface PreparedArticle {
  html: string;
  toc: TocItem[];
}

/**
 * Prepare migrated WordPress article HTML for rendering.
 *
 * This is a pure, isomorphic (no-DOM) string pipeline so the prerendered
 * (server) markup and the hydrated (client) markup are byte-identical — that
 * avoids hydration mismatches and guarantees the `pagespeed` handler strip
 * happens in the static HTML crawlers see, not only after hydration.
 *
 * Steps: remove script/style/noscript blocks, repair lazy `<img>` sources,
 * strip every inline `on*` handler, then inject stable, unique ids onto
 * headings (slugified from their text) while collecting the `h2` entries into a
 * table of contents whose anchors line up with the injected ids by construction.
 */
export function prepareArticleHtml(raw: string): PreparedArticle {
  const toc: TocItem[] = [];
  if (!raw) return { html: raw, toc };

  let html = raw
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "")
    // Thrive Content Builder `[tcb-script]…[/tcb-script]` shortcodes are dead
    // scripts: the crawler stripped the real <script> tags but kept their JS
    // body as PLAIN TEXT, so the <script> strip above never reaches them and the
    // raw JavaScript (jQuery CDN loaders, `var tgids = […]` analytics arrays,
    // summary-widget bootstraps, …) renders as visible code in the article body.
    // They are never executed — equivalent to <script> — so drop every block.
    .replace(/\[tcb-script\b[\s\S]*?\[\/tcb-script\]/gi, "");

  html = stripScriptShortcodes(html);
  html = renderReviewSpecCard(html);
  html = stripWidgetShortcodes(html);
  html = stripSocialShare(html);
  html = stripSummaryWidget(html);
  html = fixMalformedUrlScheme(html);
  html = balanceItineraryDays(html);
  html = mergeNumberedHeadings(html);
  html = stripEmptyTimelineDecorations(html);
  html = rewriteInternalLinks(html);
  html = html.replace(/<img\b[^>]*>/gi, (m) => repairImg(m));
  html = html.replace(ON_ATTR_RE, "");

  const seen = new Map<string, number>();
  const alloc = (base: string): string => {
    const b = base || "section";
    const n = seen.get(b) ?? 0;
    seen.set(b, n + 1);
    return n === 0 ? b : `${b}-${n + 1}`;
  };

  html = html.replace(
    /<h([2-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (_m, level: string, attrs: string, inner: string) => {
      const text = decodeEntities(stripTags(inner)).replace(/\s+/g, " ").trim();
      const id = alloc(slugify(text));
      const cleanedAttrs = attrs.replace(
        /\sid\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
        "",
      );
      if (level === "2" && text) toc.push({ id, label: text });
      return `<h${level}${cleanedAttrs} id="${id}">${inner}</h${level}>`;
    },
  );

  return { html, toc };
}

/**
 * Extract a table of contents from a componentTree (the fallback path used when
 * an article has no raw `contentHtml`). Handles both the crawler array shape
 * (`type: "heading"` / `type: "section"`) and the importer root shape
 * (`blockType: "heading"` / `blockType: "section"`).
 *
 * Crawled articles can repeat the same `anchorId`; a duplicate id can only ever
 * resolve to the first matching element, so we keep the first occurrence of
 * each id and drop the rest — this also guarantees unique React keys.
 */
export function tocFromComponentTree(nodes: CTNode[] | null): TocItem[] {
  if (!nodes) return [];
  const items: TocItem[] = [];
  const seen = new Set<string>();

  const visit = (list: CTNode[]): void => {
    for (const node of list) {
      const id = node.anchorId;
      const kind = node.blockType ?? node.type;
      if (id && !seen.has(id)) {
        if (kind === "section") {
          seen.add(id);
          items.push({ id, label: node.data?.heading ?? node.text ?? "" });
        } else if (
          kind === "heading" &&
          node.text &&
          (node.data?.level == null || node.data.level === 2)
        ) {
          // Top-level (h2) headings only — crawler headings carry an explicit
          // `data.level`; importer headings omit it (rendered as h2).
          seen.add(id);
          items.push({ id, label: node.text });
        }
      }
      if (node.children) visit(node.children);
    }
  };

  visit(nodes);
  return items.filter((i) => i.label);
}
