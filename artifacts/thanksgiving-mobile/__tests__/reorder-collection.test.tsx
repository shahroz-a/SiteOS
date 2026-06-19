import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
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
}));

// CollectionChips selects via a react-native-gesture-handler tap, which can't
// be fired by `fireEvent.press` under jest. Swap it for a plain pressable double
// so a test can switch into a collection's view; the chips themselves are out
// of scope here (this test is about reordering the article cards).
jest.mock("@/components/CollectionChips", () => {
  const ReactLocal = require("react");
  const { Pressable, Text } = require("react-native");
  return {
    CollectionChips: ({
      collections,
      onSelect,
    }: {
      collections: { id: string; name: string }[];
      onSelect: (id: string | null) => void;
    }) =>
      ReactLocal.createElement(
        ReactLocal.Fragment,
        null,
        ReactLocal.createElement(
          Pressable,
          { testID: "select-all", onPress: () => onSelect(null) },
          ReactLocal.createElement(Text, null, "All"),
        ),
        ...collections.map((c) =>
          ReactLocal.createElement(
            Pressable,
            { key: c.id, testID: `select-${c.id}`, onPress: () => onSelect(c.id) },
            ReactLocal.createElement(Text, null, c.name),
          ),
        ),
      ),
  };
});

// expo-image renders a host view we don't need to inspect.
jest.mock("expo-image", () => {
  const { View } = require("react-native");
  return { Image: View };
});

// react-native-reorderable-list relies on native gesture/worklet drivers that
// can't run a real drag under jest. We stand in a FlatList that still renders
// every card through the screen's real `renderItem`, and we capture the list's
// `onReorder` prop so a test can fire the exact event the library emits when a
// card is dropped in a new slot. `reorderItems` keeps the library's real
// move-one-item semantics so `handleReorder` computes the same new order.
const reorderable: {
  onReorder: ((e: { from: number; to: number }) => void) | null;
} = { onReorder: null };

jest.mock("react-native-reorderable-list", () => {
  const ReactLocal = require("react");
  const { FlatList } = require("react-native");
  return {
    __esModule: true,
    default: ({
      onReorder,
      ...rest
    }: {
      onReorder: (e: { from: number; to: number }) => void;
      [key: string]: unknown;
    }) => {
      reorderable.onReorder = onReorder;
      return ReactLocal.createElement(FlatList, rest);
    },
    reorderItems: <T,>(data: T[], from: number, to: number): T[] => {
      const next = [...data];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    },
    useReorderableDrag: () => () => {},
  };
});

// Imported after mocks so the components pick them up.
import { FavoritesProvider } from "@/hooks/useFavorites";
import { ToastProvider } from "@/hooks/useToast";
import SavedScreen from "@/app/(tabs)/saved";

const cardOrder = () =>
  screen.getAllByTestId(/^post-card-/).map((n) => n.props.testID as string);

beforeEach(async () => {
  await AsyncStorage.clear();
  reorderable.onReorder = null;
  mockRouter.push.mockClear();
});

describe("reordering articles within a collection", () => {
  it("dragging a card to a new slot reorders the collection and persists across a remount", async () => {
    const alpha = makePost({ id: "id-a", slug: "alpha", title: "Alpha" });
    const bravo = makePost({ id: "id-b", slug: "bravo", title: "Bravo" });
    const charlie = makePost({ id: "id-c", slug: "charlie", title: "Charlie" });

    // Pre-seed: three saved posts, all filed into one collection, no custom
    // order yet (so the collection view starts in save order).
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([alpha, bravo, charlie]),
    );
    await AsyncStorage.setItem(
      COLLECTIONS_KEY,
      JSON.stringify({
        collections: [{ id: "col1", name: "Trips", createdAt: 1 }],
        membership: {
          "id-a": ["col1"],
          "id-b": ["col1"],
          "id-c": ["col1"],
        },
        order: {},
      }),
    );

    const first = render(
      <ToastProvider>
        <FavoritesProvider>
          <SavedScreen />
        </FavoritesProvider>
      </ToastProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText(/3 articles bookmarked/)).toBeTruthy(),
    );

    // Switch to the collection's filtered (reorderable) view.
    fireEvent.press(screen.getByTestId("select-col1"));

    // The reorderable list mounts with all three cards in save order.
    await waitFor(() => expect(reorderable.onReorder).toBeTruthy());
    expect(cardOrder()).toEqual([
      "post-card-alpha",
      "post-card-bravo",
      "post-card-charlie",
    ]);

    // Drive the drag: pick up the first card (Alpha) and drop it in the last
    // slot — the exact reorder event the list emits on drop.
    act(() => {
      reorderable.onReorder!({ from: 0, to: 2 });
    });

    // The rendered order reflects the drag immediately.
    await waitFor(() =>
      expect(cardOrder()).toEqual([
        "post-card-bravo",
        "post-card-charlie",
        "post-card-alpha",
      ]),
    );

    // …and the new order is persisted to the collections store.
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem(COLLECTIONS_KEY);
      const parsed = JSON.parse(raw as string);
      expect(parsed.order.col1).toEqual(["id-b", "id-c", "id-a"]);
    });

    // Simulate quitting the app, then a fresh session rehydrating from storage.
    act(() => first.unmount());

    render(
      <ToastProvider>
        <FavoritesProvider>
          <SavedScreen />
        </FavoritesProvider>
      </ToastProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText(/3 articles bookmarked/)).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("select-col1"));

    // The custom order survives the remount.
    await waitFor(() =>
      expect(cardOrder()).toEqual([
        "post-card-bravo",
        "post-card-charlie",
        "post-card-alpha",
      ]),
    );
  });
});
