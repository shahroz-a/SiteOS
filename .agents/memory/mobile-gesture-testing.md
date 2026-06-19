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

**ReanimatedSwipeable renders `renderRightActions` into the tree under jest** with
no pan gesture needed. So to test a swipe action (e.g. the Saved tab's
`RemoveAction`), just reach the view and tap the action — no swipe simulation.
Caveat: the swipe `RemoveAction` and the inline ✕ button share
`accessibilityLabel="Remove from this collection"`; disambiguate by the swipe
panel's visible "Remove" caption via `within(node).queryByText("Remove")`.
