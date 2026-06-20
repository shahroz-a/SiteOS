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
 */
export function stripSummaryWidget(html: string): string {
  if (!html || !/open-summary-mobile|summary-wrapper-mobile/i.test(html)) {
    return html;
  }
  let out = removeBalancedDivsWithTag(
    html,
    /<div\b[^>]*\bopen-summary-mobile-wrapper\b/i,
  );
  out = removeBalancedDivsWithTag(out, /<div\b[^>]*\bsummary-wrapper-mobile\b/i);
  return out;
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
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "");

  html = stripSocialShare(html);
  html = stripSummaryWidget(html);
  html = fixMalformedUrlScheme(html);
  html = balanceItineraryDays(html);
  html = mergeNumberedHeadings(html);
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
