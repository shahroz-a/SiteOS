import { describe, it, expect } from "vitest";
import { computeSourceDiff } from "../source-diff";

describe("computeSourceDiff", () => {
  it("reports a clean import with no losses", () => {
    const r = computeSourceDiff({
      sourceHtml: "<p>First.</p><p>Second.</p>",
      sourceKind: "cleaned",
      componentTree: [
        { type: "paragraph", text: "First." },
        { type: "paragraph", text: "Second." },
      ],
      richText: null,
    });
    expect(r.hasSource).toBe(true);
    expect(r.hasParsed).toBe(true);
    expect(r.total).toBe(0);
    expect(r.sourceBlocks.every((b) => b.kind === "equal")).toBe(true);
  });

  it("flags a dropped paragraph, a missing image, and a dropped link", () => {
    const r = computeSourceDiff({
      sourceHtml: `
        <p>Kept paragraph.</p>
        <p>Dropped paragraph the importer lost.</p>
        <p><img src="https://cdn-img.headout.com/missing.jpg" alt="Gone"></p>
        <p><a href="https://www.headout.com/dropped">Dropped link</a></p>
      `,
      sourceKind: "cleaned",
      componentTree: [{ type: "paragraph", text: "Kept paragraph." }],
      richText: null,
    });
    expect(r.counts.dropped).toBeGreaterThanOrEqual(1);
    expect(r.missingImages).toEqual([
      { url: "https://cdn-img.headout.com/missing.jpg", alt: "Gone" },
    ]);
    expect(r.droppedLinks.map((l) => l.url)).toContain(
      "https://www.headout.com/dropped",
    );
    expect(r.total).toBeGreaterThan(0);
    const dropped = r.sourceBlocks.find((b) => b.kind === "removed");
    expect(dropped?.text).toContain("Dropped paragraph");
  });

  it("does not flag images/links the importer kept (ignoring query + origin)", () => {
    const r = computeSourceDiff({
      sourceHtml: `<p><img src="https://cdn-img.headout.com/a.jpg?w=800" alt="A"></p>`,
      sourceKind: "cleaned",
      componentTree: [
        {
          type: "image",
          data: { src: "https://cdn-img.headout.com/a.jpg", alt: "A" },
        },
      ],
      richText: null,
    });
    expect(r.missingImages).toEqual([]);
  });

  it("treats everything as dropped when nothing parsed", () => {
    const r = computeSourceDiff({
      sourceHtml: "<p>Alpha.</p><p>Beta.</p>",
      sourceKind: "original",
      componentTree: null,
      richText: null,
    });
    expect(r.hasParsed).toBe(false);
    expect(r.counts.dropped).toBe(2);
    expect(r.total).toBe(2);
  });
});
