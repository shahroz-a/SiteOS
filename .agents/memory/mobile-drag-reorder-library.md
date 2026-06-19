---
name: Mobile drag-reorder library choice
description: Which draggable-list library works in the Expo app, and why the obvious one doesn't.
---

# Draggable list in the Expo mobile app

Use `react-native-reorderable-list` for any drag-to-reorder list in `artifacts/thanksgiving-mobile`.

**Why:** The app is on `react-native-reanimated@4`, which **removed** `useAnimatedGestureHandler`. The canonical `react-native-draggable-flatlist` depends on that removed API, so it will not work here. `react-native-reorderable-list` uses the modern Gesture API + worklets, satisfies the reanimated `>=3.12` / gesture-handler `>=2.12` peers, handles variable item heights, and bundles cleanly (verified with `expo export --platform web`).

**How to apply:** `ReorderableList` extends `FlatListProps` (drop-in: `data`/`renderItem`/`keyExtractor`/`ListHeaderComponent`/`ListEmptyComponent` all work). Add `onReorder({from,to})` and use the exported `reorderItems(data, from, to)` helper to compute the new array. Inside a rendered item call `useReorderableDrag()` to get the `drag()` trigger (wire it to a long-press). Requires being under the existing `GestureHandlerRootView` (already in `app/_layout.tsx`).
