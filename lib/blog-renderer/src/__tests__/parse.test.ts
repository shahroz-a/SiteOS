// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  balanceItineraryDays,
  fixMalformedUrlScheme,
  prepareArticleHtml,
  sanitizeContentHtml,
  stripSocialShare,
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
