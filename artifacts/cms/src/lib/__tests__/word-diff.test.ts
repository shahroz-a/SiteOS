import { describe, it, expect } from "vitest";
import { diffWords, type DiffSegment } from "../word-diff";

function reconstructBefore(segments: DiffSegment[]): string {
  return segments
    .filter((s) => s.op !== "insert")
    .map((s) => s.text)
    .join("");
}

function reconstructAfter(segments: DiffSegment[]): string {
  return segments
    .filter((s) => s.op !== "delete")
    .map((s) => s.text)
    .join("");
}

describe("diffWords", () => {
  it("returns a single equal segment for identical text", () => {
    const segs = diffWords("the quick brown fox", "the quick brown fox");
    expect(segs).toEqual([{ op: "equal", text: "the quick brown fox" }]);
  });

  it("marks an added word as an insertion while keeping context equal", () => {
    const segs = diffWords("the quick fox", "the quick brown fox");
    expect(segs.some((s) => s.op === "insert" && s.text.includes("brown"))).toBe(
      true,
    );
    expect(segs.some((s) => s.op === "delete")).toBe(false);
  });

  it("marks a removed word as a deletion", () => {
    const segs = diffWords("the quick brown fox", "the quick fox");
    expect(segs.some((s) => s.op === "delete" && s.text.includes("brown"))).toBe(
      true,
    );
    expect(segs.some((s) => s.op === "insert")).toBe(false);
  });

  it("captures both deletions and insertions on a replacement", () => {
    const segs = diffWords("the quick brown fox", "the slow brown fox");
    expect(segs.some((s) => s.op === "delete" && s.text.includes("quick"))).toBe(
      true,
    );
    expect(segs.some((s) => s.op === "insert" && s.text.includes("slow"))).toBe(
      true,
    );
  });

  it("treats an empty before as an all-insert (newly added field)", () => {
    const segs = diffWords("", "brand new value");
    expect(segs).toEqual([{ op: "insert", text: "brand new value" }]);
  });

  it("treats an empty after as an all-delete (cleared field)", () => {
    const segs = diffWords("old value gone", "");
    expect(segs).toEqual([{ op: "delete", text: "old value gone" }]);
  });

  it("preserves whitespace so segments reassemble the originals", () => {
    const before = "line one\n\nthe quick brown fox\ntrailing";
    const after = "line one\n\nthe slow brown fox\ntrailing";
    const segs = diffWords(before, after);
    expect(reconstructBefore(segs)).toBe(before);
    expect(reconstructAfter(segs)).toBe(after);
  });

  it("diffs HTML source as text without executing it", () => {
    const before = "<p>Hello world</p>";
    const after = "<p>Hello brave world</p>";
    const segs = diffWords(before, after);
    expect(reconstructBefore(segs)).toBe(before);
    expect(reconstructAfter(segs)).toBe(after);
    expect(segs.some((s) => s.op === "insert" && s.text.includes("brave"))).toBe(
      true,
    );
  });

  it("never interleaves adjacent same-op tokens into separate segments", () => {
    const segs = diffWords("a b c d", "a x y d");
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].op).not.toBe(segs[i - 1].op);
    }
  });

  it("falls back to a coarse delete+insert for very large rewrites", () => {
    const before = Array.from({ length: 2500 }, (_, i) => `old${i}`).join(" ");
    const after = Array.from({ length: 2500 }, (_, i) => `new${i}`).join(" ");
    const segs = diffWords(before, after);
    expect(reconstructBefore(segs)).toBe(before);
    expect(reconstructAfter(segs)).toBe(after);
    expect(segs.some((s) => s.op === "delete")).toBe(true);
    expect(segs.some((s) => s.op === "insert")).toBe(true);
  });
});
