import { beforeEach, describe, expect, it } from "vitest";
import { assemblePage } from "../assemble";
import {
  isArticlePage,
  isArticleUrl,
  rescoreStoredValidation,
  scoreValidation,
  validateExtraction,
  type CountSet,
} from "../validate";
import type { ExtractedPage } from "../types";
import { buildHeldBackEntry } from "../reports";
import { loadFixture, makeFetchResult } from "./helpers";

const URL = "https://www.headout.com/blog/sample-article/";
const html = loadFixture("sample-article.html");

/** A freshly assembled page from the saved HTML fixture. */
function basePage(): ExtractedPage {
  return assemblePage(makeFetchResult(html, URL), null);
}

/** Aligned source/parsed counts for an article — a clean pass baseline. */
function aligned(overrides: Partial<CountSet> = {}): CountSet {
  return {
    headings: 4,
    paragraphs: 10,
    images: 2,
    links: 5,
    tables: 1,
    lists: 2,
    components: 20,
    ...overrides,
  };
}

const ARTICLE_URL = "https://www.headout.com/blog/sample-article/";

describe("isArticleUrl / isArticlePage", () => {
  it("treats a genuine /blog/ article as an article", () => {
    expect(isArticleUrl("https://www.headout.com/blog/moulin-rouge-paris/")).toBe(true);
    expect(isArticlePage("post", "https://www.headout.com/blog/moulin-rouge-paris/")).toBe(true);
  });

  it("excludes non-blog (commerce / main-site) pages", () => {
    expect(isArticleUrl("https://www.headout.com/museums-rome-sc-1002~11738/")).toBe(false);
    expect(isArticlePage("post", "https://www.headout.com/london-theatre-tickets/x-e-1/")).toBe(
      false,
    );
  });

  it("excludes blog search-result pages", () => {
    expect(isArticleUrl("https://www.headout.com/blog/?s=budapest")).toBe(false);
  });

  it("excludes taxonomy and web-story listings", () => {
    expect(isArticleUrl("https://www.headout.com/blog/category/things-to-do/")).toBe(false);
    expect(isArticleUrl("https://www.headout.com/blog/author/jane/")).toBe(false);
    expect(isArticleUrl("https://www.headout.com/blog/tag/summer/")).toBe(false);
    expect(isArticleUrl("https://www.headout.com/blog/web-stories/best-of-rome/")).toBe(false);
  });

  it("excludes paginated index pages", () => {
    expect(isArticleUrl("https://www.headout.com/blog/page/3/")).toBe(false);
  });

  it("non-post page types are never articles", () => {
    expect(isArticlePage("category", ARTICLE_URL)).toBe(false);
    expect(isArticlePage("author", ARTICLE_URL)).toBe(false);
    expect(isArticlePage("web-story", ARTICLE_URL)).toBe(false);
    expect(isArticlePage("page", ARTICLE_URL)).toBe(false);
  });

  it("returns false for malformed URLs", () => {
    expect(isArticleUrl("not a url")).toBe(false);
  });
});

