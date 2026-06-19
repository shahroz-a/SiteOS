import { componentTreeChildren } from "@workspace/content";
import { pseudoUuid } from "./sql.js";
import {
  BUNDLE_VERSION,
  normalizeBundle,
  type BundleImage,
  type BundlePost,
  type ContentBundle,
} from "./types.js";

/**
 * The Payload manifest mirrors the shape `scripts/export-payload.ts` emits: a
 * top-level `collections` object with `authors`, `categories`, `tags`, `media`
 * and `posts`. Documents reference each other by id; ids here are deterministic
 * (derived from the natural key) so a manifest re-imports cleanly and matches
 * the same content regardless of which database produced it.
 *
 * This is the in-CMS Payload bridge; the `scripts` CLI exporter remains the
 * canonical path for a full Payload Local-API migration. Both share the same
 * collection/block conventions documented in `mapping-registry.ts`.
 */

export interface PayloadAuthorDoc {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  avatarUrl: string | null;
  role: string | null;
  email: string | null;
  social: Record<string, string> | null;
}

export interface PayloadCategoryDoc {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  parent: string | null;
}

export interface PayloadTagDoc {
  id: string;
  title: string;
  slug: string;
  description: string | null;
}

export interface PayloadMediaDoc {
  id: string;
  url: string;
  sourceUrl: string | null;
  alt: string | null;
  caption: string | null;
  credit: string | null;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  filesize: number | null;
}

export interface PayloadPostDoc {
  id: string;
  title: string;
  slug: string;
  subtitle: string | null;
  excerpt: string | null;
  _status: "draft" | "published";
  language: string;
  url: { canonicalUrl: string; pathname: string; parentPath: string | null };
  author: string | null;
  categories: string[];
  tags: string[];
  primaryCategory: string | null;
  heroImage: string | null;
  layout: unknown[];
  contentHtml: string | null;
  content: unknown;
  meta: BundlePost["seo"];
  breadcrumbs: BundlePost["breadcrumbs"];
  faq: BundlePost["faq"];
  structuredData: Array<{ type: string | null; data: unknown }>;
  inlineImages: Array<{ image: string; role: string | null; position: number }>;
  links: BundlePost["links"];
  metadata: BundlePost["metadata"];
  publishedAt: string | null;
  readingTimeMinutes: number | null;
  wordCount: number | null;
}

export interface PayloadManifest {
  collections: {
    authors: PayloadAuthorDoc[];
    categories: PayloadCategoryDoc[];
    tags: PayloadTagDoc[];
    media: PayloadMediaDoc[];
    posts: PayloadPostDoc[];
  };
}

const authorId = (slug: string) => pseudoUuid(`author:${slug}`);
const categoryId = (slug: string) => pseudoUuid(`category:${slug}`);
const tagId = (slug: string) => pseudoUuid(`tag:${slug}`);
const postId = (canonicalUrl: string) => pseudoUuid(`post:${canonicalUrl}`);
const mediaId = (url: string) => pseudoUuid(`media:${url}`);

export function bundleToPayloadManifest(bundle: ContentBundle): PayloadManifest {
  const media = new Map<string, PayloadMediaDoc>();
  const registerMedia = (img: {
    url?: string | null;
    originalUrl?: string | null;
    alt?: string | null;
    caption?: string | null;
    credit?: string | null;
    width?: number | null;
    height?: number | null;
    mimeType?: string | null;
    fileSize?: number | null;
  }): string | null => {
    const url = img.url ?? img.originalUrl;
    if (!url) return null;
    if (!media.has(url)) {
      media.set(url, {
        id: mediaId(url),
        url,
        sourceUrl: img.originalUrl ?? null,
        alt: img.alt ?? null,
        caption: img.caption ?? null,
        credit: img.credit ?? null,
        width: img.width ?? null,
        height: img.height ?? null,
        mimeType: img.mimeType ?? null,
        filesize: img.fileSize ?? null,
      });
    }
    return mediaId(url);
  };

  const posts: PayloadPostDoc[] = bundle.posts.map((p) => {
    const hero = p.featuredImageUrl
      ? registerMedia({
          url: p.featuredImageUrl,
          originalUrl: p.featuredImageUrl,
          alt: p.featuredImageAlt,
        })
      : null;
    const inlineImages = p.images
      .filter((img) => img.url !== p.featuredImageUrl)
      .map((img) => ({
        image: registerMedia(img)!,
        role: img.role ?? null,
        position: img.position,
      }))
      .filter((ii) => Boolean(ii.image));

    return {
      id: postId(p.canonicalUrl),
      title: p.title,
      slug: p.slug,
      subtitle: p.subtitle ?? null,
      excerpt: p.excerpt ?? null,
      _status: p.status === "published" ? "published" : "draft",
      language: p.language,
      url: {
        canonicalUrl: p.canonicalUrl,
        pathname: p.pathname,
        parentPath: p.parentPath ?? null,
      },
      author: p.authorSlug ? authorId(p.authorSlug) : null,
      categories: p.categorySlugs.map(categoryId),
      tags: p.tagSlugs.map(tagId),
      primaryCategory: p.primaryCategorySlug
        ? categoryId(p.primaryCategorySlug)
        : null,
      heroImage: hero,
      layout: componentTreeChildren(p.componentTree),
      contentHtml: p.contentHtml ?? null,
      content: p.richText ?? null,
      meta: p.seo ?? null,
      breadcrumbs: p.breadcrumbs,
      faq: p.faq,
      structuredData: p.jsonld.map((j) => ({ type: j.type ?? null, data: j.data })),
      inlineImages,
      links: p.links,
      metadata: p.metadata ?? null,
      publishedAt: p.publishedAt ?? null,
      readingTimeMinutes: p.readingTimeMinutes ?? null,
      wordCount: p.wordCount ?? null,
    };
  });

  return {
    collections: {
      authors: bundle.authors.map((a) => ({
        id: authorId(a.slug),
        name: a.name,
        slug: a.slug,
        bio: a.bio ?? null,
        avatarUrl: a.avatarUrl ?? null,
        role: a.role ?? null,
        email: a.email ?? null,
        social: a.social ?? null,
      })),
      categories: bundle.categories.map((c) => ({
        id: categoryId(c.slug),
        title: c.name,
        slug: c.slug,
        description: c.description ?? null,
        parent: c.parentSlug ? categoryId(c.parentSlug) : null,
      })),
      tags: bundle.tags.map((t) => ({
        id: tagId(t.slug),
        title: t.name,
        slug: t.slug,
        description: t.description ?? null,
      })),
      media: [...media.values()],
      posts,
    },
  };
}

