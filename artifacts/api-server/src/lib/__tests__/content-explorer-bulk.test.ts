import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeDbMock, makeDrizzleMock, type Tables } from "../../__tests__/fakeDb";

/**
 * Unit coverage for the content explorer's bulk article actions
 * (`bulkTransition`, `bulkSetCategory`, `bulkSetAuthor`, `bulkSetSeo`) against
 * the in-memory FakeDb harness. These exercise the subtle partial-success
 * semantics that are easy to break silently:
 *  - missing / non-post ids land in `failed` without affecting the valid ids,
 *  - per-id permission gating in `bulkTransition`,
 *  - target-not-found handling in `bulkSetCategory` / `bulkSetAuthor`,
 *  - `bulkSetSeo` writing only the provided fields and treating an empty patch
 *    as a no-op success.
 *
 * The bulk functions import `db` from `@workspace/db` directly (no injectable
 * executor), so we mock the module to the FakeDb and the drizzle operators to
 * the introspectable-AST mock.
 */

const CREATED = new Date("2025-01-01T00:00:00Z");

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const PUBLISHED_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_DRAFT_ID = "33333333-3333-4333-8333-333333333333";
const NON_POST_ID = "44444444-4444-4444-8444-444444444444";
const MISSING_ID = "55555555-5555-4555-8555-555555555555";

const CATEGORY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MISSING_CATEGORY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AUTHOR_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MISSING_AUTHOR_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function page(overrides: Record<string, unknown> = {}) {
  return {
    id: DRAFT_ID,
    slug: "a-draft",
    title: "A Draft",
    pathname: "/blog/a-draft/",
    canonicalUrl: "https://www.headout.com/blog/a-draft/",
    originalUrl: null,
    pageType: "post",
    status: "draft",
    scheduledFor: null,
    publishedAt: null,
    modifiedAt: null,
    authorId: null,
    primaryCategoryId: null,
    crawledAt: CREATED,
    ...overrides,
  };
}

function seed(): Tables {
  return {
    pages: [
      page(),
      page({
        id: PUBLISHED_ID,
        slug: "a-published",
        title: "A Published",
        pathname: "/blog/a-published/",
        canonicalUrl: "https://www.headout.com/blog/a-published/",
        status: "published",
        publishedAt: CREATED,
      }),
      page({
        id: SECOND_DRAFT_ID,
        slug: "second-draft",
        title: "Second Draft",
        pathname: "/blog/second-draft/",
        canonicalUrl: "https://www.headout.com/blog/second-draft/",
        status: "draft",
      }),
      // A non-post page (e.g. a category landing page) that must be rejected by
      // every bulk action since they operate on `post` pages only.
      page({
        id: NON_POST_ID,
        slug: "a-category",
        title: "A Category",
        pathname: "/blog/category/a-category/",
        canonicalUrl: "https://www.headout.com/blog/category/a-category/",
        pageType: "category",
        status: "published",
      }),
    ],
    categories: [
      { id: CATEGORY_ID, name: "Travel", slug: "travel" },
    ],
    authors: [
      { id: AUTHOR_ID, name: "Jane Doe", slug: "jane-doe", avatarUrl: null, role: null },
    ],
    seo: [],
  };
}

const tables: Tables = seed();

vi.mock("@workspace/db", () => makeDbMock(tables));
vi.mock("drizzle-orm", () => makeDrizzleMock());

const {
  bulkTransition,
  bulkSetCategory,
  bulkSetAuthor,
  bulkSetSeo,
} = await import("../content-explorer");

function reset() {
  const fresh = seed();
  for (const k of Object.keys(tables)) delete tables[k];
  for (const [k, v] of Object.entries(fresh)) tables[k] = v;
}

beforeEach(reset);

function pageById(id: string) {
  return tables.pages.find((p) => p.id === id);
}