describe("scoreValidation", () => {
  describe("non-article pages are exempt from content-fidelity checks", () => {
    it("passes a non-post page type regardless of count shortfalls", () => {
      const r = scoreValidation({
        source: aligned({ paragraphs: 200, headings: 50 }),
        parsed: aligned({ paragraphs: 0, headings: 0, components: 0 }),
        title: "Things to do in Rome",
        pageType: "category",
        url: "https://www.headout.com/blog/category/rome/",
      });
      expect(r.status).toBe("pass");
      expect(r.score).toBe(100);
      expect(r.issues).toEqual([]);
    });

    it("passes a non-blog commerce page even with zero parsed content", () => {
      const r = scoreValidation({
        source: aligned({ paragraphs: 40 }),
        parsed: aligned({ paragraphs: 0, components: 0 }),
        title: "Museums in Rome",
        pageType: "post",
        url: "https://www.headout.com/museums-rome-sc-1002~11738/",
      });
      expect(r.status).toBe("pass");
      expect(r.issues).toEqual([]);
    });
  });

  describe("article pages", () => {
    it("passes when parsed counts meet the source volume", () => {
      const r = scoreValidation({
        source: aligned(),
        parsed: aligned(),
        title: "A real article",
        pageType: "post",
        url: ARTICLE_URL,
      });
      expect(r.status).toBe("pass");
      expect(r.score).toBe(100);
    });

    it("only WARNs on a partial shortfall — curation legitimately trims element counts", () => {
      // Even a severe shortfall (headings 2/40) is a warning, not a hold-back.
      const r = scoreValidation({
        source: aligned({ headings: 40, paragraphs: 200, lists: 30 }),
        parsed: aligned({ headings: 2, paragraphs: 40, lists: 3 }),
        title: "A heavily curated article",
        pageType: "post",
        url: ARTICLE_URL,
      });
      expect(r.status).toBe("warn");
      expect(r.issues.every((i) => i.severity === "warn")).toBe(true);
    });

    it("FAILs when the title could not be extracted", () => {
      const r = scoreValidation({
        source: aligned(),
        parsed: aligned(),
        title: "Untitled",
        pageType: "post",
        url: ARTICLE_URL,
      });
      expect(r.status).toBe("fail");
      expect(r.issues.find((i) => i.field === "title")).toMatchObject({
        severity: "fail",
        message: "page title could not be extracted",
      });
    });

    it("FAILs on a blank title", () => {
      const r = scoreValidation({
        source: aligned(),
        parsed: aligned(),
        title: "   ",
        pageType: "post",
        url: ARTICLE_URL,
      });
      expect(r.issues.find((i) => i.field === "title")?.severity).toBe("fail");
    });

    it("FAILs when the component tree is empty despite source content", () => {
      const r = scoreValidation({
        source: aligned({ paragraphs: 10 }),
        parsed: aligned({ components: 0 }),
        title: "Broken article",
        pageType: "post",
        url: ARTICLE_URL,
      });
      expect(r.status).toBe("fail");
      expect(r.issues.find((i) => i.field === "components")).toMatchObject({
        severity: "fail",
        message: "component tree is empty despite source content",
      });
    });

    it("does not flag an empty component tree when there is no source content", () => {
      const r = scoreValidation({
        source: aligned({ paragraphs: 0 }),
        parsed: aligned({ components: 0, paragraphs: 0 }),
        title: "Empty source",
        pageType: "post",
        url: ARTICLE_URL,
      });
      expect(r.issues.some((i) => i.field === "components")).toBe(false);
    });

    it("FAILs when the tree is nearly empty despite substantial source content", () => {
      const r = scoreValidation({
        source: aligned({ paragraphs: 20 }),
        parsed: aligned({ components: 2 }),
        title: "Mostly-lost article",
        pageType: "post",
        url: ARTICLE_URL,
      });
      expect(r.status).toBe("fail");
      expect(r.issues.find((i) => i.field === "components")).toMatchObject({
        severity: "fail",
        message: "component tree is nearly empty despite substantial source content",
      });
    });

    it("does not flag a small-but-real tree", () => {
      const r = scoreValidation({
        source: aligned({ paragraphs: 4 }),
        parsed: aligned({ components: 3, paragraphs: 4 }),
        title: "Short article",
        pageType: "post",
        url: ARTICLE_URL,
      });
      expect(r.issues.some((i) => i.field === "components")).toBe(false);
    });
  });

  describe("score calculation", () => {
    it("is 100 with no issues", () => {
      const r = scoreValidation({
        source: aligned(),
        parsed: aligned(),
        title: "ok",
        pageType: "post",
        url: ARTICLE_URL,
      });
      expect(r.score).toBe(100);
    });

    it("deducts 10 per issue when only warnings are present", () => {
      const r = scoreValidation({
        source: aligned({ images: 4, lists: 6 }),
        parsed: aligned({ images: 1, lists: 1 }),
        title: "ok",
        pageType: "post",
        url: ARTICLE_URL,
      });
      expect(r.status).toBe("warn");
      expect(r.issues).toHaveLength(2);
      expect(r.score).toBe(100 - 2 * 10);
    });

    it("deducts 25 per issue once any failure is present", () => {
      const r = scoreValidation({
        source: aligned({ images: 4, paragraphs: 10 }),
        parsed: aligned({ images: 1, components: 0 }),
        title: "ok",
        pageType: "post",
        url: ARTICLE_URL,
      });
      expect(r.status).toBe("fail");
      // images warn + empty-tree fail
      expect(r.issues).toHaveLength(2);
      expect(r.score).toBe(100 - 2 * 25);
    });

    it("never drops below 0", () => {
      const r = scoreValidation({
        source: aligned({ headings: 40, paragraphs: 40, tables: 10, lists: 10, images: 10 }),
        parsed: aligned({ headings: 0, paragraphs: 0, tables: 0, lists: 0, images: 0, components: 0 }),
        title: "Untitled",
        pageType: "post",
        url: ARTICLE_URL,
      });
      expect(r.score).toBe(0);
    });
  });

  describe("per-field warnings", () => {
    it("does not check links", () => {
      const r = scoreValidation({
        source: aligned({ links: 100 }),
        parsed: aligned({ links: 1 }),
        title: "ok",
        pageType: "post",
        url: ARTICLE_URL,
      });
      expect(r.issues.some((i) => i.field === "links")).toBe(false);
    });

    it("skips fields whose source count is zero", () => {
      const r = scoreValidation({
        source: aligned({ tables: 0 }),
        parsed: aligned({ tables: 5 }),
        title: "ok",
        pageType: "post",
        url: ARTICLE_URL,
      });
      expect(r.issues.some((i) => i.field === "tables")).toBe(false);
    });

    it("includes a human-readable message for each warning", () => {
      const r = scoreValidation({
        source: aligned({ headings: 10 }),
        parsed: aligned({ headings: 2 }),
        title: "ok",
        pageType: "post",
        url: ARTICLE_URL,
      });
      expect(r.issues.find((i) => i.field === "headings")?.message).toBe(
        "parsed headings (2) below source (10)",
      );
    });
  });
});

