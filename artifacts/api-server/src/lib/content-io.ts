import { randomUUID, createHash } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import {
  db,
  pagesTable,
  pageVersionsTable,
  pageCategoriesTable,
  pageTagsTable,
  blocksTable,
  componentTreeTable,
  imagesTable,
  galleriesTable,
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
import { componentTreeChildren, flattenBlocks } from "@workspace/content";
import {
  withCounts,
  normalizeBundle,
  BUNDLE_VERSION,
  PAYLOAD_BLOCK_MAPPINGS,
  findBlockMapping,
  type ContentBundle,
  type BundlePost,
  type BundleImage,
} from "@workspace/content-io";

/**
 * The DB executor: either the module-level pool or an open transaction. Every
 * nested write helper MUST receive this so that, inside a transaction, no helper
 * reaches for the global `db` pool (which would open a second connection and
 * self-deadlock against the still-open transaction's uncommitted writes — see
 * the importExport gotcha in replit.md).
 */
type Executor = typeof db;

// ---------------------------------------------------------------------------
// EXPORT — read the whole corpus into a canonical, UUID-free ContentBundle.
// ---------------------------------------------------------------------------

/**
 * Project every page column EXCEPT `original_html` (the ~500MB lossless raw HTML
 * across the corpus that OOMs the Node heap once materialized + JSON.stringify'd
 * — see the "never select(*) in a bulk job" gotcha). The export emits
 * `cleanedHtml` as `contentHtml`, never the raw original.
 */
const pageExportColumns = {
  id: pagesTable.id,
  slug: pagesTable.slug,
  title: pagesTable.title,
  subtitle: pagesTable.subtitle,
  excerpt: pagesTable.excerpt,
  status: pagesTable.status,
  language: pagesTable.language,
  canonicalUrl: pagesTable.canonicalUrl,
  originalUrl: pagesTable.originalUrl,
  pathname: pagesTable.pathname,
  parentPath: pagesTable.parentPath,
  authorId: pagesTable.authorId,
  primaryCategoryId: pagesTable.primaryCategoryId,
  featuredImageUrl: pagesTable.featuredImageUrl,
  featuredImageAlt: pagesTable.featuredImageAlt,
  cleanedHtml: pagesTable.cleanedHtml,
  richText: pagesTable.richText,
  componentTree: pagesTable.componentTree,
  readingTimeMinutes: pagesTable.readingTimeMinutes,
  wordCount: pagesTable.wordCount,
  publishedAt: pagesTable.publishedAt,
  modifiedAt: pagesTable.modifiedAt,
} as const;

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/**
 * Load the content corpus into a `ContentBundle`. Runs one query per table (no
 * N+1) and stitches children onto pages in memory by page id; the emitted bundle
 * is keyed entirely by natural keys (slugs / canonical URLs).
 *
 * By default the WHOLE corpus is loaded. Pass `opts.pageIds` to load only those
 * pages (and only their child rows), then prune the taxonomy down to the docs
 * those pages actually reference. This keeps the export — and any subsequent
 * round-trip import — small and fast, which the opt-in CMS round-trip
 * verification relies on so it can run automatically on a bounded sample instead
 * of materializing+serializing all ~3.7k pages. The full-export callers
 * (`GET /cms/export`, `GET /cms/backup`) pass no opts, so their behaviour is
 * unchanged.
 */
export async function loadContentBundle(
  exec: Executor = db,
  opts: { pageIds?: string[] } = {},
): Promise<ContentBundle> {
  const pageIds = opts.pageIds;
  // An empty pageIds array means "no pages" — short-circuit so `inArray(col, [])`
  // (which Postgres rejects) is never built.
  const pageScope =
    pageIds !== undefined ? inArray(pagesTable.id, pageIds) : undefined;
  const childScope = (col: typeof pagesTable.id) =>
    pageIds !== undefined ? inArray(col, pageIds) : undefined;

  const [authors, categories, tags, pages] = await Promise.all([
    exec.select().from(authorsTable).orderBy(asc(authorsTable.slug)),
    exec.select().from(categoriesTable).orderBy(asc(categoriesTable.slug)),
    exec.select().from(tagsTable).orderBy(asc(tagsTable.slug)),
    exec
      .select(pageExportColumns)
      .from(pagesTable)
      .where(pageScope)
      .orderBy(asc(pagesTable.slug)),
  ]);

  const authorSlugById = new Map(authors.map((a) => [a.id, a.slug]));
  const categorySlugById = new Map(categories.map((c) => [c.id, c.slug]));

  const [
    pageCats,
    pageTags,
    seoRows,
    metaRows,
    breadcrumbRows,
    faqRows,
    jsonldRows,
    imageRows,
    internalRows,
    externalRows,
  ] = await Promise.all([
    exec
      .select({
        pageId: pageCategoriesTable.pageId,
        slug: categoriesTable.slug,
      })
      .from(pageCategoriesTable)
      .innerJoin(
        categoriesTable,
        eq(pageCategoriesTable.categoryId, categoriesTable.id),
      )
      .where(childScope(pageCategoriesTable.pageId)),
    exec
      .select({ pageId: pageTagsTable.pageId, slug: tagsTable.slug })
      .from(pageTagsTable)
      .innerJoin(tagsTable, eq(pageTagsTable.tagId, tagsTable.id))
      .where(childScope(pageTagsTable.pageId)),
    exec.select().from(seoTable).where(childScope(seoTable.pageId)),
    exec.select().from(metadataTable).where(childScope(metadataTable.pageId)),
    exec
      .select()
      .from(breadcrumbsTable)
      .where(childScope(breadcrumbsTable.pageId))
      .orderBy(asc(breadcrumbsTable.position)),
    exec
      .select()
      .from(faqTable)
      .where(childScope(faqTable.pageId))
      .orderBy(asc(faqTable.position)),
    exec
      .select()
      .from(jsonldTable)
      .where(childScope(jsonldTable.pageId))
      .orderBy(asc(jsonldTable.position)),
    exec
      .select()
      .from(imagesTable)
      .where(childScope(imagesTable.pageId))
      .orderBy(asc(imagesTable.position)),
    exec
      .select()
      .from(internalLinksTable)
      .where(childScope(internalLinksTable.pageId))
      .orderBy(asc(internalLinksTable.position)),
    exec
      .select()
      .from(externalLinksTable)
      .where(childScope(externalLinksTable.pageId))
      .orderBy(asc(externalLinksTable.position)),
  ]);

  const catsByPage = groupBy(pageCats, (r) => r.pageId);
  const tagsByPage = groupBy(pageTags, (r) => r.pageId);
  const seoByPage = new Map(seoRows.map((r) => [r.pageId, r]));
  const metaByPage = new Map(metaRows.map((r) => [r.pageId, r]));
  const breadcrumbsByPage = groupBy(breadcrumbRows, (r) => r.pageId);
  const faqByPage = groupBy(faqRows, (r) => r.pageId);
  const jsonldByPage = groupBy(jsonldRows, (r) => r.pageId);
  const imagesByPage = groupBy(imageRows, (r) => r.pageId);
  const internalByPage = groupBy(internalRows, (r) => r.pageId);
  const externalByPage = groupBy(externalRows, (r) => r.pageId);

  const posts: BundlePost[] = pages.map((page) => {
    const seo = seoByPage.get(page.id);
    const meta = metaByPage.get(page.id);
    return {
      slug: page.slug,
      title: page.title,
      subtitle: page.subtitle,
      excerpt: page.excerpt,
      status: page.status,
      language: page.language,
      canonicalUrl: page.canonicalUrl,
      originalUrl: page.originalUrl,
      pathname: page.pathname,
      parentPath: page.parentPath,
      authorSlug: page.authorId ? (authorSlugById.get(page.authorId) ?? null) : null,
      primaryCategorySlug: page.primaryCategoryId
        ? (categorySlugById.get(page.primaryCategoryId) ?? null)
        : null,
      categorySlugs: (catsByPage.get(page.id) ?? []).map((r) => r.slug),
      tagSlugs: (tagsByPage.get(page.id) ?? []).map((r) => r.slug),
      featuredImageUrl: page.featuredImageUrl,
      featuredImageAlt: page.featuredImageAlt,
      contentHtml: page.cleanedHtml,
      richText: page.richText ?? null,
      componentTree: page.componentTree ?? null,
      readingTimeMinutes: page.readingTimeMinutes,
      wordCount: page.wordCount,
      publishedAt: page.publishedAt ? page.publishedAt.toISOString() : null,
      modifiedAt: page.modifiedAt ? page.modifiedAt.toISOString() : null,
      seo: seo
        ? {
            metaTitle: seo.metaTitle,
            metaDescription: seo.metaDescription,
            canonicalUrl: seo.canonicalUrl,
            robots: seo.robots,
            focusKeyword: seo.focusKeyword,
            keywords: seo.keywords,
            ogTitle: seo.ogTitle,
            ogDescription: seo.ogDescription,
            ogImage: seo.ogImage,
            ogType: seo.ogType,
            twitterCard: seo.twitterCard,
            twitterTitle: seo.twitterTitle,
            twitterDescription: seo.twitterDescription,
            twitterImage: seo.twitterImage,
          }
        : null,
      breadcrumbs: (breadcrumbsByPage.get(page.id) ?? []).map((b) => ({
        label: b.label,
        url: b.url,
        position: b.position,
      })),
      faq: (faqByPage.get(page.id) ?? []).map((f) => ({
        question: f.question,
        answer: f.answer,
        position: f.position,
      })),
      jsonld: (jsonldByPage.get(page.id) ?? []).map((j) => ({
        type: j.type,
        data: j.data,
        position: j.position,
      })),
      images: (imagesByPage.get(page.id) ?? []).map((img) => ({
        originalUrl: img.originalUrl,
        url: img.url,
        alt: img.alt,
        title: img.title,
        caption: img.caption,
        credit: img.credit,
        width: img.width,
        height: img.height,
        mimeType: img.mimeType,
        fileSize: null,
        role: img.role,
        position: img.position,
      })),
      links: {
        internal: (internalByPage.get(page.id) ?? []).map((l) => ({
          href: l.href,
          anchorText: l.anchorText,
          rel: l.rel,
          domain: null,
          position: l.position,
        })),
        external: (externalByPage.get(page.id) ?? []).map((l) => ({
          href: l.href,
          anchorText: l.anchorText,
          rel: l.rel,
          domain: l.domain,
          position: l.position,
        })),
      },
      metadata: meta
        ? {
            metaTags: meta.metaTags,
            httpHeaders: meta.httpHeaders,
            openGraph: meta.openGraph,
            twitter: meta.twitter,
            custom: meta.custom,
          }
        : null,
    };
  });

  // In bounded mode prune the taxonomy down to only the docs the loaded posts
  // reference, so a round-trip import upserts a handful of rows instead of the
  // whole ~2.2k-category taxonomy. (Full mode keeps every taxonomy row.) Missing
  // category parents are tolerated by the importer's parent-resolution pass.
  let authorsOut = authors;
  let categoriesOut = categories;
  let tagsOut = tags;
  if (pageIds !== undefined) {
    const refAuthors = new Set(
      posts.map((p) => p.authorSlug).filter((s): s is string => Boolean(s)),
    );
    const refCategories = new Set(
      posts
        .flatMap((p) => [p.primaryCategorySlug, ...p.categorySlugs])
        .filter((s): s is string => Boolean(s)),
    );
    const refTags = new Set(posts.flatMap((p) => p.tagSlugs));
    authorsOut = authors.filter((a) => refAuthors.has(a.slug));
    categoriesOut = categories.filter((c) => refCategories.has(c.slug));
    tagsOut = tags.filter((t) => refTags.has(t.slug));
  }

  return withCounts({
    bundleVersion: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    source: "headout-blog",
    authors: authorsOut.map((a) => ({
      name: a.name,
      slug: a.slug,
      bio: a.bio,
      avatarUrl: a.avatarUrl,
      role: a.role,
      email: a.email,
      social: a.social,
    })),
    categories: categories.map((c) => ({
      name: c.name,
      slug: c.slug,
      description: c.description,
      parentSlug: c.parentId ? (categorySlugById.get(c.parentId) ?? null) : null,
    })),
    tags: tags.map((t) => ({
      name: t.name,
      slug: t.slug,
      description: t.description,
    })),
    posts,
  });
}

// ---------------------------------------------------------------------------
// IMPORT — non-destructive, transactional upsert of a ContentBundle.
// ---------------------------------------------------------------------------

export interface ImportResult {
  authorsUpserted: number;
  categoriesUpserted: number;
  tagsUpserted: number;
  postsCreated: number;
  postsUpdated: number;
  postsUnchanged: number;
  internalLinksResolved: number;
}

function contentHashOf(post: BundlePost): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        title: post.title,
        contentHtml: post.contentHtml ?? null,
        componentTree: post.componentTree ?? null,
        seo: post.seo ?? null,
      }),
    )
    .digest("hex");
}

