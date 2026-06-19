import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadSkipped,
  saveSkipped,
  clearSkipped,
} from "../bulk-alt-progress";

/** Minimal in-memory localStorage stand-in for the node test environment. */
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

describe("bulk-alt-progress persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: makeStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns an empty list when nothing is stored", () => {
    expect(loadSkipped("")).toEqual([]);
    expect(loadSkipped("cats")).toEqual([]);
  });

  it("round-trips saved skipped URLs", () => {
    saveSkipped("", ["a", "b", "c"]);
    expect(loadSkipped("")).toEqual(["a", "b", "c"]);
  });

  it("accepts any iterable (e.g. a Set)", () => {
    saveSkipped("", new Set(["x", "y"]));
    expect(loadSkipped("")).toEqual(["x", "y"]);
  });

  it("scopes progress per search filter", () => {
    saveSkipped("", ["whole-library"]);
    saveSkipped("cats", ["filtered"]);
    expect(loadSkipped("")).toEqual(["whole-library"]);
    expect(loadSkipped("cats")).toEqual(["filtered"]);
  });

  it("clears only the targeted filter", () => {
    saveSkipped("", ["a"]);
    saveSkipped("cats", ["b"]);
    clearSkipped("cats");
    expect(loadSkipped("cats")).toEqual([]);
    expect(loadSkipped("")).toEqual(["a"]);
  });

  it("ignores malformed stored values", () => {
    window.localStorage.setItem("headout-cms:bulk-alt-skipped:", "not json");
    expect(loadSkipped("")).toEqual([]);
    window.localStorage.setItem(
      "headout-cms:bulk-alt-skipped:",
      JSON.stringify({ not: "an array" }),
    );
    expect(loadSkipped("")).toEqual([]);
  });

  it("drops non-string entries", () => {
    window.localStorage.setItem(
      "headout-cms:bulk-alt-skipped:",
      JSON.stringify(["ok", 1, null, "fine"]),
    );
    expect(loadSkipped("")).toEqual(["ok", "fine"]);
  });

  it("does not throw when storage is unavailable", () => {
    vi.stubGlobal("window", undefined);
    expect(() => saveSkipped("", ["a"])).not.toThrow();
    expect(loadSkipped("")).toEqual([]);
    expect(() => clearSkipped("")).not.toThrow();
  });
});
