import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  extractValidationIssues,
  listContentExplorer,
  buildContentExport,
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

/**
 * A capturing `Executor` that records the rendered SQL + bound params of every
 * query `listContentExplorer` issues (count, then the page of rows). Rendering
 * the drizzle `SQL` through the real `PgDialect` lets us assert the WHERE/ORDER
 * BY assembly and pagination math without a live database — a regression in the
 * filter or sort SQL is exactly the silent "wrong rows" bug this guards.
 */
const dialect = new PgDialect();

function capturingExecutor(resultSets: unknown[][]) {
  const queries: { sql: string; params: unknown[] }[] = [];
  let call = 0;
  const exec = {
    execute: async (query: SQL) => {
      queries.push(dialect.sqlToQuery(query));
      return { rows: resultSets[call++] ?? [] };
    },
  } as unknown as Executor;
  return { exec, queries };
}

/** Collapse whitespace so multi-line SQL is easy to substring-match. */
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

describe("listContentExplorer — WHERE filter assembly", () => {
  it("filters to posts only with no extra conditions when no filters are given", async () => {
    const { exec, queries } = capturingExecutor([[{ count: 0 }], []]);
    await listContentExplorer(BASE_OPTS, exec);
    const count = queries[0]!;
    expect(flat(count.sql)).toContain("where p.page_type = 'post'");
    // page_type is inlined, so no filter params on the count query.
    expect(count.params).toEqual([]);
    // The rows query shares the same WHERE.
    expect(flat(queries[1]!.sql)).toContain("where p.page_type = 'post'");
  });

  it("adds a status equality predicate bound to the requested status", async () => {
    const { exec, queries } = capturingExecutor([[{ count: 0 }], []]);
    await listContentExplorer({ ...BASE_OPTS, status: "draft" }, exec);
    expect(flat(queries[0]!.sql)).toContain("p.status = $1");
    expect(queries[0]!.params).toEqual(["draft"]);
  });

  it("adds a case-insensitive title/slug search bound to an escaped LIKE pattern", async () => {
    const { exec, queries } = capturingExecutor([[{ count: 0 }], []]);
    await listContentExplorer({ ...BASE_OPTS, q: "  paris  " }, exec);
    expect(flat(queries[0]!.sql)).toContain(
      "(p.title ilike $1 or p.slug ilike $2)",
    );
    // Trimmed, wrapped in %…%; the pattern is bound once per column.
    expect(queries[0]!.params).toEqual(["%paris%", "%paris%"]);
  });

  it("escapes LIKE wildcards in the search term so they match literally", async () => {
    const { exec, queries } = capturingExecutor([[{ count: 0 }], []]);
    await listContentExplorer({ ...BASE_OPTS, q: "50%_off" }, exec);
    expect(queries[0]!.params).toEqual(["%50\\%\\_off%", "%50\\%\\_off%"]);
  });

  it("adds an author-slug predicate bound to the trimmed slug", async () => {
    const { exec, queries } = capturingExecutor([[{ count: 0 }], []]);
    await listContentExplorer({ ...BASE_OPTS, author: "  jane-doe  " }, exec);
    expect(flat(queries[0]!.sql)).toContain("a.slug = $1");
    expect(queries[0]!.params).toEqual(["jane-doe"]);
  });

  it("adds a category-slug predicate bound to the trimmed slug", async () => {
    const { exec, queries } = capturingExecutor([[{ count: 0 }], []]);
    await listContentExplorer({ ...BASE_OPTS, category: "  tickets  " }, exec);
    expect(flat(queries[0]!.sql)).toContain("c.slug = $1");
    expect(queries[0]!.params).toEqual(["tickets"]);
  });

  it("combines every filter with AND, in a stable parameter order", async () => {
    const { exec, queries } = capturingExecutor([[{ count: 0 }], []]);
    await listContentExplorer(
      { ...BASE_OPTS, status: "published", q: "louvre", author: "jane", category: "museums" },
      exec,
    );
    const sqlFlat = flat(queries[0]!.sql);
    expect(sqlFlat).toContain("p.page_type = 'post'");
    expect(sqlFlat).toContain("p.status = $1");
    expect(sqlFlat).toContain("(p.title ilike $2 or p.slug ilike $3)");
    expect(sqlFlat).toContain("a.slug = $4");
    expect(sqlFlat).toContain("c.slug = $5");
    expect(sqlFlat).toContain(" and ");
    expect(queries[0]!.params).toEqual([
      "published",
      "%louvre%",
      "%louvre%",
      "jane",
      "museums",
    ]);
  });

  it("ignores blank/whitespace-only search, author, and category filters", async () => {
    const { exec, queries } = capturingExecutor([[{ count: 0 }], []]);
    await listContentExplorer(
      { ...BASE_OPTS, q: "   ", author: "  ", category: "" },
      exec,
    );
    expect(flat(queries[0]!.sql)).toContain("where p.page_type = 'post'");
    expect(queries[0]!.params).toEqual([]);
    expect(flat(queries[0]!.sql)).not.toContain("ilike");
    expect(flat(queries[0]!.sql)).not.toContain("a.slug =");
    expect(flat(queries[0]!.sql)).not.toContain("c.slug =");
  });
});

