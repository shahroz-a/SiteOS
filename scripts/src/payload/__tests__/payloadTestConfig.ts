/**
 * Boots an ephemeral, real Payload CMS instance for integration testing the
 * documented export loader (`../load.ts`). Uses the in-process SQLite adapter
 * pointed at a throwaway temp directory, so each run gets a clean schema with no
 * external services. The collection config here is the concrete, runnable
 * version of "your Payload config needs collections matching these fields" from
 * `../README.md`: if our export document shapes ever drift from a plausible
 * Payload schema, booting + loading against this config fails.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { buildConfig, getPayload, type Block, type CollectionConfig } from "payload";

const headingBlock: Block = {
  slug: "heading",
  fields: [
    { name: "level", type: "number" },
    { name: "text", type: "textarea" },
    { name: "anchorId", type: "text" },
  ],
};

const paragraphBlock: Block = {
  slug: "paragraph",
  fields: [{ name: "text", type: "textarea" }],
};

const listBlock: Block = {
  slug: "list",
  fields: [
    { name: "title", type: "text" },
    { name: "ordered", type: "checkbox" },
    { name: "items", type: "json" },
  ],
};

const htmlBlock: Block = {
  slug: "html",
  fields: [{ name: "html", type: "code" }],
};

const sectionBlock: Block = {
  slug: "section",
  fields: [
    { name: "heading", type: "text" },
    { name: "anchorId", type: "text" },
    {
      name: "content",
      type: "blocks",
      blocks: [headingBlock, paragraphBlock, listBlock, htmlBlock],
    },
  ],
};

const media: CollectionConfig = {
  slug: "media",
  upload: { staticDir: "" }, // staticDir filled in per-instance below
  fields: [
    { name: "alt", type: "text" },
    { name: "caption", type: "text" },
    { name: "credit", type: "text" },
  ],
};

const authors: CollectionConfig = {
  slug: "authors",
  fields: [
    { name: "name", type: "text", required: true },
    { name: "slug", type: "text", required: true },
    { name: "bio", type: "textarea" },
    { name: "role", type: "text" },
    { name: "email", type: "text" },
    { name: "avatar", type: "relationship", relationTo: "media" },
    { name: "social", type: "json" },
  ],
};

const categories: CollectionConfig = {
  slug: "categories",
  fields: [
    { name: "title", type: "text", required: true },
    { name: "slug", type: "text", required: true },
    { name: "description", type: "textarea" },
    { name: "parent", type: "relationship", relationTo: "categories" },
  ],
};

const tags: CollectionConfig = {
  slug: "tags",
  fields: [
    { name: "title", type: "text", required: true },
    { name: "slug", type: "text", required: true },
    { name: "description", type: "textarea" },
  ],
};

const posts: CollectionConfig = {
  slug: "posts",
  versions: { drafts: true },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "slug", type: "text", required: true },
    { name: "subtitle", type: "text" },
    { name: "excerpt", type: "textarea" },
    { name: "publishedAt", type: "date" },
    { name: "author", type: "relationship", relationTo: "authors" },
    { name: "categories", type: "relationship", relationTo: "categories", hasMany: true },
    { name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
    { name: "heroImage", type: "relationship", relationTo: "media" },
    {
      name: "layout",
      type: "blocks",
      blocks: [headingBlock, paragraphBlock, listBlock, sectionBlock, htmlBlock],
    },
    { name: "content", type: "json" },
    { name: "contentHtml", type: "code" },
    {
      name: "meta",
      type: "group",
      fields: [
        { name: "title", type: "text" },
        { name: "description", type: "textarea" },
        { name: "image", type: "text" },
        { name: "canonicalUrl", type: "text" },
        { name: "robots", type: "text" },
        { name: "keywords", type: "json" },
        { name: "ogTitle", type: "text" },
        { name: "ogDescription", type: "textarea" },
        { name: "twitterCard", type: "text" },
      ],
    },
    {
      name: "breadcrumbs",
      type: "array",
      fields: [
        { name: "label", type: "text" },
        { name: "url", type: "text" },
      ],
    },
    {
      name: "faq",
      type: "array",
      fields: [
        { name: "question", type: "text" },
        { name: "answer", type: "textarea" },
      ],
    },
  ],
};

export interface TestPayload {
  payload: Awaited<ReturnType<typeof getPayload>>;
  cleanup: () => Promise<void>;
}

/** Boot a fresh ephemeral Payload instance with the documented collections. */
export async function createTestPayload(): Promise<TestPayload> {
  const dir = await mkdtemp(join(tmpdir(), "payload-export-it-"));
  const config = await buildConfig({
    secret: "integration-test-secret",
    db: sqliteAdapter({ client: { url: `file:${join(dir, "test.db")}` } }),
    collections: [
      { ...media, upload: { staticDir: join(dir, "media") } },
      authors,
      categories,
      tags,
      posts,
    ],
    typescript: { outputFile: join(dir, "types.ts") },
  });
  const payload = await getPayload({ config });
  return {
    payload,
    cleanup: async () => {
      await payload.destroy?.();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
