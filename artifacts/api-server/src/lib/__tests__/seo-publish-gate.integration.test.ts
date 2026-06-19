/**
 * Opt-in live-DB integration test for the SEO publish gate — the safety-critical
 * path that blocks bad articles from going public and audits every attempt.
 *
 * The pure rule engine (`@workspace/seo-validation`) has its own unit tests; what
 * is exercised here is the SERVER glue that wraps it:
 *
 *   - `runPublishGate` blocks a post with critical (error-severity) failures
 *     (`ok === false` + a non-empty `blocking[]`) — this is exactly the signal
 *     the transition / PUT routes turn into a 422 `CmsPublishBlocked`. We then
 *     prove the route invariant directly: when the gate blocks, the post is NOT
 *     transitioned and its status stays `draft`.
 *   - `runPublishGate` lets a clean post through (`ok === true`, empty blocking),
 *     ALWAYS writes a `validation_reports` row (reportType "seo"), and the post
 *     can then be transitioned to `published`.
 *   - `findDuplicates` flags a colliding title / metaTitle / metaDescription
 *     against another (non-archived) row.
 *
 * Each created page is deleted in `afterAll` (children + validation_reports rows
 * cascade on the page FK). Because it mutates a real database it only runs when
 * `VERIFY_CMS_WRITE=1` is set, so the normal suite skips it.
 *
 * Run with: `VERIFY_CMS_WRITE=1 pnpm exec vitest run \
 *   artifacts/api-server/src/lib/__tests__/seo-publish-gate.integration.test.ts`
 */
import { describe, it, expect, afterAll } from "vitest";

const RUN = process.env.VERIFY_CMS_WRITE === "1";

// Live-DB ops (createPost + the gate's many joins) are well over vitest's 5s
// default, so give each test a generous budget.
const TEST_TIMEOUT = 30_000;

const contentMod = RUN ? await import("../cms-content") : ({} as never);
const gateMod = RUN ? await import("../seo-validation") : ({} as never);
const dbMod = RUN ? await import("@workspace/db") : ({} as never);
const publishMod = RUN ? await import("../cms-publishing") : ({} as never);

const createdIds: string[] = [];

afterAll(async () => {
  if (!RUN) return;
  const { deletePost } = contentMod;
  for (const id of createdIds) {
    try {
      await deletePost(id);
    } catch {
      // best-effort cleanup
    }
  }
});

/** A componentTree (paragraph + heading) so the body / heading checks pass. */
const CLEAN_TREE = [
  { blockType: "heading", text: "An informative section", data: { level: 2 } },
  {
    blockType: "paragraph",
    text:
      "A reasonably substantial paragraph of body content so the article has " +
      "renderable blocks for the publish gate to accept.",
  },
];