describe("validateExtraction (fixture integration)", () => {
  let page: ExtractedPage;

  beforeEach(() => {
    page = basePage();
  });

  it("warns on the unmodified fixture (it loses one paragraph to curation)", () => {
    const r = validateExtraction(page);
    expect(r.status).toBe("warn");
    expect(r.issues.find((i) => i.field === "paragraphs")).toMatchObject({
      source: 5,
      parsed: 4,
      severity: "warn",
    });
  });

  it("passes once source counts align with the parsed output", () => {
    page.counts.paragraphs = 4;
    const r = validateExtraction(page);
    expect(r.status).toBe("pass");
    expect(r.issues).toEqual([]);
    expect(r.score).toBe(100);
  });

  it("fails when the component tree is empty despite source content", () => {
    page.componentTree = [];
    const r = validateExtraction(page);
    expect(r.status).toBe("fail");
    expect(r.issues.find((i) => i.field === "components")?.severity).toBe("fail");
  });

  it("echoes the source and parsed tallies it compared", () => {
    const r = validateExtraction(page);
    expect(r.source).toEqual({
      headings: 2,
      paragraphs: 5,
      images: 1,
      links: 5,
      tables: 1,
      lists: 2,
    });
    expect(r.parsed).toMatchObject({
      headings: 2,
      paragraphs: 4,
      images: 1,
      tables: 1,
      lists: 2,
      components: 13,
    });
  });
});

