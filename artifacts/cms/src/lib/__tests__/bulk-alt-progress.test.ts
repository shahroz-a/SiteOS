import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadSkipped,
  saveSkipped,
  clearSkipped,
  subscribeSkipped,
  loadApproved,
  saveApproved,
  clearApproved,
  subscribeApproved,
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

/** Minimal window stub with a `storage` event bus for the subscribe tests. */
function makeWindowWithEvents() {
  const handlers = new Set<(event: StorageEvent) => void>();
  return {
    localStorage: makeStorage(),
    addEventListener: (type: string, h: (event: StorageEvent) => void) => {
      if (type === "storage") handlers.add(h);
    },
    removeEventListener: (type: string, h: (event: StorageEvent) => void) => {
      if (type === "storage") handlers.delete(h);
    },
    /** Simulate another tab writing to localStorage. */
    emitStorage: (key: string | null) => {
      for (const h of handlers) h({ key } as StorageEvent);
    },
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

  it("unions with already-persisted URLs instead of clobbering them", () => {
    // Simulates another tab having persisted [a] before this tab writes [b].
    saveSkipped("", ["a"]);
    saveSkipped("", ["b"]);
    expect(loadSkipped("")).toEqual(["a", "b"]);
  });

  it("deduplicates across merged writes", () => {
    saveSkipped("", ["a", "b"]);
    saveSkipped("", ["b", "c"]);
    expect(loadSkipped("")).toEqual(["a", "b", "c"]);
  });
});

describe("subscribeSkipped (cross-tab sync)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("notifies on a matching key write and reloads the skip set", () => {
    const win = makeWindowWithEvents();
    vi.stubGlobal("window", win);

    const seen: string[][] = [];
    const unsubscribe = subscribeSkipped("cats", (urls) => seen.push(urls));

    saveSkipped("cats", ["a", "b"]);
    win.emitStorage("headout-cms:bulk-alt-skipped:cats");

    expect(seen).toEqual([["a", "b"]]);
    unsubscribe();
  });

  it("ignores writes to a different filter's key", () => {
    const win = makeWindowWithEvents();
    vi.stubGlobal("window", win);

    const seen: string[][] = [];
    subscribeSkipped("cats", (urls) => seen.push(urls));

    saveSkipped("dogs", ["x"]);
    win.emitStorage("headout-cms:bulk-alt-skipped:dogs");

    expect(seen).toEqual([]);
  });

  it("treats a full storage clear (key === null) as a change", () => {
    const win = makeWindowWithEvents();
    vi.stubGlobal("window", win);

    const seen: string[][] = [];
    subscribeSkipped("cats", (urls) => seen.push(urls));

    win.emitStorage(null);

    expect(seen).toEqual([[]]);
  });

  it("stops notifying after unsubscribe", () => {
    const win = makeWindowWithEvents();
    vi.stubGlobal("window", win);

    const seen: string[][] = [];
    const unsubscribe = subscribeSkipped("cats", (urls) => seen.push(urls));
    unsubscribe();

    saveSkipped("cats", ["a"]);
    win.emitStorage("headout-cms:bulk-alt-skipped:cats");

    expect(seen).toEqual([]);
  });

  it("returns a no-op when events are unavailable", () => {
    vi.stubGlobal("window", { localStorage: makeStorage() });
    expect(() => subscribeSkipped("", () => {})()).not.toThrow();
  });
});

