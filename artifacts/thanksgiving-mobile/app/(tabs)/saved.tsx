import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, Platform, StyleSheet, Text, View } from "react-native";
import ReorderableList, {
  reorderItems,
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from "react-native-reorderable-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CollectionChips } from "@/components/CollectionChips";
import { CollectionFormModal } from "@/components/CollectionFormModal";
import { CollectionReorderModal } from "@/components/CollectionReorderModal";
import { CollectionsModal } from "@/components/CollectionsModal";
import { PostCard } from "@/components/PostCard";
import { EmptyView, LoadingView } from "@/components/StateViews";
import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import { useFavorites, type Collection } from "@/hooks/useFavorites";
import type { PostSummary } from "@workspace/api-client-react";

/**
 * A PostCard wrapper for the reorderable list. Long-pressing the card starts a
 * drag (with a haptic tap), letting readers reorder articles in a collection.
 */
function DraggablePostCard({
  post,
  onPress,
  onManageCollections,
}: {
  post: PostSummary;
  onPress: (slug: string) => void;
  onManageCollections: (post: PostSummary) => void;
}) {
  const drag = useReorderableDrag();
  const handleLongPress = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    drag();
  }, [drag]);

  return (
    <PostCard
      post={post}
      onPress={onPress}
      onManageCollections={onManageCollections}
      onLongPress={handleLongPress}
    />
  );
}

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
    getCollectionPosts,
    reorderCollection,
    reorderCollections,
    createCollection,
    renameCollection,
    deleteCollection,
  } = useFavorites();

  const [selected, setSelected] = useState<string | null>(null);
  const [managingPost, setManagingPost] = useState<PostSummary | null>(null);
  const [form, setForm] = useState<FormState>(null);
  const [reordering, setReordering] = useState(false);

  // The selected collection may have been deleted; fall back to "All".
  const activeSelected =
    selected !== null && collections.some((c) => c.id === selected)
      ? selected
      : null;

  // The unfiltered "All" view keeps save order; a selected collection uses the
  // reader's custom per-collection order.
  const visiblePosts = useMemo(() => {
    if (activeSelected === null) return favorites;
    return getCollectionPosts(activeSelected);
  }, [favorites, activeSelected, getCollectionPosts]);

  const handleOpen = useCallback(
    (slug: string) => router.push(`/post/${slug}`),
    [router],
  );

  const handleReorder = useCallback(
    ({ from, to }: ReorderableListReorderEvent) => {
      if (activeSelected === null) return;
      const reordered = reorderItems(visiblePosts, from, to);
      reorderCollection(
        activeSelected,
        reordered.map((p) => p.id),
      );
    },
    [activeSelected, visiblePosts, reorderCollection],
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
      const buttons: Parameters<typeof Alert.alert>[2] = [
        {
          text: "Rename",
          onPress: () => setForm({ mode: "rename", collection }),
        },
      ];
      // Reordering only makes sense with more than one collection.
      if (collections.length > 1) {
        buttons.push({
          text: "Reorder collections",
          onPress: () => setReordering(true),
        });
      }
      buttons.push(
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteCollection(collection.id);
            setSelected((prev) => (prev === collection.id ? null : prev));
          },
        },
        { text: "Cancel", style: "cancel" },
      );
      Alert.alert(collection.name, "Manage this collection", buttons);
    },
    [deleteCollection, collections.length],
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
      {activeSelected !== null && visiblePosts.length > 1 ? (
        <View style={styles.reorderHint}>
          <Feather name="move" size={13} color={colors.mutedForeground} />
          <Text style={[styles.reorderHintText, { color: colors.mutedForeground }]}>
            Long-press and drag to reorder
          </Text>
        </View>
      ) : null}
    </View>
  );

  const sharedListProps = {
    keyExtractor: (item: PostSummary) => item.id,
    ListHeaderComponent: header,
    contentContainerStyle: [
      styles.listContent,
      { paddingBottom: insets.bottom + (isWeb ? 100 : 40) },
    ],
    showsVerticalScrollIndicator: false,
    ListEmptyComponent: !isLoaded ? (
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
    ),
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {activeSelected !== null ? (
        <ReorderableList
          {...sharedListProps}
          data={visiblePosts}
          onReorder={handleReorder}
          renderItem={({ item }) => (
            <DraggablePostCard
              post={item}
              onPress={handleOpen}
              onManageCollections={handleManage}
            />
          )}
        />
      ) : (
        <FlatList
          {...sharedListProps}
          data={visiblePosts}
          renderItem={({ item }) => (
            <PostCard
              post={item}
              onPress={handleOpen}
              onManageCollections={handleManage}
            />
          )}
        />
      )}

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

      <CollectionReorderModal
        visible={reordering}
        collections={collections}
        onReorder={reorderCollections}
        onClose={() => setReordering(false)}
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
  reorderHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 14,
  },
  reorderHintText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
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
