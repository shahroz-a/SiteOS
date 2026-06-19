/**
 * Declarative documentation of how the migration database maps onto a Payload
 * CMS instance: which DB entity becomes which Payload collection, and which
 * component-tree block type becomes which Payload block. This is the source the
 * CMS "Payload compatibility" panel renders. The actual runtime migration report
 * (counts, unmapped block types) is computed against live data by the API.
 */

export interface PayloadFieldMapping {
  field: string;
  from: string;
  type: string;
}

export interface PayloadCollectionMapping {
  slug: string;
  label: string;
  source: string;
  description: string;
  fields: PayloadFieldMapping[];
}

export interface PayloadBlockMapping {
  blockType: string;
  payloadBlock: string;
  label: string;
  description: string;
}

export const PAYLOAD_COLLECTIONS: PayloadCollectionMapping[] = [
  {
    slug: "authors",
    label: "Authors",
    source: "authors",
    description: "Article bylines. Keyed by slug.",
    fields: [
      { field: "name", from: "name", type: "text" },
      { field: "slug", from: "slug", type: "text" },
      { field: "bio", from: "bio", type: "textarea" },
      { field: "avatar", from: "avatarUrl", type: "upload (media)" },
      { field: "role", from: "role", type: "text" },
      { field: "email", from: "email", type: "email" },
      { field: "social", from: "social", type: "json" },
    ],
  },
  {
    slug: "categories",
    label: "Categories",
    source: "categories",
    description: "Hierarchical taxonomy. Keyed by slug; parent resolved by slug.",
    fields: [
      { field: "title", from: "name", type: "text" },
      { field: "slug", from: "slug", type: "text" },
      { field: "description", from: "description", type: "textarea" },
      { field: "parent", from: "parentSlug", type: "relationship (categories)" },
    ],
  },
  {
    slug: "tags",
    label: "Tags",
    source: "tags",
    description: "Flat taxonomy. Keyed by slug.",
    fields: [
      { field: "title", from: "name", type: "text" },
      { field: "slug", from: "slug", type: "text" },
      { field: "description", from: "description", type: "textarea" },
    ],
  },
  {
    slug: "media",
    label: "Media",
    source: "images",
    description: "Deduplicated images (hero + inline) referenced by posts.",
    fields: [
      { field: "url", from: "url", type: "text" },
      { field: "alt", from: "alt", type: "text" },
      { field: "caption", from: "caption", type: "text" },
      { field: "credit", from: "credit", type: "text" },
      { field: "width", from: "width", type: "number" },
      { field: "height", from: "height", type: "number" },
      { field: "mimeType", from: "mimeType", type: "text" },
      { field: "filesize", from: "fileSize", type: "number" },
    ],
  },
  {
    slug: "posts",
    label: "Posts",
    source: "pages",
    description: "Articles. Keyed by canonical URL; relationships resolved by slug.",
    fields: [
      { field: "title", from: "title", type: "text" },
      { field: "slug", from: "slug", type: "text" },
      { field: "_status", from: "status", type: "select (draft|published)" },
      { field: "author", from: "authorSlug", type: "relationship (authors)" },
      { field: "categories", from: "categorySlugs", type: "relationship[] (categories)" },
      { field: "tags", from: "tagSlugs", type: "relationship[] (tags)" },
      { field: "heroImage", from: "featuredImageUrl", type: "upload (media)" },
      { field: "layout", from: "componentTree", type: "blocks" },
      { field: "content", from: "richText", type: "richText (lexical)" },
      { field: "meta", from: "seo", type: "group" },
    ],
  },
];

export const PAYLOAD_BLOCK_MAPPINGS: PayloadBlockMapping[] = [
  { blockType: "section", payloadBlock: "section", label: "Section", description: "Heading + nested children." },
  { blockType: "heading", payloadBlock: "heading", label: "Heading", description: "h1–h6 heading." },
  { blockType: "paragraph", payloadBlock: "richText", label: "Paragraph", description: "Body copy → richText block." },
  { blockType: "richText", payloadBlock: "richText", label: "Rich text", description: "Inline-formatted rich text." },
  { blockType: "list", payloadBlock: "list", label: "List", description: "Ordered / unordered list." },
  { blockType: "image", payloadBlock: "mediaBlock", label: "Image", description: "Single image → media block." },
  { blockType: "gallery", payloadBlock: "galleryBlock", label: "Gallery", description: "Image gallery." },
  { blockType: "video", payloadBlock: "videoBlock", label: "Video", description: "Embedded video." },
  { blockType: "embed", payloadBlock: "embedBlock", label: "Embed", description: "Third-party embed / iframe." },
  { blockType: "quote", payloadBlock: "quote", label: "Quote", description: "Blockquote / pull quote." },
  { blockType: "code", payloadBlock: "code", label: "Code", description: "Code block." },
  { blockType: "table", payloadBlock: "tableBlock", label: "Table", description: "Tabular content." },
  { blockType: "callout", payloadBlock: "callout", label: "Callout", description: "Highlighted callout / notice." },
  { blockType: "faq", payloadBlock: "faqBlock", label: "FAQ", description: "Question/answer accordion." },
  { blockType: "accordion", payloadBlock: "accordionBlock", label: "Accordion", description: "Collapsible content." },
  { blockType: "button", payloadBlock: "button", label: "Button", description: "Call-to-action button." },
  { blockType: "divider", payloadBlock: "divider", label: "Divider", description: "Horizontal rule." },
  { blockType: "html", payloadBlock: "htmlBlock", label: "Raw HTML", description: "Verbatim HTML fallback." },
];

const BLOCK_MAP_BY_TYPE = new Map(
  PAYLOAD_BLOCK_MAPPINGS.map((m) => [m.blockType, m]),
);

export function findBlockMapping(
  blockType: string,
): PayloadBlockMapping | undefined {
  return BLOCK_MAP_BY_TYPE.get(blockType);
}
