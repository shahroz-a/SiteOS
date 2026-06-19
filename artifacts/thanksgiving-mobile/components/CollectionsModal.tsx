import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import { useFavorites } from "@/hooks/useFavorites";
import type { PostSummary } from "@workspace/api-client-react";

type Props = {
  /** The post to assign; the modal is hidden when null. */
  post: PostSummary | null;
  visible: boolean;
  onClose: () => void;
};

/**
 * Bottom sheet that lets a reader file a saved article into one or more
 * collections, and create a new collection inline. Assigning a post to a
 * collection saves it automatically if it was not already bookmarked.
 */
export function CollectionsModal({ post, visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    collections,
    createCollection,
    isInCollection,
    togglePostCollection,
  } = useFavorites();
  const [newName, setNewName] = useState("");

  const handleCreate = () => {
    if (!post) return;
    const created = createCollection(newName);
    if (created) {
      togglePostCollection(post, created.id);
      setNewName("");
    }
  };

  return (
    <Modal
      visible={visible && post !== null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
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
        <View
          style={[styles.grabber, { backgroundColor: colors.border }]}
        />
        <Text style={[styles.title, { color: colors.foreground }]}>
          Add to collection
        </Text>
        {post ? (
          <Text
            style={[styles.subtitle, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            {post.title}
          </Text>
        ) : null}

        <View style={styles.createRow}>
          <TextInput
            testID="new-collection-input"
            value={newName}
            onChangeText={setNewName}
            placeholder="New collection name"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              {
                color: colors.foreground,
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
            returnKeyType="done"
            onSubmitEditing={handleCreate}
          />
          <Pressable
            testID="create-collection-button"
            onPress={handleCreate}
            disabled={!newName.trim()}
            style={({ pressed }) => [
              styles.createButton,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius,
                opacity: !newName.trim() ? 0.5 : pressed ? 0.85 : 1,
              },
            ]}
          >
            <Feather name="plus" size={20} color={colors.primaryForeground} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {collections.length === 0 ? (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              You have no collections yet. Create one above to start organizing
              your saved articles.
            </Text>
          ) : (
            collections.map((collection) => {
              const checked = post
                ? isInCollection(post.id, collection.id)
                : false;
              return (
                <Pressable
                  key={collection.id}
                  testID={`collection-row-${collection.id}`}
                  onPress={() => post && togglePostCollection(post, collection.id)}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      borderColor: colors.border,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[styles.rowLabel, { color: colors.foreground }]}
                    numberOfLines={1}
                  >
                    {collection.name}
                  </Text>
                  <View
                    style={[
                      styles.checkbox,
                      {
                        borderColor: checked ? colors.primary : colors.border,
                        backgroundColor: checked
                          ? colors.primary
                          : "transparent",
                        borderRadius: colors.radius * 0.75,
                      },
                    ]}
                  >
                    {checked ? (
                      <Feather
                        name="check"
                        size={16}
                        color={colors.primaryForeground}
                      />
                    ) : null}
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>

        <Pressable
          testID="collections-done-button"
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
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
  createRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.sans,
    fontSize: 15,
  },
  createButton: {
    width: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    marginTop: 8,
  },
  empty: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    paddingVertical: 24,
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  rowLabel: {
    flex: 1,
    fontFamily: fonts.sansSemiBold,
    fontSize: 16,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
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
