import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PostCard } from "@/components/PostCard";
import { EmptyView, ErrorView, LoadingView } from "@/components/StateViews";
import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import {
  getSearchPostsQueryKey,
  useSearchPosts,
} from "@workspace/api-client-react";

export default function SearchScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";

  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setQuery(input.trim()), 350);
    return () => clearTimeout(handle);
  }, [input]);

  const enabled = query.length > 0;
  const { data, isLoading, isError, refetch } = useSearchPosts(
    { q: query, limit: 20 },
    {
      query: {
        enabled,
        queryKey: getSearchPostsQueryKey({ q: query, limit: 20 }),
      },
    },
  );

  const handleOpen = useCallback(
    (slug: string) => router.push(`/post/${slug}`),
    [router],
  );

  const results = data?.items ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + (isWeb ? 67 : 12) },
        ]}
      >
        <Text style={[styles.title, { color: colors.foreground }]}>Search</Text>
        <View
          style={[
            styles.searchBox,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius * 1.5,
            },
          ]}
        >
          <Feather name="search" size={18} color={colors.mutedForeground} />
          <TextInput
            testID="search-input"
            value={input}
            onChangeText={setInput}
            placeholder="Search articles…"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground }]}
            returnKeyType="search"
            autoCorrect={false}
          />
          {input.length > 0 ? (
            <Feather
              name="x"
              size={18}
              color={colors.mutedForeground}
              onPress={() => setInput("")}
            />
          ) : null}
        </View>
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PostCard post={item} onPress={handleOpen} />
        )}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + (isWeb ? 100 : 40) },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          !enabled ? (
            <EmptyView
              icon="search"
              title="Find your next trip"
              message="Search across every travel story and guide."
            />
          ) : isLoading ? (
            <LoadingView label="Searching…" />
          ) : isError ? (
            <ErrorView onRetry={refetch} />
          ) : (
            <EmptyView
              icon="search"
              title="No results"
              message={`Nothing found for “${query}”.`}
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
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 12,
  },
  title: {
    fontFamily: fonts.serifExtraBold,
    fontSize: 32,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 16,
    padding: 0,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    flexGrow: 1,
  },
});