describe("listContentExplorer — ORDER BY sort columns and direction", () => {
  it.each([
    ["title", "p.title"],
    ["slug", "p.slug"],
    ["status", "p.status"],
    ["modified", "p.modified_at"],
    ["published", "p.published_at"],
    ["updated", "p.updated_at"],
    ["seo", "seo_score"],
    ["validation", "validation_score"],
  ] as const)("sorts by the %s column expression", async (sort, expr) => {
    const { exec, queries } = capturingExecutor([[{ count: 0 }], []]);
    await listContentExplorer({ ...BASE_OPTS, sort }, exec);
    expect(flat(queries[1]!.sql)).toContain(`order by ${expr} desc nulls last, p.id asc`);
  });

  it.each([
    ["asc", "asc"],
    ["desc", "desc"],
  ] as const)("applies %s direction and a stable id tiebreaker", async (order, dir) => {
    const { exec, queries } = capturingExecutor([[{ count: 0 }], []]);
    await listContentExplorer({ ...BASE_OPTS, sort: "seo", order }, exec);
    expect(flat(queries[1]!.sql)).toContain(`order by seo_score ${dir} nulls last, p.id asc`);
  });

  it("pushes the validation score sort to nulls last regardless of direction", async () => {
    const { exec, queries } = capturingExecutor([[{ count: 0 }], []]);
    await listContentExplorer({ ...BASE_OPTS, sort: "validation", order: "asc" }, exec);
    expect(flat(queries[1]!.sql)).toContain(
      "order by validation_score asc nulls last, p.id asc",
    );
  });
});

describe("listContentExplorer — pagination math", () => {
  it("reports a single page and offset 0 for an empty result", async () => {
    const { exec, queries } = capturingExecutor([[{ count: 0 }], []]);
    const { pagination } = await listContentExplorer({ ...BASE_OPTS, page: 1, limit: 20 }, exec);
    expect(pagination).toEqual({ page: 1, limit: 20, total: 0, totalPages: 1 });
    // limit, then offset are the trailing bound params of the rows query.
    expect(queries[1]!.params.slice(-2)).toEqual([20, 0]);
  });

  it("rounds a partial last page up", async () => {
    const { exec } = capturingExecutor([[{ count: 45 }], []]);
    const { pagination } = await listContentExplorer({ ...BASE_OPTS, page: 1, limit: 20 }, exec);
    expect(pagination).toEqual({ page: 1, limit: 20, total: 45, totalPages: 3 });
  });

  it("keeps an exact multiple at the exact page count", async () => {
    const { exec } = capturingExecutor([[{ count: 40 }], []]);
    const { pagination } = await listContentExplorer({ ...BASE_OPTS, page: 1, limit: 20 }, exec);
    expect(pagination.totalPages).toBe(2);
  });

  it("computes the SQL offset from the requested page and limit", async () => {
    const { exec, queries } = capturingExecutor([[{ count: 100 }], []]);
    const { pagination } = await listContentExplorer({ ...BASE_OPTS, page: 3, limit: 20 }, exec);
    expect(pagination).toEqual({ page: 3, limit: 20, total: 100, totalPages: 5 });
    expect(queries[1]!.params.slice(-2)).toEqual([20, 40]);
  });

  it("coerces a missing/non-numeric count row to a zero total", async () => {
    const { exec } = capturingExecutor([[], []]);
    const { pagination } = await listContentExplorer(BASE_OPTS, exec);
    expect(pagination.total).toBe(0);
    expect(pagination.totalPages).toBe(1);
  });
});

