import { describe, it, expect } from "vitest";
import {
  buildDiffMarkers,
  computeSourceDiff,
  truncateLabel,
} from "../source-diff";

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

describe("truncateLabel", () => {
  it("collapses whitespace and clips long text", () => {
    expect(truncateLabel("  a   b\nc  ")).toBe("a b c");
    expect(truncateLabel("abcdef", 3)).toBe("abc…");
    expect(truncateLabel("abc", 3)).toBe("abc");
  });
});

describe("buildDiffMarkers", () => {
  it("returns no markers for a clean import", () => {
    const r = computeSourceDiff({
      sourceHtml: "<p>First.</p><p>Second.</p>",
      sourceKind: "cleaned",
      componentTree: [
        { type: "paragraph", text: "First." },
        { type: "paragraph", text: "Second." },
      ],
      richText: null,
    });
    expect(buildDiffMarkers(r)).toEqual([]);
  });

  it("orders markers blocks-then-images-then-links and labels them", () => {
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
    const markers = buildDiffMarkers(r);

    // Blocks come first (in document order), then images, then links. The
    // link's paragraph text is itself a dropped block, so there are 2 removed.
    const types = markers.map((m) => m.type);
    expect(types.slice(-2)).toEqual(["image", "link"]);
    expect(types.filter((t) => t === "removed").length).toBe(2);
    expect(types.indexOf("removed")).toBeLessThan(types.indexOf("image"));
    // Block marker indexes point back into sourceBlocks.
    const removed = markers.find((m) => m.type === "removed");
    expect(r.sourceBlocks[removed!.index].kind).toBe("removed");
    // Image/link marker indexes point into their result arrays.
    const image = markers.find((m) => m.type === "image");
    expect(r.missingImages[image!.index].url).toContain("missing.jpg");
    const link = markers.find((m) => m.type === "link");
    expect(r.droppedLinks[link!.index].url).toContain("/dropped");
    // Labels are human-readable, not raw URLs when alt/text exist.
    expect(image!.label).toBe("Gone");
    expect(link!.label).toBe("Dropped link");
    // Marker count never includes importer-added blocks.
    expect(markers.length).toBe(r.total);
  });

  it("includes changed blocks as steppable markers", () => {
    const r = computeSourceDiff({
      sourceHtml: "<p>The quick brown fox jumps over the lazy dog.</p>",
      sourceKind: "cleaned",
      componentTree: [
        { type: "paragraph", text: "The quick brown fox jumps over the dog." },
      ],
      richText: null,
    });
    const markers = buildDiffMarkers(r);
    expect(markers).toHaveLength(1);
    expect(markers[0].type).toBe("changed");
  });
});
