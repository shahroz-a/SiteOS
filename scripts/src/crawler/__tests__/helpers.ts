import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ComponentNode, FetchResult } from "../types";

const here = dirname(fileURLToPath(import.meta.url));

/** Read a saved HTML fixture from the `fixtures/` directory. */
export function loadFixture(name: string): string {
  return readFileSync(join(here, "fixtures", name), "utf8");
}

/** Build a `FetchResult` around fixture HTML for a given URL. */
export function makeFetchResult(html: string, url: string): FetchResult {
  return {
    requestedUrl: url,
    finalUrl: url,
    httpStatus: 200,
    html,
    redirectChain: [],
    via: "http",
    httpHeaders: { "content-type": "text/html" },
  };
}

/** Recursively collect every block `type` in a component tree (document order). */
export function flattenComponentTypes(nodes: ComponentNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    out.push(node.type);
    if (node.children?.length) out.push(...flattenComponentTypes(node.children));
  }
  return out;
}
