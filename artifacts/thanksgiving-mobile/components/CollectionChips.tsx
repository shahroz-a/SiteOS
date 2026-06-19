import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect } from "react";
import {
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  ScrollView,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import type { Collection } from "@/hooks/useFavorites";

/** Horizontal gap between chips; must match `styles.row.gap`. */
const GAP = 8;
/** A drag shorter than this (px) is treated as a long-press, not a reorder. */
const DRAG_THRESHOLD = 8;

type LayoutMap = Record<string, { x: number; w: number }>;
type PositionMap = Record<string, number>;

type Props = {
  collections: Collection[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Count of saved articles for a collection id (or total for `null`). */
  countFor: (id: string | null) => number;
  /** Tapping the trailing "New" chip. */
  onCreate: () => void;
  /** A press-and-hold on a collection chip without dragging (rename/delete). */
  onManage?: (collection: Collection) => void;
  /** Persist a reader-defined order of collection ids (first-to-last). */
  onReorder?: (collectionIds: string[]) => void;
};

/**
 * Horizontal collection filter for the Saved tab. The "All" chip is always
 * pinned first and the "New" chip last; the collections in between follow the
 * reader's custom order and can be dragged to reorder.
 *
 * Reordering uses an in-flow layout: React keeps the chips in their committed
 * order for the whole drag, each chip's natural `x`/width is measured, and the
 * visual shuffle is done purely with reanimated `translateX` transforms so the
 * row layout (and therefore the slot positions) never changes mid-drag. On drop
 * we commit the new order via `onReorder`; the prop change re-renders the chips
 * in the new order and resets every transform back to zero with no visible jump.
 */
export function CollectionChips({
  collections,
  selected,
  onSelect,
  countFor,
  onCreate,
  onManage,
  onReorder,
}: Props) {
  const colors = useColors();
  const isWeb = Platform.OS === "web";

  // Measured natural layout (x within the row, width) keyed by collection id.
  const layouts = useSharedValue<LayoutMap>({});
  // Live visual index of each chip during a drag, keyed by collection id.
  const positions = useSharedValue<PositionMap>({});
  // The committed render order of collection ids (slot v's left == x of order[v]).
  const order = useSharedValue<string[]>([]);
  // The id of the chip currently being dragged, or null.
  const activeId = useSharedValue<string | null>(null);

  // Re-sync the live order/positions whenever the committed order changes
  // (either after a drop or from an external rename/create/delete).
  const ids = collections.map((c) => c.id);
  const orderKey = ids.join("|");
  useEffect(() => {
    const next: PositionMap = {};
    ids.forEach((id, i) => {
      next[id] = i;
    });
    positions.value = next;
    order.value = ids;
    // `ids`/`positions`/`order` are derived from `orderKey`; intentionally
    // keyed on the order signature so we only resync on real order changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey]);

  const handleReorder = useCallback(
    (finalIds: string[]) => onReorder?.(finalIds),
    [onReorder],
  );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      <Pressable
        testID="collection-chip-all"
        onPress={() => onSelect(null)}
        style={({ pressed }) => [
          styles.chip,
          {
            backgroundColor: selected === null ? colors.primary : colors.card,
            borderColor: selected === null ? colors.primary : colors.border,
            borderRadius: 999,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Text
          style={[
            styles.label,
            {
              color:
                selected === null
                  ? colors.primaryForeground
                  : colors.foreground,
            },
          ]}
        >
          {`All (${countFor(null)})`}
        </Text>
      </Pressable>

      {collections.map((c) => (
        <DraggableChip
          key={c.id}
          collection={c}
          label={`${c.name} (${countFor(c.id)})`}
          active={selected === c.id}
          isWeb={isWeb}
          layouts={layouts}
          positions={positions}
          order={order}
          activeId={activeId}
          onSelect={onSelect}
          onManage={onManage}
          onReorder={handleReorder}
        />
      ))}

      <Pressable
        testID="collection-chip-new"
        onPress={onCreate}
        style={({ pressed }) => [
          styles.chip,
          styles.newChip,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: 999,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Feather name="plus" size={14} color={colors.primary} />
        <Text style={[styles.label, { color: colors.primary }]}>New</Text>
      </Pressable>
    </ScrollView>
  );
}

type DraggableChipProps = {
  collection: Collection;
  label: string;
  active: boolean;
  isWeb: boolean;
  layouts: SharedValue<LayoutMap>;
  positions: SharedValue<PositionMap>;
  order: SharedValue<string[]>;
  activeId: SharedValue<string | null>;
  onSelect: (id: string | null) => void;
  onManage?: (collection: Collection) => void;
  onReorder: (collectionIds: string[]) => void;
};

function DraggableChip({
  collection,
  label,
  active,
  isWeb,
  layouts,
  positions,
  order,
  activeId,
  onSelect,
  onManage,
  onReorder,
}: DraggableChipProps) {
  const colors = useColors();
  const id = collection.id;
  // Live finger offset while this chip is the active (dragged) one.
  const translateX = useSharedValue(0);
  // 1 while picked up (drives lift/scale), 0 otherwise.
  const lifted = useSharedValue(0);

  const select = useCallback(() => onSelect(id), [onSelect, id]);
  const manage = useCallback(() => onManage?.(collection), [onManage, collection]);
  const tapHaptic = useCallback(() => {
    if (!isWeb) Haptics.selectionAsync().catch(() => {});
  }, [isWeb]);
  const commit = useCallback(() => {
    const pos = positions.value;
    const finalIds = Object.keys(pos).sort((a, b) => pos[a] - pos[b]);
    onReorder(finalIds);
  }, [positions, onReorder]);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { x, width } = e.nativeEvent.layout;
      layouts.value = { ...layouts.value, [id]: { x, w: width } };
    },
    [layouts, id],
  );

  const tap = Gesture.Tap().onEnd(() => {
    runOnJS(select)();
  });

  const pan = Gesture.Pan()
    .activateAfterLongPress(220)
    .onStart(() => {
      activeId.value = id;
      translateX.value = 0;
      lifted.value = withTiming(1, { duration: 120 });
      runOnJS(tapHaptic)();
    })
    .onUpdate((e) => {
      translateX.value = e.translationX;
      const lay = layouts.value;
      const ord = order.value;
      const naturalLeft = lay[id]?.x ?? 0;
      const activeLeft = naturalLeft + e.translationX;
      // Snap to the slot whose natural left edge is closest to the drag.
      let target = positions.value[id];
      let best = Infinity;
      for (let v = 0; v < ord.length; v++) {
        const slotLeft = lay[ord[v]]?.x ?? 0;
        const d = Math.abs(activeLeft - slotLeft);
        if (d < best) {
          best = d;
          target = v;
        }
      }
      const cur = positions.value[id];
      if (target !== cur) {
        const next: PositionMap = {};
        for (const k in positions.value) {
          const p = positions.value[k];
          if (k === id) next[k] = target;
          else if (cur < target && p > cur && p <= target) next[k] = p - 1;
          else if (cur > target && p >= target && p < cur) next[k] = p + 1;
          else next[k] = p;
        }
        positions.value = next;
      }
    })
    .onEnd((e) => {
      const moved = Math.abs(e.translationX) > DRAG_THRESHOLD;
      if (moved) runOnJS(commit)();
      else runOnJS(manage)();
    })
    .onFinalize(() => {
      activeId.value = null;
      lifted.value = withTiming(0, { duration: 120 });
    });

  const gesture = Gesture.Exclusive(pan, tap);

  const animatedStyle = useAnimatedStyle(() => {
    const isActive = activeId.value === id;
    const slotId = order.value[positions.value[id] ?? 0];
    const slotLeft = layouts.value[slotId]?.x ?? 0;
    const naturalLeft = layouts.value[id]?.x ?? 0;
    const restOffset = slotLeft - naturalLeft;
    const tx = isActive
      ? translateX.value
      : withSpring(restOffset, { damping: 22, stiffness: 220 });
    const scale = withSpring(isActive ? 1.06 : 1, {
      damping: 18,
      stiffness: 240,
    });
    return {
      transform: [{ translateX: tx }, { scale }],
      zIndex: isActive ? 20 : 0,
      shadowColor: "#000",
      shadowOpacity: 0.18 * lifted.value,
      shadowRadius: 8 * lifted.value,
      shadowOffset: { width: 0, height: 3 * lifted.value },
      elevation: 6 * lifted.value,
    };
  });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        testID={`collection-chip-${id}`}
        onLayout={onLayout}
        style={[
          styles.chip,
          animatedStyle,
          {
            backgroundColor: active ? colors.primary : colors.card,
            borderColor: active ? colors.primary : colors.border,
            borderWidth: 1,
            borderRadius: 999,
          },
        ]}
      >
        <Text
          style={[
            styles.label,
            { color: active ? colors.primaryForeground : colors.foreground },
          ]}
        >
          {label}
        </Text>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: GAP,
    paddingHorizontal: 20,
    paddingVertical: 4,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
  },
  newChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  label: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 13,
  },
});