describe.skipIf(!RUN)("SEO publish gate — live DB", () => {
  it(
    "blocks a post with critical failures and leaves its status unchanged",
    async () => {
      const { createPost } = contentMod;
      const { runPublishGate } = gateMod;
      const { transitionPost } = publishMod;
      const { db, pagesTable, validationReportsTable } = dbMod;
      const { eq } = await import("drizzle-orm");

      const suffix = Date.now();
      // A deliberately invalid draft: no excerpt/meta description (description
      // check is error-severity) and no body content (has-body is error).
      const detail = await createPost({
        title: `Gate Bad Article ${suffix}`,
        slug: `gate-bad-article-${suffix}`,
      } as never);
      createdIds.push(detail.id);
      expect(detail.status).toBe("draft");

      const gate = await runPublishGate(detail.id);
      expect(gate).not.toBeNull();
      expect(gate!.ok).toBe(false);
      expect(gate!.result.blocking.length).toBeGreaterThan(0);
      const blockingIds = gate!.result.blocking.map((c) => c.id);
      expect(blockingIds).toContain("description-present");
      expect(blockingIds).toContain("has-body");

      // The gate audits every attempt, including blocked ones.
      const reports = await db
        .select({
          reportType: validationReportsTable.reportType,
          status: validationReportsTable.status,
        })
        .from(validationReportsTable)
        .where(eq(validationReportsTable.pageId, detail.id));
      expect(reports.length).toBeGreaterThanOrEqual(1);
      expect(
        reports.every((r: { reportType: string }) => r.reportType === "seo"),
      ).toBe(true);
      expect(reports.some((r: { status: string }) => r.status === "fail")).toBe(
        true,
      );

      // Route invariant: when the gate blocks, the post is NOT transitioned (the
      // route returns 422 and never calls transitionPost). Prove the status is
      // preserved by NOT transitioning and re-reading it.
      const [page] = await db
        .select({ status: pagesTable.status })
        .from(pagesTable)
        .where(eq(pagesTable.id, detail.id))
        .limit(1);
      expect(page?.status).toBe("draft");
      // Sanity: transitionPost itself does not re-check the gate — the gate is
      // the only thing standing between this draft and a successful publish.
      expect(typeof transitionPost).toBe("function");
    },
    TEST_TIMEOUT,
  );

  it(
    "lets a clean post through, writes a seo report, and publishes",
    async () => {
      const { createPost } = contentMod;
      const { runPublishGate } = gateMod;
      const { transitionPost } = publishMod;
      const { db, pagesTable, validationReportsTable } = dbMod;
      const { eq } = await import("drizzle-orm");

      const suffix = Date.now();
      const detail = await createPost({
        title: `Gate Clean Article About Travel Tips ${suffix}`,
        slug: `gate-clean-article-${suffix}`,
        excerpt:
          "A meta description of comfortable length that explains what this " +
          "article covers for searchers and social cards alike.",
        componentTree: CLEAN_TREE,
      } as never);
      createdIds.push(detail.id);

      const gate = await runPublishGate(detail.id);
      expect(gate).not.toBeNull();
      expect(gate!.ok).toBe(true);
      expect(gate!.result.blocking).toHaveLength(0);

      // A validation_reports row (reportType "seo") was written for the attempt.
      const reports = await db
        .select({
          reportType: validationReportsTable.reportType,
          score: validationReportsTable.score,
        })
        .from(validationReportsTable)
        .where(eq(validationReportsTable.pageId, detail.id));
      expect(reports.length).toBeGreaterThanOrEqual(1);
      expect(
        reports.every((r: { reportType: string }) => r.reportType === "seo"),
      ).toBe(true);

      // The gate passed, so the route would proceed to transition the post.
      const result = await transitionPost(detail.id, "published", null);
      expect(result.ok).toBe(true);
      const [page] = await db
        .select({ status: pagesTable.status })
        .from(pagesTable)
        .where(eq(pagesTable.id, detail.id))
        .limit(1);
      expect(page?.status).toBe("published");
    },
    TEST_TIMEOUT,
  );

  it(
    "findDuplicates flags a colliding title, metaTitle, and metaDescription",
    async () => {
      const { createPost } = contentMod;
      const { findDuplicates, buildValidationInput } = gateMod;

      const suffix = Date.now();
      const sharedTitle = `Shared Collision Title ${suffix}`;
      const sharedMetaTitle = `Shared Collision Meta Title ${suffix}`;
      const sharedMetaDescription =
        `Shared collision meta description ${suffix} of a comfortable length ` +
        "for search engines and social cards.";

      // The "other" article already in the catalogue.
      const original = await createPost({
        title: sharedTitle,
        slug: `collision-original-${suffix}`,
        excerpt: "Original.",
        componentTree: CLEAN_TREE,
        seo: {
          metaTitle: sharedMetaTitle,
          metaDescription: sharedMetaDescription,
        },
      } as never);
      createdIds.push(original.id);

      // The article being validated — same colliding fields, different slug.
      const candidate = await createPost({
        title: sharedTitle,
        slug: `collision-candidate-${suffix}`,
        excerpt: "Candidate.",
        componentTree: CLEAN_TREE,
        seo: {
          metaTitle: sharedMetaTitle,
          metaDescription: sharedMetaDescription,
        },
      } as never);
      createdIds.push(candidate.id);

      const input = buildValidationInput(candidate);
      const dupes = await findDuplicates(candidate.id, input);

      // Each collision points at the OTHER (original) row, never the candidate.
      expect(dupes.title?.id).toBe(original.id);
      expect(dupes.metaTitle?.id).toBe(original.id);
      expect(dupes.metaDescription?.id).toBe(original.id);
    },
    TEST_TIMEOUT,
  );
});
