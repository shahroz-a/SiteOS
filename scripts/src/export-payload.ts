/**
 * Export the migrated content into Payload CMS collection documents.
 *
 * Reads every page (and its related author, categories, tags, media, SEO,
 * breadcrumbs, FAQ and structured data) from the migration database and
 * serializes it into a single JSON file shaped as Payload collections.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run export:payload
 *   pnpm --filter @workspace/scripts run export:payload -- --out ./custom.json
 *
 * The output (default `scripts/out/payload-export.json`) can be loaded into a
 * Payload instance with the example loader documented in
 * `scripts/src/payload/README.md`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  db,
  pool,
  pagesTable,
  authorsTable,
  categoriesTable,
  tagsTable,
  pageTagsTable,
  pageCategoriesTable,
  breadcrumbsTable,
  faqTable,
  imagesTable,
  jsonldTable,
  seoTable,
} from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import {
  mapAuthor,
  mapCategory,
  mapImage,
  mapPost,
  mapTag,
  type PayloadExport,
  type SourcePageBundle,
} from "./payload/mapping.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

function parseOutPath(argv: string[]): string {
  const idx = argv.indexOf("--out");
  if (idx !== -1 && argv[idx + 1]) return resolve(process.cwd(), argv[idx + 1]!);
  // Anchor the default to the package (scripts/out) regardless of cwd.
  return resolve(SCRIPT_DIR, "../out/payload-export.json");
}

async function buildExport(): Promise<PayloadExport> {
  const [authors, categories, tags, pages, images] = await Promise.all([
    db.select().from(authorsTable),
    db.select().from(categoriesTable),
    db.select().from(tagsTable),
    db.select().from(pagesTable).orderBy(asc(pagesTable.publishedAt)),
    db.select().from(imagesTable).orderBy(asc(imagesTable.position)),
  ]);

  // Group images by page so we can pick a hero image and emit media docs.
  const imagesByPage = new Map<string, typeof images>();
  for (const img of images) {
    if (!img.pageId) continue;
    const list = imagesByPage.get(img.pageId) ?? [];
    list.push(img);
    imagesByPage.set(img.pageId, list);
  }

  // Media collection: every stored image becomes a media document.
  const mediaDocs = images.map((img) => mapImage(img));

  // Authors: map an avatar to a media doc only if one exists with that URL.
  const mediaByUrl = new Map(mediaDocs.map((m) => [m.url, m.id]));
  const authorDocs = authors.map((a) =>
    mapAuthor(
      {
        id: a.id,
        name: a.name,
        slug: a.slug,
        bio: a.bio,
        avatarUrl: a.avatarUrl,
        role: a.role,
        email: a.email,
        social: a.social ?? null,
      },
      a.avatarUrl ? (mediaByUrl.get(a.avatarUrl) ?? null) : null,
    ),
  );

  const categoryDocs = categories.map((c) =>
    mapCategory({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      parentId: c.parentId,
    }),
  );

  const tagDocs = tags.map((t) =>
    mapTag({
      id: t.id,
      name: t.name,
      slug: t.slug,
      description: t.description,
    }),
  );

  // Posts: load per-page relations and structured content.
  const postDocs = [];
  for (const page of pages) {
    const [pageCats, pageTags, crumbs, faqRows, jsonldRows, seoRows] =
      await Promise.all([
        db
          .select({ categoryId: pageCategoriesTable.categoryId })
          .from(pageCategoriesTable)
          .where(eq(pageCategoriesTable.pageId, page.id)),
        db
          .select({ tagId: pageTagsTable.tagId })
          .from(pageTagsTable)
          .where(eq(pageTagsTable.pageId, page.id)),
        db
          .select()
          .from(breadcrumbsTable)
          .where(eq(breadcrumbsTable.pageId, page.id))
          .orderBy(asc(breadcrumbsTable.position)),
        db
          .select()
          .from(faqTable)
          .where(eq(faqTable.pageId, page.id))
          .orderBy(asc(faqTable.position)),
        db
          .select()
          .from(jsonldTable)
          .where(eq(jsonldTable.pageId, page.id))
          .orderBy(asc(jsonldTable.position)),
        db.select().from(seoTable).where(eq(seoTable.pageId, page.id)).limit(1),
      ]);

    const pageImages = imagesByPage.get(page.id) ?? [];
    const featured =
      pageImages.find((img) => img.role === "featured") ??
      (page.featuredImageUrl
        ? pageImages.find((img) => img.url === page.featuredImageUrl)
        : undefined) ??
      pageImages[0];

    const seo = seoRows[0];
    const bundle: SourcePageBundle = {
      page: {
        id: page.id,
        slug: page.slug,
        title: page.title,
        subtitle: page.subtitle,
        excerpt: page.excerpt,
        status: page.status,
        language: page.language,
        canonicalUrl: page.canonicalUrl,
        pathname: page.pathname,
        parentPath: page.parentPath,
        featuredImageUrl: page.featuredImageUrl,
        featuredImageAlt: page.featuredImageAlt,
        cleanedHtml: page.cleanedHtml,
        richText: page.richText ?? null,
        componentTree: page.componentTree ?? null,
        readingTimeMinutes: page.readingTimeMinutes,
        wordCount: page.wordCount,
        publishedAt: page.publishedAt,
        modifiedAt: page.modifiedAt,
        authorId: page.authorId,
        primaryCategoryId: page.primaryCategoryId,
      },
      authorId: page.authorId,
      categoryIds: pageCats.map((r) => r.categoryId),
      tagIds: pageTags.map((r) => r.tagId),
      images: pageImages.map((img) => ({
        id: img.id,
        pageId: img.pageId,
        originalUrl: img.originalUrl,
        url: img.url,
        alt: img.alt,
        title: img.title,
        caption: img.caption,
        credit: img.credit,
        width: img.width,
        height: img.height,
        mimeType: img.mimeType,
        fileSize: img.fileSize,
        role: img.role,
        position: img.position,
      })),
      breadcrumbs: crumbs.map((b) => ({
        label: b.label,
        url: b.url,
        position: b.position,
      })),
      faq: faqRows.map((f) => ({
        id: f.id,
        question: f.question,
        answer: f.answer,
        position: f.position,
      })),
      jsonld: jsonldRows.map((j) => ({ type: j.type, data: j.data })),
      seo: seo
        ? {
            metaTitle: seo.metaTitle,
            metaDescription: seo.metaDescription,
            canonicalUrl: seo.canonicalUrl,
            robots: seo.robots,
            ogTitle: seo.ogTitle,
            ogDescription: seo.ogDescription,
            ogImage: seo.ogImage,
            twitterCard: seo.twitterCard,
            twitterTitle: seo.twitterTitle,
            twitterDescription: seo.twitterDescription,
            twitterImage: seo.twitterImage,
            keywords: seo.keywords,
          }
        : null,
    };

    postDocs.push(mapPost(bundle, featured?.id ?? null));
  }

  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: "1",
    collections: {
      media: mediaDocs,
      authors: authorDocs,
      categories: categoryDocs,
      tags: tagDocs,
      posts: postDocs,
    },
  };
}

async function main(): Promise<void> {
  const outPath = parseOutPath(process.argv.slice(2));
  console.log("Reading migrated content from the database...");
  const result = await buildExport();

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(result, null, 2), "utf8");

  const c = result.collections;
  console.log(
    `Payload export written to ${outPath}\n` +
      `  media:      ${c.media.length}\n` +
      `  authors:    ${c.authors.length}\n` +
      `  categories: ${c.categories.length}\n` +
      `  tags:       ${c.tags.length}\n` +
      `  posts:      ${c.posts.length}`,
  );
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Export failed:", err);
    await pool.end();
    process.exit(1);
  });
