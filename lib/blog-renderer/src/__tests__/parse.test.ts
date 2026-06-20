// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  balanceItineraryDays,
  fixMalformedUrlScheme,
  mergeNumberedHeadings,
  prepareArticleHtml,
  renderReviewSpecCard,
  renderVerdictCallouts,
  rewriteInternalLinks,
  sanitizeContentHtml,
  stripEmptyTimelineDecorations,
  stripScriptShortcodes,
  stripSocialShare,
  stripSummaryWidget,
  stripWidgetShortcodes,
} from "../parse";

describe("sanitizeContentHtml (DOM path)", () => {
  it("strips the mod_pagespeed onload handler that crashed the blog", () => {
    const html =
      '<img src="https://cdn.example.com/x.jpg" width="90" alt="spring in nyc" ' +
      'data-pagespeed-url-hash="3205075745" ' +
      'onload="pagespeed.CriticalImages.checkImageForCriticality(this);">';
    const out = sanitizeContentHtml(html);
    expect(out).not.toMatch(/onload/i);
    expect(out).not.toContain("pagespeed.CriticalImages");
    // Non-handler attributes are preserved.
    expect(out).toContain('src="https://cdn.example.com/x.jpg"');
    expect(out).toContain('alt="spring in nyc"');
    expect(out).toContain('data-pagespeed-url-hash="3205075745"');
  });

  it("strips every on* handler regardless of case and element", () => {
    const html =
      '<a href="/x" onclick="steal()">link</a>' +
      '<img src="y" onError="boom()">' +
      '<div ONMOUSEOVER="x()">hi</div>';
    const out = sanitizeContentHtml(html);
    expect(out).not.toMatch(/on(click|error|mouseover)/i);
    expect(out).toContain('href="/x"');
    expect(out).toContain("link");
    expect(out).toContain("hi");
  });

  it("preserves ordinary markup and text content", () => {
    const html = "<p>Best time to visit <strong>New York</strong></p>";
    expect(sanitizeContentHtml(html)).toBe(html);
  });

  it("returns falsy input unchanged", () => {
    expect(sanitizeContentHtml("")).toBe("");
  });
});

describe("sanitizeContentHtml (non-DOM fallback)", () => {
  const original = globalThis.DOMParser;
  afterEach(() => {
    globalThis.DOMParser = original;
  });

  it("uses the regex fallback when DOMParser is unavailable", () => {
    // Force the SSR/non-browser branch.
    (globalThis as { DOMParser?: typeof DOMParser }).DOMParser = undefined;
    const html =
      '<img src=y.jpg onload="pagespeed.x(this)" alt=spring>' +
      "<img src='z' onerror='boom()'>";
    const out = sanitizeContentHtml(html);
    expect(out).not.toMatch(/onload|onerror/i);
    expect(out).not.toContain("pagespeed");
    expect(out).toContain("src=y.jpg");
  });
});

