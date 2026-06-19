import { normalizeBundle, type ContentBundle } from "./types.js";

/** Serialize a bundle to pretty-printed JSON — the lossless reference format. */
export function serializeJson(bundle: ContentBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/** Parse JSON text back into a normalized bundle. */
export function parseJson(text: string): ContentBundle {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Invalid JSON bundle: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return normalizeBundle(data);
}
