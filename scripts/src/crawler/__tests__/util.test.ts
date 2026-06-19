import { describe, expect, it } from "vitest";
import {
  classifyUrl,
  collapseSlashes,
  isCleanBlogUrl,
  isFrontierDiscovered,
  isMalformedBlogUrl,
  isResolvableRedirectTarget,
} from "../util";

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

  it("flags repeated slashes — a duplicate of the slash-collapsed URL", () => {
    // Real corpus garbage: `.../1-day-venice-itinerary//`, `.../acropolis-athens//`.
    expect(isMalformedBlogUrl(`${BASE}/1-day-venice-itinerary//`)).toBe(true);
    expect(isMalformedBlogUrl(`${BASE}/acropolis-athens//tickets`)).toBe(true);
  });

  it("flags an uppercase slug (mis-cased duplicate) and junk template tokens", () => {
    // Real corpus garbage: `/Melbourne-travel-guide/` and `/Ambassadors-theatre-seating-plan/`
    // both have completed lowercase twins; `/barcelona-in-march/LINK` is a template token.
    expect(isMalformedBlogUrl(`${BASE}/Melbourne-travel-guide/`)).toBe(true);
    expect(isMalformedBlogUrl(`${BASE}/Ambassadors-theatre-seating-plan/`)).toBe(true);
    expect(isMalformedBlogUrl(`${BASE}/barcelona-in-march/LINK`)).toBe(true);
    // A normal all-lowercase slug stays valid.
    expect(isMalformedBlogUrl(`${BASE}/melbourne-travel-guide/`)).toBe(false);
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

describe("isCleanBlogUrl", () => {
  it("accepts a clean on-blog article URL", () => {
    expect(isCleanBlogUrl(`${BASE}/singapore-zoo/`)).toBe(true);
    expect(isCleanBlogUrl(`${BASE}/category/things-to-do-city-singapore/`)).toBe(true);
  });

  it("accepts a URL once accidental repeated slashes are collapsed", () => {
    expect(isCleanBlogUrl(`${BASE}/acropolis-athens//tickets/`)).toBe(true);
    expect(isCleanBlogUrl(`${BASE}/singapore-zoo//`)).toBe(true);
  });

  it("rejects off-blog URLs (the blog can't serve them)", () => {
    expect(isCleanBlogUrl("https://www.headout.com/statue-of-liberty-cruises-c-121/")).toBe(false);
    expect(isCleanBlogUrl("https://www.example.com/blog/external/")).toBe(false);
  });

  it("rejects non-page asset URLs", () => {
    expect(isCleanBlogUrl(`${BASE}/wp-content/uploads/2020/x.jpg`)).toBe(false);
  });

  it("rejects structurally malformed source-markup junk", () => {
    expect(isCleanBlogUrl(`${BASE}/athens-in-august/introducingathens.com/bus`)).toBe(false);
    expect(isCleanBlogUrl(`${BASE}/aladdin/:%22https://en.wikipedia.org/x`)).toBe(false);
    expect(isCleanBlogUrl(`${BASE}/best-broadway-shows-january/%22`)).toBe(false);
  });
});

describe("isResolvableRedirectTarget", () => {
  it("accepts clean on-blog destinations (incl. ones needing slash-collapse)", () => {
    expect(isResolvableRedirectTarget(`${BASE}/new-name/`)).toBe(true);
    expect(isResolvableRedirectTarget(`${BASE}/acropolis-athens//tickets/`)).toBe(true);
    expect(isResolvableRedirectTarget(`${BASE}/category/things-to-do-city-singapore/`)).toBe(true);
  });

  it("accepts legitimate off-blog destinations on the Headout origin", () => {
    expect(
      isResolvableRedirectTarget("https://www.headout.com/empire-state-building-tickets-c-234/"),
    ).toBe(true);
    expect(
      isResolvableRedirectTarget("https://www.headout.com/london-theatre-tickets/six-e-9858/"),
    ).toBe(true);
  });

  it("rejects foreign-host destinations (would be re-hosted under headout.com)", () => {
    expect(isResolvableRedirectTarget("https://maps.google.com/?q=rome")).toBe(false);
    expect(isResolvableRedirectTarget("https://www.example.com/some-page/")).toBe(false);
  });

  it("rejects on-blog destinations that are structurally malformed junk", () => {
    expect(
      isResolvableRedirectTarget(`${BASE}/foo/https://www.headout.com/blog/bar/`),
    ).toBe(false);
    expect(isResolvableRedirectTarget(`${BASE}/best-broadway-shows-january/%22`)).toBe(false);
  });

  it("rejects off-blog destinations whose path is junk (bare domain, embedded URL)", () => {
    expect(isResolvableRedirectTarget("https://www.headout.com/introducingathens.com")).toBe(false);
    expect(
      isResolvableRedirectTarget("https://www.headout.com/x/:%22https://en.wikipedia.org/y"),
    ).toBe(false);
  });

  it("rejects asset and unparseable destinations", () => {
    expect(isResolvableRedirectTarget(`${BASE}/wp-content/uploads/2020/x.jpg`)).toBe(false);
    expect(isResolvableRedirectTarget("not-a-url")).toBe(false);
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

  it("classifies non-blog commerce/main-site URLs as 'page', not 'post'", () => {
    expect(classifyUrl("https://www.headout.com/museums-rome-sc-1002~11738/")).toBe("page");
    expect(
      classifyUrl("https://www.headout.com/london-theatre-tickets/six-e-9858/"),
    ).toBe("page");
    expect(classifyUrl("https://www.headout.com/headout-reviews/")).toBe("page");
    // A post-sitemap source must not promote a non-blog URL back to 'post'.
    expect(
      classifyUrl(
        "https://www.headout.com/empire-state-building-tickets-c-234/",
        "https://www.headout.com/post-sitemap.xml",
      ),
    ).toBe("page");
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