describe("prepareArticleHtml (the live render path)", () => {
  it("strips the mod_pagespeed onload handler before render", () => {
    // This is the function the renderer actually feeds into
    // dangerouslySetInnerHTML, so it is the true crash-regression guard.
    const raw =
      "<p>Intro</p>" +
      '<img src="https://cdn.example.com/x.jpg" ' +
      'onload="pagespeed.CriticalImages.checkImageForCriticality(this);">';
    const { html } = prepareArticleHtml(raw);
    expect(html).not.toMatch(/onload/i);
    expect(html).not.toContain("pagespeed.CriticalImages");
    expect(html).toContain('src="https://cdn.example.com/x.jpg"');
    expect(html).toContain("<p>Intro</p>");
  });

  it("returns falsy input unchanged with an empty toc", () => {
    expect(prepareArticleHtml("")).toEqual({ html: "", toc: [] });
  });

  it("normalizes unit-bearing width/height attributes so icons aren't ballooned", () => {
    // mod_pagespeed/WP emit `width="60px"`; the unit makes the browser ignore
    // the attribute and the icon grows to its intrinsic size. Strip the unit.
    const raw =
      '<img src="https://cdn.example.com/icon.png" width="60px" height="60px" alt="jan">';
    const { html } = prepareArticleHtml(raw);
    expect(html).toContain('width="60"');
    expect(html).toContain('height="60"');
    expect(html).not.toMatch(/\d+px"/);
  });

  it("strips the px unit case-insensitively (PX/Px)", () => {
    const raw = '<img src="x.png" width="48PX" height="48Px" alt="up">';
    const { html } = prepareArticleHtml(raw);
    expect(html).toContain('width="48"');
    expect(html).toContain('height="48"');
    expect(html).not.toMatch(/\d+px"/i);
  });

  it("leaves valid unitless dimensions and CSS style widths untouched", () => {
    const raw =
      '<img src="x.png" width="90" height="90" style="width: 90px;" alt="spring">';
    const { html } = prepareArticleHtml(raw);
    expect(html).toContain('width="90"');
    expect(html).toContain('height="90"');
    // The CSS `style` width keeps its unit — only the HTML attributes are fixed.
    expect(html).toContain("width: 90px;");
  });
});

/** Count `.days` blocks that are nested inside another `.days` block. */
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

const dayBlock = (n: number, closed: boolean) =>
  `<div class="days"><div class="itn-day">Day ${n}</div>` +
  `<div class="itn-flex-row-container"><div class="itn-body">x</div></div>` +
  (closed ? "</div>" : "");

describe("balanceItineraryDays", () => {
  it("leaves well-formed itineraries untouched", () => {
    const html =
      `<div class="page-card">${dayBlock(1, true)}${dayBlock(2, true)}</div>`;
    expect(balanceItineraryDays(html)).toBe(html);
    expect(countNestedDays(html)).toBe(0);
  });

  it("de-nests days whose closing </div> is missing", () => {
    // Days 1-2 closed, days 3-5 missing their close (the real corpus defect).
    const malformed =
      `<div class="page-card">` +
      dayBlock(1, true) +
      dayBlock(2, true) +
      dayBlock(3, false) +
      dayBlock(4, false) +
      dayBlock(5, false) +
      `</div>`;
    expect(countNestedDays(malformed)).toBeGreaterThan(0);

    const fixed = balanceItineraryDays(malformed);
    expect(countNestedDays(fixed)).toBe(0);
    // All five days survive as siblings.
    expect((fixed.match(/class="days"/g) ?? []).length).toBe(5);
    // No content is lost.
    for (let n = 1; n <= 5; n++) expect(fixed).toContain(`Day ${n}`);
  });

  it("distinguishes `days` from look-alike classes (itn-day)", () => {
    const html = `<div class="itn-day">Morning</div><div class="itn-day">Noon</div>`;
    // No `.days` blocks at all → returned unchanged.
    expect(balanceItineraryDays(html)).toBe(html);
  });

  it("is a no-op for HTML without itinerary widgets", () => {
    const html = `<p>Hello <a href="/x">link</a></p><div class="foo">bar</div>`;
    expect(balanceItineraryDays(html)).toBe(html);
  });

  it("keeps trailing content out of the nested days and preserves it", () => {
    // The real defect: the last day is unclosed, then article content follows.
    // De-nesting must not swallow or drop that trailing content.
    const malformed =
      `<div class="page-card">` +
      dayBlock(1, false) +
      dayBlock(2, false) +
      `</div>` +
      `<h2>What to pack</h2><p>Comfortable shoes.</p>`;
    const fixed = balanceItineraryDays(malformed);
    expect(countNestedDays(fixed)).toBe(0);
    expect((fixed.match(/class="days"/g) ?? []).length).toBe(2);
    // Trailing content survives verbatim and stays after the widget markup.
    expect(fixed).toContain("<h2>What to pack</h2><p>Comfortable shoes.</p>");
    expect(fixed.indexOf("Day 2")).toBeLessThan(fixed.indexOf("What to pack"));
  });

  it("runs inside prepareArticleHtml so injected markup is balanced", () => {
    const malformed =
      `<div class="page-card">${dayBlock(1, false)}${dayBlock(2, false)}</div>`;
    const { html } = prepareArticleHtml(malformed);
    expect(countNestedDays(html)).toBe(0);
  });
});

describe("stripSocialShare", () => {
  // A representative migrated "Sassy Social Share" (heateor_sss_*) widget: a
  // container with a title, a list of icon anchors (span sprites) and the
  // plugin's clearing spacer.
  const widget =
    '<div class="heateor_sss_sharing_container heateor_sss_horizontal_sharing" data-heateor-sss-href="https://x">' +
    '<div class="heateor_sss_sharing_title">Spread the love</div>' +
    '<div class="heateor_sss_sharing_ul">' +
    '<a class="heateor_sss_button_facebook" href="https://facebook.com/share" title="Facebook">' +
    '<span class="heateor_sss_svg heateor_sss_s_facebook" style="background-color:#3b5998;width:40px;height:40px"></span></a>' +
    '<a class="heateor_sss_button_instagram" href="https://www.instagram.com/headout" title="Instagram">' +
    '<span class="heateor_sss_svg" style="background-color:#53beee;width:40px;height:40px"></span></a>' +
    "</div>" +
    '<div class="heateorSssClear"></div>' +
    "</div>";

  it("removes the whole share container and keeps surrounding content", () => {
    const raw = `<p>Intro</p>${widget}<h2>Next</h2><p>Body</p>`;
    const out = stripSocialShare(raw);
    expect(out).not.toMatch(/heateor/i);
    expect(out).not.toContain("instagram.com/headout");
    expect(out).not.toContain("Spread the love");
    expect(out).toContain("<p>Intro</p>");
    expect(out).toContain("<h2>Next</h2><p>Body</p>");
  });

  it("does not over-remove adjacent non-social divs", () => {
    const raw =
      `<div class="page-card"><div class="days">Day 1</div></div>` +
      widget +
      `<div class="callout">Tip</div>`;
    const out = stripSocialShare(raw);
    expect(out).not.toMatch(/heateor/i);
    expect(out).toContain(
      '<div class="page-card"><div class="days">Day 1</div></div>',
    );
    expect(out).toContain('<div class="callout">Tip</div>');
  });

  it("sweeps up loose share anchors with no wrapping container", () => {
    const raw =
      "<p>Read more</p>" +
      '<a class="heateor_sss_button_twitter" href="https://twitter.com/intent" title="Twitter">' +
      '<span class="heateor_sss_svg" style="background-color:#000"></span></a>' +
      "<p>End</p>";
    const out = stripSocialShare(raw);
    expect(out).not.toMatch(/heateor/i);
    expect(out).toBe("<p>Read more</p><p>End</p>");
  });

  it("is a no-op when there is no social markup", () => {
    const raw = '<p>Hello <a href="/x">link</a></p>';
    expect(stripSocialShare(raw)).toBe(raw);
  });

  it("runs inside prepareArticleHtml so the rendered body has no social widget", () => {
    const raw = `<p>Intro</p>${widget}<h2>When to go</h2>`;
    const { html } = prepareArticleHtml(raw);
    expect(html).not.toMatch(/heateor/i);
    expect(html).not.toContain("instagram.com/headout");
    expect(html).toContain("<p>Intro</p>");
  });
});

describe("fixMalformedUrlScheme", () => {
  it("repairs the duplicated-h `hhttps://` scheme on image sources", () => {
    const raw =
      '<img class="lazyloaded" src="hhttps://cdn-imgix.headout.com/a.jpg" ' +
      'data-src="hhttps://cdn-imgix.headout.com/a.jpg">';
    const out = fixMalformedUrlScheme(raw);
    expect(out).not.toContain("hhttps://");
    expect(out).toBe(
      '<img class="lazyloaded" src="https://cdn-imgix.headout.com/a.jpg" ' +
        'data-src="https://cdn-imgix.headout.com/a.jpg">',
    );
  });

  it("repairs `hhttp://` too and leaves valid schemes untouched", () => {
    const raw = '<a href="hhttp://x.com">a</a><a href="https://ok.com">b</a>';
    expect(fixMalformedUrlScheme(raw)).toBe(
      '<a href="http://x.com">a</a><a href="https://ok.com">b</a>',
    );
  });

  it("runs inside prepareArticleHtml so the rendered body has no broken scheme", () => {
    const raw = '<p>x</p><img src="hhttps://cdn-imgix.headout.com/b.jpg">';
    const { html } = prepareArticleHtml(raw);
    expect(html).not.toContain("hhttps://");
    expect(html).toContain("https://cdn-imgix.headout.com/b.jpg");
  });
});

describe("stripSummaryWidget", () => {
  const widget =
    '<div class="open-summary-mobile-wrapper">' +
    '<a class="open-summary-mobile"><i class="fa fa-bars"></i> Summary</a>' +
    "</div>" +
    '<div id="summary-wrapper-mobile" class="summary-list">' +
    '<div class="summary-wrapper-mobile-content">' +
    '<div class="category-title"><div class="title-text">Best time to visit NYC</div></div>' +
    '<div class="thrv_wrapper"><ul id="summary-mobile-ul"></ul></div>' +
    "</div></div>";

  it("removes both the toggle wrapper and the list panel", () => {
    const raw = `<p>Intro</p>${widget}<h2>When to go</h2>`;
    const out = stripSummaryWidget(raw);
    expect(out).not.toMatch(/open-summary-mobile/);
    expect(out).not.toMatch(/summary-wrapper-mobile/);
    expect(out).not.toMatch(/summary-list/);
    expect(out).not.toContain("fa fa-bars");
    expect(out).toBe("<p>Intro</p><h2>When to go</h2>");
  });

  it("is a no-op when no summary widget is present", () => {
    const raw = "<p>Hello</p><h2>Section</h2>";
    expect(stripSummaryWidget(raw)).toBe(raw);
  });

  it("removes the widget when carried by a non-div tag (section/nav)", () => {
    const nonDivWidget =
      '<nav class="open-summary-mobile-wrapper">' +
      '<a class="open-summary-mobile"><i class="fa fa-bars"></i> Summary</a>' +
      "</nav>" +
      '<section id="summary-wrapper-mobile" class="summary-list">' +
      '<div class="summary-wrapper-mobile-content">' +
      '<ul id="summary-mobile-ul"></ul>' +
      "</div></section>";
    const raw = `<p>Intro</p>${nonDivWidget}<h2>When to go</h2>`;
    const out = stripSummaryWidget(raw);
    expect(out).not.toMatch(/open-summary-mobile/);
    expect(out).not.toMatch(/summary-wrapper-mobile/);
    expect(out).not.toMatch(/summary-list/);
    expect(out).not.toContain("fa fa-bars");
    expect(out).toBe("<p>Intro</p><h2>When to go</h2>");
  });

  it("drops the Thrive [tcb-script] block that drives the summary widget", () => {
    // The real failing corpus shape (/blog/climb-o2-arena-london/,
    // /blog/empire-state-building/): the summary residue is dead JS in a Thrive
    // `[tcb-script]` shortcode stored as plain text (no real <script> tag), so
    // it survives prepareArticleHtml's <script> strip and references the summary
    // nodes (open-summary-mobile / summary-wrapper-mobile).
    const summaryScript =
      "<p>[tcb-script] jQuery(document).ready(function () { " +
      'let modal = document.getElementById("summary-wrapper-mobile"); ' +
      'jQuery(".open-summary-mobile")[0].addEventListener("click", function () { ' +
      'modal.style.display = "block"; }); ' +
      'jQuery("#summary-mobile-ul").append("<li></li>"); }); [/tcb-script]</p>';
    const raw = `<p>Intro</p><ul id="summary-mobile-ul"></ul>${summaryScript}<h2>When to go</h2>`;
    const out = stripSummaryWidget(raw);
    expect(out).not.toMatch(/open-summary-mobile/);
    expect(out).not.toMatch(/summary-wrapper-mobile/);
    expect(out).not.toContain("[tcb-script]");
  });

  it("leaves unrelated [tcb-script] blocks untouched", () => {
    const raw =
      '<p>Body</p><p>[tcb-script]var tgids = [1,2,3];[/tcb-script]</p>' +
      `${widget}<h2>Next</h2>`;
    const out = stripSummaryWidget(raw);
    // The summary widget is gone, but the unrelated analytics shortcode stays.
    expect(out).not.toMatch(/summary-wrapper-mobile/);
    expect(out).toContain("[tcb-script]var tgids = [1,2,3];[/tcb-script]");
  });

  it("runs inside prepareArticleHtml so the rendered body has no grey toggle box", () => {
    const raw = `<p>Intro</p>${widget}<h2>When to go</h2>`;
    const { html } = prepareArticleHtml(raw);
    expect(html).not.toContain("fa fa-bars");
    expect(html).not.toMatch(/summary-list/);
    expect(html).toContain("<p>Intro</p>");
  });
});

describe("stripScriptShortcodes", () => {
  it("removes a balanced [tcb-script]…[/tcb-script] block with its JS body", () => {
    const raw =
      "<p>Intro</p>" +
      "[tcb-script]var tgids = [593];[/tcb-script]" +
      "<h2>Section</h2>";
    const out = stripScriptShortcodes(raw);
    expect(out).toBe("<p>Intro</p><h2>Section</h2>");
    expect(out).not.toContain("tcb-script");
    expect(out).not.toContain("tgids");
  });

  it("removes the dead mobile Summary widget script that leaked as bare text", () => {
    const raw =
      "<p>[tcb-script] jQuery(document).ready(function () { " +
      'let modal = document.getElementById("summary-wrapper-mobile"); ' +
      'document.querySelectorAll("#summaryList li a"); });[/tcb-script]</p>';
    const out = stripScriptShortcodes(raw);
    expect(out).toBe("<p></p>");
    expect(out).not.toContain("document.");
    expect(out).not.toContain("summary-wrapper-mobile");
    expect(out).not.toContain("jQuery");
  });

  it("removes an opening marker that carries attributes", () => {
    const raw =
      "<p>x</p>" +
      '[tcb-script src="https://cdn/jquery.min.js" integrity="sha512-x" ' +
      'crossorigin="anonymous"][/tcb-script]<p>y</p>';
    const out = stripScriptShortcodes(raw);
    expect(out).toBe("<p>x</p><p>y</p>");
    expect(out).not.toContain("tcb-script");
    expect(out).not.toContain("cdn/jquery");
  });

  it("sweeps up an orphan closing marker with no matching open", () => {
    const raw = "<p>a</p>[/tcb-script]<p>b</p>";
    expect(stripScriptShortcodes(raw)).toBe("<p>a</p><p>b</p>");
  });

  it("strips multiple consecutive blocks", () => {
    const raw =
      "[tcb-script]a();[/tcb-script][tcb-script]b();[/tcb-script]<p>keep</p>";
    expect(stripScriptShortcodes(raw)).toBe("<p>keep</p>");
  });

  it("is a no-op when no tcb-script shortcode is present", () => {
    const raw = "<p>Hello</p><h2>Section</h2>";
    expect(stripScriptShortcodes(raw)).toBe(raw);
  });

  it("runs inside prepareArticleHtml so no JS reaches the rendered body", () => {
    const raw =
      "<p>Intro</p>" +
      "[tcb-script] jQuery(document).ready(function () { " +
      'document.getElementById("summary-wrapper-mobile"); });[/tcb-script]' +
      "<h2>When to go</h2>";
    const { html } = prepareArticleHtml(raw);
    expect(html).not.toContain("tcb-script");
    expect(html).not.toContain("document.");
    expect(html).not.toContain("jQuery");
    expect(html).toContain("<p>Intro</p>");
  });
});

describe("stripWidgetShortcodes", () => {
  it("drops [show_link_exp]…[/show_link_exp] markers but keeps the wrapped CTA", () => {
    const raw =
      '<a href="https://www.headout.com/book/41963/">' +
      '[show_link_exp poi-id="616"]' +
      '<div class="book-strip"><div class="book-strip__button"> Find Best Seats</div></div>' +
      "[/show_link_exp]</a>";
    const out = stripWidgetShortcodes(raw);
    expect(out).not.toContain("show_link_exp");
    expect(out).not.toContain("[");
    // The real booking CTA inside the markers is preserved.
    expect(out).toContain('class="book-strip"');
    expect(out).toContain("Find Best Seats");
    expect(out).toContain('href="https://www.headout.com/book/41963/"');
  });

  it("drops a truncated [/show_link_ex] closer (missing the final p)", () => {
    const raw = "<p>Keep me</p>[/show_link_ex]";
    const out = stripWidgetShortcodes(raw);
    expect(out).toBe("<p>Keep me</p>");
    expect(out).not.toContain("show_link_ex");
  });

  it("renders a [star rating] widget as a visible rating, incl. curly quotes", () => {
    const raw = "<strong>Rating:</strong>[star rating=\u201d8\u201d max=\u201d10\u201d]<br>";
    const out = stripWidgetShortcodes(raw);
    expect(out).not.toContain("[star");
    expect(out).toContain("\u2605");
    expect(out).toContain(">8/10</span>");
    expect(out).toContain('aria-label="Rating: 8 out of 10"');
    // Surrounding content is preserved untouched.
    expect(out).toContain("<strong>Rating:</strong>");
    expect(out).toContain("<br>");
  });

  it("renders a [star rating] widget with straight quotes", () => {
    const out = stripWidgetShortcodes('[star rating="7" max="5"]');
    expect(out).toContain("\u2605");
    expect(out).toContain(">7/5</span>");
    expect(out).not.toContain("[star");
  });

  it("defaults a missing max to a 10-point scale", () => {
    const out = stripWidgetShortcodes("[star rating=\u201d8\u201d]");
    expect(out).toContain("\u2605");
    expect(out).toContain(">8/10</span>");
    expect(out).toContain('aria-label="Rating: 8 out of 10"');
  });

  it("supports a decimal rating value", () => {
    const out = stripWidgetShortcodes('[star rating="8.5" max="10"]');
    expect(out).toContain("\u2605");
    expect(out).toContain(">8.5/10</span>");
  });

  it("drops a [star] marker with no parseable rating value", () => {
    const out = stripWidgetShortcodes("<p>before</p>[star]<p>after</p>");
    expect(out).toBe("<p>before</p><p>after</p>");
  });

  it("leaves legitimate bracket text and Tailwind arbitrary values untouched", () => {
    const raw =
      "<p>Best time to visit [June-November] for cricket [1].</p>" +
      '<div class="shadow-[inset_0_0_0_1px_token(colorBgBorder)] animate-[opacity_0]">x</div>' +
      '<p>Supplement charge [Supplement] applies.</p>';
    expect(stripWidgetShortcodes(raw)).toBe(raw);
  });

  it("does not match longer words like [starting]", () => {
    const raw = "<p>[starting]</p>";
    expect(stripWidgetShortcodes(raw)).toBe(raw);
  });

  it("is a no-op when no widget shortcode is present", () => {
    const raw = "<p>Hello</p><h2>Section</h2>";
    expect(stripWidgetShortcodes(raw)).toBe(raw);
  });

  it("runs inside prepareArticleHtml so no marker reaches the rendered body", () => {
    const raw =
      '<p>Intro</p>[show_link_exp poi-id="611"]' +
      '<div class="book-strip">Find Best Seats</div>[/show_link_exp]' +
      "<strong>Rating:</strong>[star rating=\u201d8\u201d]<h2>Section</h2>";
    const { html } = prepareArticleHtml(raw);
    expect(html).not.toContain("show_link_exp");
    expect(html).not.toContain("[star");
    expect(html).toContain("Find Best Seats");
    expect(html).toContain("<p>Intro</p>");
  });
});

describe("renderReviewSpecCard", () => {
  // The migrated Thrive review header, as it appears in the corpus (e.g. slug
  // review-natasha-pierre-great-comet-1812): a single <p> of inline facts with
  // <br>s nested inside <strong>/<span> colour wrappers.
  const header =
    '<p><strong><span style="color: #000000;">The Great Comet Review by: Jordan Diggory</span><br></strong>' +
    '<strong style="color: #000000;">Critic\u2019s Pic<br></strong>' +
    '<strong><span style="color: #000000;">Rating:</span>&nbsp;</strong>[star rating=\u201d8\u201d max=\u201d10\u201d]<br>' +
    "Theatre:&nbsp;Imperial Theatre &nbsp; &nbsp; &nbsp; Show Runtime:&nbsp;2 hrs. and 30 min.<br>" +
    '<a href="https://www.headout.com/broadway-musicals/x-e-4192/?stage=content" target="_blank" rel="noopener noreferrer">Natasha, Pierre &amp; The Great Comet of 1812 Tickets</a></p>';

  it("wraps the loose review facts into a single spec card", () => {
    const out = renderReviewSpecCard(header);
    expect(out).toContain('<div class="review-spec-card">');
    expect(out).toContain('<dl class="review-spec-card__grid">');
    // Title lifted out of the grid.
    expect(out).toContain(
      '<p class="review-spec-card__title">The Great Comet Review by: Jordan Diggory</p>',
    );
    // "Critic's Pic" becomes a badge, not a row.
    expect(out).toContain(
      '<span class="review-spec-card__badge">Critic\u2019s Pic</span>',
    );
  });

  it("splits a multi-pair line into separate label/value rows", () => {
    const out = renderReviewSpecCard(header);
    expect(out).toContain(
      '<dt class="review-spec-card__label">Theatre</dt><dd class="review-spec-card__value">Imperial Theatre</dd>',
    );
    expect(out).toContain(
      '<dt class="review-spec-card__label">Show Runtime</dt><dd class="review-spec-card__value">2 hrs. and 30 min.</dd>',
    );
  });

  it("preserves the [star] marker as the Rating value and the CTA link", () => {
    const out = renderReviewSpecCard(header);
    expect(out).toContain('<dt class="review-spec-card__label">Rating</dt>');
    // Raw marker survives so stripWidgetShortcodes can convert it downstream.
    expect(out).toMatch(/Rating<\/dt><dd[^>]*>\[star rating/);
    expect(out).toContain('<p class="review-spec-card__cta">');
    expect(out).toContain("Great Comet of 1812 Tickets</a>");
  });

  it("renders a polished, star-badged card end-to-end via prepareArticleHtml", () => {
    const { html } = prepareArticleHtml(
      header + "<h2>Natasha, Pierre &amp; the Great Comet Review</h2><p>Body.</p>",
    );
    expect(html).toContain('<div class="review-spec-card">');
    // The rating shortcode is converted to the .star-rating badge, no marker left.
    expect(html).not.toContain("[star");
    expect(html).toContain('class="star-rating"');
    expect(html).toContain(">8/10</span>");
    // The body after the header is untouched and still gets a heading id.
    expect(html).toContain("<h2");
    expect(html).toContain("Body.");
  });

  it("only cards the first review header and leaves later <p> facts alone", () => {
    const second =
      header +
      "<p>Show runtime: 2 hrs. and 30 min.</p><p>Theatre: Imperial Theatre</p>";
    const out = renderReviewSpecCard(second);
    expect(out.match(/review-spec-card"/g)?.length).toBe(1);
    expect(out).toContain("<p>Show runtime: 2 hrs. and 30 min.</p>");
  });

  it("leaves a stray star widget in ordinary prose untouched", () => {
    const raw = '<p>We rated it [star rating="8" max="10"] overall.</p>';
    expect(renderReviewSpecCard(raw)).toBe(raw);
  });

  it("is a no-op when no star marker is present", () => {
    const raw = "<p>Theatre: Imperial Theatre<br>Show Runtime: 2 hrs.</p>";
    expect(renderReviewSpecCard(raw)).toBe(raw);
  });
});

describe("renderVerdictCallouts", () => {
  it("cards a 'The Good' / 'The Bad' pros-cons pair into accent variants", () => {
    const raw =
      "<h3><strong>The Good</strong></h3><p>Thrilling rides all day.</p>" +
      "<h3><strong>The Bad</strong></h3><p>Long queues at peak season.</p>";
    const out = renderVerdictCallouts(raw);
    expect(out).toContain(
      '<div class="verdict-callout verdict-callout--good"><h3><strong>The Good</strong></h3><p>Thrilling rides all day.</p></div>',
    );
    expect(out).toContain(
      '<div class="verdict-callout verdict-callout--bad"><h3><strong>The Bad</strong></h3><p>Long queues at peak season.</p></div>',
    );
  });

  it("cards a 'Verdict' blurb heading + its paragraph", () => {
    const raw = "<h3>Verdict</h3><p>Siam Park City wins for families.</p>";
    const out = renderVerdictCallouts(raw);
    expect(out).toBe(
      '<div class="verdict-callout verdict-callout--verdict">' +
        "<h3>Verdict</h3><p>Siam Park City wins for families.</p></div>",
    );
  });

  it("cards a comparison heading whose title ends in '- Verdict'", () => {
    const raw =
      "<h3>Parc Asterix vs Disneyland Paris - Verdict</h3><p>Parc Asterix is cheaper.</p>";
    const out = renderVerdictCallouts(raw);
    expect(out).toContain('class="verdict-callout verdict-callout--verdict"');
    expect(out).toContain("Parc Asterix vs Disneyland Paris - Verdict</h3>");
  });

  it("folds a 'Pros and Cons' heading together with its following list", () => {
    const raw =
      "<h3>Pros and Cons of the Combo Pass</h3>" +
      "<p>The perks:</p><ul><li>Save up to 15%</li><li>5% cashback</li></ul>";
    const out = renderVerdictCallouts(raw);
    expect(out).toContain(
      '<div class="verdict-callout verdict-callout--proscons">',
    );
    // Both the lead paragraph and the whole list are inside the one card.
    expect(out).toContain("<p>The perks:</p><ul><li>Save up to 15%</li>");
    expect(out).toContain("<li>5% cashback</li></ul></div>");
  });

  it("keeps a nested list whole via the balanced-block scan", () => {
    const raw =
      "<h3>Pros and Cons</h3><ul><li>Outer<ul><li>Inner</li></ul></li><li>Second</li></ul>";
    const out = renderVerdictCallouts(raw);
    expect(out).toContain(
      "<ul><li>Outer<ul><li>Inner</li></ul></li><li>Second</li></ul></div>",
    );
  });

  it("preserves the heading id and TOC entry end-to-end via prepareArticleHtml", () => {
    const { html, toc } = prepareArticleHtml(
      "<h2>Verdict</h2><p>Worth the trip.</p>",
    );
    expect(html).toContain('class="verdict-callout verdict-callout--verdict"');
    // The h2 stays a real heading: it still gets an id and a TOC entry.
    expect(html).toMatch(/<h2[^>]*id="verdict"[^>]*>Verdict<\/h2>/);
    expect(toc).toContainEqual({ id: "verdict", label: "Verdict" });
  });

  it("leaves ordinary section headings that merely contain a cue word alone", () => {
    const raw =
      "<h2>Pros of an early start</h2><p>Beat the crowds.</p>" +
      "<h2>What was the final verdict of the trial?</h2><p>Guilty.</p>";
    expect(renderVerdictCallouts(raw)).toBe(raw);
  });

  it("does not fire when the cue heading is not immediately followed by content", () => {
    const raw =
      '<div><h2 class="add-to-summary">Verdict - Which bath?</h2><hr></div><div><p>Body.</p></div>';
    expect(renderVerdictCallouts(raw)).toBe(raw);
  });

  it("is a no-op on prose with no cue headings", () => {
    const raw = "<h2>Getting There</h2><p>Take the train.</p>";
    expect(renderVerdictCallouts(raw)).toBe(raw);
  });
});

describe("mergeNumberedHeadings", () => {
  it("folds the corpus `<span id>` number into the heading as `N. `", () => {
    const raw =
      '<h2 class="attr-list-title"><span id="attr-1">1</span>Pemba Island</h2>';
    const out = mergeNumberedHeadings(raw);
    expect(out).toBe('<h2 class="attr-list-title">1. Pemba Island</h2>');
    expect(out).not.toContain("<span");
  });

  it("folds the legacy `#N` span variant into the heading as `N. `", () => {
    const raw =
      '<h2 class="attr-list-title add-to-summary">' +
      "<span>#2 </span>National 9/11 Memorial and Museum</h2>";
    const out = mergeNumberedHeadings(raw);
    expect(out).toBe(
      '<h2 class="attr-list-title add-to-summary">' +
        "2. National 9/11 Memorial and Museum</h2>",
    );
    expect(out).not.toContain("<span>");
    expect(out).not.toContain("#2");
  });

  it("folds the orphaned timeline number paragraph into the card-title heading", () => {
    const raw =
      '<div class="timeline"><div><p class="number">2</p>' +
      '<div class="timeline-line"></div></div>' +
      '<div class="timeline-text"><h2 class="card-title">9/11 Museum</h2></div></div>';
    const out = mergeNumberedHeadings(raw);
    expect(out).toContain('<h2 class="card-title">2. 9/11 Museum</h2>');
    expect(out).not.toMatch(/<p[^>]*class="number"/);
  });

  it("folds the timeline number into a non-card-title heading (add-to-summary)", () => {
    // Real corpus shape (e.g. /blog/best-time-to-visit-paris/): the timeline
    // item heading carries `add-to-summary`, not `card-title`, so binding to
    // `card-title` alone left a stray "1" floating and dropped the number.
    const raw =
      '<div class="timeline"><div><p class="number">1</p>' +
      '<div class="timeline-line"></div></div>' +
      '<div class="timeline-text"><h2 class="add-to-summary">Paris In January</h2></div></div>';
    const out = mergeNumberedHeadings(raw);
    expect(out).toContain('<h2 class="add-to-summary">1. Paris In January</h2>');
    expect(out).not.toMatch(/<p[^>]*class="number"/);
  });

  it("folds the timeline number into a non-heading span.card-title title", () => {
    // Real corpus shape (e.g. /blog/paris-guide-things-to-do/): the timeline
    // item title is a <span class="card-title">, not a heading at all, and a
    // sibling <p class="card-title-subtext"> must NOT receive the number.
    const raw =
      '<div class="timeline"><div><p class="number">2</p>' +
      '<div class="timeline-line"></div></div>' +
      '<div class="timeline-text"><span class="card-title">Eiffel Tower</span>' +
      '<p class="card-title-subtext">Sightseeing</p></div></div>';
    const out = mergeNumberedHeadings(raw);
    expect(out).toContain('<span class="card-title">2. Eiffel Tower</span>');
    expect(out).toContain('<p class="card-title-subtext">Sightseeing</p>');
    expect(out).not.toMatch(/<p[^>]*class="number"/);
  });

  it("drops an empty timeline number orphan (no digit) above the title", () => {
    // Real corpus shape (e.g. /blog/best-time-to-visit-melbourne/): the timeline
    // number paragraph carries no digit at all. There's nothing to fold and the
    // number-circle CSS was never migrated, so the empty <p class="number"></p>
    // renders as a stray blank badge above the title — drop it outright (we do
    // NOT renumber from position: these are month sequences, not ranked lists).
    const raw =
      '<div class="timeline"><div><p class="number"></p>' +
      '<div class="timeline-line"></div></div>' +
      '<div class="timeline-text"><h2 class="card-title">Melbourne in January</h2></div></div>';
    const out = mergeNumberedHeadings(raw);
    expect(out).not.toMatch(/<p[^>]*class="number"/);
    // The title is left exactly as-is — no synthetic "N. " prefix invented.
    expect(out).toContain('<h2 class="card-title">Melbourne in January</h2>');
  });

  it("drops a whitespace-only timeline number orphan", () => {
    const raw =
      '<div class="timeline"><div><p class="number">  </p>' +
      '<div class="timeline-line"></div></div>' +
      '<div class="timeline-text"><h2 class="card-title">Melbourne in May</h2></div></div>';
    const out = mergeNumberedHeadings(raw);
    expect(out).not.toMatch(/<p[^>]*class="number"/);
    expect(out).toContain('<h2 class="card-title">Melbourne in May</h2>');
  });

  it("leaves unnumbered headings untouched", () => {
    const raw = '<h2 class="card-title">Plain heading</h2>';
    expect(mergeNumberedHeadings(raw)).toBe(raw);
  });

  it("feeds the merged number into the toc label via prepareArticleHtml", () => {
    const raw =
      '<div class="timeline"><div><p class="number">2</p>' +
      '<div class="timeline-line"></div></div>' +
      '<div class="timeline-text"><h2 class="card-title">9/11 Museum</h2></div></div>';
    const { html, toc } = prepareArticleHtml(raw);
    expect(html).toContain("2. 9/11 Museum");
    expect(toc.map((t) => t.label)).toContain("2. 9/11 Museum");
  });
});

describe("stripEmptyTimelineDecorations", () => {
  it("drops the always-empty timeline-line connector decoration", () => {
    const raw =
      '<div class="timeline"><div><p class="number">2</p>' +
      '<div class="timeline-line"></div></div>' +
      '<div class="timeline-text"><h2 class="card-title">9/11 Museum</h2></div></div>';
    const out = stripEmptyTimelineDecorations(raw);
    expect(out).not.toContain("timeline-line");
    // The rest of the timeline item is untouched.
    expect(out).toContain('<p class="number">2</p>');
    expect(out).toContain('<h2 class="card-title">9/11 Museum</h2>');
  });

  it("drops an empty card-title-subtext subtitle row (truly empty)", () => {
    // Real corpus shape (e.g. /blog/5-7-days-in-new-york/).
    const raw =
      '<div class="timeline-text"><h2 class="card-title">Day 1</h2>' +
      '<p class="card-title-subtext" style="display:block;"></p></div>';
    const out = stripEmptyTimelineDecorations(raw);
    expect(out).not.toContain("card-title-subtext");
    expect(out).toContain('<h2 class="card-title">Day 1</h2>');
  });

  it("drops a whitespace-only card-title-subtext row", () => {
    // Real corpus shape (e.g. /blog/paris-with-kids/): a single space inside.
    const raw =
      '<h2 class="card-title">Climb the Eiffel Tower</h2>' +
      '<p class="card-title-subtext" style="display:block;"> </p>';
    const out = stripEmptyTimelineDecorations(raw);
    expect(out).not.toContain("card-title-subtext");
    expect(out).toContain('<h2 class="card-title">Climb the Eiffel Tower</h2>');
  });

  it("keeps a card-title-subtext row that carries real text", () => {
    // Real corpus shape (e.g. /blog/best-time-to-visit-melbourne/): the subtitle
    // holds the average-temperature line — genuine content, must NOT be dropped.
    const raw =
      '<h2 class="card-title">Melbourne in January</h2>' +
      '<p class="card-title-subtext london-cta" style="display:block;">' +
      "Average Temperature: 16°C - 26°C</p>";
    const out = stripEmptyTimelineDecorations(raw);
    expect(out).toContain("Average Temperature: 16°C - 26°C");
    expect(out).toContain("card-title-subtext");
  });

  it("is a no-op when there is no timeline decoration markup", () => {
    const raw = '<p>Hello <a href="/x">link</a></p><h2>Section</h2>';
    expect(stripEmptyTimelineDecorations(raw)).toBe(raw);
  });

  it("runs inside prepareArticleHtml so the rendered body has no empty decoration", () => {
    // Full timeline item (the empty-number variant) — after the pipeline the
    // empty number, the connector line and the empty subtitle are all gone, and
    // the heading text survives.
    const raw =
      '<div class="timeline"><div><p class="number"></p>' +
      '<div class="timeline-line"></div></div>' +
      '<div class="timeline-text"><h2 class="card-title">Melbourne in January</h2>' +
      '<p class="card-title-subtext" style="display:block;"></p></div></div>';
    const { html } = prepareArticleHtml(raw);
    expect(html).not.toContain("timeline-line");
    expect(html).not.toContain("card-title-subtext");
    expect(html).not.toMatch(/<p[^>]*class="number"/);
    expect(html).toContain("Melbourne in January");
  });

  it("preserves a populated subtitle through the full pipeline", () => {
    const raw =
      '<div class="timeline"><div><p class="number">1</p>' +
      '<div class="timeline-line"></div></div>' +
      '<div class="timeline-text"><h2 class="card-title">Melbourne in January</h2>' +
      '<p class="card-title-subtext" style="display:block;">' +
      "Average Temperature: 16°C - 26°C</p></div></div>";
    const { html } = prepareArticleHtml(raw);
    expect(html).not.toContain("timeline-line");
    expect(html).toContain("Average Temperature: 16°C - 26°C");
    // The number was folded into the heading, not left as an orphan.
    expect(html).toMatch(/1\.\s*Melbourne in January/);
  });
});

describe("rewriteInternalLinks", () => {
  it("rewrites absolute blog links to root-relative /blog/ paths", () => {
    const raw =
      '<a href="https://www.headout.com/blog/author/rohit-jadhav/">Rohit</a>';
    expect(rewriteInternalLinks(raw)).toBe(
      '<a href="/blog/author/rohit-jadhav/">Rohit</a>',
    );
  });

  it("handles scheme-less and www-less blog links", () => {
    const raw =
      '<a href="//headout.com/blog/central-park/">x</a>' +
      '<a href="http://www.headout.com/blog/nyc/">y</a>';
    expect(rewriteInternalLinks(raw)).toBe(
      '<a href="/blog/central-park/">x</a><a href="/blog/nyc/">y</a>',
    );
  });

  it("leaves non-/blog headout.com links (tours, tickets) absolute", () => {
    const raw =
      '<a href="https://www.headout.com/911-museum-tickets/e-549/">Tickets</a>';
    expect(rewriteInternalLinks(raw)).toBe(raw);
  });

  it("runs inside prepareArticleHtml", () => {
    const raw =
      '<p><a href="https://www.headout.com/blog/nyc-in-june/">June</a> ' +
      'and <a href="https://www.headout.com/new-york-tours/e-1/">tour</a></p>';
    const { html } = prepareArticleHtml(raw);
    expect(html).toContain('href="/blog/nyc-in-june/"');
    expect(html).toContain('href="https://www.headout.com/new-york-tours/e-1/"');
  });
});
