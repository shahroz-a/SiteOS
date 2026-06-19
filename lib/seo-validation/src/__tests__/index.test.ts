import { describe, it, expect } from "vitest";
import {
  validateSeo,
  type SeoValidationInput,
  TITLE_MIN,
  DESC_MIN,
} from "../index";

function baseInput(overrides: Partial<SeoValidationInput> = {}): SeoValidationInput {
  return {
    pageType: "post",
    title: "A Perfectly Reasonable Headline About Travel In Lisbon",
    slug: "travel-in-lisbon",
    pathname: "/blog/travel-in-lisbon/",
    canonicalUrl: "https://www.headout.com/blog/travel-in-lisbon/",
    excerpt: null,
    featuredImageUrl: "https://cdn.example.com/lisbon.jpg",
    seo: {
      metaTitle: "Travel In Lisbon: The Complete 2026 Local Guide",
      metaDescription:
        "Everything you need to plan a trip to Lisbon in 2026 — neighbourhoods, food, day trips, tickets and the local tips that make the difference.",
      canonicalUrl: "https://www.headout.com/blog/travel-in-lisbon/",
      robots: null,
      ogTitle: null,
      ogDescription: null,
      ogImage: "https://cdn.example.com/lisbon-og.jpg",
      ogType: "article",
      twitterCard: "summary_large_image",
      twitterTitle: null,
      twitterDescription: null,
      twitterImage: null,
    },
    jsonldCount: 1,
    breadcrumbCount: 3,
    headings: [
      { level: 1, text: "Travel in Lisbon" },
      { level: 2, text: "Neighbourhoods" },
      { level: 2, text: "Food" },
    ],
    images: [{ alt: "Lisbon tram" }],
    internalLinkCount: 4,
    externalLinks: [{ rel: "nofollow" }],
    componentCount: 12,
    hasBody: true,
    ...overrides,
  };
}

describe("validateSeo", () => {
  it("passes a fully-formed article with no blocking failures", () => {
    const r = validateSeo(baseInput());
    expect(r.blocking).toHaveLength(0);
    expect(r.status).toBe("pass");
    expect(r.score).toBe(100);
  });

  it("blocks publishing when title/description/canonical/body are missing", () => {
    const r = validateSeo(
      baseInput({
        title: "",
        excerpt: null,
        canonicalUrl: null,
        hasBody: false,
        componentCount: 0,
        seo: null,
      }),
    );
    const blockingIds = r.blocking.map((c) => c.id).sort();
    expect(blockingIds).toEqual(
      ["canonical-present", "description-present", "has-body", "title-present"].sort(),
    );
    expect(r.status).toBe("fail");
    expect(r.score).toBeLessThan(50);
  });

  it("invalid slug is a blocking error", () => {
    const r = validateSeo(baseInput({ slug: "Not A Slug" }));
    expect(r.blocking.map((c) => c.id)).toContain("slug-valid");
  });

  it("flags duplicate title/description as warnings, not blockers", () => {
    const r = validateSeo(baseInput(), {
      title: { id: "x", slug: "other-post", title: "dupe" },
      metaDescription: { id: "y", slug: "another-post", title: "dupe" },
    });
    expect(r.blocking).toHaveLength(0);
    expect(r.status).toBe("warn");
    const dupTitle = r.checks.find((c) => c.id === "duplicate-title");
    expect(dupTitle?.passed).toBe(false);
    const dupDesc = r.checks.find((c) => c.id === "duplicate-meta-description");
    expect(dupDesc?.passed).toBe(false);
  });

  it("warns on short title/description and missing schema", () => {
    const r = validateSeo(
      baseInput({
        seo: {
          ...baseInput().seo!,
          metaTitle: "Short",
          metaDescription: "Too short.",
        },
        jsonldCount: 0,
      }),
    );
    expect(r.checks.find((c) => c.id === "title-length")?.passed).toBe(false);
    expect(r.checks.find((c) => c.id === "description-length")?.passed).toBe(false);
    expect(r.checks.find((c) => c.id === "jsonld-present")?.passed).toBe(false);
    expect("Short".length).toBeLessThan(TITLE_MIN);
    expect("Too short.".length).toBeLessThan(DESC_MIN);
  });

  it("detects skipped heading levels and multiple H1s", () => {
    const skip = validateSeo(
      baseInput({ headings: [{ level: 2, text: "A" }, { level: 4, text: "B" }] }),
    );
    expect(skip.checks.find((c) => c.id === "heading-hierarchy")?.passed).toBe(false);

    const multiH1 = validateSeo(
      baseInput({ headings: [{ level: 1, text: "A" }, { level: 1, text: "B" }] }),
    );
    expect(multiH1.checks.find((c) => c.id === "heading-hierarchy")?.passed).toBe(false);
  });

  it("flags images missing alt text", () => {
    const r = validateSeo(
      baseInput({ images: [{ alt: "ok" }, { alt: null }, { alt: "  " }] }),
    );
    const c = r.checks.find((ck) => ck.id === "images-alt");
    expect(c?.passed).toBe(false);
    expect(c?.message).toContain("2 of 3");
  });
});
