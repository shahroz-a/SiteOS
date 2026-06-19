/**
 * @workspace/content-io — canonical content bundle + multi-format
 * serializers/parsers (JSON, CSV, Markdown, SQL, Payload manifest) and the
 * declarative Payload collection/block mapping registry. DB-free: the API server
 * reads/writes the database into/from a `ContentBundle`, and this lib handles
 * every on-disk format.
 */
export * from "./types.js";
export { serializeJson, parseJson } from "./json.js";
export { serializeCsv, parseCsv } from "./csv.js";
export {
  serializeMarkdown,
  serializeMarkdownFiles,
  serializePostMarkdown,
  parseMarkdown,
  parsePostMarkdown,
} from "./markdown.js";
export { serializeSql, pseudoUuid } from "./sql.js";
export {
  serializePayload,
  bundleToPayloadManifest,
  payloadManifestToBundle,
  type PayloadManifest,
  type PayloadAuthorDoc,
  type PayloadCategoryDoc,
  type PayloadTagDoc,
  type PayloadMediaDoc,
  type PayloadPostDoc,
} from "./payload.js";
export * from "./mapping-registry.js";

import type { ContentBundle, ExportFormat } from "./types.js";
import { serializeJson } from "./json.js";
import { serializeCsv } from "./csv.js";
import { serializeMarkdown } from "./markdown.js";
import { serializeSql } from "./sql.js";
import { serializePayload } from "./payload.js";
import { parseJson } from "./json.js";
import { parseCsv } from "./csv.js";
import { parseMarkdown } from "./markdown.js";
import { payloadManifestToBundle } from "./payload.js";
import type { ImportFormat } from "./types.js";

export interface FormatMeta {
  extension: string;
  contentType: string;
}

export const FORMAT_META: Record<ExportFormat, FormatMeta> = {
  json: { extension: "json", contentType: "application/json" },
  csv: { extension: "csv", contentType: "text/csv" },
  markdown: { extension: "md", contentType: "text/markdown" },
  sql: { extension: "sql", contentType: "application/sql" },
  payload: { extension: "payload.json", contentType: "application/json" },
};

/** Serialize a bundle to the requested format's string representation. */
export function serializeBundle(
  bundle: ContentBundle,
  format: ExportFormat,
): string {
  switch (format) {
    case "json":
      return serializeJson(bundle);
    case "csv":
      return serializeCsv(bundle);
    case "markdown":
      return serializeMarkdown(bundle);
    case "sql":
      return serializeSql(bundle);
    case "payload":
      return serializePayload(bundle);
  }
}

/** Parse a string in the given format back into a normalized bundle. */
export function parseBundle(text: string, format: ImportFormat): ContentBundle {
  switch (format) {
    case "json":
      return parseJson(text);
    case "csv":
      return parseCsv(text);
    case "markdown":
      return parseMarkdown(text);
    case "payload":
      return payloadManifestToBundle(JSON.parse(text));
  }
}