async function upsertAuthors(
  exec: Executor,
  bundle: ContentBundle,
): Promise<Map<string, string>> {
  const idBySlug = new Map<string, string>();
  for (const a of bundle.authors) {
    const [row] = await exec
      .insert(authorsTable)
      .values({
        name: a.name,
        slug: a.slug,
        bio: a.bio ?? null,
        avatarUrl: a.avatarUrl ?? null,
        role: a.role ?? null,
        email: a.email ?? null,
        social: a.social ?? null,
      })
      .onConflictDoUpdate({
        target: authorsTable.slug,
        set: {
          name: a.name,
          bio: a.bio ?? null,
          avatarUrl: a.avatarUrl ?? null,
          role: a.role ?? null,
          email: a.email ?? null,
          social: a.social ?? null,
        },
      })
      .returning({ id: authorsTable.id, slug: authorsTable.slug });
    if (row) idBySlug.set(row.slug, row.id);
  }
  return idBySlug;
}

async function upsertCategories(
  exec: Executor,
  bundle: ContentBundle,
): Promise<Map<string, string>> {
  const idBySlug = new Map<string, string>();
  // First pass: upsert every category without its parent.
  for (const c of bundle.categories) {
    const [row] = await exec
      .insert(categoriesTable)
      .values({
        name: c.name,
        slug: c.slug,
        description: c.description ?? null,
      })
      .onConflictDoUpdate({
        target: categoriesTable.slug,
        set: { name: c.name, description: c.description ?? null },
      })
      .returning({ id: categoriesTable.id, slug: categoriesTable.slug });
    if (row) idBySlug.set(row.slug, row.id);
  }
  // Second pass: resolve parents now that every id exists.
  for (const c of bundle.categories) {
    if (!c.parentSlug) continue;
    const id = idBySlug.get(c.slug);
    const parentId = idBySlug.get(c.parentSlug);
    if (id && parentId) {
      await exec
        .update(categoriesTable)
        .set({ parentId })
        .where(eq(categoriesTable.id, id));
    }
  }
  return idBySlug;
}

