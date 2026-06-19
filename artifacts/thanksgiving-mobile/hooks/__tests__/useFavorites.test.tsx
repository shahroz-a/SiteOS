// @vitest-environment node
import { createElement } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PostSummary } from "@workspace/api-client-react";

const STORAGE_KEY = "@headout/favorites/v1";
const COLLECTIONS_KEY = "@headout/collections/v1";

// In-memory AsyncStorage so persistence read/write paths run without a native module.
const store = new Map<string, string>();
const getItem = vi.fn(async (key: string) => store.get(key) ?? null);
const setItem = vi.fn(async (key: string, value: string) => {
  store.set(key, value);
});
const removeItem = vi.fn(async (key: string) => {
  store.delete(key);
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem, setItem, removeItem },
}));

const { FavoritesProvider, useFavorites } = await import("../useFavorites");
type FavoritesValue = ReturnType<typeof useFavorites>;

function makePost(id: string, overrides: Partial<PostSummary> = {}): PostSummary {
  return {
    id,
    slug: `slug-${id}`,
    title: `Title ${id}`,
    subtitle: null,
    excerpt: null,
    canonicalUrl: `https://example.com/${id}`,
    pathname: `/${id}`,
    featuredImageUrl: null,
    featuredImageAlt: null,
    readingTimeMinutes: null,
    publishedAt: null,
    author: null,
    primaryCategory: null,
    tags: [],
    ...overrides,
  } as PostSummary;
}

type Harness = {
  readonly value: FavoritesValue;
  renderer: ReactTestRenderer;
};

async function setup(): Promise<Harness> {
  let captured: FavoritesValue = null as unknown as FavoritesValue;
  function Probe() {
    captured = useFavorites();
    return null;
  }
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      createElement(FavoritesProvider, null, createElement(Probe)),
    );
  });
  return {
    get value() {
      return captured;
    },
    renderer,
  };
}

function lastCollectionsWrite(): {
  collections: { id: string; name: string; createdAt: number }[];
  membership: Record<string, string[]>;
} | null {
  const calls = setItem.mock.calls.filter(([key]) => key === COLLECTIONS_KEY);
  const last = calls.at(-1);
  return last ? JSON.parse(last[1] as string) : null;
}

beforeEach(() => {
  store.clear();
  getItem.mockClear();
  setItem.mockClear();
  removeItem.mockClear();
});

