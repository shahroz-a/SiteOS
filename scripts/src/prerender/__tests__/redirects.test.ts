import { describe, expect, it } from "vitest";
import {
  buildRedirectStub,
  classifyRedirect,
  normalizeRedirectFromPath,
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

describe("normalizeRedirectFromPath", () => {
  it("keeps a clean on-blog path unchanged", () => {
    expect(normalizeRedirectFromPath("/blog/old-name/")).toBe("/blog/old-name/");
    expect(normalizeRedirectFromPath("/blog/web-stories/paris-3-day-itinerary")).toBe(
      "/blog/web-stories/paris-3-day-itinerary",
    );
  });

  it("collapses accidental repeated slashes into a serveable path", () => {
    expect(normalizeRedirectFromPath("/blog/acropolis-athens//tickets/")).toBe(
      "/blog/acropolis-athens/tickets/",
    );
    expect(normalizeRedirectFromPath("/blog/loop//")).toBe("/blog/loop/");
  });

  it("drops off-blog and bare-root paths", () => {
    expect(normalizeRedirectFromPath("/statue-of-liberty-cruises-c-121/")).toBeNull();
    expect(normalizeRedirectFromPath("/london-theatre-tickets/the-great-gatsby-e-6581/")).toBeNull();
    expect(normalizeRedirectFromPath("/blog/")).toBeNull();
  });

  it("drops junk paths carrying embedded URLs, query strings, map links, or quotes", () => {
    expect(normalizeRedirectFromPath("/blog/best-broadway-shows-january/%22")).toBeNull();
    expect(
      normalizeRedirectFromPath(
        "/blog/disneyland-paris-tips/https://www.headout.com/blog/disneyland-paris-hotel/",
      ),
    ).toBeNull();
    expect(
      normalizeRedirectFromPath(
        "/blog/off-broadway-week-2-for-1/google.com/maps/place/New+World+Stages/@40.76,-73.98,15z",
      ),
    ).toBeNull();
    expect(
      normalizeRedirectFromPath("/blog/where-to-stay-in-rome-for-jubilee/ist.it.s.elisabetta@libero.it"),
    ).toBeNull();
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

describe("classifyRedirect", () => {
  it("returns a stub and no reason for a serveable entry", () => {
    const result = classifyRedirect("/blog/old-name/", "/blog/new-name/");
    expect(result.reason).toBeNull();
    expect(result.stub).not.toBeNull();
    expect(result.stub?.target).toBe("/blog/new-name/");
  });

  it("flags a non-blog source path", () => {
    const result = classifyRedirect("/elsewhere/old/", "/blog/new/");
    expect(result.stub).toBeNull();
    expect(result.reason).toBe("non-blog-source");
  });

  it("flags a malformed segment (junk, encoded punctuation, bare root)", () => {
    expect(
      classifyRedirect(
        "/blog/disneyland-paris-tips/https://www.headout.com/blog/x/",
        "/blog/new/",
      ).reason,
    ).toBe("malformed-segment");
    expect(classifyRedirect("/blog/with%20space/", "/blog/new/").reason).toBe(
      "malformed-segment",
    );
    expect(classifyRedirect("/blog/", "/blog/new/").reason).toBe(
      "malformed-segment",
    );
  });

  it("flags a self-redirect", () => {
    const result = classifyRedirect("/blog/loop/", "/blog/loop/");
    expect(result.stub).toBeNull();
    expect(result.reason).toBe("self-redirect");
  });
});
