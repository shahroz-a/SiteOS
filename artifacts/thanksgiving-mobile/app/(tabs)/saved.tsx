import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CollectionChips } from "@/components/CollectionChips";
import { CollectionFormModal } from "@/components/CollectionFormModal";
import { CollectionsModal } from "@/components/CollectionsModal";
import { PostCard } from "@/components/PostCard";
import { EmptyView, LoadingView } from "@/components/StateViews";
import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import { useFavorites, type Collection } from "@/hooks/useFavorites";
import type { PostSummary } from "@workspace/api-client-react";

type FormState =
  | { mode: "create" }
  | { mode: "rename"; collection: Collection }
  | null;

export default function SavedScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";

  const {
    favorites,
    count,
    isLoaded,
    collections,
    collectionCount,
    getPostCollections,
    createCollection,
    renameCollection,
    deleteCollection,
  } = useFavorites();

  const [selected, setSelected] = useState<string | null>(null);
  const [managingPost, setManagingPost] = useState<PostSummary | null>(null);
  const [form, setForm] = useState<FormState>(null);

  // The selected collection may have been deleted; fall back to "All".
  const activeSelected =
    selected !== null && collections.some((c) => c.id === selected)
      ? selected
      : null;

  const visiblePosts = useMemo(() => {
    if (activeSelected === null) return favorites;
    return favorites.filter((p) =>
      getPostCollections(p.id).includes(activeSelected),
    );
  }, [favorites, activeSelected, getPostCollections]);

  const handleOpen = useCallback(
    (slug: string) => router.push(`/post/${slug}`),
    [router],
  );

  const handleManage = useCallback(
    (post: PostSummary) => setManagingPost(post),
    [],
  );

  const countFor = useCallback(
    (id: string | null) => (id === null ? count : collectionCount(id)),
    [count, collectionCount],
  );

  const handleManageCollection = useCallback(
    (collection: Collection) => {
      Alert.alert(collection.name, "Manage this collection", [
        {
          text: "Rename",
          onPress: () => setForm({ mode: "rename", collection }),
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteCollection(collection.id);
            setSelected((prev) => (prev === collection.id ? null : prev));
          },
        },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [deleteCollection],
  );

  const handleFormSubmit = useCallback(
    (name: string) => {
      if (form?.mode === "rename") {
        renameCollection(form.collection.id, name);
      } else {
        createCollection(name);
      }
      setForm(null);
    },
    [form, renameCollection, createCollection],
  );

  const header = (
    <View>
      <View
        style={[
          styles.headerBlock,
          { paddingTop: insets.top + (isWeb ? 67 : 12) },
        ]}
      >
        <Text style={[styles.kicker, { color: colors.primary }]}>
          YOUR LIBRARY
        </Text>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Saved
        </Text>
        {count > 0 ? (
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {count} {count === 1 ? "article" : "articles"} bookmarked
          </Text>
        ) : null}
      </View>
      {count > 0 ? (
        <View style={styles.chipsWrap}>
          <CollectionChips
            collections={collections}
            selected={activeSelected}
            onSelect={setSelected}
            countFor={countFor}
            onCreate={() => setForm({ mode: "create" })}
            onManage={handleManageCollection}
          />
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={visiblePosts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            onPress={handleOpen}
            onManageCollections={handleManage}
          />
        )}
        ListHeaderComponent={header}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + (isWeb ? 100 : 40) },
        ]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          !isLoaded ? (
            <LoadingView />
          ) : count === 0 ? (
            <EmptyView
              icon="heart"
              title="No saved articles yet"
              message="Tap the heart on any story to bookmark it and find it here later."
            />
          ) : (
            <EmptyView
              icon="folder"
              title="Nothing in this collection"
              message="Tap the folder icon on a saved article to add it here."
            />
          )
        }
      />

      <CollectionsModal
        post={managingPost}
        visible={managingPost !== null}
        onClose={() => setManagingPost(null)}
      />

      <CollectionFormModal
        visible={form !== null}
        title={form?.mode === "rename" ? "Rename collection" : "New collection"}
        submitLabel={form?.mode === "rename" ? "Save" : "Create"}
        initialName={form?.mode === "rename" ? form.collection.name : ""}
        onSubmit={handleFormSubmit}
        onClose={() => setForm(null)}
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
  chipsWrap: {
    marginHorizontal: -20,
    marginBottom: 16,
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
