import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CategoryChips } from "@/components/CategoryChips";
import { PostCard } from "@/components/PostCard";
import { EmptyView, ErrorView, LoadingView } from "@/components/StateViews";
import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import {
  useListCategories,
  useListPosts,
  type PostSummary,
} from "@workspace/api-client-react";

const PAGE_SIZE = 10;

export default function ArticlesScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";

  const [category, setCategory] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [acc, setAcc] = useState<{ key: string; items: PostSummary[] }>({
    key: "all",
    items: [],
  });

  const categoriesQuery = useListCategories();

  const postsQuery = useListPosts({
    page,
    limit: PAGE_SIZE,
    category: category ?? undefined,
  });

  const { data, isLoading, isFetching, isError, refetch } = postsQuery;

  useEffect(() => {
    if (!data) return;
    const key = category ?? "all";
    setAcc((prev) => {
      if (data.pagination.page === 1 || prev.key !== key) {
        return { key, items: data.items };
      }
      const seen = new Set(prev.items.map((i) => i.id));
      const merged = [
        ...prev.items,
        ...data.items.filter((i) => !seen.has(i.id)),
      ];
      return { key, items: merged };
    });
  }, [data, category]);

  const handleCategory = useCallback(
    (slug: string | null) => {
      if (slug === category) return;
      setCategory(slug);
      setPage(1);
      setAcc({ key: slug ?? "all", items: [] });
    },
    [category],
  );

  const handleOpen = useCallback(
    (slug: string) => {
      router.push(`/post/${slug}`);
    },
    [router],
  );

  const total = data?.pagination.total ?? 0;
  const hasMore = acc.items.length < total;

  const onEndReached = useCallback(() => {
    if (hasMore && !isFetching) {
      setPage((p) => p + 1);
    }
  }, [hasMore, isFetching]);

  const onRefresh = useCallback(() => {
    setPage(1);
    setAcc({ key: category ?? "all", items: [] });
    refetch();
  }, [category, refetch]);

  const showInitialLoading = isLoading && acc.items.length === 0;

  const header = (
    <View>
      <View
        style={[
          styles.headerBlock,
          { paddingTop: insets.top + (isWeb ? 67 : 12) },
        ]}
      >
        <Text style={[styles.kicker, { color: colors.primary }]}>
          HEADOUT BLOG
        </Text>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Travel Stories & Guides
        </Text>
      </View>
      <View style={styles.chipsWrap}>
        <CategoryChips
          categories={categoriesQuery.data ?? []}
          selected={category}
          onSelect={handleCategory}
        />
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={acc.items}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <PostCard post={item} onPress={handleOpen} featured={index === 0} />
        )}
        ListHeaderComponent={header}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + (isWeb ? 100 : 40) },
        ]}
        showsVerticalScrollIndicator={false}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && page === 1 && acc.items.length > 0}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          showInitialLoading ? (
            <LoadingView label="Loading stories…" />
          ) : isError ? (
            <ErrorView onRetry={refetch} />
          ) : (
            <EmptyView
              icon="book-open"
              title="No articles yet"
              message="Try a different category."
            />
          )
        }
        ListFooterComponent={
          hasMore && acc.items.length > 0 ? (
            <View style={styles.footer}>
              <LoadingView />
            </View>
          ) : null
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
  },
  headerBlock: {
    marginHorizontal: -20,
    paddingHorizontal: 20,
    paddingBottom: 8,
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
  chipsWrap: {
    marginHorizontal: -20,
    marginBottom: 16,
  },
  footer: {
    paddingVertical: 12,
  },
});
