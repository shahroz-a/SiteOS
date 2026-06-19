import { describe, it, expect } from "vitest";
import {
  extractValidationIssues,
  listContentExplorer,
  type ContentExplorerOpts,
} from "../content-explorer";
import type { Executor } from "../cms-content";

/**
 * Unit coverage for the content explorer's score drill-downs:
 *  - `extractValidationIssues` must normalize BOTH stored report shapes (the
 *    real corpus is almost entirely content-fidelity reports, so a regression
 *    here silently empties the drill-down), and
 *  - the inline `seoFactors[]` mapping in `listContentExplorer` must turn each
 *    per-field presence boolean into the present/missing breakdown the UI shows.
 */

describe("extractValidationIssues — seo reports (issues.checks)", () => {
  it("surfaces only the checks that did not pass", () => {
    const issues = extractValidationIssues({
      checks: [
        { id: "title", label: "Title length", severity: "error", message: "Too short", passed: false },
        { id: "desc", label: "Description", severity: "warn", message: "Missing", passed: false },
        { id: "canonical", label: "Canonical URL", severity: "info", message: "OK", passed: true },
      ],
    });
    expect(issues).toEqual([
      { id: "title", label: "Title length", severity: "error", message: "Too short" },
      { id: "desc", label: "Description", severity: "warn", message: "Missing" },
    ]);
  });

  it("treats a check without an explicit passed flag as failed", () => {
    const issues = extractValidationIssues({
      checks: [{ id: "x", label: "X", severity: "warn", message: "m" }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ id: "x", severity: "warn" });
  });

  it("returns an empty list when every check passed", () => {
    expect(
      extractValidationIssues({
        checks: [
          { id: "a", label: "A", severity: "info", message: "", passed: true },
          { id: "b", label: "B", severity: "info", message: "", passed: true },
        ],
      }),
    ).toEqual([]);
  });

  it("coerces missing/non-string check fields to empty strings", () => {
    const issues = extractValidationIssues({
      checks: [{ passed: false }],
    });
    expect(issues).toEqual([
      { id: "", label: "", severity: "info", message: "" },
    ]);
  });

  it("normalizes an unknown severity to info", () => {
    const issues = extractValidationIssues({
      checks: [{ id: "x", label: "X", severity: "critical", message: "m", passed: false }],
    });
    expect(issues[0]?.severity).toBe("info");
  });
});

describe("extractValidationIssues — content-fidelity reports (issues.issues)", () => {
  it("treats every recorded issue as a problem and humanizes the field name", () => {
    const issues = extractValidationIssues({
      issues: [
        { field: "headings", severity: "warn", message: "Heading mismatch" },
        { field: "images", severity: "error", message: "Image lost" },
      ],
    });
    expect(issues).toEqual([
      { id: "headings", label: "Headings", severity: "warn", message: "Heading mismatch" },
      { id: "images", label: "Images", severity: "error", message: "Image lost" },
    ]);
  });

  it("normalizes a 'fail' severity to error", () => {
    const issues = extractValidationIssues({
      issues: [{ field: "links", severity: "fail", message: "Link dropped" }],
    });
    expect(issues[0]?.severity).toBe("error");
  });

  it("falls back to a 'Content' label when the field is missing", () => {
    const issues = extractValidationIssues({
      issues: [{ severity: "error", message: "Something broke" }],
    });
    expect(issues[0]).toEqual({
      id: "",
      label: "Content",
      severity: "error",
      message: "Something broke",
    });
  });
});

describe("extractValidationIssues — empty / unknown blobs", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "not an object"],
    ["a number", 42],
    ["an empty object", {}],
    ["an object without checks/issues arrays", { checks: "x", issues: 7 }],
  ])("returns an empty list for %s", (_label, input) => {
    expect(extractValidationIssues(input)).toEqual([]);
  });

  it("prefers the checks shape when both keys are arrays", () => {
    const issues = extractValidationIssues({
      checks: [{ id: "c", label: "C", severity: "error", message: "from checks", passed: false }],
      issues: [{ field: "f", severity: "error", message: "from issues" }],
    });
    expect(issues).toEqual([
      { id: "c", label: "C", severity: "error", message: "from checks" },
    ]);
  });
});