describe("bulk-alt-progress approved persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: makeStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns an empty map when nothing is stored", () => {
    expect(loadApproved("")).toEqual({});
    expect(loadApproved("cats")).toEqual({});
  });

  it("round-trips saved url→alt entries", () => {
    saveApproved("", { a: "alt a", b: "alt b" });
    expect(loadApproved("")).toEqual({ a: "alt a", b: "alt b" });
  });

  it("scopes progress per search filter", () => {
    saveApproved("", { whole: "library" });
    saveApproved("cats", { filtered: "alt" });
    expect(loadApproved("")).toEqual({ whole: "library" });
    expect(loadApproved("cats")).toEqual({ filtered: "alt" });
  });

  it("clears only the targeted filter", () => {
    saveApproved("", { a: "alt a" });
    saveApproved("cats", { b: "alt b" });
    clearApproved("cats");
    expect(loadApproved("cats")).toEqual({});
    expect(loadApproved("")).toEqual({ a: "alt a" });
  });

  it("does not collide with the skipped channel for the same filter", () => {
    saveSkipped("cats", ["s1"]);
    saveApproved("cats", { a: "alt a" });
    expect(loadSkipped("cats")).toEqual(["s1"]);
    expect(loadApproved("cats")).toEqual({ a: "alt a" });
  });

  it("ignores malformed stored values", () => {
    window.localStorage.setItem("headout-cms:bulk-alt-approved:", "not json");
    expect(loadApproved("")).toEqual({});
    window.localStorage.setItem(
      "headout-cms:bulk-alt-approved:",
      JSON.stringify(["an", "array"]),
    );
    expect(loadApproved("")).toEqual({});
  });

  it("drops non-string alt values", () => {
    window.localStorage.setItem(
      "headout-cms:bulk-alt-approved:",
      JSON.stringify({ a: "ok", b: 1, c: null, d: "fine" }),
    );
    expect(loadApproved("")).toEqual({ a: "ok", d: "fine" });
  });

  it("does not throw when storage is unavailable", () => {
    vi.stubGlobal("window", undefined);
    expect(() => saveApproved("", { a: "x" })).not.toThrow();
    expect(loadApproved("")).toEqual({});
    expect(() => clearApproved("")).not.toThrow();
  });

  it("unions with already-persisted entries instead of clobbering them", () => {
    // Simulates another tab persisting {a} before this tab writes {b}.
    saveApproved("", { a: "alt a" });
    saveApproved("", { b: "alt b" });
    expect(loadApproved("")).toEqual({ a: "alt a", b: "alt b" });
  });

  it("lets a later write win for the same URL (re-saved alt)", () => {
    saveApproved("", { a: "first" });
    saveApproved("", { a: "second" });
    expect(loadApproved("")).toEqual({ a: "second" });
  });
});

describe("subscribeApproved (cross-tab sync)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("notifies on a matching key write and reloads the approved map", () => {
    const win = makeWindowWithEvents();
    vi.stubGlobal("window", win);

    const seen: Record<string, string>[] = [];
    const unsubscribe = subscribeApproved("cats", (entries) =>
      seen.push(entries),
    );

    saveApproved("cats", { a: "alt a" });
    win.emitStorage("headout-cms:bulk-alt-approved:cats");

    expect(seen).toEqual([{ a: "alt a" }]);
    unsubscribe();
  });

  it("ignores writes to a different filter's key", () => {
    const win = makeWindowWithEvents();
    vi.stubGlobal("window", win);

    const seen: Record<string, string>[] = [];
    subscribeApproved("cats", (entries) => seen.push(entries));

    saveApproved("dogs", { x: "alt x" });
    win.emitStorage("headout-cms:bulk-alt-approved:dogs");

    expect(seen).toEqual([]);
  });

  it("ignores writes to the skipped channel's key", () => {
    const win = makeWindowWithEvents();
    vi.stubGlobal("window", win);

    const seen: Record<string, string>[] = [];
    subscribeApproved("cats", (entries) => seen.push(entries));

    saveSkipped("cats", ["s1"]);
    win.emitStorage("headout-cms:bulk-alt-skipped:cats");

    expect(seen).toEqual([]);
  });

  it("treats a full storage clear (key === null) as a change", () => {
    const win = makeWindowWithEvents();
    vi.stubGlobal("window", win);

    const seen: Record<string, string>[] = [];
    subscribeApproved("cats", (entries) => seen.push(entries));

    win.emitStorage(null);

    expect(seen).toEqual([{}]);
  });

  it("stops notifying after unsubscribe", () => {
    const win = makeWindowWithEvents();
    vi.stubGlobal("window", win);

    const seen: Record<string, string>[] = [];
    const unsubscribe = subscribeApproved("cats", (entries) =>
      seen.push(entries),
    );
    unsubscribe();

    saveApproved("cats", { a: "alt a" });
    win.emitStorage("headout-cms:bulk-alt-approved:cats");

    expect(seen).toEqual([]);
  });

  it("returns a no-op when events are unavailable", () => {
    vi.stubGlobal("window", { localStorage: makeStorage() });
    expect(() => subscribeApproved("", () => {})()).not.toThrow();
  });
});