async function upsertTags(
  exec: Executor,
  bundle: ContentBundle,
): Promise<Map<string, string>> {
  const idBySlug = new Map<string, string>();
  for (const t of bundle.tags) {
    const [row] = await exec
      .insert(tagsTable)
      .values({
        name: t.name,
        slug: t.slug,
        description: t.description ?? null,
      })
      .onConflictDoUpdate({
        target: tagsTable.slug,
        set: { name: t.name, description: t.description ?? null },
      })
      .returning({ id: tagsTable.id, slug: tagsTable.slug });
    if (row) idBySlug.set(row.slug, row.id);
  }
  return idBySlug;
}

/** Delete every child row owned by a page so it can be rewritten wholesale. */
async function clearPostChildren(exec: Executor, pageId: string): Promise<void> {
  await exec.delete(internalLinksTable).where(eq(internalLinksTable.pageId, pageId));
  await exec.delete(externalLinksTable).where(eq(externalLinksTable.pageId, pageId));
  await exec.delete(jsonldTable).where(eq(jsonldTable.pageId, pageId));
  await exec.delete(breadcrumbsTable).where(eq(breadcrumbsTable.pageId, pageId));
  await exec.delete(faqTable).where(eq(faqTable.pageId, pageId));
  await exec.delete(imagesTable).where(eq(imagesTable.pageId, pageId));
  await exec.delete(galleriesTable).where(eq(galleriesTable.pageId, pageId));
  await exec.delete(blocksTable).where(eq(blocksTable.pageId, pageId));
  await exec.delete(componentTreeTable).where(eq(componentTreeTable.pageId, pageId));
  await exec.delete(seoTable).where(eq(seoTable.pageId, pageId));
  await exec.delete(metadataTable).where(eq(metadataTable.pageId, pageId));
  await exec.delete(pageCategoriesTable).where(eq(pageCategoriesTable.pageId, pageId));
  await exec.delete(pageTagsTable).where(eq(pageTagsTable.pageId, pageId));
}

