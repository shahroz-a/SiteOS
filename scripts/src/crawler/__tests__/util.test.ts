import { describe, expect, it } from "vitest";
import { classifyUrl, collapseSlashes, isFrontierDiscovered, isMalformedBlogUrl } from "../util";

const BASE = "https://www.headout.com/blog";

describe("collapseSlashes", () => {
  it("collapses an accidental trailing double slash", () => {
    expect(collapseSlashes(`${BASE}/singapore-zoo//`)).toBe(`${BASE}/singapore-zoo/`);
  });

  it("collapses repeated slashes anywhere in the path", () => {
    expect(collapseSlashes(`${BASE}/acropolis-athens///tickets`)).toBe(
      `${BASE}/acropolis-athens/tickets`,
    );
  });

  it("leaves the scheme separator and a clean path untouched", () => {
    const clean = `${BASE}/thanksgiving-vacation-ideas-for-families/`;
    expect(collapseSlashes(clean)).toBe(clean);
  });

  it("returns the input unchanged when it can't be parsed", () => {
    expect(collapseSlashes("not a url")).toBe("not a url");
  });
});

describe("isMalformedBlogUrl", () => {
  it("flags a bare domain used as a relative link", () => {
    // Real corpus garbage: `.../athens-in-august/introducingathens.com/bus`.
    expect(isMalformedBlogUrl(`${BASE}/athens-in-august/introducingathens.com/bus`)).toBe(true);
    expect(isMalformedBlogUrl(`${BASE}/capitoline-museums-rome/www.hyerlinktoacombo.com`)).toBe(true);
    expect(isMalformedBlogUrl(`${BASE}/dubai-in-may/skydivedubai.ae`)).toBe(true);
    expect(isMalformedBlogUrl(`${BASE}/hysteria-dubai-mall/hysteria.ae`)).toBe(true);
  });

  it("flags an embedded protocol or quote from a concatenated href", () => {
    expect(isMalformedBlogUrl(`${BASE}/free-walking-tour-paris/https://www.headout.com/x`)).toBe(
      true,
    );
    expect(isMalformedBlogUrl(`${BASE}/aladdin-on-broadway/:%22https://en.wikipedia.org/wiki/x`)).toBe(
      true,
    );
    expect(
      isMalformedBlogUrl(`${BASE}/coronavirus-in-italy/%E2%80%9Chttps://www.reuters.com/x`),
    ).toBe(true);
  });

  it("accepts well-formed blog slugs, including numeric/underscore/tilde codes", () => {
    expect(isMalformedBlogUrl(`${BASE}/singapore-zoo/`)).toBe(false);
    expect(isMalformedBlogUrl(`${BASE}/singapore-zoo-breakfast-with-orangutans/`)).toBe(false);
    expect(isMalformedBlogUrl(`${BASE}/category/things-to-do-city-singapore/`)).toBe(false);
    expect(
      isMalformedBlogUrl(
        `${BASE}/category/things-to-do-city-singapore/tickets-singapore-ca-1__23209/`,
      ),
    ).toBe(false);
    expect(isMalformedBlogUrl(`${BASE}/author/some-author-ca-5~8027/`)).toBe(false);
  });

  it("flags a leading-hyphen segment from a botched relative link", () => {
    // Real corpus garbage: `.../paris-3-day-itinerary/-catacombs/` etc.
    expect(
      isMalformedBlogUrl(`${BASE}/web-stories/paris-3-day-itinerary/-catacombs/`),
    ).toBe(true);
    expect(
      isMalformedBlogUrl(`${BASE}/web-stories/paris-3-day-itinerary/-to-loire-valley/`),
    ).toBe(true);
  });

  it("flags a segment containing whitespace from captured label text", () => {
    // Real corpus garbage: alt-text/labels captured as hrefs.
    expect(isMalformedBlogUrl(`${BASE}/tkts-broadway-tickets/No%20Data`)).toBe(true);
    expect(
      isMalformedBlogUrl(`${BASE}/3-days-venice-itinerary/Basilica%20di%20San%20Marco,`),
    ).toBe(true);
    expect(
      isMalformedBlogUrl(`${BASE}/sabrina-carpenter-mean-girls/(opens%20in%20a%20new%20tab)`),
    ).toBe(true);
  });

  it("flags an over-nested taxonomy path while keeping a slug+code one valid", () => {
    // Real corpus garbage: a category with extra `wp-…/wcp-…` nesting.
    expect(
      isMalformedBlogUrl(
        `${BASE}/category/things-to-do-city-new-york/wp-essential-nyc-travel-guide/wcp-new-york-itineraries/`,
      ),
    ).toBe(true);
    // A category slug plus a single collection-code segment stays valid.
    expect(
      isMalformedBlogUrl(
        `${BASE}/category/things-to-do-city-singapore/tickets-singapore-ca-1__23209/`,
      ),
    ).toBe(false);
  });

  it("returns true for an unparseable URL", () => {
    expect(isMalformedBlogUrl("http://")).toBe(true);
  });
});

describe("classifyUrl", () => {
  it("classifies web-story URLs as their own type, not 'page'", () => {
    expect(classifyUrl(`${BASE}/web-stories/top-experiences-in-paris/`)).toBe("web-story");
    expect(classifyUrl(`${BASE}/web-stories/page/6/`)).toBe("web-story");
  });

  it("classifies web-story URLs from the web-story sitemap source", () => {
    expect(
      classifyUrl(
        "https://www.headout.com/blog/some-slug/",
        "https://www.headout.com/blog/web-story-sitemap.xml",
      ),
    ).toBe("web-story");
  });

  it("still classifies authors, categories, tags, and posts", () => {
    expect(classifyUrl(`${BASE}/author/jane-traveler/`)).toBe("author");
    expect(classifyUrl(`${BASE}/category/things-to-do/`)).toBe("category");
    expect(classifyUrl(`${BASE}/tag/family/`)).toBe("tag");
    expect(classifyUrl(`${BASE}/thanksgiving-vacation-ideas-for-families/`)).toBe("post");
  });
});

describe("isFrontierDiscovered", () => {
  it("is true for a link discovered on a page (frontier expansion)", () => {
    expect(isFrontierDiscovered(`${BASE}/some-source-article/`)).toBe(true);
  });

  it("is false for sitemap-sourced and unknown-origin items", () => {
    expect(isFrontierDiscovered(`${BASE}/post-sitemap2.xml`)).toBe(false);
    expect(isFrontierDiscovered(`${BASE}/web-story-sitemap.xml`)).toBe(false);
    expect(isFrontierDiscovered(null)).toBe(false);
    expect(isFrontierDiscovered(undefined)).toBe(false);
  });
});
