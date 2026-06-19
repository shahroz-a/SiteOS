import { describe, expect, it } from "vitest";
import { assemblePage } from "../assemble";
import { extractRaw } from "../extract";
import { classifyUrl } from "../util";
import { flattenComponentTypes, loadFixture, makeFetchResult } from "./helpers";

const URL = "https://www.headout.com/blog/sample-article/";
const html = loadFixture("sample-article.html");

function raw() {
  const fetch = makeFetchResult(html, URL);
  return extractRaw(fetch, classifyUrl(URL));
}

describe("extractRaw", () => {
  it("extracts the title and core text fields", () => {
    const r = raw();
    expect(r.title).toBe("Sample Article Title");
    expect(r.language).toBe("en");
    expect(r.excerpt).toBe("A concise SEO description of the sample article.");
  });

  it("extracts SEO metadata", () => {
    const { seo } = raw();
    expect(seo.metaDescription).toBe("A concise SEO description of the sample article.");
    expect(seo.canonicalUrl).toBe("https://www.headout.com/blog/sample-article/");
    expect(seo.robots).toBe("index, follow");
    expect(seo.keywords).toEqual(["travel", "family", "thanksgiving", "guide"]);
    expect(seo.ogTitle).toBe("Sample Article OG Title");
    expect(seo.ogImage).toBe("https://cdn.example.com/og-image.jpg");
    expect(seo.twitterCard).toBe("summary_large_image");
  });

  it("parses every JSON-LD block", () => {
    const { jsonld } = raw();
    const types = jsonld.map((b) => b.type);
    expect(types).toEqual(["Article", "BreadcrumbList", "FAQPage"]);
  });

  it("extracts the author from JSON-LD", () => {
    const { author } = raw();
    expect(author?.name).toBe("Jane Traveler");
    expect(author?.slug).toBe("jane-traveler");
    expect(author?.bio).toBe("Jane writes about family travel.");
    expect(author?.url).toBe("https://www.headout.com/blog/author/jane-traveler/");
  });

  it("extracts FAQs from FAQPage JSON-LD", () => {
    const { faqs } = raw();
    expect(faqs).toHaveLength(2);
    expect(faqs[0]).toMatchObject({
      question: "Is this a sample question?",
      answer: "Yes, this is the first sample answer.",
      position: 0,
    });
    expect(faqs[1]?.position).toBe(1);
  });

  it("extracts breadcrumbs from BreadcrumbList JSON-LD", () => {
    const { breadcrumbs } = raw();
    expect(breadcrumbs.map((b) => b.label)).toEqual(["Home", "Blog", "Sample Article"]);
    expect(breadcrumbs[0]?.url).toBe("https://www.headout.com/");
  });

  it("extracts images with alt, caption, and dimensions", () => {
    const { images } = raw();
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      url: "https://cdn.example.com/destination.jpg",
      alt: "A scenic family destination",
      caption: "A scenic family destination at sunset.",
      width: 800,
      height: 600,
    });
  });

  it("extracts the embedded video", () => {
    const { videos } = raw();
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({
      provider: "youtube",
      embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    });
  });

  it("separates internal and external links", () => {
    const { internalLinks, externalLinks } = raw();
    const internalHrefs = internalLinks.map((l) => l.href);
    const externalHrefs = externalLinks.map((l) => l.href);
    expect(internalHrefs).toContain("https://www.headout.com/blog/another-post/");
    expect(externalHrefs).toContain("https://www.example.com/external/");
    expect(internalHrefs).not.toContain("https://www.example.com/external/");
  });

  it("extracts categories and tags from taxonomy links", () => {
    const { categories, tags } = raw();
    expect(categories).toEqual([
      {
        name: "Family Travel",
        slug: "family-travel",
        url: "https://www.headout.com/blog/category/family-travel/",
      },
    ]);
    expect(tags.map((t) => t.slug)).toEqual(["thanksgiving", "holidays"]);
  });

  it("strips noise (nav/header/footer) from cleaned HTML", () => {
    const { cleanedHtml } = raw();
    expect(cleanedHtml).not.toContain("Site navigation that should be stripped");
    expect(cleanedHtml).not.toContain("Footer content that should be stripped");
    expect(cleanedHtml).toContain("Sample Article Title");
  });
});

describe("component tree (normalize)", () => {
  it("produces the expected block types in document order", () => {
    const page = assemblePage(makeFetchResult(html, URL), null);
    const types = flattenComponentTypes(page.componentTree);
    for (const expected of [
      "heading",
      "richText",
      "list",
      "table",
      "quote",
      "image",
      "embed",
      "accordion",
    ]) {
      expect(types).toContain(expected);
    }
  });

  it("captures both ordered and unordered lists", () => {
    const page = assemblePage(makeFetchResult(html, URL), null);
    const lists = page.componentTree.filter((n) => n.blockType === "list");
    expect(lists.some((l) => l.data?.ordered === true)).toBe(true);
    expect(lists.some((l) => l.data?.ordered === false)).toBe(true);
  });

  it("preserves inline formatting marks in rich text", () => {
    const page = assemblePage(makeFetchResult(html, URL), null);
    const json = JSON.stringify(page.richText);
    expect(json).toContain("\"bold\"");
    expect(json).toContain("\"italic\"");
  });
});

describe("assemblePage metadata", () => {
  it("classifies the URL as a post and preserves identity fields", () => {
    const page = assemblePage(makeFetchResult(html, URL), null);
    expect(page.pageType).toBe("post");
    expect(page.slug).toBe("sample-article");
    expect(page.canonicalUrl).toBe("https://www.headout.com/blog/sample-article/");
    expect(page.pathname).toBe("/blog/sample-article/");
  });

  it("derives reading time and word count", () => {
    const page = assemblePage(makeFetchResult(html, URL), null);
    expect(page.wordCount).toBeGreaterThan(0);
    expect(page.readingTimeMinutes).toBeGreaterThanOrEqual(1);
  });
});

describe("determinism", () => {
  it("produces identical contentHash across two assembles of the same HTML", () => {
    const a = assemblePage(makeFetchResult(html, URL), null);
    const b = assemblePage(makeFetchResult(html, URL), null);
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("produces a deeply identical component tree across two assembles", () => {
    const a = assemblePage(makeFetchResult(html, URL), null);
    const b = assemblePage(makeFetchResult(html, URL), null);
    expect(a.componentTree).toEqual(b.componentTree);
    expect(a.cleanedHtml).toBe(b.cleanedHtml);
  });

  it("changes the contentHash when the underlying content changes", () => {
    const a = assemblePage(makeFetchResult(html, URL), null);
    const mutated = html.replace(
      "<h1>Sample Article Title</h1>",
      "<h1>Different Article Title</h1>",
    );
    const b = assemblePage(makeFetchResult(mutated, URL), null);
    expect(a.contentHash).not.toBe(b.contentHash);
  });
});
