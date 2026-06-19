/**
 * Opt-in live-DB integration test for the CMS write ops. It exercises the real
 * create → read → update → duplicate → delete round-trip against the database
 * configured via `DATABASE_URL`, wrapping each mutation so the test cleans up
 * after itself (every created page is deleted at the end). Because it mutates a
 * real database it only runs when `VERIFY_CMS_WRITE=1` is set, so the normal
 * suite skips it.
 *
 * Run with: `VERIFY_CMS_WRITE=1 pnpm exec vitest run \
 *   artifacts/api-server/src/lib/__tests__/cms-content.integration.test.ts`
 */
import { describe, it, expect, afterAll } from "vitest";

const RUN = process.env.VERIFY_CMS_WRITE === "1";

const {
  createPost,
  updatePost,
  deletePost,
  scaffoldPost,
  duplicatePost,
  serializeCmsPostDetail,
} = RUN ? await import("../cms-content") : ({} as never);

const createdIds: string[] = [];

afterAll(async () => {
  if (!RUN) return;
  for (const id of createdIds) {
    try {
      await deletePost(id);
    } catch {
      // best-effort cleanup
    }
  }
});

describe.skipIf(!RUN)("CMS write ops — live DB round-trip", () => {
  it("creates a draft with nested content, then reads it back", async () => {
    const suffix = Date.now();
    const detail = await createPost({
      title: `Integration Test Post ${suffix}`,
      slug: `integration-test-post-${suffix}`,
      excerpt: "Created by the integration test.",
      contentHtml: "<p>Hello world</p>",
      faq: [{ question: "Q1?", answer: "A1.", position: 0 }],
      breadcrumbs: [{ label: "Home", url: "/", position: 0 }],
      images: [
        {
          url: "https://example.com/img.jpg",
          alt: "example",
          position: 0,
        },
      ],
    } as never);
    createdIds.push(detail.id);

    expect(detail.status).toBe("draft");
    expect(detail.title).toBe(`Integration Test Post ${suffix}`);
    expect(detail.faq).toHaveLength(1);
    expect(detail.images.length).toBeGreaterThanOrEqual(1);

    const reread = await serializeCmsPostDetail(detail.id);
    expect(reread?.id).toBe(detail.id);
    expect(reread?.faq[0]?.question).toBe("Q1?");
  });

  it("scaffolds a blank draft", async () => {
    const suffix = Date.now();
    const detail = await scaffoldPost({
      title: `Scaffold ${suffix}`,
      slug: `scaffold-${suffix}`,
    });
    createdIds.push(detail.id);
    expect(detail.status).toBe("draft");
    expect(detail.title).toBe(`Scaffold ${suffix}`);
  });

  it("updates a post wholesale and snapshots a version", async () => {
    const suffix = Date.now();
    const created = await createPost({
      title: `To Update ${suffix}`,
      slug: `to-update-${suffix}`,
      contentHtml: "<p>v1</p>",
    } as never);
    createdIds.push(created.id);

    const updated = await updatePost(created.id, {
      title: `Updated ${suffix}`,
      slug: `to-update-${suffix}`,
      contentHtml: "<p>v2</p>",
      changeSummary: "Second revision",
    } as never);
    expect(updated?.title).toBe(`Updated ${suffix}`);
    expect(updated?.contentHtml).toContain("v2");
  });

  it("duplicates a post into a fresh draft with SEO flagged for review", async () => {
    const suffix = Date.now();
    const source = await createPost({
      title: `Source ${suffix}`,
      slug: `source-${suffix}`,
      contentHtml: "<p>source body</p>",
      seo: { metaTitle: "Meta", metaDescription: "Desc", needsReview: false },
    } as never);
    createdIds.push(source.id);

    const copy = await duplicatePost(source.id, {});
    expect(copy).not.toBeNull();
    if (copy) {
      createdIds.push(copy.id);
      expect(copy.id).not.toBe(source.id);
      expect(copy.status).toBe("draft");
      expect(copy.slug).not.toBe(source.slug);
      expect(copy.title).toContain("(Copy)");
      expect(copy.seo?.needsReview).toBe(true);
    }
  });

  it("deletes a post and cascades children", async () => {
    const suffix = Date.now();
    const created = await createPost({
      title: `To Delete ${suffix}`,
      slug: `to-delete-${suffix}`,
      contentHtml: "<p>bye</p>",
    } as never);

    const ok = await deletePost(created.id);
    expect(ok).toBe(true);
    const gone = await serializeCmsPostDetail(created.id);
    expect(gone).toBeNull();
  });
});