describe("bulkTransition", () => {
  it("transitions every valid post and reports missing ids in failed", async () => {
    const result = await bulkTransition(
      [DRAFT_ID, SECOND_DRAFT_ID, MISSING_ID],
      "review",
      null,
      "editor",
    );
    expect(result.requested).toBe(3);
    expect(result.succeeded).toEqual([DRAFT_ID, SECOND_DRAFT_ID]);
    expect(result.failed).toEqual([{ id: MISSING_ID, error: "Post not found" }]);
    expect(pageById(DRAFT_ID)?.status).toBe("review");
    expect(pageById(SECOND_DRAFT_ID)?.status).toBe("review");
  });

  it("treats a non-post id as not found and leaves it untouched", async () => {
    const result = await bulkTransition([NON_POST_ID], "review", null, "editor");
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([{ id: NON_POST_ID, error: "Post not found" }]);
    expect(pageById(NON_POST_ID)?.status).toBe("published");
  });

  it("gates per id on the actor's role without affecting the others", async () => {
    // A writer holds content.edit (may submit for review) but NOT
    // content.publish, so the publish leg must fail for that id alone while the
    // editorial move on the other id still succeeds.
    const result = await bulkTransition(
      [DRAFT_ID, SECOND_DRAFT_ID],
      "published",
      null,
      "writer",
    );
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([
      { id: DRAFT_ID, error: "This transition requires content.publish" },
      { id: SECOND_DRAFT_ID, error: "This transition requires content.publish" },
    ]);
    expect(pageById(DRAFT_ID)?.status).toBe("draft");
  });

  it("gates per id within a single batch — some ids pass, others fail on permission", async () => {
    // One call mixing a leg the writer MAY do with one it may not: moving the
    // published post back to review needs content.publish (leaving published),
    // while the draft → review move needs only content.edit. The denied id must
    // fail without blocking the allowed id in the same batch.
    const result = await bulkTransition(
      [PUBLISHED_ID, DRAFT_ID],
      "review",
      null,
      "writer",
    );
    expect(result.requested).toBe(2);
    expect(result.succeeded).toEqual([DRAFT_ID]);
    expect(result.failed).toEqual([
      { id: PUBLISHED_ID, error: "This transition requires content.publish" },
    ]);
    expect(pageById(PUBLISHED_ID)?.status).toBe("published");
    expect(pageById(DRAFT_ID)?.status).toBe("review");
  });

  it("allows a writer to perform an edit-only transition (draft → review)", async () => {
    const result = await bulkTransition([DRAFT_ID], "review", null, "writer");
    expect(result.succeeded).toEqual([DRAFT_ID]);
    expect(result.failed).toEqual([]);
    expect(pageById(DRAFT_ID)?.status).toBe("review");
  });

  it("reports an invalid lifecycle transition without aborting valid ones", async () => {
    // published → scheduled is not a legal transition (publish gate aside), so
    // that id fails while a legal draft → scheduled with a future date succeeds.
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const result = await bulkTransition(
      [PUBLISHED_ID, DRAFT_ID],
      "scheduled",
      future,
      "editor",
    );
    expect(result.succeeded).toEqual([DRAFT_ID]);
    expect(result.failed).toEqual([
      { id: PUBLISHED_ID, error: "Cannot move to scheduled" },
    ]);
    expect(pageById(DRAFT_ID)?.status).toBe("scheduled");
  });

  it("reports a missing schedule date as a per-id failure", async () => {
    const result = await bulkTransition([DRAFT_ID], "scheduled", null, "editor");
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([
      { id: DRAFT_ID, error: "A future scheduledFor date is required to schedule" },
    ]);
  });
});

describe("bulkSetCategory", () => {
  it("sets the category on valid posts and reports missing ids", async () => {
    const result = await bulkSetCategory([DRAFT_ID, MISSING_ID], CATEGORY_ID);
    expect(result.requested).toBe(2);
    expect(result.succeeded).toEqual([DRAFT_ID]);
    expect(result.failed).toEqual([{ id: MISSING_ID, error: "Post not found" }]);
    expect(pageById(DRAFT_ID)?.primaryCategoryId).toBe(CATEGORY_ID);
  });

  it("clears the category when given null", async () => {
    tables.pages[0].primaryCategoryId = CATEGORY_ID;
    const result = await bulkSetCategory([DRAFT_ID], null);
    expect(result.succeeded).toEqual([DRAFT_ID]);
    expect(pageById(DRAFT_ID)?.primaryCategoryId).toBeNull();
  });

  it("fails every id when the target category does not exist", async () => {
    const result = await bulkSetCategory([DRAFT_ID, SECOND_DRAFT_ID], MISSING_CATEGORY_ID);
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([
      { id: DRAFT_ID, error: "Target category not found" },
      { id: SECOND_DRAFT_ID, error: "Target category not found" },
    ]);
    // No write happened — the post keeps its original (null) category.
    expect(pageById(DRAFT_ID)?.primaryCategoryId).toBeNull();
  });

  it("rejects a non-post id as not found", async () => {
    const result = await bulkSetCategory([NON_POST_ID], CATEGORY_ID);
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([{ id: NON_POST_ID, error: "Post not found" }]);
  });
});