describe("rescoreStoredValidation (resilience to stale verdicts)", () => {
  // A row written by an OLDER validator that wrongly failed a non-article page.
  // The current validator auto-passes non-article pages, so re-scoring its
  // captured tallies must override the stale "fail" — otherwise it would keep
  // counting against launch readiness until a manual revalidate refreshed it.
  it("re-scores a stale non-article 'fail' row to pass", () => {
    const staleNonArticleFail = {
      source: { paragraphs: 50, headings: 5 },
      parsed: { paragraphs: 0, components: 0 },
    };
    const r = rescoreStoredValidation(staleNonArticleFail, {
      pageType: "category",
      url: "https://www.headout.com/blog/category/things-to-do/",
      title: "Things to do",
    });
    expect(r.status).toBe("pass");
  });

  it("still fails a genuinely broken article (empty tree despite source prose)", () => {
    const r = rescoreStoredValidation(
      { source: { paragraphs: 20 }, parsed: { components: 0 } },
      { pageType: "post", url: ARTICLE_URL, title: "A real article" },
    );
    expect(r.status).toBe("fail");
  });

  it("treats a missing issues blob as zero counts (no crash, passes non-article)", () => {
    const r = rescoreStoredValidation(null, {
      pageType: "author",
      url: "https://www.headout.com/blog/author/jane/",
      title: null,
    });
    expect(r.status).toBe("pass");
    expect(r.source).toEqual({
      headings: 0,
      paragraphs: 0,
      images: 0,
      links: 0,
      tables: 0,
      lists: 0,
      components: 0,
    });
  });

  it("coerces non-numeric stored tallies to zero", () => {
    const r = rescoreStoredValidation(
      { source: { paragraphs: "lots", headings: null }, parsed: { components: NaN } },
      { pageType: "post", url: ARTICLE_URL, title: "Article" },
    );
    // paragraphs coerced to 0 → no "empty tree despite source content" fail.
    expect(r.status).toBe("pass");
    expect(r.source.paragraphs).toBe(0);
  });
});

describe("buildHeldBackEntry (editor review queue shows the CURRENT reason)", () => {
  const page = {
    id: "page-1",
    slug: "sample-article",
    title: "A real article",
    url: ARTICLE_URL,
    pageType: "post" as const,
  };

  // A draft whose latest stored row was written by an OLDER, over-strict
  // validator that failed it on an element shortfall the current rules only
  // warn about. The editor must not see that stale "fail" reason.
  it("re-scores a stale over-strict 'fail' row to the current verdict", () => {
    const staleStrictFail = {
      // Captured tallies show a partial shortfall (warn today, not fail) and a
      // healthy component tree, so the current validator passes the article.
      source: { paragraphs: 40, headings: 8, images: 10 },
      parsed: { paragraphs: 30, headings: 6, images: 5, components: 40 },
      // The verdict the OLD validator stored alongside the tallies — ignored.
      issues: [{ field: "images", severity: "fail", message: "stale over-strict fail" }],
    };
    const entry = buildHeldBackEntry(page, { issues: staleStrictFail });
    expect(entry.validationStatus).not.toBe("fail");
    // The displayed issues come from the current validator, not the stored blob.
    expect(entry.issues).not.toContainEqual(
      expect.objectContaining({ message: "stale over-strict fail" }),
    );
  });

  it("shows the real current fail issues for a genuinely broken article", () => {
    const brokenArticle = {
      source: { paragraphs: 20 },
      parsed: { components: 0 },
    };
    const entry = buildHeldBackEntry(page, { issues: brokenArticle });
    expect(entry.validationStatus).toBe("fail");
    expect(entry.issues).toContainEqual(
      expect.objectContaining({ field: "components", severity: "fail" }),
    );
  });

  it("carries null verdict fields when a draft has no validation row yet", () => {
    const entry = buildHeldBackEntry(page, undefined);
    expect(entry.validationStatus).toBeNull();
    expect(entry.validationScore).toBeNull();
    expect(entry.issues).toBeNull();
    // The page fields are preserved unchanged.
    expect(entry.slug).toBe("sample-article");
  });
});
