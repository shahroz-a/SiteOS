import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { State } from "react-native-gesture-handler";
import {
  fireGestureHandler,
  getByGestureTestId,
} from "react-native-gesture-handler/jest-utils";
import React from "react";

import { makePost, makePostDetail } from "./fixtures";

const STORAGE_KEY = "@headout/favorites/v1";
const COLLECTIONS_KEY = "@headout/collections/v1";

// --- Native / navigation module mocks ------------------------------------

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const mockRouter = { push: jest.fn(), back: jest.fn() };
let mockSlug = "thanksgiving-family-trips";
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ slug: mockSlug }),
  Stack: { Screen: () => null },
}));

// useGetPostBySlug is mocked per-test via this mutable ref.
const mockGetPostResult: {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = { data: undefined, isLoading: false, isError: false, refetch: jest.fn() };

jest.mock("@workspace/api-client-react", () => ({
  useGetPostBySlug: () => mockGetPostResult,
}));

// expo-image renders a host view we don't need to inspect.
jest.mock("expo-image", () => {
  const { View } = require("react-native");
  return { Image: View };
});

// Imported after mocks so the components pick them up.
import { PostCard } from "@/components/PostCard";
import { FavoritesProvider } from "@/hooks/useFavorites";
import { ToastProvider } from "@/hooks/useToast";
import SavedScreen from "@/app/(tabs)/saved";
import PostDetailScreen from "@/app/post/[slug]";

beforeEach(async () => {
  await AsyncStorage.clear();
  mockRouter.push.mockClear();
  mockRouter.back.mockClear();
});

describe("favorites end to end", () => {
  it("favoriting from a PostCard surfaces the post in the Saved tab and unfavoriting removes it", async () => {
    const post = makePost();

    render(
      <ToastProvider>
        <FavoritesProvider>
        <PostCard post={post} onPress={() => {}} />
        <SavedScreen />
        </FavoritesProvider>
      </ToastProvider>,
    );

    // Saved tab starts empty once hydration completes.
    await waitFor(() =>
      expect(screen.getByText("No saved articles yet")).toBeTruthy(),
    );
    // Only the browse card exists, not a saved copy.
    expect(screen.getAllByTestId(`post-card-${post.slug}`)).toHaveLength(1);

    // Favorite from the browse card.
    fireEvent.press(screen.getByTestId(`favorite-toggle-${post.slug}`), { stopPropagation: jest.fn() });

    // Saved tab now reflects the change.
    await waitFor(() =>
      expect(screen.getByText(/1 article bookmarked/)).toBeTruthy(),
    );
    expect(screen.queryByText("No saved articles yet")).toBeNull();
    // Browse card + the card rendered inside the Saved list.
    expect(screen.getAllByTestId(`post-card-${post.slug}`)).toHaveLength(2);

    // Unfavorite via one of the toggles.
    fireEvent.press(screen.getAllByTestId(`favorite-toggle-${post.slug}`)[0], { stopPropagation: jest.fn() });

    await waitFor(() =>
      expect(screen.getByText("No saved articles yet")).toBeTruthy(),
    );
    expect(screen.getAllByTestId(`post-card-${post.slug}`)).toHaveLength(1);
  });

  it("favoriting then unfavoriting from the detail screen toggles the post in the Saved tab", async () => {
    const detail = makePostDetail();
    mockGetPostResult.data = detail;
    mockGetPostResult.isLoading = false;
    mockGetPostResult.isError = false;
    mockSlug = detail.slug;

    render(
      <ToastProvider>
        <FavoritesProvider>
        <PostDetailScreen />
        <SavedScreen />
        </FavoritesProvider>
      </ToastProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText("No saved articles yet")).toBeTruthy(),
    );

    // Favorite via the detail screen's floating favorite button.
    fireEvent.press(screen.getByTestId("favorite-toggle"));

    await waitFor(() =>
      expect(screen.getByText(/1 article bookmarked/)).toBeTruthy(),
    );
    expect(screen.getByTestId(`post-card-${detail.slug}`)).toBeTruthy();
    expect(screen.queryByText("No saved articles yet")).toBeNull();

    // Unfavorite from the same detail button: Saved tab returns to empty.
    fireEvent.press(screen.getByTestId("favorite-toggle"));

    await waitFor(() =>
      expect(screen.getByText("No saved articles yet")).toBeTruthy(),
    );
    expect(screen.queryByTestId(`post-card-${detail.slug}`)).toBeNull();
    expect(screen.queryByText(/article(s)? bookmarked/)).toBeNull();
  });

  it("shows an inline remove button on a PostCard only when onRemoveFromCollection is given", async () => {
    const post = makePost();
    const onRemove = jest.fn();

    const { rerender } = render(
      <ToastProvider>
        <FavoritesProvider>
        <PostCard post={post} onPress={() => {}} />
        </FavoritesProvider>
      </ToastProvider>,
    );

    // No collection context → no remove affordance.
    expect(
      screen.queryByTestId(`remove-from-collection-${post.slug}`),
    ).toBeNull();

    rerender(
      <ToastProvider>
        <FavoritesProvider>
        <PostCard
          post={post}
          onPress={() => {}}
          onRemoveFromCollection={onRemove}
        />
        </FavoritesProvider>
      </ToastProvider>,
    );

    const btn = screen.getByTestId(`remove-from-collection-${post.slug}`);
    fireEvent.press(btn, { stopPropagation: jest.fn() });
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(post);
  });

  it("removing from a collection in the Saved tab keeps the article saved under All", async () => {
    const post = makePost();
    // Pre-seed: the post is saved and filed into one collection.
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([post]));
    await AsyncStorage.setItem(
      COLLECTIONS_KEY,
      JSON.stringify({
        collections: [{ id: "col1", name: "Trips", createdAt: 1 }],
        membership: { [post.id]: ["col1"] },
        order: {},
      }),
    );

    render(
      <ToastProvider>
        <FavoritesProvider>
        <SavedScreen />
        </FavoritesProvider>
      </ToastProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText(/1 article bookmarked/)).toBeTruthy(),
    );

    // Switch to the collection's filtered view. The chip selects via a
    // react-native-gesture-handler Tap (not a Pressable onPress), so it must be
    // driven through the gesture-handler test harness rather than fireEvent.
    fireGestureHandler(getByGestureTestId("chip-tap-col1"), [
      { state: State.BEGAN },
      { state: State.ACTIVE },
      { state: State.END },
    ]);

    // The inline remove button is now available; tap it.
    const removeBtn = await screen.findByTestId(
      `remove-from-collection-${post.slug}`,
    );
    fireEvent.press(removeBtn, { stopPropagation: jest.fn() });

    // The collection chip count drops to 0…
    await waitFor(() =>
      expect(screen.getByTestId("collection-chip-col1")).toHaveTextContent(
        "Trips (0)",
      ),
    );
    // …but the article is still saved overall (All count unchanged).
    expect(screen.getByTestId("collection-chip-all")).toHaveTextContent(
      "All (1)",
    );
    expect(screen.getByText(/1 article bookmarked/)).toBeTruthy();
  });

  it("swipe-to-remove from a collection in the Saved tab keeps the article saved under All", async () => {
    const post = makePost();
    // Pre-seed: the post is saved and filed into one collection.
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([post]));
    await AsyncStorage.setItem(
      COLLECTIONS_KEY,
      JSON.stringify({
        collections: [{ id: "col1", name: "Trips", createdAt: 1 }],
        membership: { [post.id]: ["col1"] },
        order: {},
      }),
    );

    render(
      <ToastProvider>
        <FavoritesProvider>
        <SavedScreen />
        </FavoritesProvider>
      </ToastProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText(/1 article bookmarked/)).toBeTruthy(),
    );

    // Switch to the collection's filtered view (renders SwipeableDraggablePostCard).
    // The chip selects via a react-native-gesture-handler Tap (not a Pressable
    // onPress), so drive it through the gesture-handler test harness.
    fireGestureHandler(getByGestureTestId("chip-tap-col1"), [
      { state: State.BEGAN },
      { state: State.ACTIVE },
      { state: State.END },
    ]);

    // The swipe "Remove" panel (RemoveAction) is rendered by ReanimatedSwipeable's
    // renderRightActions. Both it and the inline ✕ button share the
    // "Remove from this collection" label, but only the swipe panel shows a
    // visible "Remove" caption — use that to target the swipe action specifically.
    const swipeRemove = await waitFor(() => {
      const candidate = screen
        .getAllByLabelText("Remove from this collection")
        .find((node) => within(node).queryByText("Remove"));
      if (!candidate) throw new Error("swipe RemoveAction not rendered yet");
      return candidate;
    });
    fireEvent.press(swipeRemove);

    // The collection chip count drops to 0…
    await waitFor(() =>
      expect(screen.getByTestId("collection-chip-col1")).toHaveTextContent(
        "Trips (0)",
      ),
    );
    // …but the article is still saved overall (All count unchanged).
    expect(screen.getByTestId("collection-chip-all")).toHaveTextContent(
      "All (1)",
    );
    expect(screen.getByText(/1 article bookmarked/)).toBeTruthy();
  });

  it("persists favorites across an app restart (AsyncStorage rehydration on mount)", async () => {
    const post = makePost();

    // First session: favorite a post and let it persist.
    const first = render(
      <ToastProvider>
        <FavoritesProvider>
        <PostCard post={post} onPress={() => {}} />
        </FavoritesProvider>
      </ToastProvider>,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId(`favorite-toggle-${post.slug}`),
      ).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId(`favorite-toggle-${post.slug}`), { stopPropagation: jest.fn() });

    // The write reaches AsyncStorage.
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw as string)).toHaveLength(1);
    });

    // Simulate quitting the app.
    act(() => first.unmount());

    // Second session: a fresh provider must rehydrate from storage on mount.
    render(
      <ToastProvider>
        <FavoritesProvider>
        <SavedScreen />
        </FavoritesProvider>
      </ToastProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText(/1 article bookmarked/)).toBeTruthy(),
    );
    expect(screen.getByTestId(`post-card-${post.slug}`)).toBeTruthy();
    expect(screen.queryByText("No saved articles yet")).toBeNull();
  });
});
