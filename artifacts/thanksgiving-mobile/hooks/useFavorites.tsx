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

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<PostSummary[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const hydrated = useRef(false);

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

  // Persist favorites whenever they change (after the initial hydration).
  useEffect(() => {
    if (!hydrated.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(favorites)).catch(() => {
      // Ignore write failures; in-memory state remains the source of truth.
    });
  }, [favorites]);

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
    return nowFavorite;
  }, []);

  const removeFavorite = useCallback((id: string) => {
    setFavorites((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const value = useMemo<FavoritesContextValue>(
    () => ({
      favorites,
      count: favorites.length,
      isLoaded,
      isFavorite,
      toggleFavorite,
      removeFavorite,
    }),
    [favorites, isLoaded, isFavorite, toggleFavorite, removeFavorite],
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
