import { describe, expect, it } from "vitest";
import { parsePage } from "../parse";
import type { FetchResult, BlockNode } from "../types";

function makeFetch(bodyHtml: string): FetchResult {
  const html = `<!doctype html><html lang="en"><head>
    <title>Test</title>
    <meta property="og:title" content="Barcelona Aquarium" />
    <link rel="canonical" href="https://www.headout.com/blog/barcelona-aquarium/" />
  </head><body>
    <article class="post category-things-to-do">
      <div class="post-content entry-content">${bodyHtml}</div>
    </article>
  </body></html>`;
  return {
    url: "https://www.headout.com/blog/barcelona-aquarium/",
    finalUrl: "https://www.headout.com/blog/barcelona-aquarium/",
    httpStatus: 200,
    headers: {},
    html,
    durationMs: 1,
  };
}

/** Collect every anchorId in a block tree in document order. */
function collectAnchorIds(nodes: BlockNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.anchorId) out.push(node.anchorId);
    if (node.children?.length) out.push(...collectAnchorIds(node.children));
  }
  return out;
}

describe("parsePage anchor generation", () => {
  it("produces a unique, meaningful anchorId per section even when source ids collide", () => {
    // Nine sections all share the junk id `3a`, mirroring the real article.
    const sections = Array.from({ length: 9 })
      .map(
        (_, i) =>
          `<h2 id="3a">Section ${i + 1}</h2><p>Body for section ${i + 1}.</p>`,
      )
      .join("");
    const parsed = parsePage(makeFetch(sections));

    const ids = collectAnchorIds(parsed.blocks);
    // Derived from heading text, not the junk `3a`.
    expect(ids).toContain("section-1");
    expect(ids).not.toContain("3a");
    // Every anchorId is unique.
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(9);
  });

  it("disambiguates sections that share identical heading text", () => {
    const body = `
      <h2>Where to Eat</h2><p>One.</p>
      <h2>Where to Eat</h2><p>Two.</p>
      <h2>Where to Eat</h2><p>Three.</p>`;
    const parsed = parsePage(makeFetch(body));
    const ids = collectAnchorIds(parsed.blocks);
    expect(ids).toEqual(["where-to-eat", "where-to-eat-2", "where-to-eat-3"]);
  });
});
