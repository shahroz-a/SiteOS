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
  internalLinksTable,
  externalLinksTable,
  metadataTable,
} from "@workspace/db";
import { asc, eq, inArray } from "drizzle-orm";
import {
  mapAuthor,
  mapCategory,
  mapImage,
  mapPost,
  mapTag,
  type PayloadAuthorDoc,
  type PayloadCategoryDoc,
  type PayloadExport,
  type PayloadMediaDoc,
  type PayloadPostDoc,
  type PayloadTagDoc,
  type SourcePageBundle,
} from "./payload/mapping.js";

export interface BuildExportOptions {
  /**
   * Restrict the export to these page ids (plus the media, authors, categories
   * — including ancestor categories — and tags those pages reference). When
   * omitted, every page is exported. Used by the real-dataset round-trip
   * verification to operate on a small, interesting sample of live pages.
   */
  pageIds?: string[];
}

/**
 * Prune the global media/authors/categories/tags collections down to only the
 * documents the sampled posts actually reference. Keeps the export self-
 * contained (every relationship resolves on load) without dragging the whole
 * media library along for a handful of sampled pages.
 */
function pruneToReferenced(all: {
  mediaDocs: PayloadMediaDoc[];
  authorDocs: PayloadAuthorDoc[];
  categoryDocs: PayloadCategoryDoc[];
  tagDocs: PayloadTagDoc[];
  postDocs: PayloadPostDoc[];
}): PayloadExport["collections"] {
  const { mediaDocs, authorDocs, categoryDocs, tagDocs, postDocs } = all;
  const usedAuthors = new Set<string>();
  const usedCategories = new Set<string>();
  const usedTags = new Set<string>();
  const usedMedia = new Set<string>();

  for (const p of postDocs) {
    if (p.author) usedAuthors.add(p.author);
    if (p.heroImage) usedMedia.add(p.heroImage);
    for (const ii of p.inlineImages) usedMedia.add(ii.image);
    for (const c of p.categories) usedCategories.add(c);
    if (p.primaryCategory) usedCategories.add(p.primaryCategory);
    for (const t of p.tags) usedTags.add(t);
  }

  // Referenced authors may carry an avatar media doc.
  for (const a of authorDocs) {
    if (usedAuthors.has(a.id) && a.avatar) usedMedia.add(a.avatar);
  }

  // Include category ancestors so `parent` relationships resolve on load.
  const categoryById = new Map(categoryDocs.map((c) => [c.id, c]));
  for (const id of [...usedCategories]) {
    let cur = categoryById.get(id);
    while (cur?.parent) {
      usedCategories.add(cur.parent);
      cur = categoryById.get(cur.parent);
    }
  }

  return {
    media: mediaDocs.filter((m) => usedMedia.has(m.id)),
    authors: authorDocs.filter((a) => usedAuthors.has(a.id)),
    categories: categoryDocs.filter((c) => usedCategories.has(c.id)),
    tags: tagDocs.filter((t) => usedTags.has(t.id)),
    posts: postDocs,
  };
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

function parseOutPath(argv: string[]): string {
  const idx = argv.indexOf("--out");
  if (idx !== -1 && argv[idx + 1]) return resolve(process.cwd(), argv[idx + 1]!);
  // Anchor the default to the package (scripts/out) regardless of cwd.
  return resolve(SCRIPT_DIR, "../out/payload-export.json");
}

export async function buildExport(
  opts: BuildExportOptions = {},
): Promise<PayloadExport> {
  const sampling = opts.pageIds !== undefined && opts.pageIds.length > 0;
  // Project only the columns the export consumes. Selecting `*` also pulls
  // `original_html` (~500MB across the corpus) which the Payload export never
  // uses (it emits `cleanedHtml`), and loading it OOMs the Node heap.
  const pageColumns = {
    id: pagesTable.id,
    slug: pagesTable.slug,
    title: pagesTable.title,
    subtitle: pagesTable.subtitle,
    excerpt: pagesTable.excerpt,
    status: pagesTable.status,
    language: pagesTable.language,
    canonicalUrl: pagesTable.canonicalUrl,
    pathname: pagesTable.pathname,
    parentPath: pagesTable.parentPath,
    featuredImageUrl: pagesTable.featuredImageUrl,
    featuredImageAlt: pagesTable.featuredImageAlt,
    cleanedHtml: pagesTable.cleanedHtml,
    richText: pagesTable.richText,
    componentTree: pagesTable.componentTree,
    readingTimeMinutes: pagesTable.readingTimeMinutes,
    wordCount: pagesTable.wordCount,
    publishedAt: pagesTable.publishedAt,
    modifiedAt: pagesTable.modifiedAt,
    authorId: pagesTable.authorId,
    primaryCategoryId: pagesTable.primaryCategoryId,
  };
  const pagesQuery = sampling
    ? db
        .select(pageColumns)
        .from(pagesTable)
        .where(inArray(pagesTable.id, opts.pageIds!))
        .orderBy(asc(pagesTable.publishedAt))
    : db.select(pageColumns).from(pagesTable).orderBy(asc(pagesTable.publishedAt));

  const [authors, categories, tags, pages, images] = await Promise.all([
    db.select().from(authorsTable),
    db.select().from(categoriesTable),
    db.select().from(tagsTable),
    pagesQuery,
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
  const postDocs: PayloadPostDoc[] = [];
  for (const page of pages) {
    const [
      pageCats,
      pageTags,
      crumbs,
      faqRows,
      jsonldRows,
      seoRows,
      internalLinkRows,
      externalLinkRows,
      metadataRows,
    ] = await Promise.all([
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
      db
        .select()
        .from(internalLinksTable)
        .where(eq(internalLinksTable.pageId, page.id))
        .orderBy(asc(internalLinksTable.position)),
      db
        .select()
        .from(externalLinksTable)
        .where(eq(externalLinksTable.pageId, page.id))
        .orderBy(asc(externalLinksTable.position)),
      db
        .select()
        .from(metadataTable)
        .where(eq(metadataTable.pageId, page.id))
        .limit(1),
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
      internalLinks: internalLinkRows.map((l) => ({
        href: l.href,
        anchorText: l.anchorText,
        rel: l.rel,
        position: l.position,
      })),
      externalLinks: externalLinkRows.map((l) => ({
        href: l.href,
        anchorText: l.anchorText,
        rel: l.rel,
        domain: l.domain,
        position: l.position,
      })),
      metadata: metadataRows[0]
        ? {
            metaTags: metadataRows[0].metaTags,
            httpHeaders: metadataRows[0].httpHeaders,
            openGraph: metadataRows[0].openGraph,
            twitter: metadataRows[0].twitter,
            custom: metadataRows[0].custom,
          }
        : null,
    };

    postDocs.push(mapPost(bundle, featured?.id ?? null));
  }

  const collections = sampling
    ? pruneToReferenced({
        mediaDocs,
        authorDocs,
        categoryDocs,
        tagDocs,
        postDocs,
      })
    : {
        media: mediaDocs,
        authors: authorDocs,
        categories: categoryDocs,
        tags: tagDocs,
        posts: postDocs,
      };

  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: "1",
    collections,
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

// Only run the CLI when this module is executed directly (not when imported by
// tests, which exercise `buildExport` against a fake DB).
const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
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
}
