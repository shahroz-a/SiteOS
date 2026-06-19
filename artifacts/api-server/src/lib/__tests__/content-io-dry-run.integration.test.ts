/**
 * Opt-in live-DB integration test guarding the import dry-run preview.
 *
 * It proves the two contracts an operator relies on when trusting a preview:
 *   1. The summary returned by a `dryRun: true` import is identical to the
 *      summary a subsequent real (`dryRun: false`) import of the same bundle
 *      produces — counts the operator sees in the preview are the counts the
 *      real import yields.
 *   2. A dry run persists NOTHING: every relevant table's row count is
 *      unchanged across the dry run.
 *
 * It walks the create / unchanged / update code paths in order, using a unique
 * canonical-URL/slug prefix so it never collides with the existing corpus, and
 * cleans up everything it created at the end (pages cascade to children; the
 * author/category/tag rows are deleted by slug).
 *
 * Because it writes to a real database it only runs when
 * `VERIFY_IMPORT_PREVIEW=1` is set, so the normal suite skips it.
 *
 * Run with: `VERIFY_IMPORT_PREVIEW=1 pnpm exec vitest run \
 *   artifacts/api-server/src/lib/__tests__/content-io-dry-run.integration.test.ts`
 */
import { describe, it, expect, afterAll } from "vitest";
import { count, eq, inArray } from "drizzle-orm";
import {
  db,
  pagesTable,
  pageVersionsTable,
  pageCategoriesTable,
  pageTagsTable,
  blocksTable,
  componentTreeTable,
  imagesTable,
  faqTable,
  breadcrumbsTable,
  jsonldTable,
  seoTable,
  metadataTable,
  internalLinksTable,
  externalLinksTable,
  authorsTable,
  categoriesTable,
  tagsTable,
} from "@workspace/db";
import { withCounts, type ContentBundle } from "@workspace/content-io";

const RUN = process.env.VERIFY_IMPORT_PREVIEW === "1";

const { importContentBundle } = RUN
  ? await import("../content-io")
  : ({} as never);

// A unique prefix so this run never touches the existing corpus.
const SUFFIX = Date.now();
const AUTHOR_SLUG = `dryrun-author-${SUFFIX}`;
const CATEGORY_SLUG = `dryrun-category-${SUFFIX}`;
const SUBCATEGORY_SLUG = `dryrun-subcategory-${SUFFIX}`;
const TAG_SLUG = `dryrun-tag-${SUFFIX}`;
const POST_SLUGS = [`dryrun-post-a-${SUFFIX}`, `dryrun-post-b-${SUFFIX}`];
const POST_CANONICALS = POST_SLUGS.map((s) => `https://dryrun.test/${s}`);

/**
 * Build the bundle. `variant` changes the title/body so the per-post content
 * hash differs, exercising the update path on re-import.
 */
