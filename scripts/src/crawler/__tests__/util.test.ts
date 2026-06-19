import { describe, expect, it } from "vitest";
import { collapseSlashes, isMalformedBlogUrl } from "../util";

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

  it("returns true for an unparseable URL", () => {
    expect(isMalformedBlogUrl("http://")).toBe(true);
  });
});
