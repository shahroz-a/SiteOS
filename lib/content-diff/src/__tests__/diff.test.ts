import { describe, it, expect } from "vitest";
import {
  diffBlocks,
  diffWords,
  diffUrlSets,
  normalizeText,
  normalizeUrl,
} from "../diff";

describe("normalizeText", () => {
  it("collapses whitespace and lowercases", () => {
    expect(normalizeText("  Hello   World\n")).toBe("hello world");
  });
});

describe("diffBlocks", () => {
  it("reports no changes when source and parsed match", () => {
    const a = ["First paragraph.", "Second paragraph."];
    const r = diffBlocks(a, [...a]);
    expect(r.dropped).toBe(0);
    expect(r.added).toBe(0);
    expect(r.changed).toBe(0);
    expect(r.blocks.every((b) => b.kind === "equal")).toBe(true);
  });

  it("flags a dropped paragraph the importer lost", () => {
    const source = ["Intro line.", "A paragraph that was dropped.", "Outro."];
    const parsed = ["Intro line.", "Outro."];
    const r = diffBlocks(source, parsed);
    expect(r.dropped).toBe(1);
    expect(r.added).toBe(0);
    const removed = r.blocks.find((b) => b.kind === "removed");
    expect(removed?.sourceIndex).toBe(1);
    expect(removed?.sourceText).toContain("dropped");
  });

  it("pairs a lightly edited paragraph as a single changed block", () => {
    const source = ["The quick brown fox jumps over the lazy dog."];
    const parsed = ["The quick brown fox jumps over the dog."];
    const r = diffBlocks(source, parsed);
    expect(r.changed).toBe(1);
    expect(r.dropped).toBe(0);
    expect(r.added).toBe(0);
    const changed = r.blocks.find((b) => b.kind === "changed");
    expect(changed?.words?.some((w) => w.type === "removed")).toBe(true);
  });

  it("flags importer-only content as added", () => {
    const source = ["Real content."];
    const parsed = ["Real content.", "Boilerplate the importer injected."];
    const r = diffBlocks(source, parsed);
    expect(r.added).toBe(1);
    expect(r.dropped).toBe(0);
  });

  it("treats everything as dropped when parsed is empty", () => {
    const source = ["One.", "Two.", "Three."];
    const r = diffBlocks(source, []);
    expect(r.dropped).toBe(3);
  });
});

describe("diffWords", () => {
  it("marks removed and added words", () => {
    const segs = diffWords("alpha beta gamma", "alpha delta gamma");
    expect(segs.some((s) => s.type === "removed" && s.text.includes("beta")))
      .toBe(true);
    expect(segs.some((s) => s.type === "added" && s.text.includes("delta")))
      .toBe(true);
    expect(segs.some((s) => s.type === "equal")).toBe(true);
  });
});

describe("normalizeUrl", () => {
  it("drops origin so relative and absolute paths match", () => {
    expect(normalizeUrl("https://www.headout.com/blog/foo/")).toBe(
      normalizeUrl("/blog/foo"),
    );
  });

  it("rejects non-navigational targets", () => {
    expect(normalizeUrl("#section")).toBe("");
    expect(normalizeUrl("mailto:a@b.com")).toBe("");
    expect(normalizeUrl("javascript:void(0)")).toBe("");
  });
});

describe("diffUrlSets", () => {
  it("finds source URLs missing from parsed (ignoring origin + query)", () => {
    const source = [
      "https://cdn.headout.com/a.jpg?w=800",
      "https://cdn.headout.com/b.jpg",
    ];
    const parsed = ["https://cdn.headout.com/a.jpg"];
    const { missing } = diffUrlSets(source, parsed);
    expect(missing).toEqual(["https://cdn.headout.com/b.jpg"]);
  });

  it("reports importer-only URLs as extra", () => {
    const { extra } = diffUrlSets(
      ["/blog/keep"],
      ["/blog/keep", "/blog/cta-injected"],
    );
    expect(extra).toEqual(["/blog/cta-injected"]);
  });
});