function makeBundle(variant: "v1" | "v2"): ContentBundle {
  return withCounts({
    bundleVersion: "1",
    exportedAt: "2026-01-01T00:00:00.000Z",
    source: "dry-run-integration-test",
    authors: [
      {
        name: `Dry Run Author ${SUFFIX}`,
        slug: AUTHOR_SLUG,
        bio: "Author created by the dry-run integration test.",
        avatarUrl: null,
        role: "Writer",
        email: null,
        social: null,
      },
    ],
    categories: [
      {
        name: `Dry Run Category ${SUFFIX}`,
        slug: CATEGORY_SLUG,
        description: null,
        parentSlug: null,
      },
      {
        name: `Dry Run Subcategory ${SUFFIX}`,
        slug: SUBCATEGORY_SLUG,
        description: null,
        parentSlug: CATEGORY_SLUG,
      },
    ],
    tags: [{ name: `Dry Run Tag ${SUFFIX}`, slug: TAG_SLUG, description: null }],
    posts: POST_SLUGS.map((slug, i) => ({
      slug,
      title: `${variant === "v1" ? "Original" : "Updated"} Post ${i} ${SUFFIX}`,
      subtitle: null,
      excerpt: "Excerpt.",
      status: "published",
      language: "en",
      canonicalUrl: POST_CANONICALS[i]!,
      originalUrl: POST_CANONICALS[i]!,
      pathname: `/${slug}`,
      parentPath: "/",
      authorSlug: AUTHOR_SLUG,
      primaryCategorySlug: CATEGORY_SLUG,
      categorySlugs: [CATEGORY_SLUG, SUBCATEGORY_SLUG],
      tagSlugs: [TAG_SLUG],
      featuredImageUrl: "https://dryrun.test/hero.jpg",
      featuredImageAlt: "Hero",
      contentHtml:
        variant === "v1"
          ? `<p>Body ${i} version one</p>`
          : `<p>Body ${i} version two — changed</p>`,
      richText: null,
      componentTree: {
        type: "root",
        children: [
          {
            blockType: "paragraph",
            text: variant === "v1" ? `Body ${i} v1` : `Body ${i} v2`,
          },
        ],
      },
      readingTimeMinutes: 2,
      wordCount: 50,
      publishedAt: "2025-12-01T00:00:00.000Z",
      modifiedAt: "2025-12-02T00:00:00.000Z",
      seo: {
        metaTitle: `Meta ${i}`,
        metaDescription: "Desc",
        canonicalUrl: POST_CANONICALS[i]!,
        robots: "index,follow",
        focusKeyword: null,
        keywords: null,
        ogTitle: null,
        ogDescription: null,
        ogImage: null,
        ogType: "article",
        twitterCard: null,
        twitterTitle: null,
        twitterDescription: null,
        twitterImage: null,
      },
      breadcrumbs: [{ label: "Home", url: "/", position: 0 }],
      faq: [{ question: `Q${i}?`, answer: "A.", position: 0 }],
      jsonld: [
        { type: "Article", data: { "@type": "Article" }, position: 0 },
      ],
      images: [
        {
          originalUrl: "https://dryrun.test/hero.jpg",
          url: "https://dryrun.test/hero.jpg",
          alt: "Hero",
          title: null,
          caption: null,
          credit: null,
          width: 1200,
          height: 630,
          mimeType: "image/jpeg",
          fileSize: null,
          role: "featured",
          position: 0,
        },
      ],
      links: {
        internal: [],
        external: [
          {
            href: "https://example.com",
            anchorText: "Example",
            rel: "nofollow",
            domain: "example.com",
            position: 0,
          },
        ],
      },
      metadata: null,
    })),
  });
}

// Every table the importer writes to. A dry run must leave all of these
// unchanged; a real create must grow pages/versions/children.
const TRACKED_TABLES = {
  pages: pagesTable,
  pageVersions: pageVersionsTable,
  pageCategories: pageCategoriesTable,
  pageTags: pageTagsTable,
  blocks: blocksTable,
  componentTree: componentTreeTable,
  images: imagesTable,
  faq: faqTable,
  breadcrumbs: breadcrumbsTable,
  jsonld: jsonldTable,
  seo: seoTable,
  metadata: metadataTable,
  internalLinks: internalLinksTable,
  externalLinks: externalLinksTable,
  authors: authorsTable,
  categories: categoriesTable,
  tags: tagsTable,
} as const;

type Counts = Record<keyof typeof TRACKED_TABLES, number>;

async function snapshotCounts(): Promise<Counts> {
  const keys = Object.keys(TRACKED_TABLES) as (keyof typeof TRACKED_TABLES)[];
  const values = await Promise.all(
    keys.map(async (key) => {
      const [row] = await db.select({ c: count() }).from(TRACKED_TABLES[key]);
      return Number(row?.c ?? 0);
    }),
  );
  const out = {} as Counts;
  keys.forEach((key, i) => {
    out[key] = values[i]!;
  });
  return out;
}

// The importer runs resolveInternalLinks (a full corpus scan) on every call, so
// against a large live DB each phase needs well over the 5s default.
const PHASE_TIMEOUT = 120_000;