export function serializePayload(bundle: ContentBundle): string {
  return JSON.stringify(bundleToPayloadManifest(bundle), null, 2);
}

export function payloadManifestToBundle(raw: unknown): ContentBundle {
  const manifest = raw as Partial<PayloadManifest>;
  const c = manifest?.collections;
  if (!c || typeof c !== "object") {
    throw new Error(
      "Invalid Payload manifest: expected a top-level `collections` object.",
    );
  }
  const authors = c.authors ?? [];
  const categories = c.categories ?? [];
  const tags = c.tags ?? [];
  const mediaDocs = c.media ?? [];
  const posts = c.posts ?? [];

  const authorSlugById = new Map(authors.map((a) => [a.id, a.slug]));
  const categorySlugById = new Map(categories.map((c2) => [c2.id, c2.slug]));
  const tagSlugById = new Map(tags.map((t) => [t.id, t.slug]));
  const mediaById = new Map(mediaDocs.map((m) => [m.id, m]));

  const bundlePosts: Partial<BundlePost>[] = posts.map((p) => {
    const hero = p.heroImage ? mediaById.get(p.heroImage) : undefined;
    const images: BundleImage[] = [];
    if (hero) {
      images.push({
        originalUrl: hero.sourceUrl ?? hero.url,
        url: hero.url,
        alt: hero.alt,
        title: null,
        caption: hero.caption,
        credit: hero.credit,
        width: hero.width,
        height: hero.height,
        mimeType: hero.mimeType,
        fileSize: hero.filesize,
        role: "featured",
        position: 0,
      });
    }
    for (const ii of p.inlineImages ?? []) {
      const m = mediaById.get(ii.image);
      if (!m) continue;
      images.push({
        originalUrl: m.sourceUrl ?? m.url,
        url: m.url,
        alt: m.alt,
        title: null,
        caption: m.caption,
        credit: m.credit,
        width: m.width,
        height: m.height,
        mimeType: m.mimeType,
        fileSize: m.filesize,
        role: ii.role ?? null,
        position: ii.position,
      });
    }
    return {
      slug: p.slug,
      title: p.title,
      subtitle: p.subtitle,
      excerpt: p.excerpt,
      status: p._status === "published" ? "published" : "draft",
      language: p.language,
      canonicalUrl: p.url.canonicalUrl,
      originalUrl: p.url.canonicalUrl,
      pathname: p.url.pathname,
      parentPath: p.url.parentPath,
      authorSlug: p.author ? (authorSlugById.get(p.author) ?? null) : null,
      primaryCategorySlug: p.primaryCategory
        ? (categorySlugById.get(p.primaryCategory) ?? null)
        : null,
      categorySlugs: (p.categories ?? [])
        .map((id) => categorySlugById.get(id))
        .filter((s): s is string => Boolean(s)),
      tagSlugs: (p.tags ?? [])
        .map((id) => tagSlugById.get(id))
        .filter((s): s is string => Boolean(s)),
      featuredImageUrl: hero?.url ?? null,
      featuredImageAlt: hero?.alt ?? null,
      contentHtml: p.contentHtml ?? null,
      richText: p.content ?? null,
      componentTree: { type: "root", children: p.layout ?? [] },
      readingTimeMinutes: p.readingTimeMinutes,
      wordCount: p.wordCount,
      publishedAt: p.publishedAt,
      seo: p.meta ?? null,
      breadcrumbs: p.breadcrumbs ?? [],
      faq: p.faq ?? [],
      jsonld: (p.structuredData ?? []).map((s, i) => ({
        type: s.type ?? null,
        data: s.data,
        position: i,
      })),
      images,
      links: p.links ?? { internal: [], external: [] },
      metadata: p.metadata ?? null,
    };
  });

  return normalizeBundle({
    bundleVersion: BUNDLE_VERSION,
    authors: authors.map((a) => ({
      name: a.name,
      slug: a.slug,
      bio: a.bio,
      avatarUrl: a.avatarUrl,
      role: a.role,
      email: a.email,
      social: a.social,
    })),
    categories: categories.map((c2) => ({
      name: c2.title,
      slug: c2.slug,
      description: c2.description,
      parentSlug: c2.parent ? (categorySlugById.get(c2.parent) ?? null) : null,
    })),
    tags: tags.map((t) => ({
      name: t.title,
      slug: t.slug,
      description: t.description,
    })),
    posts: bundlePosts,
  });
}
