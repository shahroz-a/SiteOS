import { describe, expect, it } from "vitest";
import { createAnchorAllocator } from "../anchors";

describe("createAnchorAllocator", () => {
  it("returns the preferred base verbatim on first use", () => {
    const alloc = createAnchorAllocator();
    expect(alloc("new-york")).toBe("new-york");
    expect(alloc("boston")).toBe("boston");
  });

  it("appends incrementing numeric suffixes on collision", () => {
    const alloc = createAnchorAllocator();
    expect(alloc("3a")).toBe("3a");
    expect(alloc("3a")).toBe("3a-2");
    expect(alloc("3a")).toBe("3a-3");
  });

  it("does not clash an organic base with an already-suffixed id", () => {
    const alloc = createAnchorAllocator();
    expect(alloc("intro")).toBe("intro");
    expect(alloc("intro-2")).toBe("intro-2");
    // A second `intro` must skip the taken `intro-2`.
    expect(alloc("intro")).toBe("intro-3");
  });

  it("falls back to a generic base for empty/blank input", () => {
    const alloc = createAnchorAllocator();
    expect(alloc("")).toBe("section");
    expect(alloc(null)).toBe("section-2");
    expect(alloc(undefined)).toBe("section-3");
    expect(alloc("   ")).toBe("section-4");
  });
});