afterAll(async () => {
  if (!RUN) return;
  try {
    // Pages cascade to all children (seo/images/faq/links/blocks/etc.).
    await db.delete(pagesTable).where(inArray(pagesTable.canonicalUrl, POST_CANONICALS));
    await db.delete(tagsTable).where(eq(tagsTable.slug, TAG_SLUG));
    await db
      .delete(categoriesTable)
      .where(inArray(categoriesTable.slug, [SUBCATEGORY_SLUG, CATEGORY_SLUG]));
    await db.delete(authorsTable).where(eq(authorsTable.slug, AUTHOR_SLUG));
  } catch {
    // best-effort cleanup
  }
});

describe.skipIf(!RUN)("import dry-run preview ↔ real import parity (live DB)", () => {
  it("create path: preview matches the real import and persists nothing", async () => {
    const bundle = makeBundle("v1");

    const before = await snapshotCounts();
    const preview = await importContentBundle(bundle, { dryRun: true });
    const afterDryRun = await snapshotCounts();

    // (2) A dry run persists nothing.
    expect(afterDryRun).toEqual(before);

    const real = await importContentBundle(bundle, { dryRun: false });

    // (1) Preview summary is identical to the real import summary.
    expect(preview).toEqual(real);

    // The summary describes a genuine create.
    expect(real.postsCreated).toBe(POST_SLUGS.length);
    expect(real.postsUpdated).toBe(0);
    expect(real.postsUnchanged).toBe(0);
    expect(real.authorsUpserted).toBe(1);
    expect(real.categoriesUpserted).toBe(2);
    expect(real.tagsUpserted).toBe(1);

    // The real import actually wrote the expected rows.
    const afterReal = await snapshotCounts();
    expect(afterReal.pages - before.pages).toBe(POST_SLUGS.length);
    expect(afterReal.pageVersions - before.pageVersions).toBe(POST_SLUGS.length);
    expect(afterReal.authors - before.authors).toBe(1);
    expect(afterReal.categories - before.categories).toBe(2);
    expect(afterReal.tags - before.tags).toBe(1);
    expect(afterReal.seo - before.seo).toBe(POST_SLUGS.length);
  }, PHASE_TIMEOUT);

  it("unchanged path: preview matches the real import and persists nothing", async () => {
    // Re-import the identical bundle: same content hash → unchanged.
    const bundle = makeBundle("v1");

    const before = await snapshotCounts();
    const preview = await importContentBundle(bundle, { dryRun: true });
    const afterDryRun = await snapshotCounts();

    expect(afterDryRun).toEqual(before);

    const real = await importContentBundle(bundle, { dryRun: false });

    expect(preview).toEqual(real);
    expect(real.postsUnchanged).toBe(POST_SLUGS.length);
    expect(real.postsCreated).toBe(0);
    expect(real.postsUpdated).toBe(0);

    // An unchanged re-import writes no new rows (it only refreshes page fields,
    // never row counts; no version snapshot).
    const afterReal = await snapshotCounts();
    expect(afterReal).toEqual(before);
  }, PHASE_TIMEOUT);

  it("update path: preview matches the real import and persists nothing", async () => {
    // Changed content → update path (children rewritten, new version snapshot).
    const bundle = makeBundle("v2");

    const before = await snapshotCounts();
    const preview = await importContentBundle(bundle, { dryRun: true });
    const afterDryRun = await snapshotCounts();

    expect(afterDryRun).toEqual(before);

    const real = await importContentBundle(bundle, { dryRun: false });

    expect(preview).toEqual(real);
    expect(real.postsUpdated).toBe(POST_SLUGS.length);
    expect(real.postsCreated).toBe(0);
    expect(real.postsUnchanged).toBe(0);

    // An update snapshots one new version per post (and rewrites children, which
    // are identical in shape here, so other counts are stable).
    const afterReal = await snapshotCounts();
    expect(afterReal.pageVersions - before.pageVersions).toBe(POST_SLUGS.length);
    expect(afterReal.pages).toBe(before.pages);
  }, PHASE_TIMEOUT);
});
