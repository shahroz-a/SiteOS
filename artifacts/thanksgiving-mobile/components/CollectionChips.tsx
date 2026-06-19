import { Feather } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import type { Collection } from "@/hooks/useFavorites";

type Props = {
  collections: Collection[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Count of saved articles for a collection id (or total for `null`). */
  countFor: (id: string | null) => number;
  /** Tapping the trailing "New" chip. */
  onCreate: () => void;
  /** Long-pressing a collection chip (e.g. to rename/delete). */
  onManage?: (collection: Collection) => void;
};

/**
 * Horizontal collection filter for the Saved tab, mirroring the Articles tab's
 * CategoryChips pattern. Includes an "All" chip and a trailing "New" chip.
 */
export function CollectionChips({
  collections,
  selected,
  onSelect,
  countFor,
  onCreate,
  onManage,
}: Props) {
  const colors = useColors();

  const renderChip = (
    key: string,
    label: string,
    active: boolean,
    onPress: () => void,
    onLongPress?: () => void,
    testID?: string,
  ) => (
    <Pressable
      key={key}
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? colors.primary : colors.card,
          borderColor: active ? colors.primary : colors.border,
          borderRadius: 999,
          opacity: pressed ? 0.85 : 1,
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
    </Pressable>
  );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {renderChip(
        "all",
        `All (${countFor(null)})`,
        selected === null,
        () => onSelect(null),
        undefined,
        "collection-chip-all",
      )}
      {collections.map((c) =>
        renderChip(
          c.id,
          `${c.name} (${countFor(c.id)})`,
          selected === c.id,
          () => onSelect(c.id),
          onManage ? () => onManage(c) : undefined,
          `collection-chip-${c.id}`,
        ),
      )}
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

const styles = StyleSheet.create({
  row: {
    gap: 8,
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
