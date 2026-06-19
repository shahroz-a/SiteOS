import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { State } from "react-native-gesture-handler";
import {
  fireGestureHandler,
  getByGestureTestId,
} from "react-native-gesture-handler/jest-utils";
import React from "react";

import { makePost } from "./fixtures";

const STORAGE_KEY = "@headout/favorites/v1";
const COLLECTIONS_KEY = "@headout/collections/v1";

// --- Native / navigation module mocks ------------------------------------

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const mockRouter = { push: jest.fn(), back: jest.fn() };
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
}));

jest.mock("@workspace/api-client-react", () => ({
  useGetPostBySlug: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

jest.mock("expo-image", () => {
  const { View } = require("react-native");
  return { Image: View };
});

// Imported after mocks so the components pick them up.
import { FavoritesProvider } from "@/hooks/useFavorites";
import { ToastProvider } from "@/hooks/useToast";
import SavedScreen from "@/app/(tabs)/saved";

// SavedScreen surfaces an undo toast when un-saving, so it needs both providers.
/** Render the Saved screen wrapped in the providers it depends on. */
function renderSaved() {
  return render(
    <ToastProvider>
      <FavoritesProvider>
        <SavedScreen />
      </FavoritesProvider>
    </ToastProvider>,
  );
}

const COLLECTIONS = [
  { id: "alpha", name: "Alpha", createdAt: 1 },
  { id: "bravo", name: "Bravo", createdAt: 2 },
  { id: "charlie", name: "Charlie", createdAt: 3 },
];

// Natural left edge (x) of each chip in the row, fed via onLayout so the drag
// snap math (which compares the dragged chip's projected left edge against each
// slot's measured left edge) has coordinates to work with.
const CHIP_X: Record<string, number> = { alpha: 0, bravo: 100, charlie: 200 };
const CHIP_W = 90;

async function seedCollections() {
  const post = makePost();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([post]));
  await AsyncStorage.setItem(
    COLLECTIONS_KEY,
    JSON.stringify({
      collections: COLLECTIONS,
      membership: {},
      order: {},
    }),
  );
}

/** The testIDs of the chips in rendered row order. */
function chipOrder(): string[] {
  return screen
    .getAllByTestId(/^collection-chip-/)
    .map((node) => node.props.testID as string);
}

/** Feed each collection chip a layout so the drag snap math has coordinates. */
function measureChips() {
  for (const c of COLLECTIONS) {
    const node = screen.getByTestId(`collection-chip-${c.id}`);
    fireEvent(node, "layout", {
      nativeEvent: {
        layout: { x: CHIP_X[c.id], y: 0, width: CHIP_W, height: 32 },
      },
    });
  }
}

/**
 * Replay a long-press drag of collection `id` so its projected left edge lands
 * on `targetX`, committing the reorder on release. The Pan gesture is driven
 * through the official gesture-handler test harness (the chips use a Pan, not a
 * Pressable), mirroring how favorites.test.tsx drives the Tap gesture.
 */
async function dragChipTo(id: string, targetX: number) {
  const translationX = targetX - CHIP_X[id];
  await act(async () => {
    fireGestureHandler(getByGestureTestId(`chip-pan-${id}`), [
      { state: State.BEGAN, translationX: 0 },
      { state: State.ACTIVE, translationX: 0 },
      { translationX },
      { state: State.END, translationX },
    ]);
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockRouter.push.mockClear();
});

describe("collection chip reordering", () => {
  it("dragging a chip updates the chip order while All and New stay pinned", async () => {
    await seedCollections();

    renderSaved();

    // Chips render once hydration completes, in their seeded order.
    await waitFor(() =>
      expect(chipOrder()).toEqual([
        "collection-chip-all",
        "collection-chip-alpha",
        "collection-chip-bravo",
        "collection-chip-charlie",
        "collection-chip-new",
      ]),
    );

    // Drag "Charlie" (rightmost collection) to the first collection slot.
    measureChips();
    await dragChipTo("charlie", CHIP_X.alpha);

    // The collection chips reorder to Charlie, Alpha, Bravo…
    await waitFor(() =>
      expect(chipOrder()).toEqual([
        "collection-chip-all",
        "collection-chip-charlie",
        "collection-chip-alpha",
        "collection-chip-bravo",
        "collection-chip-new",
      ]),
    );

    // …and the structural "All" / "New" chips stay pinned at the ends.
    const ids = chipOrder();
    expect(ids[0]).toBe("collection-chip-all");
    expect(ids[ids.length - 1]).toBe("collection-chip-new");
  });

  it("persists the new chip order across a simulated app restart", async () => {
    await seedCollections();

    const first = renderSaved();

    await waitFor(() =>
      expect(screen.getByTestId("collection-chip-charlie")).toBeTruthy(),
    );

    // Reorder Charlie to the front.
    measureChips();
    await dragChipTo("charlie", CHIP_X.alpha);

    // The new order reaches AsyncStorage.
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem(COLLECTIONS_KEY);
      const stored = JSON.parse(raw as string) as {
        collections: { id: string }[];
      };
      expect(stored.collections.map((c) => c.id)).toEqual([
        "charlie",
        "alpha",
        "bravo",
      ]);
    });

    // Simulate quitting the app.
    act(() => first.unmount());

    // A fresh provider must rehydrate the saved order from storage on mount.
    renderSaved();

    await waitFor(() =>
      expect(chipOrder()).toEqual([
        "collection-chip-all",
        "collection-chip-charlie",
        "collection-chip-alpha",
        "collection-chip-bravo",
        "collection-chip-new",
      ]),
    );
  });
});

describe("collection chip selection", () => {
  it("tapping a chip switches the active filter to that collection's posts", async () => {
    const post = makePost();
    // The post is saved and filed into "alpha" only; "bravo" is empty.
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([post]));
    await AsyncStorage.setItem(
      COLLECTIONS_KEY,
      JSON.stringify({
        collections: COLLECTIONS,
        membership: { [post.id]: ["alpha"] },
        order: {},
      }),
    );

    renderSaved();

    // "All" is selected by default: the saved post is visible.
    await waitFor(() =>
      expect(screen.getByTestId(`post-card-${post.slug}`)).toBeTruthy(),
    );

    // Tap "Alpha". Chips select via a react-native-gesture-handler Tap (not a
    // Pressable onPress), so drive the real gesture through the test harness.
    act(() => {
      fireGestureHandler(getByGestureTestId("chip-tap-alpha"), [
        { state: State.BEGAN },
        { state: State.ACTIVE },
        { state: State.END },
      ]);
    });

    // Alpha contains the post, so it stays visible under that filter.
    await waitFor(() =>
      expect(screen.getByTestId(`post-card-${post.slug}`)).toBeTruthy(),
    );

    // Tap "Bravo", which has no posts: the empty-collection state shows and the
    // post card disappears — proving the tap really switched the active filter.
    act(() => {
      fireGestureHandler(getByGestureTestId("chip-tap-bravo"), [
        { state: State.BEGAN },
        { state: State.ACTIVE },
        { state: State.END },
      ]);
    });

    await waitFor(() =>
      expect(screen.getByText("Nothing in this collection")).toBeTruthy(),
    );
    expect(screen.queryByTestId(`post-card-${post.slug}`)).toBeNull();

    // Tap "All" again to confirm the post returns to the unfiltered view. The
    // "All" chip is a plain Pressable (not a gesture), so press it directly.
    fireEvent.press(screen.getByTestId("collection-chip-all"));

    await waitFor(() =>
      expect(screen.getByTestId(`post-card-${post.slug}`)).toBeTruthy(),
    );
    expect(screen.queryByText("Nothing in this collection")).toBeNull();
  });
});
