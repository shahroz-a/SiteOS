import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import ReorderableList, {
  reorderItems,
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from "react-native-reorderable-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import type { Collection } from "@/hooks/useFavorites";

type Props = {
  visible: boolean;
  collections: Collection[];
  /** Persist the new chip order (full list of ids, first-to-last). */
  onReorder: (collectionIds: string[]) => void;
  onClose: () => void;
};

/** A draggable collection row. Long-pressing (or the handle) starts a drag. */
function ReorderRow({ collection }: { collection: Collection }) {
  const colors = useColors();
  const drag = useReorderableDrag();
  const handleDrag = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    drag();
  }, [drag]);

  return (
    <Pressable
      testID={`collection-reorder-row-${collection.id}`}
      onLongPress={handleDrag}
      delayLongPress={150}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text
        style={[styles.rowLabel, { color: colors.foreground }]}
        numberOfLines={1}
      >
        {collection.name}
      </Text>
      <Pressable
        testID={`collection-reorder-handle-${collection.id}`}
        onPressIn={handleDrag}
        hitSlop={10}
      >
        <Feather name="menu" size={20} color={colors.mutedForeground} />
      </Pressable>
    </Pressable>
  );
}

/**
 * Bottom sheet for reordering the Saved tab's collection chips. The "All" and
 * "New" chips are not collections, so they are unaffected and stay pinned in
 * the chip row. Reordering persists immediately via `onReorder`.
 */
export function CollectionReorderModal({
  visible,
  collections,
  onReorder,
  onClose,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  // Local working copy so drags feel instant; synced from props on open.
  const [items, setItems] = useState<Collection[]>(collections);

  useEffect(() => {
    if (visible) setItems(collections);
  }, [visible, collections]);

  const handleReorder = useCallback(
    ({ from, to }: ReorderableListReorderEvent) => {
      setItems((prev) => {
        const next = reorderItems(prev, from, to);
        onReorder(next.map((c) => c.id));
        return next;
      });
    },
    [onReorder],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              borderTopLeftRadius: colors.radius * 2.5,
              borderTopRightRadius: colors.radius * 2.5,
              paddingBottom: insets.bottom + 16,
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <Text style={[styles.title, { color: colors.foreground }]}>
            Reorder collections
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Drag to set the order of your collection filters.
          </Text>

          <ReorderableList
            data={items}
            onReorder={handleReorder}
            keyExtractor={(item) => item.id}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => <ReorderRow collection={item} />}
          />

          <Pressable
            testID="collection-reorder-done"
            onPress={onClose}
            style={({ pressed }) => [
              styles.doneButton,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text style={[styles.doneText, { color: colors.foreground }]}>
              Done
            </Text>
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
    maxHeight: "82%",
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 14,
  },
  title: {
    fontFamily: fonts.serifBold,
    fontSize: 22,
  },
  subtitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    marginTop: 2,
  },
  list: {
    marginTop: 16,
  },
  listContent: {
    gap: 10,
    paddingBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  rowLabel: {
    flex: 1,
    fontFamily: fonts.sansSemiBold,
    fontSize: 16,
  },
  doneButton: {
    marginTop: 16,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: "center",
  },
  doneText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 15,
  },
});
