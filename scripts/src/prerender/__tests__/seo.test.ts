import { describe, it, expect } from "vitest";
import {
  renderSeoTags,
  injectSeo,
  outputPathsFor,
  isSafeSlug,
  articleSeo,
  categorySeo,
  authorSeo,
  indexSeo,
  searchSeo,
} from "../seo";

const TEMPLATE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Headout Blog</title>
    <meta name="description" content="Default description." />
    <meta name="robots" content="index, follow" />
    <meta property="og:title" content="Headout Blog" />
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="canonical" href="https://old.example.com/" />
    <script type="module" src="/blog/assets/index.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>`;

describe("renderSeoTags", () => {
  it("renders the full article tag set in useSeo order", () => {
    const out = renderSeoTags(
      articleSeo({
        title: "Best Beaches",
        excerpt: "Sun and sand.",
        canonicalUrl: "https://headout.com/blog/best-beaches/",
        featuredImageUrl: "https://cdn.example.com/beach.jpg",
        seo: null,
        jsonLd: [{ "@type": "Article", headline: "Best Beaches" }],
      }),
    );

    expect(out).toContain("<title>Best Beaches | Headout Blog</title>");
    expect(out).toContain('<meta name="description" content="Sun and sand." />');
    expect(out).toContain(
      '<link rel="canonical" href="https://headout.com/blog/best-beaches/" />',
    );
    expect(out).toContain('<meta property="og:title" content="Best Beaches" />');
    expect(out).toContain('<meta property="og:type" content="article" />');
    expect(out).toContain(
      '<meta property="og:url" content="https://headout.com/blog/best-beaches/" />',
    );
    expect(out).toContain(
      '<meta property="og:image" content="https://cdn.example.com/beach.jpg" />',
    );
    expect(out).toContain('<meta name="twitter:title" content="Best Beaches" />');
    expect(out).toContain(
      '<meta name="twitter:image" content="https://cdn.example.com/beach.jpg" />',
    );
    expect(out).toContain(
      '<script type="application/ld+json">{"@type":"Article","headline":"Best Beaches"}</script>',
    );
  });

  it("prefers SEO-row overrides over page fields", () => {
    const out = renderSeoTags(
      articleSeo({
        title: "Raw Title",
        excerpt: "Raw excerpt.",
        canonicalUrl: "https://headout.com/raw/",
        featuredImageUrl: "https://cdn.example.com/raw.jpg",
        seo: {
          metaTitle: "SEO Title",
          metaDescription: "SEO description.",
          canonicalUrl: "https://headout.com/seo/",
          ogTitle: "OG Title",
          ogDescription: "OG description.",
          ogImage: "https://cdn.example.com/og.jpg",
        },
      }),
    );

    expect(out).toContain("<title>SEO Title | Headout Blog</title>");
    expect(out).toContain('<meta name="description" content="SEO description." />');
    expect(out).toContain('<link rel="canonical" href="https://headout.com/seo/" />');
    expect(out).toContain('<meta property="og:title" content="OG Title" />');
    expect(out).toContain(
      '<meta property="og:image" content="https://cdn.example.com/og.jpg" />',
    );
  });

  it("omits canonical/og:url and empty descriptions but carries the brand og:image for listing pages", () => {
    const out = renderSeoTags(categorySeo({ name: "Beaches", description: null }));
    expect(out).toContain("<title>Beaches | Headout Blog</title>");
    expect(out).not.toContain("rel=\"canonical\"");
    expect(out).not.toContain("og:url");
    expect(out).not.toContain('name="description"');
    expect(out).not.toContain("og:description");
    // Listing pages share the brand preview image (og:image + twitter:image).
    expect(out).toContain(
      '<meta property="og:image" content="/blog/og-default.png" />',
    );
    expect(out).toContain(
      '<meta name="twitter:image" content="/blog/og-default.png" />',
    );
    // og:title still falls back to the (full) title.
    expect(out).toContain(
      '<meta property="og:title" content="Beaches | Headout Blog" />',
    );
  });

  it("escapes HTML-significant characters in attributes and titles", () => {
    const out = renderSeoTags(
      authorSeo({ name: 'A & B <"C">', bio: 'Bio with "quotes" & <tags>' }),
    );
    // Title is text content: &, <, > are escaped but quotes are left as-is.
    expect(out).toContain(
      '<title>A &amp; B &lt;"C"&gt; | Headout Blog</title>',
    );
    expect(out).toContain(
      '<meta name="description" content="Bio with &quot;quotes&quot; &amp; &lt;tags&gt;" />',
    );
  });

  it("escapes < in JSON-LD so it cannot close the script tag", () => {
    const out = renderSeoTags({
      title: "X",
      jsonLd: [{ html: "</script><script>alert(1)</script>" }],
    });
    expect(out).not.toContain("</script><script>alert(1)");
    expect(out).toContain("\\u003c/script>");
  });
});

describe("injectSeo", () => {
  it("replaces template SEO tags while preserving robots and scripts", () => {
    const out = injectSeo(TEMPLATE, indexSeo());

    // Old defaults are gone.
    expect(out).not.toContain("<title>Headout Blog</title>");
    expect(out).not.toContain("https://old.example.com/");
    expect(out).not.toContain('content="Default description."');

    // New ones are present (& is escaped in title text content).
    expect(out).toContain(
      "<title>Headout Blog — Travel inspiration &amp; destination guides</title>",
    );

    // Exactly one title and one robots tag remain.
    expect(out.match(/<title>/g)?.length).toBe(1);
    expect(out.match(/name="robots"/g)?.length).toBe(1);

    // The built script tag and root are untouched.
    expect(out).toContain('<script type="module" src="/blog/assets/index.js">');
    expect(out).toContain('<div id="root">');
    // Block was inserted before </head>.
    expect(out.indexOf("twitter:title")).toBeLessThan(out.indexOf("</head>"));
  });

  it("does not leave duplicate og/twitter tags from the template", () => {
    const out = injectSeo(TEMPLATE, searchSeo());
    expect(out.match(/property="og:title"/g)?.length).toBe(1);
    expect(out.match(/property="og:type"/g)?.length).toBe(1);
    expect(out.match(/name="twitter:card"/g)?.length).toBe(1);
  });

  it("throws when there is no </head>", () => {
    expect(() => injectSeo("<html><body></body></html>", indexSeo())).toThrow();
  });
});

describe("outputPathsFor", () => {
  it("maps each route kind to both clean-URL file forms", () => {
    expect(outputPathsFor("index")).toEqual(["index.html"]);
    expect(outputPathsFor("search")).toEqual(["search.html", "search/index.html"]);
    expect(outputPathsFor("article", "best-beaches")).toEqual([
      "best-beaches.html",
      "best-beaches/index.html",
    ]);
    expect(outputPathsFor("category", "europe")).toEqual([
      "category/europe.html",
      "category/europe/index.html",
    ]);
    expect(outputPathsFor("author", "jane")).toEqual([
      "author/jane.html",
      "author/jane/index.html",
    ]);
  });
});

describe("isSafeSlug", () => {
  it("rejects empty, traversal and separator slugs", () => {
    expect(isSafeSlug("normal-slug")).toBe(true);
    expect(isSafeSlug("")).toBe(false);
    expect(isSafeSlug("../etc/passwd")).toBe(false);
    expect(isSafeSlug("a/b")).toBe(false);
    expect(isSafeSlug("a\\b")).toBe(false);
  });
});
