// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { prepareArticleHtml, sanitizeContentHtml } from "../parse";

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
