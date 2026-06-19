import { useRouter } from "expo-router";
import { useCallback } from "react";
import { FlatList, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PostCard } from "@/components/PostCard";
import { EmptyView, LoadingView } from "@/components/StateViews";
import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import { useFavorites } from "@/hooks/useFavorites";

export default function SavedScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";

  const { favorites, count, isLoaded } = useFavorites();

  const handleOpen = useCallback(
    (slug: string) => router.push(`/post/${slug}`),
    [router],
  );

  const header = (
    <View
      style={[styles.headerBlock, { paddingTop: insets.top + (isWeb ? 67 : 12) }]}
    >
      <Text style={[styles.kicker, { color: colors.primary }]}>YOUR LIBRARY</Text>
      <Text style={[styles.headerTitle, { color: colors.foreground }]}>Saved</Text>
      {count > 0 ? (
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {count} {count === 1 ? "article" : "articles"} bookmarked
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={favorites}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <PostCard post={item} onPress={handleOpen} />}
        ListHeaderComponent={header}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + (isWeb ? 100 : 40) },
        ]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          !isLoaded ? (
            <LoadingView />
          ) : (
            <EmptyView
              icon="heart"
              title="No saved articles yet"
              message="Tap the heart on any story to bookmark it and find it here later."
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    flexGrow: 1,
  },
  headerBlock: {
    paddingBottom: 16,
    gap: 4,
  },
  kicker: {
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 1.5,
  },
  headerTitle: {
    fontFamily: fonts.serifExtraBold,
    fontSize: 32,
    lineHeight: 38,
  },
  subtitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    marginTop: 2,
  },
});
