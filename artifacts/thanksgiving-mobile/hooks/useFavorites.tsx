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
 * Persisted collections payload. `membership` maps a post id to the set of
 * collection ids it belongs to, so a single saved article can live in many
 * collections at once.
 */
type CollectionsState = {
  collections: Collection[];
  membership: Record<string, string[]>;
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

  /** Reader-defined collections, most-recently-created first. */
  collections: Collection[];
  /** Create a new collection and return it (trims and ignores blank names). */
  createCollection: (name: string) => Collection | null;
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
  /** Number of saved posts assigned to the given collection. */
  collectionCount: (collectionId: string) => number;
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

function makeCollectionId(): string {
  return `c_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<PostSummary[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [membership, setMembership] = useState<Record<string, string[]>>({});
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
    const payload: CollectionsState = { collections, membership };
    AsyncStorage.setItem(COLLECTIONS_KEY, JSON.stringify(payload)).catch(() => {
      // Ignore write failures; in-memory state remains the source of truth.
    });
  }, [collections, membership]);

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
    // When un-saving, drop any collection membership for the post.
    if (!nowFavorite) {
      setMembership((prev) => {
        if (!prev[post.id]) return prev;
        const next = { ...prev };
        delete next[post.id];
        return next;
      });
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

  const collectionCount = useCallback(
    (collectionId: string) =>
      Object.values(membership).reduce(
        (acc, ids) => acc + (ids.includes(collectionId) ? 1 : 0),
        0,
      ),
    [membership],
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
      renameCollection,
      deleteCollection,
      getPostCollections,
      isInCollection,
      togglePostCollection,
      collectionCount,
    }),
    [
      favorites,
      isLoaded,
      isFavorite,
      toggleFavorite,
      removeFavorite,
      collections,
      createCollection,
      renameCollection,
      deleteCollection,
      getPostCollections,
      isInCollection,
      togglePostCollection,
      collectionCount,
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
