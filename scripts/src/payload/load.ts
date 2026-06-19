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
 *
 * The load is idempotent: every document is looked up by its natural key
 * (filename for media, slug for authors/categories/tags/posts) and updated in
 * place when it already exists, so re-running after a partial failure creates
 * no duplicates. The same idempotency the round-trip importer already provides.
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
    draft?: boolean;
  }): Promise<unknown>;
  find(args: {
    collection: string;
    where: Record<string, unknown>;
    limit?: number;
  }): Promise<{ docs: Array<{ id: string | number }> }>;
}

export interface LoadOptions {
  /** Override the fetch used to download media assets (e.g. in tests). */
  fetchImpl?: typeof fetch;
  /**
   * Preview mode: perform every natural-key lookup to project the
   * create/update split, but skip all create/update calls (and the media
   * re-fetch + upload) so the Payload instance is left untouched. The returned
   * `counts` / `updated` still report what *would* happen.
   */
  dryRun?: boolean;
}

export interface LoadResult {
  /** Maps each export document's original UUID to its new Payload id. */
  idMap: Map<string, string | number>;
  /** Number of documents newly created per collection. */
  counts: {
    media: number;
    authors: number;
    categories: number;
    tags: number;
    posts: number;
  };
  /** Number of pre-existing documents updated in place per collection. */
  updated: {
    media: number;
    authors: number;
    categories: number;
    tags: number;
    posts: number;
  };
}

/** Find an existing document by a natural-key field, or `undefined`. */
async function findByKey(
  payload: PayloadLike,
  collection: string,
  field: string,
  value: string,
): Promise<{ id: string | number } | undefined> {
  const res = await payload.find({
    collection,
    where: { [field]: { equals: value } },
    limit: 1,
  });
  return res.docs[0];
}

/**
 * Seed (or re-seed) a Payload instance from an export's `collections`. Returns
 * the old-UUID → new-Payload-id map plus per-collection create/update counts.
 * Re-running against an already-populated instance updates the existing
 * documents in place instead of creating duplicates.
 */
export async function loadPayloadExport(
  payload: PayloadLike,
  collections: PayloadExport["collections"],
  opts: LoadOptions = {},
): Promise<LoadResult> {
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  const dryRun = opts.dryRun ?? false;

  // old migration UUID -> new Payload id
  const idMap = new Map<string, string | number>();
  const remap = (uuid: string | null): string | number | null =>
    uuid ? (idMap.get(uuid) ?? null) : null;

  const counts = { media: 0, authors: 0, categories: 0, tags: 0, posts: 0 };
  const updated = { media: 0, authors: 0, categories: 0, tags: 0, posts: 0 };

  // 1) Media — fetch each source asset and upload it so Payload owns a copy.
  // Natural key: filename. When a media doc already exists we update its
  // metadata only and skip the (network) re-fetch + re-upload.
  for (const m of collections.media) {
    const data = { alt: m.alt, caption: m.caption, credit: m.credit };
    const existing = await findByKey(payload, "media", "filename", m.filename);
    if (existing) {
      if (!dryRun) {
        await payload.update({ collection: "media", id: existing.id, data });
      }
      idMap.set(m.id, existing.id);
      updated.media++;
      continue;
    }
    if (dryRun) {
      counts.media++;
      continue;
    }
    const res = await doFetch(m.sourceUrl || m.url);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch media asset ${m.sourceUrl || m.url}: ${res.status}`,
      );
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const created = await payload.create({
      collection: "media",
      data,
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

  // 2) Authors — natural key: slug.
  for (const a of collections.authors) {
    const data = {
      name: a.name,
      slug: a.slug,
      bio: a.bio,
      role: a.role,
      email: a.email,
      avatar: remap(a.avatar),
      social: a.social,
    };
    const existing = await findByKey(payload, "authors", "slug", a.slug);
    if (existing) {
      if (!dryRun) {
        await payload.update({ collection: "authors", id: existing.id, data });
      }
      idMap.set(a.id, existing.id);
      updated.authors++;
      continue;
    }
    if (dryRun) {
      counts.authors++;
      continue;
    }
    const created = await payload.create({ collection: "authors", data });
    idMap.set(a.id, created.id);
    counts.authors++;
  }

  // 3) Categories — natural key: slug. First pass without parent, then patch
  // parents (so a parent always exists before a child references it).
  for (const c of collections.categories) {
    const data = { title: c.title, slug: c.slug, description: c.description };
    const existing = await findByKey(payload, "categories", "slug", c.slug);
    if (existing) {
      if (!dryRun) {
        await payload.update({
          collection: "categories",
          id: existing.id,
          data,
        });
      }
      idMap.set(c.id, existing.id);
      updated.categories++;
      continue;
    }
    if (dryRun) {
      counts.categories++;
      continue;
    }
    const created = await payload.create({ collection: "categories", data });
    idMap.set(c.id, created.id);
    counts.categories++;
  }
  if (!dryRun) {
    for (const c of collections.categories) {
      if (!c.parent) continue;
      await payload.update({
        collection: "categories",
        id: idMap.get(c.id)!,
        data: { parent: remap(c.parent) },
      });
    }
  }

  // 4) Tags — natural key: slug.
  for (const t of collections.tags) {
    const data = { title: t.title, slug: t.slug, description: t.description };
    const existing = await findByKey(payload, "tags", "slug", t.slug);
    if (existing) {
      if (!dryRun) {
        await payload.update({ collection: "tags", id: existing.id, data });
      }
      idMap.set(t.id, existing.id);
      updated.tags++;
      continue;
    }
    if (dryRun) {
      counts.tags++;
      continue;
    }
    const created = await payload.create({ collection: "tags", data });
    idMap.set(t.id, created.id);
    counts.tags++;
  }

  // 5) Posts — natural key: slug.
  for (const p of collections.posts) {
    const data = {
      title: p.title,
      slug: p.slug,
      subtitle: p.subtitle,
      excerpt: p.excerpt,
      _status: p._status,
      language: p.language,
      publishedAt: p.publishedAt,
      author: remap(p.author),
      categories: p.categories.map(remap).filter(Boolean),
      primaryCategory: remap(p.primaryCategory),
      tags: p.tags.map(remap).filter(Boolean),
      heroImage: remap(p.heroImage),
      layout: p.layout,
      content: p.content,
      contentHtml: p.contentHtml,
      meta: p.meta,
      url: p.url,
      readingTimeMinutes: p.readingTimeMinutes,
      wordCount: p.wordCount,
      breadcrumbs: p.breadcrumbs,
      faq: p.faq,
      structuredData: p.structuredData,
      inlineImages: p.inlineImages
        .map((ii) => ({
          image: remap(ii.image),
          role: ii.role,
          position: ii.position,
        }))
        .filter((ii) => ii.image != null),
      links: p.links,
      metadata: p.metadata,
    };
    const draft = p._status !== "published";
    const existing = await findByKey(payload, "posts", "slug", p.slug);
    if (existing) {
      if (!dryRun) {
        await payload.update({
          collection: "posts",
          id: existing.id,
          data,
          draft,
        });
      }
      idMap.set(p.id, existing.id);
      updated.posts++;
      continue;
    }
    if (dryRun) {
      counts.posts++;
      continue;
    }
    const created = await payload.create({ collection: "posts", draft, data });
    idMap.set(p.id, created.id);
    counts.posts++;
  }

  return { idMap, counts, updated };
}
