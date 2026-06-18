import { beforeEach, describe, expect, it } from "vitest";
import { assemblePage } from "../assemble";
import { validateExtraction } from "../validate";
import type { ExtractedPage } from "../types";
import { loadFixture, makeFetchResult } from "./helpers";

const URL = "https://www.headout.com/blog/sample-article/";
const html = loadFixture("sample-article.html");

/** A freshly assembled page from the saved HTML fixture. */
function basePage(): ExtractedPage {
  return assemblePage(makeFetchResult(html, URL), null);
}

/**
 * The validator compares the source DOM `counts` against values derived from
 * the parsed output (richText/componentTree/images). For the fixture these are
 * the parsed numbers; tests move the source `counts` to drive each scenario.
 */
const PARSED = {
  headings: 2,
  paragraphs: 4,
  images: 1,
  tables: 1,
  lists: 2,
} as const;

describe("validateExtraction", () => {
  let page: ExtractedPage;

  beforeEach(() => {
    page = basePage();
  });

  describe("status", () => {
    it("passes when every parsed field meets the source volume", () => {
      // Align source counts with what the parser actually produced.
      page.counts.paragraphs = PARSED.paragraphs;
      const r = validateExtraction(page);
      expect(r.status).toBe("pass");
      expect(r.issues).toEqual([]);
      expect(r.score).toBe(100);
    });

    it("warns on a modest shortfall (the unmodified fixture loses one paragraph)", () => {
      const r = validateExtraction(page);
      expect(r.status).toBe("warn");
      expect(r.issues).toHaveLength(1);
      expect(r.issues[0]).toMatchObject({
        field: "paragraphs",
        source: 5,
        parsed: 4,
        severity: "warn",
      });
    });

    it("fails on a severe shortfall", () => {
      page.counts.headings = 10; // parsed 2 / 10 = 0.2, well under the fail threshold
      const r = validateExtraction(page);
      expect(r.status).toBe("fail");
      expect(r.issues.some((i) => i.field === "headings" && i.severity === "fail")).toBe(true);
    });
  });

  describe("score calculation", () => {
    it("is 100 with no issues", () => {
      page.counts.paragraphs = PARSED.paragraphs;
      expect(validateExtraction(page).score).toBe(100);
    });

    it("deducts 10 per issue when only warnings are present", () => {
      page.counts.paragraphs = PARSED.paragraphs;
      page.counts.images = 2; // 1/2 = 0.5 -> warn (>= 0.8 * 0.6)
      page.counts.lists = 3; // 2/3 = 0.67 -> warn (>= 0.85 * 0.6)
      const r = validateExtraction(page);
      expect(r.status).toBe("warn");
      expect(r.issues).toHaveLength(2);
      expect(r.score).toBe(100 - 2 * 10);
    });

    it("deducts 25 per issue once any failure is present", () => {
      page.counts.paragraphs = PARSED.paragraphs;
      page.counts.headings = 10; // fail
      page.counts.images = 2; // warn, but a fail switches the whole page to the 25x penalty
      const r = validateExtraction(page);
      expect(r.status).toBe("fail");
      expect(r.issues).toHaveLength(2);
      expect(r.score).toBe(100 - 2 * 25);
    });

    it("never drops below 0", () => {
      page.title = "Untitled"; // fail
      page.counts.headings = 100; // fail
      page.counts.paragraphs = 100; // fail
      page.counts.tables = 100; // fail
      page.counts.lists = 100; // fail
      page.counts.images = 100; // fail
      const r = validateExtraction(page);
      expect(r.score).toBe(0);
    });
  });

  describe("per-field issue detection", () => {
    beforeEach(() => {
      // Start from a clean pass so each test isolates a single field.
      page.counts.paragraphs = PARSED.paragraphs;
    });

    it("flags a heading count mismatch", () => {
      page.counts.headings = 5; // 2/5 = 0.4 -> below 0.9 and below 0.9*0.6
      const r = validateExtraction(page);
      const issue = r.issues.find((i) => i.field === "headings");
      expect(issue).toMatchObject({
        field: "headings",
        source: 5,
        parsed: PARSED.headings,
        severity: "fail",
      });
    });

    it("flags a paragraph count mismatch", () => {
      page.counts.paragraphs = 8; // 4/8 = 0.5 -> below 0.9*0.6 = 0.54 -> fail
      const r = validateExtraction(page);
      const issue = r.issues.find((i) => i.field === "paragraphs");
      expect(issue).toMatchObject({ field: "paragraphs", source: 8, parsed: 4, severity: "fail" });
    });

    it("flags a table count mismatch", () => {
      page.counts.tables = 2; // 1/2 = 0.5 -> below 0.9*0.6 = 0.54 -> fail
      const r = validateExtraction(page);
      expect(r.issues.find((i) => i.field === "tables")).toMatchObject({
        field: "tables",
        source: 2,
        parsed: PARSED.tables,
      });
    });

    it("flags a list count mismatch", () => {
      page.counts.lists = 3; // 2/3 = 0.67 -> below 0.85 but above 0.85*0.6 -> warn
      const r = validateExtraction(page);
      expect(r.issues.find((i) => i.field === "lists")).toMatchObject({
        field: "lists",
        source: 3,
        parsed: PARSED.lists,
        severity: "warn",
      });
    });

    it("flags an image count mismatch", () => {
      page.counts.images = 3; // 1/3 = 0.33 -> below 0.8*0.6 = 0.48 -> fail
      const r = validateExtraction(page);
      expect(r.issues.find((i) => i.field === "images")).toMatchObject({
        field: "images",
        source: 3,
        parsed: PARSED.images,
        severity: "fail",
      });
    });

    it("includes a human-readable message for each issue", () => {
      page.counts.headings = 5;
      const r = validateExtraction(page);
      expect(r.issues.find((i) => i.field === "headings")?.message).toBe(
        "parsed headings (2) below source (5)",
      );
    });

    it("does not check links", () => {
      page.counts.links = 100;
      const r = validateExtraction(page);
      expect(r.issues.some((i) => i.field === "links")).toBe(false);
    });
  });

  describe("severity thresholds", () => {
    beforeEach(() => {
      page.counts.paragraphs = PARSED.paragraphs;
    });

    it("treats a ratio at or above tolerance*0.6 as a warning", () => {
      // images tolerance 0.8 -> fail threshold 0.48. 1/2 = 0.5 stays a warn.
      page.counts.images = 2;
      const issue = validateExtraction(page).issues.find((i) => i.field === "images");
      expect(issue?.severity).toBe("warn");
    });

    it("treats a ratio below tolerance*0.6 as a failure", () => {
      // 1/3 = 0.33 falls under 0.48 -> fail.
      page.counts.images = 3;
      const issue = validateExtraction(page).issues.find((i) => i.field === "images");
      expect(issue?.severity).toBe("fail");
    });

    it("does not flag a field whose ratio meets the tolerance", () => {
      // images tolerance 0.8: 1/1 = 1.0 is fine, so no issue.
      page.counts.images = 1;
      expect(validateExtraction(page).issues.some((i) => i.field === "images")).toBe(false);
    });
  });

  describe("edge cases", () => {
    beforeEach(() => {
      page.counts.paragraphs = PARSED.paragraphs;
    });

    it("skips fields whose source count is zero (avoids divide-by-zero noise)", () => {
      page.counts.tables = 0; // even though parsed has 1 table, source 0 is skipped
      const r = validateExtraction(page);
      expect(r.issues.some((i) => i.field === "tables")).toBe(false);
    });

    it("fails when the title could not be extracted", () => {
      page.title = "Untitled";
      const r = validateExtraction(page);
      expect(r.status).toBe("fail");
      expect(r.issues.find((i) => i.field === "title")).toMatchObject({
        field: "title",
        severity: "fail",
        message: "page title could not be extracted",
      });
    });

    it("fails on a blank title", () => {
      page.title = "   ";
      const r = validateExtraction(page);
      expect(r.issues.find((i) => i.field === "title")?.severity).toBe("fail");
    });

    it("fails when the component tree is empty despite source content", () => {
      page.componentTree = [];
      const r = validateExtraction(page);
      expect(r.status).toBe("fail");
      expect(r.issues.find((i) => i.field === "components")).toMatchObject({
        field: "components",
        source: page.counts.paragraphs,
        parsed: 0,
        severity: "fail",
        message: "component tree is empty despite source content",
      });
    });

    it("does not flag an empty component tree when there is no source content", () => {
      page.componentTree = [];
      page.counts.paragraphs = 0;
      const r = validateExtraction(page);
      expect(r.issues.some((i) => i.field === "components")).toBe(false);
    });
  });

  describe("reported counts", () => {
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
});
