// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { sanitizeContentHtml } from "./blog";

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
