import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { PostSummary } from "@workspace/api-client-react";

const STORAGE_KEY = "@headout/favorites/v1";
const COLLECTIONS_KEY = "@headout/collections/v1";

/** A reader-named group of saved articles. */
export type Collection = {
  id: string;
  name: string;
  createdAt: number;
};

/**
 * A snapshot of an article's membership in a collection, captured the moment it
 * is removed so the action can be undone. `orderIndex` is the post's position in
 * the collection's custom order at removal time (or -1 if it had no custom slot),
 * letting `restoreToCollection` put it back exactly where it was.
 */
export type RemovedFromCollection = {
  postId: string;
  collectionId: string;
  orderIndex: number;
};

/**
 * Persisted collections payload. `membership` maps a post id to the set of
 * collection ids it belongs to, so a single saved article can live in many
 * collections at once. `order` maps a collection id to a reader-defined
 * ordering of post ids; ids missing from the array fall back to save order.
 */
type CollectionsState = {
  collections: Collection[];
  membership: Record<string, string[]>;
  order: Record<string, string[]>;
};

type FavoritesContextValue = {
  /** Saved posts, most-recently-added first. */
  favorites: PostSummary[];
  /** Number of saved posts. */
  count: number;
  /** True once the persisted favorites have been read from storage. */
  isLoaded: boolean;
  /** Whether the given post id is currently saved. */
  isFavorite: (id: string) => boolean;
  /** Add the post if absent, remove it if present. Returns the new state. */
  toggleFavorite: (post: PostSummary) => boolean;
  /** Remove a post from favorites. */
  removeFavorite: (id: string) => void;

  /** Reader-defined collections, in the reader's custom (or creation) order. */
  collections: Collection[];
  /** Create a new collection and return it (trims and ignores blank names). */
  createCollection: (name: string) => Collection | null;
  /**
   * Persist a reader-defined ordering of the collection chips. Pass the full
   * list of collection ids in the desired order; unknown ids are ignored and
   * any omitted collections are appended in their current order.
   */
  reorderCollections: (collectionIds: string[]) => void;
  /** Rename an existing collection. */
  renameCollection: (id: string, name: string) => void;
  /** Delete a collection and drop it from every post's membership. */
  deleteCollection: (id: string) => void;
  /** Collection ids the given post currently belongs to. */
  getPostCollections: (postId: string) => string[];
  /** Whether the given post is assigned to the given collection. */
  isInCollection: (postId: string, collectionId: string) => boolean;
  /**
   * Toggle a post's membership in a collection. Saves the post first if it is
   * not already a favorite so assigning always works from any screen.
   */
  togglePostCollection: (post: PostSummary, collectionId: string) => void;
  /**
   * Remove a post from a single collection without un-saving it. The post stays
   * a favorite (under "All") and in any other collections it belongs to. Also
   * prunes the post from that collection's custom order. Returns a snapshot that
   * can be passed to `restoreToCollection` to undo the removal.
   */
  removeFromCollection: (
    postId: string,
    collectionId: string,
  ) => RemovedFromCollection;
  /**
   * Undo a `removeFromCollection`: re-add the post to the collection and put it
   * back at its previous position in the custom order.
   */
  restoreToCollection: (snapshot: RemovedFromCollection) => void;
  /** Number of saved posts assigned to the given collection. */
  collectionCount: (collectionId: string) => number;
  /**
   * Saved posts assigned to the given collection, in the reader's custom order.
   * Newly-added posts (not yet in the stored order) appear first, in save order.
   */
  getCollectionPosts: (collectionId: string) => PostSummary[];
  /** Persist a reader-defined ordering of post ids for a collection. */
  reorderCollection: (collectionId: string, postIds: string[]) => void;
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

/**
 * Reduces any post-like object (PostSummary or PostDetail) down to the fields
 * needed to render a saved card, so the Saved view does not need a network call.
 */
function toStoredSummary(post: PostSummary): PostSummary {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    subtitle: post.subtitle ?? null,
    excerpt: post.excerpt ?? null,
    canonicalUrl: post.canonicalUrl,
    pathname: post.pathname,
    featuredImageUrl: post.featuredImageUrl ?? null,
    featuredImageAlt: post.featuredImageAlt ?? null,
    readingTimeMinutes: post.readingTimeMinutes ?? null,
    publishedAt: post.publishedAt ?? null,
    author: post.author ?? null,
    primaryCategory: post.primaryCategory ?? null,
    tags: post.tags ?? [],
  };
}

/**
 * Returns a new order map with the given post id removed from every
 * collection's ordering array. Returns the same reference when nothing changed.
 */
