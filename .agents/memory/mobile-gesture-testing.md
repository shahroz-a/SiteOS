---
name: mobile gesture component testing (thanksgiving-mobile, jest)
description: How react-native-gesture-handler components behave under jest-expo when writing Saved-tab/collection tests.
---

# Testing gesture-driven mobile components under jest

**`fireEvent.press` cannot drive a react-native-gesture-handler Tap gesture.**
The Saved tab's collection filter chips are gesture-based (`DraggableChip` in
`components/CollectionChips.tsx` uses `Gesture.Tap`/`Gesture.Pan`), so pressing a
chip's host node does nothing in jest.

**Drive the real gesture — do not mock `CollectionChips`.** Use RNGH's
`fireGestureHandler(getByGestureTestId("chip-tap-<id>"), [{state: State.BEGAN},
{state: State.ACTIVE}, {state: State.END}])` (from
`react-native-gesture-handler/jest-utils`). This requires the chip's Tap gesture
in source to carry `.withTestId(\`chip-tap-${id}\`)`. Mocking the component out
with plain `Pressable`s removes the real gesture and breaks any sibling test that
relies on it, so prefer the harness over a mock.

**Why this matters:** a chip refactor from `Pressable` → gesture component will
silently break any test that selected a collection via `fireEvent.press` — with
no compile error — and such breakage went unnoticed once already.

**Driving the chip Pan (drag-to-reorder) under jest:** feed each chip an
`onLayout` (`fireEvent(node, "layout", {nativeEvent:{layout:{x,width,...}}})`) so
the in-flow snap math has coordinates, then replay
`fireGestureHandler(getByGestureTestId("chip-pan-<id>"), [{state:BEGAN,
translationX:0},{state:ACTIVE,translationX:0},{translationX},{state:END,
translationX}])` where `translationX = targetSlotX - chipX`. Assert on the
resulting committed chip order / persisted AsyncStorage order, not internal state.

**SavedScreen needs BOTH `FavoritesProvider` AND `ToastProvider`.** It calls
`useToast()` (undo snackbar on remove), so any test rendering `SavedScreen` must
wrap in both or it throws "useToast must be used within a ToastProvider". A test
that added only `FavoritesProvider` silently broke when the remove flow gained an
undo toast — same class of invisible breakage as the Tap-gesture refactor.

**ReanimatedSwipeable renders `renderRightActions` into the tree under jest** with
no pan gesture needed. So to test a swipe action (e.g. the Saved tab's
`RemoveAction`), just reach the view and tap the action — no swipe simulation.
Caveat: the swipe `RemoveAction` and the inline ✕ button share
`accessibilityLabel="Remove from this collection"`; disambiguate by the swipe
panel's visible "Remove" caption via `within(node).queryByText("Remove")`.