describe("bulkSetAuthor", () => {
  it("sets the author on valid posts and reports missing ids", async () => {
    const result = await bulkSetAuthor([DRAFT_ID, MISSING_ID], AUTHOR_ID);
    expect(result.succeeded).toEqual([DRAFT_ID]);
    expect(result.failed).toEqual([{ id: MISSING_ID, error: "Post not found" }]);
    expect(pageById(DRAFT_ID)?.authorId).toBe(AUTHOR_ID);
  });

  it("clears the author when given null", async () => {
    tables.pages[0].authorId = AUTHOR_ID;
    const result = await bulkSetAuthor([DRAFT_ID], null);
    expect(result.succeeded).toEqual([DRAFT_ID]);
    expect(pageById(DRAFT_ID)?.authorId).toBeNull();
  });

  it("fails every id when the target author does not exist", async () => {
    const result = await bulkSetAuthor([DRAFT_ID], MISSING_AUTHOR_ID);
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([
      { id: DRAFT_ID, error: "Target author not found" },
    ]);
    expect(pageById(DRAFT_ID)?.authorId).toBeNull();
  });

  it("rejects a non-post id as not found", async () => {
    const result = await bulkSetAuthor([NON_POST_ID], AUTHOR_ID);
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([{ id: NON_POST_ID, error: "Post not found" }]);
  });
});

describe("bulkSetSeo", () => {
  it("creates a seo row writing only the provided fields", async () => {
    const result = await bulkSetSeo([DRAFT_ID], {
      metaTitle: "New title",
      focusKeyword: "paris",
    });
    expect(result.succeeded).toEqual([DRAFT_ID]);
    expect(result.failed).toEqual([]);
    const row = tables.seo.find((r) => r.pageId === DRAFT_ID);
    expect(row).toBeDefined();
    expect(row?.metaTitle).toBe("New title");
    expect(row?.focusKeyword).toBe("paris");
    // Omitted fields must not be written at all.
    expect("metaDescription" in (row ?? {})).toBe(false);
    expect("canonicalUrl" in (row ?? {})).toBe(false);
  });

  it("updates only the provided fields on an existing seo row, leaving others intact", async () => {
    tables.seo.push({
      pageId: DRAFT_ID,
      metaTitle: "Old title",
      metaDescription: "Keep me",
      focusKeyword: "old",
    });
    const result = await bulkSetSeo([DRAFT_ID], { metaTitle: "Updated title" });
    expect(result.succeeded).toEqual([DRAFT_ID]);
    const row = tables.seo.find((r) => r.pageId === DRAFT_ID);
    expect(row?.metaTitle).toBe("Updated title");
    // Untouched fields are preserved.
    expect(row?.metaDescription).toBe("Keep me");
    expect(row?.focusKeyword).toBe("old");
  });

  it("writes an empty string when a field is explicitly cleared", async () => {
    const result = await bulkSetSeo([DRAFT_ID], { metaDescription: "" });
    expect(result.succeeded).toEqual([DRAFT_ID]);
    const row = tables.seo.find((r) => r.pageId === DRAFT_ID);
    expect(row?.metaDescription).toBe("");
  });

  it("treats an empty patch as a no-op success and writes nothing", async () => {
    const result = await bulkSetSeo([DRAFT_ID, SECOND_DRAFT_ID], {});
    expect(result.succeeded).toEqual([DRAFT_ID, SECOND_DRAFT_ID]);
    expect(result.failed).toEqual([]);
    expect(tables.seo).toHaveLength(0);
  });

  it("reports missing and non-post ids in failed while updating valid ones", async () => {
    const result = await bulkSetSeo([DRAFT_ID, MISSING_ID, NON_POST_ID], {
      metaTitle: "T",
    });
    expect(result.succeeded).toEqual([DRAFT_ID]);
    expect(result.failed).toEqual([
      { id: MISSING_ID, error: "Post not found" },
      { id: NON_POST_ID, error: "Post not found" },
    ]);
  });
});