function dropPostFromOrder(
  order: Record<string, string[]>,
  postId: string,
): Record<string, string[]> {
  let changed = false;
  const next: Record<string, string[]> = {};
  for (const [collectionId, ids] of Object.entries(order)) {
    const filtered = ids.filter((id) => id !== postId);
    if (filtered.length !== ids.length) changed = true;
    next[collectionId] = filtered;
  }
  return changed ? next : order;
}

function makeCollectionId(): string {
  return `c_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<PostSummary[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [membership, setMembership] = useState<Record<string, string[]>>({});
  const [order, setOrder] = useState<Record<string, string[]>>({});
  const [isLoaded, setIsLoaded] = useState(false);
  const hydrated = useRef(false);
  const collectionsHydrated = useRef(false);

  // Load persisted favorites once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setFavorites(parsed as PostSummary[]);
          }
        }
      } catch {
        // Corrupt or unavailable storage: start from an empty list.
      } finally {
        if (!cancelled) {
          hydrated.current = true;
          setIsLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load persisted collections once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(COLLECTIONS_KEY);
        if (!cancelled && raw) {
          const parsed = JSON.parse(raw) as Partial<CollectionsState>;
          if (parsed && typeof parsed === "object") {
            if (Array.isArray(parsed.collections)) {
              setCollections(parsed.collections as Collection[]);
            }
            if (parsed.membership && typeof parsed.membership === "object") {
              setMembership(parsed.membership as Record<string, string[]>);
            }
            if (parsed.order && typeof parsed.order === "object") {
              setOrder(parsed.order as Record<string, string[]>);
            }
          }
        }
      } catch {
        // Corrupt or unavailable storage: start with no collections.
      } finally {
        if (!cancelled) {
          collectionsHydrated.current = true;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist favorites whenever they change (after the initial hydration).
  useEffect(() => {
    if (!hydrated.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(favorites)).catch(() => {
      // Ignore write failures; in-memory state remains the source of truth.
    });
  }, [favorites]);

  // Persist collections + membership whenever either changes.
  useEffect(() => {
    if (!collectionsHydrated.current) return;
    const payload: CollectionsState = { collections, membership, order };
    AsyncStorage.setItem(COLLECTIONS_KEY, JSON.stringify(payload)).catch(() => {
      // Ignore write failures; in-memory state remains the source of truth.
    });
  }, [collections, membership, order]);

  const isFavorite = useCallback(
    (id: string) => favorites.some((p) => p.id === id),
    [favorites],
  );

  const toggleFavorite = useCallback((post: PostSummary) => {
    let nowFavorite = false;
    setFavorites((prev) => {
      if (prev.some((p) => p.id === post.id)) {
        return prev.filter((p) => p.id !== post.id);
      }
      nowFavorite = true;
      return [toStoredSummary(post), ...prev];
    });
    // When un-saving, drop any collection membership and custom-order entries.
    if (!nowFavorite) {
      setMembership((prev) => {
        if (!prev[post.id]) return prev;
        const next = { ...prev };
        delete next[post.id];
        return next;
      });
      setOrder((prev) => dropPostFromOrder(prev, post.id));
    }
    return nowFavorite;
  }, []);

  const removeFavorite = useCallback((id: string) => {
    setFavorites((prev) => prev.filter((p) => p.id !== id));
    setMembership((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setOrder((prev) => dropPostFromOrder(prev, id));
  }, []);

  const createCollection = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const collection: Collection = {
      id: makeCollectionId(),
      name: trimmed,
      createdAt: Date.now(),
    };
    setCollections((prev) => [collection, ...prev]);
    return collection;
  }, []);

  const reorderCollections = useCallback((collectionIds: string[]) => {
    setCollections((prev) => {
      const byId = new Map(prev.map((c) => [c.id, c]));
      const next: Collection[] = [];
      // Take collections in the requested order first.
      for (const id of collectionIds) {
        const c = byId.get(id);
        if (c) {
          next.push(c);
          byId.delete(id);
        }
      }
      // Append any collections the caller omitted, keeping their prior order.
      for (const c of prev) {
        if (byId.has(c.id)) next.push(c);
      }
      return next;
    });
  }, []);

  const renameCollection = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCollections((prev) =>
      prev.map((c) => (c.id === id ? { ...c, name: trimmed } : c)),
    );
  }, []);

  const deleteCollection = useCallback((id: string) => {
    setCollections((prev) => prev.filter((c) => c.id !== id));
    setMembership((prev) => {
      let changed = false;
      const next: Record<string, string[]> = {};
      for (const [postId, ids] of Object.entries(prev)) {
        const filtered = ids.filter((cid) => cid !== id);
        if (filtered.length !== ids.length) changed = true;
        if (filtered.length > 0) next[postId] = filtered;
      }
      return changed ? next : prev;
    });
    setOrder((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const getPostCollections = useCallback(
    (postId: string) => membership[postId] ?? [],
    [membership],
  );

  const isInCollection = useCallback(
    (postId: string, collectionId: string) =>
      (membership[postId] ?? []).includes(collectionId),
    [membership],
  );

  const togglePostCollection = useCallback(
    (post: PostSummary, collectionId: string) => {
      // Ensure the post is saved before it can be filed into a collection.
      setFavorites((prev) => {
        if (prev.some((p) => p.id === post.id)) return prev;
        return [toStoredSummary(post), ...prev];
      });
      setMembership((prev) => {
        const current = prev[post.id] ?? [];
        const has = current.includes(collectionId);
        const nextIds = has
          ? current.filter((cid) => cid !== collectionId)
          : [...current, collectionId];
        const next = { ...prev };
        if (nextIds.length > 0) {
          next[post.id] = nextIds;
        } else {
          delete next[post.id];
        }
        return next;
      });
    },
    [],
  );

  const removeFromCollection = useCallback(
    (postId: string, collectionId: string): RemovedFromCollection => {
      // Capture the post's slot in the custom order before mutating, so an undo
      // can restore its exact position.
      const orderIndex = order[collectionId]?.indexOf(postId) ?? -1;
      setMembership((prev) => {
        const current = prev[postId];
        if (!current || !current.includes(collectionId)) return prev;
        const nextIds = current.filter((cid) => cid !== collectionId);
        const next = { ...prev };
        if (nextIds.length > 0) {
          next[postId] = nextIds;
        } else {
          delete next[postId];
        }
        return next;
      });
      setOrder((prev) => {
        const ids = prev[collectionId];
        if (!ids || !ids.includes(postId)) return prev;
        return { ...prev, [collectionId]: ids.filter((id) => id !== postId) };
      });
      return { postId, collectionId, orderIndex };
    },
    [order],
  );

  const restoreToCollection = useCallback(
    ({ postId, collectionId, orderIndex }: RemovedFromCollection) => {
      setMembership((prev) => {
        const current = prev[postId] ?? [];
        if (current.includes(collectionId)) return prev;
        return { ...prev, [postId]: [...current, collectionId] };
      });
      // Re-insert the post at its previous slot in the custom order. Posts that
      // had no explicit slot (orderIndex < 0) fall back to save order, so there
      // is nothing to restore.
      if (orderIndex >= 0) {
        setOrder((prev) => {
          const ids = prev[collectionId] ?? [];
          if (ids.includes(postId)) return prev;
          const next = [...ids];
          next.splice(Math.min(orderIndex, next.length), 0, postId);
          return { ...prev, [collectionId]: next };
        });
      }
    },
    [],
  );

  const collectionCount = useCallback(
    (collectionId: string) =>
      Object.values(membership).reduce(
        (acc, ids) => acc + (ids.includes(collectionId) ? 1 : 0),
        0,
      ),
    [membership],
  );

  const getCollectionPosts = useCallback(
    (collectionId: string) => {
      // `favorites` is already in save order (most-recent first).
      const inCollection = favorites.filter((p) =>
        (membership[p.id] ?? []).includes(collectionId),
      );
      const savedOrder = order[collectionId];
      if (!savedOrder || savedOrder.length === 0) return inCollection;
      const rank = new Map(savedOrder.map((id, i) => [id, i]));
      // Stable sort: known ids by their stored rank, unknown (newly-added) ids
      // sort to the front and keep their relative save order.
      return [...inCollection].sort((a, b) => {
        const ra = rank.has(a.id) ? rank.get(a.id)! : -1;
        const rb = rank.has(b.id) ? rank.get(b.id)! : -1;
        return ra - rb;
      });
    },
    [favorites, membership, order],
  );

  const reorderCollection = useCallback(
    (collectionId: string, postIds: string[]) => {
      setOrder((prev) => ({ ...prev, [collectionId]: postIds }));
    },
    [],
  );

  const value = useMemo<FavoritesContextValue>(
    () => ({
      favorites,
      count: favorites.length,
      isLoaded,
      isFavorite,
      toggleFavorite,
      removeFavorite,
      collections,
      createCollection,
      reorderCollections,
      renameCollection,
      deleteCollection,
      getPostCollections,
      isInCollection,
      togglePostCollection,
      removeFromCollection,
      restoreToCollection,
      collectionCount,
      getCollectionPosts,
      reorderCollection,
    }),
    [
      favorites,
      isLoaded,
      isFavorite,
      toggleFavorite,
      removeFavorite,
      collections,
      createCollection,
      reorderCollections,
      renameCollection,
      deleteCollection,
      getPostCollections,
      isInCollection,
      togglePostCollection,
      removeFromCollection,
      restoreToCollection,
      collectionCount,
      getCollectionPosts,
      reorderCollection,
    ],
  );

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext);
  if (!ctx) {
    throw new Error("useFavorites must be used within a FavoritesProvider");
  }
  return ctx;
}
