# Payload CMS export

This directory turns the migrated content (the `pages` tree plus its related
authors, categories, tags, media, SEO and structured data) into **Payload CMS
collection documents** so editors can manage the content in Payload after the
migration.

- `mapping.ts` — pure, DB-free functions that map migration row shapes into
  Payload documents (including `componentTree` → Payload `layout` blocks). Safe
  to unit-test and reuse without a database.
- `../export-payload.ts` — reads the database and writes a single export JSON.

## 1. Run the export

```bash
pnpm --filter @workspace/scripts run export:payload
# custom output path:
pnpm --filter @workspace/scripts run export:payload -- --out ./payload-export.json
```

Requires `DATABASE_URL` (or `SUPABASE_DATABASE_URL`) to be set — the same
connection the rest of the workspace uses.

Default output: `scripts/out/payload-export.json`.

## 2. Export shape

```jsonc
{
  "exportedAt": "2026-06-18T00:00:00.000Z",
  "schemaVersion": "1",
  "collections": {
    "media":      [ /* PayloadMediaDoc */ ],
    "authors":    [ /* PayloadAuthorDoc */ ],
    "categories": [ /* PayloadCategoryDoc */ ],
    "tags":       [ /* PayloadTagDoc */ ],
    "posts":      [ /* PayloadPostDoc */ ]
  }
}
```

Key conventions:

- **Stable ids.** Every document keeps its original migration UUID as `id`.
  Relationship fields (`author`, `categories`, `tags`, `heroImage`, category
  `parent`) reference related documents **by that UUID string** — the shape a
  Payload relationship value expects. The loader below remaps these UUIDs to the
  ids Payload generates on create.
- **Media is an upload collection.** Each `media` doc carries `sourceUrl` /
  `url` (the original CDN asset) plus `filename`, `mimeType`, `width`,
  `height`. Files are *not* downloaded by the export — the loader fetches and
  uploads each asset so Payload stores its own copy.
- **`posts.layout`** is a Payload `blocks` field assembled from each page's
  `componentTree`. Block types emitted: `heading`, `paragraph`, `list`,
  `section` (nested `content` blocks) and `html`. The lossless `content`
  (rich-text JSON) and `contentHtml` (cleaned HTML) are preserved alongside it
  so nothing is lost if your block set differs.
- **Order matters.** Load `media → authors → categories → tags → posts` so
  relationships resolve.

## 3. Load into a Payload instance

The export is intentionally adapter-agnostic JSON. Load it with Payload's
[Local API](https://payloadcms.com/docs/local-api/overview). Your Payload config
needs collections matching the fields above (`media` as an `upload` collection;
`authors`, `categories`, `tags`, `posts`; relationship fields as listed). Then
run a one-off seed script inside your Payload project:

```ts
// payload-import.ts (run inside your Payload project: `payload run payload-import.ts`)
import { getPayload } from "payload";
import config from "@payload-config";
import { readFile } from "node:fs/promises";

type Export = {
  collections: {
    media: any[];
    authors: any[];
    categories: any[];
    tags: any[];
    posts: any[];
  };
};

async function main() {
  const payload = await getPayload({ config });
  const data: Export = JSON.parse(await readFile("payload-export.json", "utf8"));

  // old migration UUID -> new Payload id
  const idMap = new Map<string, string | number>();
  const remap = (uuid: string | null) =>
    uuid ? (idMap.get(uuid) ?? null) : null;

  // 1) Media — fetch each source asset and upload it.
  for (const m of data.collections.media) {
    const res = await fetch(m.sourceUrl || m.url);
    const buffer = Buffer.from(await res.arrayBuffer());
    const created = await payload.create({
      collection: "media",
      data: { alt: m.alt, caption: m.caption, credit: m.credit },
      file: {
        data: buffer,
        name: m.filename,
        mimetype: m.mimeType ?? res.headers.get("content-type") ?? "image/jpeg",
        size: buffer.byteLength,
      },
    });
    idMap.set(m.id, created.id);
  }

  // 2) Authors
  for (const a of data.collections.authors) {
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
  }

  // 3) Categories (first pass without parent, then patch parents)
  for (const c of data.collections.categories) {
    const created = await payload.create({
      collection: "categories",
      data: { title: c.title, slug: c.slug, description: c.description },
    });
    idMap.set(c.id, created.id);
  }
  for (const c of data.collections.categories) {
    if (!c.parent) continue;
    await payload.update({
      collection: "categories",
      id: idMap.get(c.id)!,
      data: { parent: remap(c.parent) },
    });
  }

  // 4) Tags
  for (const t of data.collections.tags) {
    const created = await payload.create({
      collection: "tags",
      data: { title: t.title, slug: t.slug, description: t.description },
    });
    idMap.set(t.id, created.id);
  }

  // 5) Posts
  for (const p of data.collections.posts) {
    await payload.create({
      collection: "posts",
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
        layout: p.layout, // Payload blocks
        content: p.content,
        contentHtml: p.contentHtml,
        meta: p.meta,
        breadcrumbs: p.breadcrumbs,
        faq: p.faq,
      },
    });
  }

  console.log("Imported into Payload.");
  process.exit(0);
}

main();
```

Notes:

- `_status` requires `versions.drafts` enabled on the `posts` collection.
- If you prefer to keep the original UUIDs as Payload ids, configure a custom
  `id` field on each collection and pass `id` directly to `payload.create` —
  then the `idMap` remap step is unnecessary.
- `layout` blocks assume your `posts` collection defines a `blocks` field with
  `heading` / `paragraph` / `list` / `section` / `html` blocks. Adjust the block
  set to taste; `content`/`contentHtml` remain available as a fallback.
