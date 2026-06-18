import { describe, it, expect } from "vitest";
import {
  renderSeoTags,
  applySeoTags,
  articleSeo,
  categorySeo,
  authorSeo,
  indexSeo,
  searchSeo,
  type SeoDocument,
  type SeoElement,
  type SeoTags,
} from "../seo";

/**
 * Drift guard: the static prerender (`renderSeoTags`, used by
 * `prerender-blog.ts`) and the runtime `useSeo` hook (which applies
 * `applySeoTags` to the live `document`) must emit an IDENTICAL set of head
 * tags for the same route input. Both derive from the shared
 * `@workspace/blog-seo` source of truth; this test exercises each rendering
 * target independently and asserts they agree, so any future divergence between
 * what crawlers see (static HTML) and what JS visitors see (DOM) fails CI.
 */

/** A normalized, target-agnostic representation of a single head tag. */
type TagRecord =
  | { kind: "title"; text: string }
  | { kind: "meta"; attr: "name" | "property"; key: string; content: string }
  | { kind: "link"; rel: string; href: string }
  | { kind: "jsonld"; json: unknown };

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Parse the prerender HTML string into normalized tag records. */
function parseRenderedTags(html: string): TagRecord[] {
  const records: TagRecord[] = [];
  for (const raw of html.split("\n    ")) {
    const line = raw.trim();
    if (!line) continue;

    const title = line.match(/^<title>([\s\S]*)<\/title>$/);
    if (title) {
      records.push({ kind: "title", text: decodeEntities(title[1]) });
      continue;
    }

    const meta = line.match(/^<meta (name|property)="([^"]*)" content="([\s\S]*)" \/>$/);
    if (meta) {
      records.push({
        kind: "meta",
        attr: meta[1] as "name" | "property",
        key: meta[2],
        content: decodeEntities(meta[3]),
      });
      continue;
    }

    const link = line.match(/^<link rel="([^"]*)" href="([\s\S]*)" \/>$/);
    if (link) {
      records.push({ kind: "link", rel: link[1], href: decodeEntities(link[2]) });
      continue;
    }

    const json = line.match(/^<script type="application\/ld\+json">([\s\S]*)<\/script>$/);
    if (json) {
      records.push({ kind: "jsonld", json: JSON.parse(json[1].replace(/\\u003c/g, "<")) });
      continue;
    }

    throw new Error(`Unrecognized rendered tag line: ${line}`);
  }
  return records;
}

const MANAGED_ATTR = "data-blog-seo";

/** A minimal in-memory DOM that satisfies `SeoDocument` for `applySeoTags`. */
class FakeElement implements SeoElement {
  tagName: string;
  attrs = new Map<string, string>();
  textContent: string | null = null;
  removed = false;
  constructor(tagName: string) {
    this.tagName = tagName;
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  remove() {
    this.removed = true;
  }
}

class FakeDocument implements SeoDocument {
  title = "";
  elements: FakeElement[] = [];
  head = {
    querySelector: (selectors: string): SeoElement | null => {
      // Only the `tag[attr="value"][data-blog-seo]` form is used by applySeoTags.
      const m = selectors.match(/^(\w+)\[(\w+)="([^"]*)"\]\[data-blog-seo\]$/);
      if (!m) return null;
      const [, tag, attr, value] = m;
      return (
        this.elements.find(
          (el) =>
            !el.removed &&
            el.tagName === tag &&
            el.getAttribute(attr) === value &&
            el.getAttribute(MANAGED_ATTR) !== null,
        ) ?? null
      );
    },
    appendChild: (child: SeoElement) => {
      this.elements.push(child as FakeElement);
    },
  };
  createElement(tagName: string): SeoElement {
    return new FakeElement(tagName);
  }
}

/** Read the managed tags applied to a fake document into normalized records. */
function readAppliedTags(doc: FakeDocument): TagRecord[] {
  const records: TagRecord[] = [{ kind: "title", text: doc.title }];
  for (const el of doc.elements) {
    if (el.removed) continue;
    if (el.tagName === "meta") {
      const attr = el.getAttribute("name") !== null ? "name" : "property";
      records.push({
        kind: "meta",
        attr,
        key: el.getAttribute(attr)!,
        content: el.getAttribute("content")!,
      });
    } else if (el.tagName === "link") {
      records.push({
        kind: "link",
        rel: el.getAttribute("rel")!,
        href: el.getAttribute("href")!,
      });
    } else if (el.tagName === "script") {
      records.push({ kind: "jsonld", json: JSON.parse(el.textContent!) });
    }
  }
  return records;
}

const CASES: Record<string, SeoTags> = {
  index: indexSeo(),
  search: searchSeo(),
  "search with query": {
    title: "Search: beaches | Headout Blog",
    description: "Search travel guides and articles on the Headout Blog.",
  },
  category: categorySeo({ name: "Beaches", description: "Sun & sand guides." }),
  "category without description": categorySeo({ name: "Europe", description: null }),
  author: authorSeo({ name: "Jane Doe", bio: 'Writes about "quirky" travel & food.' }),
  "author without bio": authorSeo({ name: "John", bio: null }),
  article: articleSeo({
    title: "Best Beaches",
    excerpt: "Sun and sand.",
    canonicalUrl: "https://headout.com/blog/best-beaches/",
    featuredImageUrl: "https://cdn.example.com/beach.jpg",
    seo: null,
    jsonLd: [{ "@type": "Article", headline: "Best Beaches" }],
  }),
  "article with seo overrides": articleSeo({
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
    jsonLd: [{ "@type": "Article", body: "</script> injection attempt" }],
  }),
};

describe("prerender / runtime SEO parity", () => {
  for (const [name, tags] of Object.entries(CASES)) {
    it(`emits identical tags for "${name}"`, () => {
      const rendered = parseRenderedTags(renderSeoTags(tags));

      const doc = new FakeDocument();
      applySeoTags(doc, tags);
      const applied = readAppliedTags(doc);

      expect(applied).toEqual(rendered);
    });
  }

  it("re-applying to the same document updates in place without duplicating meta/link tags", () => {
    const doc = new FakeDocument();
    applySeoTags(doc, CASES["article"]);
    applySeoTags(doc, CASES["article with seo overrides"]);

    const live = readAppliedTags(doc);
    const expected = parseRenderedTags(
      renderSeoTags(CASES["article with seo overrides"]),
    );

    // JSON-LD scripts are recreated each run; the first run's script remains in
    // the fake DOM (the hook removes it via the returned cleanup). Compare only
    // the reusable title/meta/link tags for the in-place update guarantee.
    const reusable = (records: TagRecord[]) =>
      records.filter((r) => r.kind !== "jsonld");
    expect(reusable(live)).toEqual(reusable(expected));
  });
});
