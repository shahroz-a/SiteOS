import { ScrollView, StyleSheet, Pressable, Text } from "react-native";

import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import type { Category } from "@workspace/api-client-react";

type Props = {
  categories: Category[];
  selected: string | null;
  onSelect: (slug: string | null) => void;
};

export function CategoryChips({ categories, selected, onSelect }: Props) {
  const colors = useColors();

  const items: { slug: string | null; name: string }[] = [
    { slug: null, name: "All" },
    ...categories.map((c) => ({ slug: c.slug, name: c.name })),
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {items.map((item) => {
        const active = selected === item.slug;
        return (
          <Pressable
            key={item.slug ?? "all"}
            testID={`chip-${item.slug ?? "all"}`}
            onPress={() => onSelect(item.slug)}
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
              {item.name}
            </Text>
          </Pressable>
        );
      })}
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
  label: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 13,
  },
});