describe("listContentExplorer — row → item mapping", () => {
  it("maps the joined author and primary category onto nested objects", async () => {
    const { exec } = capturingExecutor([
      [{ count: 1 }],
      [
        explorerRow({
          author_id: "au1",
          author_name: "Jane Doe",
          author_slug: "jane-doe",
          author_avatar_url: "https://cdn/x.png",
          author_role: "Editor",
          category_id: "ca1",
          category_name: "Museums",
          category_slug: "museums",
        }),
      ],
    ]);
    const { items } = await listContentExplorer(BASE_OPTS, exec);
    expect(items[0]?.author).toEqual({
      id: "au1",
      name: "Jane Doe",
      slug: "jane-doe",
      avatarUrl: "https://cdn/x.png",
      role: "Editor",
    });
    expect(items[0]?.primaryCategory).toEqual({ id: "ca1", name: "Museums", slug: "museums" });
  });

  it("leaves author and primaryCategory null when the joins miss", async () => {
    const { exec } = capturingExecutor([[{ count: 1 }], [explorerRow()]]);
    const { items } = await listContentExplorer(BASE_OPTS, exec);
    expect(items[0]?.author).toBeNull();
    expect(items[0]?.primaryCategory).toBeNull();
  });

  it("normalizes Date and string timestamps to ISO strings, leaving nulls null", async () => {
    const { exec } = capturingExecutor([
      [{ count: 1 }],
      [
        explorerRow({
          modified_at: new Date("2026-01-02T03:04:05.000Z"),
          published_at: "2026-02-03T04:05:06.000Z",
          updated_at: null,
        }),
      ],
    ]);
    const { items } = await listContentExplorer(BASE_OPTS, exec);
    expect(items[0]?.modifiedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(items[0]?.publishedAt).toBe("2026-02-03T04:05:06.000Z");
    expect(items[0]?.updatedAt).toBeNull();
  });

  it("coerces the SEO score and a null validation score correctly", async () => {
    const { exec } = capturingExecutor([
      [{ count: 1 }],
      [explorerRow({ seo_score: 80, validation_score: null, validation_status: null })],
    ]);
    const { items } = await listContentExplorer(BASE_OPTS, exec);
    expect(items[0]?.seoScore).toBe(80);
    expect(items[0]?.validationScore).toBeNull();
    expect(items[0]?.validationStatus).toBeNull();
  });
});

/**
 * A `fakeExecutor` that also records how many `.execute` calls it received, so a
 * test can assert the empty-selection short-circuit never touches the DB.
 */
function countingExecutor(resultSets: unknown[][]): {
  exec: Executor;
  calls: () => number;
} {
  let call = 0;
  return {
    exec: {
      execute: async () => ({ rows: resultSets[call++] ?? [] }),
    } as unknown as Executor,
    calls: () => call,
  };
}

describe("buildContentExport — selection ordering & filtering", () => {
  it("preserves the caller's selection order, not the DB's order", async () => {
    // DB returns rows in updated-desc order (p2, p3, p1); caller asked for
    // p1, p2, p3 — the export must follow the caller's order.
    const exec = fakeExecutor([
      [{ count: 3 }],
      [
        explorerRow({ id: "p2", title: "Post Two" }),
        explorerRow({ id: "p3", title: "Post Three" }),
        explorerRow({ id: "p1", title: "Post One" }),
      ],
    ]);
    const env = await buildContentExport(["p1", "p2", "p3"], "json", exec);
    const parsed = JSON.parse(env.content) as { items: { id: string }[] };
    expect(parsed.items.map((i) => i.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("silently drops ids the explorer query did not return (non-post / missing)", async () => {
    // Only p1 and p3 come back from the DB; p2 (e.g. a non-post or deleted id)
    // and pX (never existed) are dropped without erroring.
    const exec = fakeExecutor([
      [{ count: 2 }],
      [
        explorerRow({ id: "p1", title: "Post One" }),
        explorerRow({ id: "p3", title: "Post Three" }),
      ],
    ]);
    const env = await buildContentExport(["p1", "p2", "p3", "pX"], "json", exec);
    const parsed = JSON.parse(env.content) as { items: { id: string }[] };
    expect(parsed.items.map((i) => i.id)).toEqual(["p1", "p3"]);
  });

  it("returns an empty export without querying when the id list is empty", async () => {
    const { exec, calls } = countingExecutor([]);
    const env = await buildContentExport([], "json", exec);
    expect(calls()).toBe(0);
    const parsed = JSON.parse(env.content) as { items: unknown[] };
    expect(parsed.items).toEqual([]);
  });

  it("returns an empty CSV (header only) without querying when the id list is empty", async () => {
    const { exec, calls } = countingExecutor([]);
    const env = await buildContentExport([], "csv", exec);
    expect(calls()).toBe(0);
    // Header row only, no data rows.
    expect(env.content.split("\n")).toHaveLength(1);
    expect(env.content).toMatch(/^id,title,slug,/);
  });
});

describe("buildContentExport — JSON envelope", () => {
  it("returns a {filename, contentType, content} envelope with today's date", async () => {
    const exec = fakeExecutor([[{ count: 1 }], [explorerRow({ id: "p1" })]]);
    const env = await buildContentExport(["p1"], "json", exec);
    expect(env.contentType).toBe("application/json");
    expect(env.filename).toMatch(/^content-export-\d{4}-\d{2}-\d{2}\.json$/);
    const parsed = JSON.parse(env.content) as {
      exportedAt: string;
      items: { id: string }[];
    };
    expect(typeof parsed.exportedAt).toBe("string");
    expect(parsed.items.map((i) => i.id)).toEqual(["p1"]);
  });

  it("defaults to the json format when no format is given", async () => {
    const exec = fakeExecutor([[{ count: 1 }], [explorerRow({ id: "p1" })]]);
    const env = await buildContentExport(["p1"], undefined, exec);
    expect(env.contentType).toBe("application/json");
    expect(env.filename.endsWith(".json")).toBe(true);
  });
});

describe("buildContentExport — CSV envelope & escaping", () => {
  it("returns a {filename, contentType, content} CSV envelope", async () => {
    const exec = fakeExecutor([
      [{ count: 1 }],
      [
        explorerRow({
          id: "p1",
          title: "A Post",
          slug: "a-post",
          canonical_url: "https://www.headout.com/blog/a-post/",
          status: "published",
          seo_score: 60,
          validation_score: 80,
          validation_status: "warn",
        }),
      ],
    ]);
    const env = await buildContentExport(["p1"], "csv", exec);
    expect(env.contentType).toBe("text/csv");
    expect(env.filename).toMatch(/^content-export-\d{4}-\d{2}-\d{2}\.csv$/);
    const [header, row] = env.content.split("\n");
    expect(header).toBe(
      "id,title,slug,url,author,category,status,modifiedAt,publishedAt,seoScore,validationScore,validationStatus",
    );
    expect(row).toBe(
      "p1,A Post,a-post,https://www.headout.com/blog/a-post/,,,published,,,60,80,warn",
    );
  });

  it("quotes and escapes cells containing commas, quotes, and newlines", async () => {
    const exec = fakeExecutor([
      [{ count: 1 }],
      [
        explorerRow({
          id: "p1",
          title: 'Hello, "World"\nNext line',
          slug: "tricky",
          canonical_url: "https://www.headout.com/blog/tricky/",
          author_id: "a1",
          author_name: "Doe, Jane",
          status: "published",
          seo_score: 0,
        }),
      ],
    ]);
    const env = await buildContentExport(["p1"], "csv", exec);
    // The whole CSV (after the header line) — the embedded newline lives inside
    // a quoted cell, so splitting on "\n" is not safe; assert on substrings.
    expect(env.content).toContain('"Hello, ""World""\nNext line"');
    expect(env.content).toContain('"Doe, Jane"');
  });

  it("renders nulls as empty cells and stringifies numeric scores", async () => {
    const exec = fakeExecutor([
      [{ count: 1 }],
      [
        explorerRow({
          id: "p1",
          title: "Plain",
          slug: "plain",
          canonical_url: "https://www.headout.com/blog/plain/",
          status: "draft",
          modified_at: null,
          published_at: null,
          seo_score: 40,
          validation_score: null,
          validation_status: null,
        }),
      ],
    ]);
    const env = await buildContentExport(["p1"], "csv", exec);
    const row = env.content.split("\n")[1];
    // ...,status,modifiedAt(empty),publishedAt(empty),seoScore,validationScore(empty),validationStatus(empty)
    expect(row).toBe(
      "p1,Plain,plain,https://www.headout.com/blog/plain/,,,draft,,,40,,",
    );
  });
});