/**
 * A minimal `Executor` whose `.execute` returns a queued sequence of result
 * sets. `listContentExplorer` issues exactly two queries — the count, then the
 * page of rows — so we hand back a `{ count }` row, then the explorer rows.
 */
function fakeExecutor(resultSets: unknown[][]): Executor {
  let call = 0;
  return {
    execute: async () => ({ rows: resultSets[call++] ?? [] }),
  } as unknown as Executor;
}

const BASE_OPTS: ContentExplorerOpts = {
  sort: "updated",
  order: "desc",
  page: 1,
  limit: 20,
};

function explorerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    slug: "a-post",
    title: "A Post",
    canonical_url: "https://www.headout.com/blog/a-post/",
    pathname: "/blog/a-post/",
    status: "published",
    modified_at: null,
    published_at: null,
    scheduled_for: null,
    updated_at: null,
    author_id: null,
    author_name: null,
    author_slug: null,
    author_avatar_url: null,
    author_role: null,
    category_id: null,
    category_name: null,
    category_slug: null,
    seo_score: 0,
    seo_meta_title: false,
    seo_meta_description: false,
    seo_og_image: false,
    seo_focus_keyword: false,
    seo_canonical_url: false,
    validation_score: null,
    validation_status: null,
    validation_issues: null,
    ...overrides,
  };
}

describe("listContentExplorer — seoFactors mapping", () => {
  it("maps each per-field presence boolean onto the present/missing breakdown", async () => {
    const exec = fakeExecutor([
      [{ count: 1 }],
      [
        explorerRow({
          seo_meta_title: true,
          seo_meta_description: false,
          seo_og_image: true,
          seo_focus_keyword: false,
          seo_canonical_url: true,
        }),
      ],
    ]);
    const { items } = await listContentExplorer(BASE_OPTS, exec);
    expect(items[0]?.seoFactors).toEqual([
      { id: "metaTitle", label: "Meta title", present: true },
      { id: "metaDescription", label: "Meta description", present: false },
      { id: "ogImage", label: "Social image (og:image)", present: true },
      { id: "focusKeyword", label: "Focus keyword", present: false },
      { id: "canonicalUrl", label: "Canonical URL", present: true },
    ]);
  });

  it("coerces non-boolean SQL truthiness into real booleans", async () => {
    const exec = fakeExecutor([
      [{ count: 1 }],
      [
        explorerRow({
          // Postgres can hand back boolean expressions as 0/1 or null.
          seo_meta_title: 1,
          seo_meta_description: 0,
          seo_og_image: null,
          seo_focus_keyword: undefined,
          seo_canonical_url: true,
        }),
      ],
    ]);
    const { items } = await listContentExplorer(BASE_OPTS, exec);
    expect(items[0]?.seoFactors.map((f) => f.present)).toEqual([
      true,
      false,
      false,
      false,
      true,
    ]);
  });

  it("threads the stored validation report through extractValidationIssues", async () => {
    const exec = fakeExecutor([
      [{ count: 1 }],
      [
        explorerRow({
          validation_score: 80,
          validation_status: "warn",
          validation_issues: {
            issues: [{ field: "links", severity: "fail", message: "Link dropped" }],
          },
        }),
      ],
    ]);
    const { items } = await listContentExplorer(BASE_OPTS, exec);
    expect(items[0]?.validationScore).toBe(80);
    expect(items[0]?.validationStatus).toBe("warn");
    expect(items[0]?.validationIssues).toEqual([
      { id: "links", label: "Links", severity: "error", message: "Link dropped" },
    ]);
  });
});
