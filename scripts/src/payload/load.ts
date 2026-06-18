/**
 * Load a Payload CMS export (the JSON produced by `export-payload.ts`) into a
 * live Payload instance via its Local API. This is the executable, tested
 * version of the example loader documented in `README.md` — keeping it as real
 * code means the README example and the integration test can never drift from
 * each other, and a schema mismatch between our document shapes and a Payload
 * collection config surfaces as a failing load rather than silently.
 *
 * It is intentionally decoupled from Payload's generated collection types: it
 * talks to a minimal structural `PayloadLike` interface so it can run against
 * any Payload config that defines the documented collections (`media`,
 * `authors`, `categories`, `tags`, `posts`).
 *
 * Load order matters: media → authors → categories (then parents) → tags →
 * posts, so every relationship resolves to an already-created document.
 */
import type { PayloadExport } from "./mapping.js";

/** Minimal structural view of the Payload Local API methods we call. */
export interface PayloadLike {
  create(args: {
    collection: string;
    data: Record<string, unknown>;
    draft?: boolean;
    file?: {
      data: Buffer;
      name: string;
      mimetype: string;
      size: number;
    };
  }): Promise<{ id: string | number }>;
  update(args: {
    collection: string;
    id: string | number;
    data: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface LoadOptions {
  /** Override the fetch used to download media assets (e.g. in tests). */
  fetchImpl?: typeof fetch;
}

export interface LoadResult {
  /** Maps each export document's original UUID to its new Payload id. */
  idMap: Map<string, string | number>;
  counts: {
    media: number;
    authors: number;
    categories: number;
    tags: number;
    posts: number;
  };
}

/**
 * Seed a Payload instance from an export's `collections`. Returns the
 * old-UUID → new-Payload-id map plus per-collection create counts.
 */
export async function loadPayloadExport(
  payload: PayloadLike,
  collections: PayloadExport["collections"],
  opts: LoadOptions = {},
): Promise<LoadResult> {
  const doFetch = opts.fetchImpl ?? globalThis.fetch;

  // old migration UUID -> new Payload id
  const idMap = new Map<string, string | number>();
  const remap = (uuid: string | null): string | number | null =>
    uuid ? (idMap.get(uuid) ?? null) : null;

  const counts = { media: 0, authors: 0, categories: 0, tags: 0, posts: 0 };

  // 1) Media — fetch each source asset and upload it so Payload owns a copy.
  for (const m of collections.media) {
    const res = await doFetch(m.sourceUrl || m.url);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch media asset ${m.sourceUrl || m.url}: ${res.status}`,
      );
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const created = await payload.create({
      collection: "media",
      data: { alt: m.alt, caption: m.caption, credit: m.credit },
      file: {
        data: buffer,
        name: m.filename,
        mimetype:
          m.mimeType ?? res.headers.get("content-type") ?? "image/jpeg",
        size: buffer.byteLength,
      },
    });
    idMap.set(m.id, created.id);
    counts.media++;
  }

  // 2) Authors
  for (const a of collections.authors) {
    const created = await payload.create({
      collection: "authors",
      data: {
        name: a.name,
        slug: a.slug,
        bio: a.bio,
        role: a.role,
        email: a.email,
        avatar: remap(a.avatar),
        social: a.social,
      },
    });
    idMap.set(a.id, created.id);
    counts.authors++;
  }

  // 3) Categories — first pass without parent, then patch parents.
  for (const c of collections.categories) {
    const created = await payload.create({
      collection: "categories",
      data: { title: c.title, slug: c.slug, description: c.description },
    });
    idMap.set(c.id, created.id);
    counts.categories++;
  }
  for (const c of collections.categories) {
    if (!c.parent) continue;
    await payload.update({
      collection: "categories",
      id: idMap.get(c.id)!,
      data: { parent: remap(c.parent) },
    });
  }

  // 4) Tags
  for (const t of collections.tags) {
    const created = await payload.create({
      collection: "tags",
      data: { title: t.title, slug: t.slug, description: t.description },
    });
    idMap.set(t.id, created.id);
    counts.tags++;
  }

  // 5) Posts
  for (const p of collections.posts) {
    const created = await payload.create({
      collection: "posts",
      draft: p._status !== "published",
      data: {
        title: p.title,
        slug: p.slug,
        subtitle: p.subtitle,
        excerpt: p.excerpt,
        _status: p._status,
        publishedAt: p.publishedAt,
        author: remap(p.author),
        categories: p.categories.map(remap).filter(Boolean),
        tags: p.tags.map(remap).filter(Boolean),
        heroImage: remap(p.heroImage),
        layout: p.layout,
        content: p.content,
        contentHtml: p.contentHtml,
        meta: p.meta,
        breadcrumbs: p.breadcrumbs,
        faq: p.faq,
      },
    });
    idMap.set(p.id, created.id);
    counts.posts++;
  }

  return { idMap, counts };
}