describe("useFavorites — hydration", () => {
  it("marks isLoaded true after the initial storage read", async () => {
    const h = await setup();
    expect(getItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(getItem).toHaveBeenCalledWith(COLLECTIONS_KEY);
    expect(h.value.isLoaded).toBe(true);
    expect(h.value.collections).toEqual([]);
    expect(h.value.favorites).toEqual([]);
  });

  it("restores persisted favorites and collections from storage", async () => {
    store.set(STORAGE_KEY, JSON.stringify([makePost("p1")]));
    store.set(
      COLLECTIONS_KEY,
      JSON.stringify({
        collections: [{ id: "c1", name: "Trips", createdAt: 1 }],
        membership: { p1: ["c1"] },
      }),
    );
    const h = await setup();
    expect(h.value.favorites.map((p) => p.id)).toEqual(["p1"]);
    expect(h.value.collections).toEqual([
      { id: "c1", name: "Trips", createdAt: 1 },
    ]);
    expect(h.value.getPostCollections("p1")).toEqual(["c1"]);
    expect(h.value.collectionCount("c1")).toBe(1);
  });
});

describe("useFavorites — create / rename / delete collections", () => {
  it("creates a collection, trims its name, and prepends it", async () => {
    const h = await setup();
    let created: { id: string; name: string } | null = null;
    await act(async () => {
      created = h.value.createCollection("  Weekend Trips  ");
    });
    expect(created).not.toBeNull();
    expect(created!.name).toBe("Weekend Trips");
    expect(h.value.collections.map((c) => c.name)).toEqual(["Weekend Trips"]);

    let second: { id: string } | null = null;
    await act(async () => {
      second = h.value.createCollection("Food");
    });
    // Most-recently-created first.
    expect(h.value.collections.map((c) => c.name)).toEqual([
      "Food",
      "Weekend Trips",
    ]);
    expect(second).not.toBeNull();
  });

  it("ignores blank collection names and returns null", async () => {
    const h = await setup();
    let created: unknown;
    await act(async () => {
      created = h.value.createCollection("   ");
    });
    expect(created).toBeNull();
    expect(h.value.collections).toEqual([]);
  });

  it("renames a collection, trimming the new name, and ignores blanks", async () => {
    const h = await setup();
    let id = "";
    await act(async () => {
      id = h.value.createCollection("Old Name")!.id;
    });
    await act(async () => {
      h.value.renameCollection(id, "  New Name  ");
    });
    expect(h.value.collections[0].name).toBe("New Name");
    await act(async () => {
      h.value.renameCollection(id, "   ");
    });
    expect(h.value.collections[0].name).toBe("New Name");
  });

  it("reorders collections by id and ignores unknown / appends omitted ids", async () => {
    const h = await setup();
    let a = "";
    let b = "";
    let c = "";
    await act(async () => {
      a = h.value.createCollection("A")!.id;
      b = h.value.createCollection("B")!.id;
      c = h.value.createCollection("C")!.id;
    });
    // Most-recently-created first → [C, B, A].
    expect(h.value.collections.map((x) => x.name)).toEqual(["C", "B", "A"]);

    await act(async () => {
      h.value.reorderCollections([a, b, c]);
    });
    expect(h.value.collections.map((x) => x.name)).toEqual(["A", "B", "C"]);

    // Unknown ids are skipped; omitted ids keep their order at the end.
    await act(async () => {
      h.value.reorderCollections(["nope", c]);
    });
    expect(h.value.collections.map((x) => x.name)).toEqual(["C", "A", "B"]);
  });

  it("persists the reordered collections so they survive a restart", async () => {
    const h = await setup();
    let a = "";
    let b = "";
    await act(async () => {
      a = h.value.createCollection("A")!.id;
      b = h.value.createCollection("B")!.id;
    });
    await act(async () => {
      h.value.reorderCollections([a, b]);
    });
    const persisted = lastCollectionsWrite();
    expect(persisted!.collections.map((x) => x.name)).toEqual(["A", "B"]);
  });

  it("deletes a collection and prunes it from every post's membership", async () => {
    const h = await setup();
    let cId = "";
    await act(async () => {
      cId = h.value.createCollection("Trips")!.id;
    });
    await act(async () => {
      h.value.togglePostCollection(makePost("p1"), cId);
      h.value.togglePostCollection(makePost("p2"), cId);
    });
    expect(h.value.collectionCount(cId)).toBe(2);

    await act(async () => {
      h.value.deleteCollection(cId);
    });
    expect(h.value.collections).toEqual([]);
    expect(h.value.getPostCollections("p1")).toEqual([]);
    expect(h.value.getPostCollections("p2")).toEqual([]);
    // Posts themselves stay saved; only the collection assignment is removed.
    expect(h.value.isFavorite("p1")).toBe(true);
    expect(h.value.collectionCount(cId)).toBe(0);
  });
});

describe("useFavorites — togglePostCollection", () => {
  it("auto-saves an unsaved post when filing it into a collection", async () => {
    const h = await setup();
    let cId = "";
    await act(async () => {
      cId = h.value.createCollection("Trips")!.id;
    });
    expect(h.value.isFavorite("p1")).toBe(false);

    await act(async () => {
      h.value.togglePostCollection(makePost("p1"), cId);
    });
    expect(h.value.isFavorite("p1")).toBe(true);
    expect(h.value.isInCollection("p1", cId)).toBe(true);
    expect(h.value.getPostCollections("p1")).toEqual([cId]);
  });

  it("toggles a post out of a collection and clears the membership key when empty", async () => {
    const h = await setup();
    let cId = "";
    await act(async () => {
      cId = h.value.createCollection("Trips")!.id;
    });
    await act(async () => {
      h.value.togglePostCollection(makePost("p1"), cId);
    });
    await act(async () => {
      h.value.togglePostCollection(makePost("p1"), cId);
    });
    expect(h.value.isInCollection("p1", cId)).toBe(false);
    expect(h.value.getPostCollections("p1")).toEqual([]);
    // Un-filing does not un-save the post.
    expect(h.value.isFavorite("p1")).toBe(true);
  });

  it("supports a post belonging to multiple collections at once", async () => {
    const h = await setup();
    let a = "";
    let b = "";
    await act(async () => {
      a = h.value.createCollection("A")!.id;
      b = h.value.createCollection("B")!.id;
    });
    await act(async () => {
      h.value.togglePostCollection(makePost("p1"), a);
      h.value.togglePostCollection(makePost("p1"), b);
    });
    expect(h.value.getPostCollections("p1").sort()).toEqual([a, b].sort());
    expect(h.value.collectionCount(a)).toBe(1);
    expect(h.value.collectionCount(b)).toBe(1);
  });
});

describe("useFavorites — removeFromCollection", () => {
  it("removes a post from one collection without un-saving it or touching others", async () => {
    const h = await setup();
    let a = "";
    let b = "";
    await act(async () => {
      a = h.value.createCollection("A")!.id;
      b = h.value.createCollection("B")!.id;
    });
    await act(async () => {
      h.value.togglePostCollection(makePost("p1"), a);
      h.value.togglePostCollection(makePost("p1"), b);
    });
    expect(h.value.getPostCollections("p1").sort()).toEqual([a, b].sort());

    await act(async () => {
      h.value.removeFromCollection("p1", a);
    });
    // Dropped from A only; still in B and still saved overall.
    expect(h.value.isInCollection("p1", a)).toBe(false);
    expect(h.value.isInCollection("p1", b)).toBe(true);
    expect(h.value.getPostCollections("p1")).toEqual([b]);
    expect(h.value.isFavorite("p1")).toBe(true);
    expect(h.value.collectionCount(a)).toBe(0);
    expect(h.value.collectionCount(b)).toBe(1);
  });

  it("clears the membership key when the last collection is removed but keeps the favorite", async () => {
    const h = await setup();
    let cId = "";
    await act(async () => {
      cId = h.value.createCollection("Trips")!.id;
    });
    await act(async () => {
      h.value.togglePostCollection(makePost("p1"), cId);
    });

    await act(async () => {
      h.value.removeFromCollection("p1", cId);
    });
    expect(h.value.getPostCollections("p1")).toEqual([]);
    expect(h.value.isFavorite("p1")).toBe(true);
    expect(h.value.collectionCount(cId)).toBe(0);
  });

  it("prunes the post from the collection's custom order", async () => {
    const h = await setup();
    let cId = "";
    await act(async () => {
      cId = h.value.createCollection("Trips")!.id;
    });
    await act(async () => {
      h.value.togglePostCollection(makePost("p1"), cId);
      h.value.togglePostCollection(makePost("p2"), cId);
    });
    await act(async () => {
      h.value.reorderCollection(cId, ["p2", "p1"]);
    });
    expect(h.value.getCollectionPosts(cId).map((p) => p.id)).toEqual([
      "p2",
      "p1",
    ]);

    await act(async () => {
      h.value.removeFromCollection("p1", cId);
    });
    const persisted = lastCollectionsWrite() as {
      order?: Record<string, string[]>;
    } | null;
    expect(persisted?.order?.[cId]).toEqual(["p2"]);
    expect(h.value.getCollectionPosts(cId).map((p) => p.id)).toEqual(["p2"]);
  });

  it("is a no-op when the post is not in the collection", async () => {
    const h = await setup();
    let cId = "";
    await act(async () => {
      cId = h.value.createCollection("Trips")!.id;
    });
    await act(async () => {
      h.value.togglePostCollection(makePost("p1"), cId);
    });
    await act(async () => {
      h.value.removeFromCollection("p-missing", cId);
    });
    expect(h.value.isInCollection("p1", cId)).toBe(true);
    expect(h.value.collectionCount(cId)).toBe(1);
  });
});

describe("useFavorites — favorite removal prunes membership", () => {
  it("removeFavorite drops the post and its collection membership", async () => {
    const h = await setup();
    let cId = "";
    await act(async () => {
      cId = h.value.createCollection("Trips")!.id;
    });
    await act(async () => {
      h.value.togglePostCollection(makePost("p1"), cId);
    });
    expect(h.value.collectionCount(cId)).toBe(1);

    await act(async () => {
      h.value.removeFavorite("p1");
    });
    expect(h.value.isFavorite("p1")).toBe(false);
    expect(h.value.getPostCollections("p1")).toEqual([]);
    expect(h.value.collectionCount(cId)).toBe(0);
  });

  it("toggleFavorite returns the new state and prunes membership on un-save", async () => {
    const h = await setup();
    let cId = "";
    await act(async () => {
      cId = h.value.createCollection("Trips")!.id;
    });
    await act(async () => {
      h.value.togglePostCollection(makePost("p1"), cId);
    });

    let nowFavorite: boolean | undefined;
    await act(async () => {
      nowFavorite = h.value.toggleFavorite(makePost("p1"));
    });
    // Already saved → toggling removes it and reports the new (un-saved) state.
    expect(nowFavorite).toBe(false);
    expect(h.value.isFavorite("p1")).toBe(false);
    expect(h.value.getPostCollections("p1")).toEqual([]);
    expect(h.value.collectionCount(cId)).toBe(0);

    // Toggling an absent post re-saves it (observable via resulting state).
    await act(async () => {
      h.value.toggleFavorite(makePost("p1"));
    });
    expect(h.value.isFavorite("p1")).toBe(true);
  });
});

describe("useFavorites — persistence", () => {
  it("writes collections and membership to storage after changes", async () => {
    const h = await setup();
    let cId = "";
    await act(async () => {
      cId = h.value.createCollection("Trips")!.id;
    });
    await act(async () => {
      h.value.togglePostCollection(makePost("p1"), cId);
    });

    const persisted = lastCollectionsWrite();
    expect(persisted).not.toBeNull();
    expect(persisted!.collections.map((c) => c.name)).toEqual(["Trips"]);
    expect(persisted!.membership).toEqual({ p1: [cId] });
    expect(setItem).toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));
  });

  it("does not write to storage during the initial hydration", async () => {
    await setup();
    expect(setItem).not.toHaveBeenCalled();
  });
});