async function writePostChildren(
  exec: Executor,
  pageId: string,
  post: BundlePost,
  categoryIdBySlug: Map<string, string>,
  tagIdBySlug: Map<string, string>,
): Promise<void> {
  const categoryIds = [
    ...new Set(
      post.categorySlugs
        .map((s) => categoryIdBySlug.get(s))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (categoryIds.length) {
    await exec
      .insert(pageCategoriesTable)
      .values(categoryIds.map((categoryId) => ({ pageId, categoryId })));
  }
  const tagIds = [
    ...new Set(
      post.tagSlugs
        .map((s) => tagIdBySlug.get(s))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (tagIds.length) {
    await exec
      .insert(pageTagsTable)
      .values(tagIds.map((tagId) => ({ pageId, tagId })));
  }

  if (post.seo) {
    await exec.insert(seoTable).values({
      pageId,
      metaTitle: post.seo.metaTitle ?? null,
      metaDescription: post.seo.metaDescription ?? null,
      canonicalUrl: post.seo.canonicalUrl ?? null,
      robots: post.seo.robots ?? null,
      focusKeyword: post.seo.focusKeyword ?? null,
      keywords: post.seo.keywords ?? null,
      ogTitle: post.seo.ogTitle ?? null,
      ogDescription: post.seo.ogDescription ?? null,
      ogImage: post.seo.ogImage ?? null,
      ogType: post.seo.ogType ?? null,
      twitterCard: post.seo.twitterCard ?? null,
      twitterTitle: post.seo.twitterTitle ?? null,
      twitterDescription: post.seo.twitterDescription ?? null,
      twitterImage: post.seo.twitterImage ?? null,
    });
  }

  if (post.metadata) {
    await exec.insert(metadataTable).values({
      pageId,
      metaTags: post.metadata.metaTags ?? null,
      httpHeaders: post.metadata.httpHeaders ?? null,
      openGraph: post.metadata.openGraph ?? null,
      twitter: post.metadata.twitter ?? null,
      custom: post.metadata.custom ?? null,
    });
  }

  if (post.breadcrumbs.length) {
    await exec.insert(breadcrumbsTable).values(
      post.breadcrumbs.map((b, i) => ({
        pageId,
        label: b.label,
        url: b.url ?? null,
        position: b.position ?? i,
      })),
    );
  }

  const blocks = componentTreeChildren(post.componentTree ?? null);
  if (blocks.length) {
    const rows = flattenBlocks(blocks, randomUUID).map((r) => ({ ...r, pageId }));
    await exec.insert(blocksTable).values(rows);
  }
  if (post.componentTree != null) {
    await exec.insert(componentTreeTable).values({
      pageId,
      tree: post.componentTree,
      schemaVersion: "1",
    });
  }

  if (post.images.length) {
    await exec.insert(imagesTable).values(
      post.images.map((img: BundleImage, i) => ({
        pageId,
        galleryId: null,
        originalUrl: img.originalUrl ?? img.url,
        url: img.url,
        alt: img.alt ?? null,
        title: img.title ?? null,
        caption: img.caption ?? null,
        credit: img.credit ?? null,
        width: img.width ?? null,
        height: img.height ?? null,
        mimeType: img.mimeType ?? null,
        role: img.role ?? null,
        position: img.position ?? i,
      })),
    );
  }

  if (post.faq.length) {
    await exec.insert(faqTable).values(
      post.faq.map((f, i) => ({
        pageId,
        question: f.question,
        answer: f.answer,
        answerRichText: null,
        position: f.position ?? i,
      })),
    );
  }

  if (post.jsonld.length) {
    await exec.insert(jsonldTable).values(
      post.jsonld.map((j, i) => ({
        pageId,
        type: j.type ?? null,
        data: j.data,
        position: j.position ?? i,
      })),
    );
  }

  if (post.links.external.length) {
    await exec.insert(externalLinksTable).values(
      post.links.external.map((l, i) => ({
        pageId,
        href: l.href,
        anchorText: l.anchorText ?? null,
        rel: l.rel ?? null,
        domain: l.domain ?? null,
        position: l.position ?? i,
      })),
    );
  }

  if (post.links.internal.length) {
    await exec.insert(internalLinksTable).values(
      post.links.internal.map((l, i) => ({
        pageId,
        targetPageId: null,
        href: l.href,
        anchorText: l.anchorText ?? null,
        rel: l.rel ?? null,
        position: l.position ?? i,
      })),
    );
  }
}

async function snapshotVersion(
  exec: Executor,
  pageId: string,
  contentHash: string,
  changeSummary: string,
): Promise<void> {
  const rows = await exec
    .select({ versionNumber: pageVersionsTable.versionNumber })
    .from(pageVersionsTable)
    .where(eq(pageVersionsTable.pageId, pageId));
  const versionNumber =
    rows.reduce((max, r) => Math.max(max, r.versionNumber), 0) + 1;
  await exec.insert(pageVersionsTable).values({
    pageId,
    versionNumber,
    snapshot: {},
    contentHash,
    changeSummary,
    crawledAt: null,
  });
}

/**
 * Resolve internal-link targets by matching each link `href` to a page whose
 * canonical URL or pathname equals it. MUST receive the active executor so it
 * participates in the same transaction (see the self-deadlock gotcha).
 */
export async function resolveInternalLinks(exec: Executor): Promise<number> {
  const pages = await exec
    .select({
      id: pagesTable.id,
      canonicalUrl: pagesTable.canonicalUrl,
      pathname: pagesTable.pathname,
    })
    .from(pagesTable);
  const idByHref = new Map<string, string>();
  for (const p of pages) {
    idByHref.set(p.canonicalUrl, p.id);
    idByHref.set(p.pathname, p.id);
  }
  const links = await exec
    .select({ id: internalLinksTable.id, href: internalLinksTable.href })
    .from(internalLinksTable);
  let resolved = 0;
  for (const link of links) {
    const targetPageId = idByHref.get(link.href);
    if (!targetPageId) continue;
    await exec
      .update(internalLinksTable)
      .set({ targetPageId })
      .where(eq(internalLinksTable.id, link.id));
    resolved += 1;
  }
  return resolved;
}

/**
 * Sentinel thrown to force a transaction rollback once a dry-run has computed
 * its result. Drizzle rolls back the transaction when its callback throws, so we
 * carry the result on the error and unwrap it outside the transaction.
 */
class DryRunRollback extends Error {
  constructor(public readonly result: ImportResult) {
    super("dry-run rollback");
    this.name = "DryRunRollback";
  }
}

/**
 * Non-destructively import a bundle: upsert taxonomy by slug, then upsert each
 * post by canonical URL (create if new; rewrite children only when the content
 * hash changed, snapshotting a version each time). Runs in a single transaction
 * with the executor threaded to every nested write.
 *
 * When `options.dryRun` is true, the exact same work runs inside the transaction
 * but it is rolled back instead of committed, so the returned summary reflects
 * what *would* change without persisting anything (a preview).
 */
export async function importContentBundle(
  raw: ContentBundle,
  options: { dryRun?: boolean; exec?: Executor } = {},
): Promise<ImportResult> {
  const bundle = normalizeBundle(raw);
  const run = async (tx: Executor): Promise<ImportResult> => {
      await upsertAuthors(tx, bundle);
      const categoryIdBySlug = await upsertCategories(tx, bundle);
      const tagIdBySlug = await upsertTags(tx, bundle);

      const authorIdBySlug = new Map(
        (await tx.select({ id: authorsTable.id, slug: authorsTable.slug }).from(authorsTable)).map(
          (r) => [r.slug, r.id],
        ),
      );

      const result: ImportResult = {
        authorsUpserted: bundle.authors.length,
        categoriesUpserted: bundle.categories.length,
        tagsUpserted: bundle.tags.length,
        postsCreated: 0,
        postsUpdated: 0,
        postsUnchanged: 0,
        internalLinksResolved: 0,
      };

      for (const post of bundle.posts) {
        const hash = contentHashOf(post);
        const authorId = post.authorSlug
          ? (authorIdBySlug.get(post.authorSlug) ?? null)
          : null;
        const primaryCategoryId = post.primaryCategorySlug
          ? (categoryIdBySlug.get(post.primaryCategorySlug) ?? null)
          : null;

        const [existing] = await tx
          .select({ id: pagesTable.id })
          .from(pagesTable)
          .where(eq(pagesTable.canonicalUrl, post.canonicalUrl))
          .limit(1);

        const pageValues = {
          slug: post.slug,
          title: post.title,
          subtitle: post.subtitle ?? null,
          excerpt: post.excerpt ?? null,
          status: (post.status === "published" ? "published" : "draft") as
            | "published"
            | "draft",
          language: post.language || "en",
          originalUrl: post.originalUrl ?? post.canonicalUrl,
          canonicalUrl: post.canonicalUrl,
          pathname: post.pathname,
          parentPath: post.parentPath ?? null,
          authorId,
          primaryCategoryId,
          featuredImageUrl: post.featuredImageUrl ?? null,
          featuredImageAlt: post.featuredImageAlt ?? null,
          cleanedHtml: post.contentHtml ?? null,
          richText: post.richText ?? null,
          componentTree: post.componentTree ?? null,
          readingTimeMinutes: post.readingTimeMinutes ?? null,
          wordCount: post.wordCount ?? null,
          publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
          modifiedAt: post.modifiedAt ? new Date(post.modifiedAt) : null,
        };

        if (!existing) {
          const [pageRow] = await tx
            .insert(pagesTable)
            .values(pageValues)
            .returning({ id: pagesTable.id });
          const pageId = pageRow!.id;
          await writePostChildren(tx, pageId, post, categoryIdBySlug, tagIdBySlug);
          await snapshotVersion(tx, pageId, hash, "Imported");
          result.postsCreated += 1;
          continue;
        }

        const pageId = existing.id;
        // Only rewrite when content actually changed (idempotent re-import).
        const versions = await tx
          .select({
            versionNumber: pageVersionsTable.versionNumber,
            contentHash: pageVersionsTable.contentHash,
          })
          .from(pageVersionsTable)
          .where(eq(pageVersionsTable.pageId, pageId));
        const latest = versions.sort((a, b) => b.versionNumber - a.versionNumber)[0];
        if (latest && latest.contentHash === hash) {
          // Still refresh lightweight page-level fields, but skip child rewrite.
          await tx
            .update(pagesTable)
            .set({ ...pageValues, updatedAt: new Date() })
            .where(eq(pagesTable.id, pageId));
          result.postsUnchanged += 1;
          continue;
        }

        await tx
          .update(pagesTable)
          .set({ ...pageValues, updatedAt: new Date() })
          .where(eq(pagesTable.id, pageId));
        await clearPostChildren(tx, pageId);
        await writePostChildren(tx, pageId, post, categoryIdBySlug, tagIdBySlug);
        await snapshotVersion(tx, pageId, hash, "Imported (updated)");
        result.postsUpdated += 1;
      }

      result.internalLinksResolved = await resolveInternalLinks(tx);
      if (options.dryRun) {
        // Computed everything; throw to roll back so nothing is persisted.
        throw new DryRunRollback(result);
      }
      return result;
  };
  // When an executor is injected (e.g. a test's rolled-back transaction), run
  // inside it directly; otherwise open and own a fresh transaction. Mirrors the
  // injectable-executor pattern used by importExport (see the self-deadlock
  // gotcha in replit.md — every nested write already threads this executor).
  // A dry-run throws DryRunRollback so its transaction rolls back; we unwrap the
  // carried result outside the transaction.
  try {
    if (options.exec) return await run(options.exec);
    return await db.transaction(async (txRaw) => run(txRaw as unknown as Executor));
  } catch (err) {
    if (err instanceof DryRunRollback) return err.result;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// PAYLOAD MIGRATION REPORT — runtime block-type coverage vs the registry.
// ---------------------------------------------------------------------------

export interface PayloadMigrationReport {
  generatedAt: string;
  totals: {
    posts: number;
    blocks: number;
    mappedBlocks: number;
    unmappedBlocks: number;
  };
  blockTypes: Array<{
    blockType: string;
    count: number;
    payloadBlock: string | null;
    mapped: boolean;
  }>;
}

/**
 * Walk every page's persisted blocks and tally how many of each block type the
 * corpus contains, flagging any type that has no Payload mapping in the
 * registry. This is the live counterpart to the static mapping panel.
 */
export async function buildPayloadMigrationReport(
  exec: Executor = db,
): Promise<PayloadMigrationReport> {
  const rows = await exec
    .select({ blockType: blocksTable.blockType, pageId: blocksTable.pageId })
    .from(blocksTable);

  const counts = new Map<string, number>();
  const pageIds = new Set<string>();
  for (const r of rows) {
    counts.set(r.blockType, (counts.get(r.blockType) ?? 0) + 1);
    pageIds.add(r.pageId);
  }

  let mappedBlocks = 0;
  let unmappedBlocks = 0;
  const blockTypes = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([blockType, count]) => {
      const mapping = findBlockMapping(blockType);
      if (mapping) mappedBlocks += count;
      else unmappedBlocks += count;
      return {
        blockType,
        count,
        payloadBlock: mapping?.payloadBlock ?? null,
        mapped: Boolean(mapping),
      };
    });

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      posts: pageIds.size,
      blocks: rows.length,
      mappedBlocks,
      unmappedBlocks,
    },
    blockTypes,
  };
}

/** Known Payload block targets, for surfacing the full mapping table. */
export const payloadBlockMappings = PAYLOAD_BLOCK_MAPPINGS;

