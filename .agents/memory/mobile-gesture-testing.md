---
name: mobile gesture component testing (thanksgiving-mobile, jest)
description: Why fireEvent.press fails on RNGH Gesture.Tap/Pan components and how to test around them
---

# Testing gesture-driven mobile components under jest

In `thanksgiving-mobile`, components built on `react-native-gesture-handler` `Gesture.Tap()/Pan()` inside a `<GestureDetector>` (e.g. `CollectionChips` chips) do NOT respond to `@testing-library/react-native`'s `fireEvent.press`. The press maps to an `onPress` prop, but a gesture handler has none, so the tap's `onEnd`/`onSelect` never fires and state never changes.

**Why:** the RNGH jest setup mocks the native gesture pipeline but does not translate synthetic press events into gesture state transitions.

**How to apply:** when a test only needs the *side effect* of a gesture (e.g. selecting a collection so the article list switches views), `jest.mock` the gesture component with a plain `Pressable` double that calls the same callback prop (`onSelect`). This is often simpler than driving real gesture state transitions under jest.

**Driving the chip Pan (drag-to-reorder) under jest:** feed each chip an
`onLayout` (`fireEvent(node, "layout", {nativeEvent:{layout:{x,width,...}}})`) so
the in-flow snap math has coordinates, then replay
`fireGestureHandler(getByGestureTestId("chip-pan-<id>"), [{state:BEGAN,
translationX:0},{state:ACTIVE,translationX:0},{translationX},{state:END,
translationX}])` where `translationX = targetSlotX - chipX`. Assert on the
resulting committed chip order / persisted AsyncStorage order, not internal state.

Reserve real gesture simulation for tests that are actually about the gesture logic itself. For those, use RNGH's `fireGestureHandler(getByGestureTestId("chip-tap-<id>"), [{state: State.BEGAN}, {state: State.ACTIVE}, {state: State.END}])` (from `react-native-gesture-handler/jest-utils`). This requires the chip's Tap gesture in source to carry `.withTestId(\`chip-tap-${id}\`)`.

**Reorderable lists:** `react-native-reorderable-list` can't run a real drag under jest — mock it to a `FlatList` and capture/invoke its `onReorder({from,to})` prop, providing a real `reorderItems` (splice from→to) so the screen computes the true new order.

**SavedScreen needs BOTH `FavoritesProvider` AND `ToastProvider`.** It calls
`useToast()` (undo snackbar on remove), so any test rendering `SavedScreen` must
wrap in both or it throws "useToast must be used within a ToastProvider". A test
that added only `FavoritesProvider` silently broke when the remove flow gained an
undo toast — same class of invisible breakage as the Tap-gesture refactor.

**ReanimatedSwipeable:** renders `renderRightActions` into the tree under jest with no pan gesture needed. To test a swipe action (e.g. the Saved tab's `RemoveAction`), just reach the view and tap the action — no swipe simulation. Caveat: the swipe `RemoveAction` and the inline ✕ button share `accessibilityLabel="Remove from this collection"`; disambiguate by the swipe panel's visible "Remove" caption via `within(node).queryByText("Remove")`.

Note: the pre-existing `favorites.test.tsx` "removing from a collection" test was failing because it `fireEvent.press`-es a real RNGH gesture chip; mocking the component to a pressable double resolves this.
