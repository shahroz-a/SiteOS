import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
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
  type Page,
} from "@workspace/db";
import { and, eq, asc, ilike } from "drizzle-orm";
import {
  ListPostsQueryParams,
  ListPostsResponse,
  GetPostBySlugParams,
  GetPostBySlugResponse,
  GetPostByPreviewTokenParams,
  GetPostByPreviewTokenResponse,
  ResolveRedirectQueryParams,
  ResolveRedirectResponse,
} from "@workspace/api-zod";
import { listPosts } from "../lib/posts";
import { resolveImageServingUrl } from "../lib/image-source";
import { resolvePreviewToken, resolveRedirect } from "../lib/cms-publishing";

const router: IRouter = Router();

/**
 * Serialize a `pages` row into the public `PostDetail` shape. Used by BOTH the
 * public `/posts/{slug}` route and the authenticated `/preview/{token}` route
 * so that a draft preview renders through exactly the same production renderer
 * (no separate, drift-prone draft view).
 */
async function serializePostDetail(page: Page) {
  const author = page.authorId
    ? (
        await db
          .select()
          .from(authorsTable)
          .where(eq(authorsTable.id, page.authorId))
          .limit(1)
      )[0]
    : undefined;

  const primaryCategory = page.primaryCategoryId
    ? (
        await db
          .select()
          .from(categoriesTable)
          .where(eq(categoriesTable.id, page.primaryCategoryId))
          .limit(1)
      )[0]
    : undefined;

  const categories = await db
    .select({
      id: categoriesTable.id,
      name: categoriesTable.name,
      slug: categoriesTable.slug,
    })
    .from(pageCategoriesTable)
    .innerJoin(
      categoriesTable,
      eq(pageCategoriesTable.categoryId, categoriesTable.id),
    )
    .where(eq(pageCategoriesTable.pageId, page.id));

  const tags = await db
    .select({
      id: tagsTable.id,
      name: tagsTable.name,
      slug: tagsTable.slug,
    })
    .from(pageTagsTable)
    .innerJoin(tagsTable, eq(pageTagsTable.tagId, tagsTable.id))
    .where(eq(pageTagsTable.pageId, page.id));

  const breadcrumbs = await db
    .select()
    .from(breadcrumbsTable)
    .where(eq(breadcrumbsTable.pageId, page.id))
    .orderBy(asc(breadcrumbsTable.position));

  const faq = await db
    .select()
    .from(faqTable)
    .where(eq(faqTable.pageId, page.id))
    .orderBy(asc(faqTable.position));

  const images = await db
    .select()
    .from(imagesTable)
    .where(eq(imagesTable.pageId, page.id))
    .orderBy(asc(imagesTable.position));

  const jsonld = await db
    .select()
    .from(jsonldTable)
    .where(eq(jsonldTable.pageId, page.id))
    .orderBy(asc(jsonldTable.position));

  const [seo] = await db
    .select()
    .from(seoTable)
    .where(eq(seoTable.pageId, page.id))
    .limit(1);

  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    subtitle: page.subtitle,
    excerpt: page.excerpt,
    canonicalUrl: page.canonicalUrl,
    pathname: page.pathname,
    parentPath: page.parentPath,
    featuredImageUrl: page.featuredImageUrl,
    featuredImageAlt: page.featuredImageAlt,
    readingTimeMinutes: page.readingTimeMinutes,
    wordCount: page.wordCount,
    language: page.language,
    publishedAt: page.publishedAt,
    modifiedAt: page.modifiedAt,
    contentHtml: page.cleanedHtml,
    richText: page.richText ?? null,
    componentTree: page.componentTree ?? null,
    author: author
      ? {
          id: author.id,
          name: author.name,
          slug: author.slug,
          avatarUrl: author.avatarUrl,
          role: author.role,
        }
      : null,
    primaryCategory: primaryCategory
      ? {
          id: primaryCategory.id,
          name: primaryCategory.name,
          slug: primaryCategory.slug,
        }
      : null,
    categories,
    tags,
    breadcrumbs: breadcrumbs.map((b) => ({
      label: b.label,
      url: b.url,
      position: b.position,
    })),
    faq: faq.map((f) => ({
      id: f.id,
      question: f.question,
      answer: f.answer,
      position: f.position,
    })),
    images: images.map((img) => ({
      id: img.id,
      // Migrated images always serve straight from the original Headout CDN —
      // never a re-hosted self-hosted storage path. See lib/image-source.ts.
      url: resolveImageServingUrl(img),
      originalUrl: img.originalUrl,
      alt: img.alt,
      caption: img.caption,
      credit: img.credit,
      width: img.width,
      height: img.height,
      role: img.role,
      position: img.position,
    })),
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
    jsonld: jsonld.map((j) => ({ type: j.type, data: j.data })),
  };
}

router.get("/posts", async (req, res) => {
  const query = ListPostsQueryParams.parse(req.query);
  const category = typeof req.query.category === "string" ? req.query.category : undefined;
  const author = typeof req.query.author === "string" ? req.query.author : undefined;
  const tag = typeof req.query.tag === "string" ? req.query.tag : undefined;
  const tagSlugs = tag
    ? tag
        .split(",")
        .map((slug) => slug.trim())
        .filter((slug) => slug.length > 0)
    : undefined;

  const result = await listPosts({
    page: query.page,
    limit: query.limit,
    categorySlug: category,
    authorSlug: author,
    tagSlugs,
  });

  res.json(ListPostsResponse.parse(result));
});

router.get("/posts/:slug", async (req, res) => {
  const { slug } = GetPostBySlugParams.parse(req.params);

  const [page] = await db
    .select()
    .from(pagesTable)
    .where(
      and(
        eq(pagesTable.slug, slug),
        eq(pagesTable.status, "published"),
        eq(pagesTable.pageType, "post"),
        // Only genuine `/blog/` articles are servable; mirrors `listPosts`.
        ilike(pagesTable.canonicalUrl, "%/blog/%"),
      ),
    )
    .limit(1);

  if (!page) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  const result = await serializePostDetail(page);
  res.json(GetPostBySlugResponse.parse(result));
});

// Resolve a (possibly old) path to its active redirect target, if any. Public:
// the static blog has no real server-side 301, so the SPA calls this on a 404 to
// forward old URLs to their new home.
router.get("/redirects/resolve", async (req, res) => {
  const { path } = ResolveRedirectQueryParams.parse(req.query);
  const resolution = await resolveRedirect(path);
  res.json(ResolveRedirectResponse.parse(resolution));
});

// Render a single article (ANY status) via a valid, unexpired preview token.
// This reuses the exact production serializer so reviewers see the real thing.
// The token is the only secret; without it drafts never leak.
router.get("/preview/:token", async (req, res) => {
  const { token } = GetPostByPreviewTokenParams.parse(req.params);
  const pageId = await resolvePreviewToken(token);
  if (!pageId) {
    res.status(404).json({ error: "Preview link is invalid or has expired" });
    return;
  }

  const [page] = await db
    .select()
    .from(pagesTable)
    .where(and(eq(pagesTable.id, pageId), eq(pagesTable.pageType, "post")))
    .limit(1);

  if (!page) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  const result = await serializePostDetail(page);
  res.json(GetPostByPreviewTokenResponse.parse(result));
});

export default router;
