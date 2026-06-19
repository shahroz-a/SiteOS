import { describe, expect, it } from "vitest";
import {
  buildRedirectStub,
  redirectFilePaths,
  redirectTargetUrl,
  renderRedirectHtml,
  OFF_BLOG_ORIGIN,
} from "../redirects";

describe("redirectFilePaths", () => {
  it("emits both clean-URL forms for a safe on-blog path", () => {
    expect(redirectFilePaths("/blog/vatican-city-secrets/")).toEqual([
      "vatican-city-secrets.html",
      "vatican-city-secrets/index.html",
    ]);
  });

  it("tolerates a missing trailing slash and nested safe segments", () => {
    expect(redirectFilePaths("/blog/web-stories/paris-3-day-itinerary")).toEqual(
      [
        "web-stories/paris-3-day-itinerary.html",
        "web-stories/paris-3-day-itinerary/index.html",
      ],
    );
  });

  it("rejects non-blog, empty-root, and malformed paths", () => {
    expect(redirectFilePaths("/london-theatre-tickets/foo/")).toBeNull();
    expect(redirectFilePaths("/blog/")).toBeNull();
    expect(redirectFilePaths("/blog/../escape/")).toBeNull();
    expect(
      redirectFilePaths("/blog/x/google.com/maps/place/@40.7,!4m5"),
    ).toBeNull();
    expect(redirectFilePaths("/blog/with%20space/")).toBeNull();
  });
});

describe("redirectTargetUrl", () => {
  it("keeps on-blog targets root-relative", () => {
    expect(redirectTargetUrl("/blog/secrets-of-the-vatican-city/")).toBe(
      "/blog/secrets-of-the-vatican-city/",
    );
  });

  it("makes off-blog targets absolute against the Headout origin", () => {
    expect(redirectTargetUrl("/empire-state-building-tickets-c-234/")).toBe(
      `${OFF_BLOG_ORIGIN}/empire-state-building-tickets-c-234/`,
    );
  });
});

describe("renderRedirectHtml", () => {
  it("includes a zero-delay refresh, canonical, noindex, and a JS replace", () => {
    const html = renderRedirectHtml("/blog/new/");
    expect(html).toContain(
      '<meta http-equiv="refresh" content="0; url=/blog/new/" />',
    );
    expect(html).toContain('<link rel="canonical" href="/blog/new/" />');
    expect(html).toContain('<meta name="robots" content="noindex, follow" />');
    expect(html).toContain('location.replace("/blog/new/");');
  });

  it("escapes the target in attributes and JS", () => {
    const html = renderRedirectHtml('/blog/a"b/');
    expect(html).toContain('href="/blog/a&quot;b/"');
    expect(html).toContain('location.replace("/blog/a\\"b/");');
  });
});

describe("buildRedirectStub", () => {
  it("returns files + html for a valid entry", () => {
    const stub = buildRedirectStub(
      "/blog/old-name/",
      "/blog/new-name/",
    );
    expect(stub).not.toBeNull();
    expect(stub?.files).toEqual(["old-name.html", "old-name/index.html"]);
    expect(stub?.target).toBe("/blog/new-name/");
  });

  it("returns null for unsafe source paths", () => {
    expect(buildRedirectStub("/elsewhere/old/", "/blog/new/")).toBeNull();
  });

  it("returns null for a self-redirect (no refresh loop)", () => {
    expect(buildRedirectStub("/blog/loop/", "/blog/loop/")).toBeNull();
  });
});
