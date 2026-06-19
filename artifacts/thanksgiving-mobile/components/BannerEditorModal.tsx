import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { useToast } from "@/hooks/useToast";
import {
  getGetCmsPostQueryKey,
  getListCmsMediaQueryKey,
  useGetCmsPost,
  useListCmsMedia,
  useUpdateCmsPost,
  type MediaItem,
} from "@workspace/api-client-react";
import { buildCmsPostInput } from "@workspace/cms-post-input";

type Props = {
  /** The post being edited; the modal is hidden when null. */
  postId: string | null;
  visible: boolean;
  onClose: () => void;
  /** Called after a successful save so the caller can refresh the article. */
  onSaved?: () => void;
};

const MEDIA_LIMIT = 60;

/**
 * Bottom sheet that lets an authorised writer pick, preview, alt-tag, and clear
 * an article's banner image from the shared media library — mirroring the web
 * CMS banner flow. Loads the full CMS post detail, round-trips it through
 * `buildCmsPostInput` (so nested content is never dropped) and saves the chosen
 * `featuredImageUrl` / `featuredImageAlt` via `PUT /cms/posts/{id}`.
 */
export function BannerEditorModal({ postId, visible, onClose, onSaved }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { showUndoToast } = useToast();

  const [search, setSearch] = useState("");
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [alt, setAlt] = useState("");

  const detailQuery = useGetCmsPost(postId ?? "", {
    query: {
      enabled: visible && !!postId,
      queryKey: getGetCmsPostQueryKey(postId ?? ""),
    },
  });
  const detail = detailQuery.data;

  const mediaParams = useMemo(
    () => ({ q: search.trim() || undefined, limit: MEDIA_LIMIT }),
    [search],
  );
  const mediaQuery = useListCmsMedia(mediaParams, {
    query: {
      enabled: visible,
      queryKey: getListCmsMediaQueryKey(mediaParams),
    },
  });
  const media: MediaItem[] = mediaQuery.data?.items ?? [];

  const updateMutation = useUpdateCmsPost();

  // Seed the editor from the loaded detail's current banner.
  useEffect(() => {
    if (detail) {
      setSelectedUrl(detail.featuredImageUrl ?? null);
      setAlt(detail.featuredImageAlt ?? "");
    }
  }, [detail]);

  // Reset transient state whenever the sheet is dismissed.
  useEffect(() => {
    if (!visible) setSearch("");
  }, [visible]);

  const handleSelect = (item: MediaItem) => {
    setSelectedUrl(item.url);
    // Prefill alt text from the media item when the field is still empty.
    if (!alt.trim() && item.alt) setAlt(item.alt);
  };

  const handleClear = () => {
    setSelectedUrl(null);
    setAlt("");
  };

  const handleSave = async () => {
    if (!detail) return;
    try {
      const input = buildCmsPostInput(detail, {
        meta: {
          featuredImageUrl: selectedUrl,
          featuredImageAlt: selectedUrl ? alt.trim() || null : null,
        },
      });
      await updateMutation.mutateAsync({ id: detail.id, data: input });
      showUndoToast({ message: "Banner updated", onAction: () => {} });
      onSaved?.();
      onClose();
    } catch {
      showUndoToast({ message: "Could not save banner", onAction: () => {} });
    }
  };

  const dirty =
    !!detail &&
    (selectedUrl !== (detail.featuredImageUrl ?? null) ||
      (selectedUrl ? alt.trim() : "") !== (detail.featuredImageAlt ?? ""));

  return (
    <Modal
      visible={visible && postId !== null}
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
        <View style={[styles.grabber, { backgroundColor: colors.border }]} />

        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Article banner
          </Text>
          <Pressable
            testID="banner-close"
            onPress={onClose}
            hitSlop={10}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Feather name="x" size={22} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {detailQuery.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : detailQuery.isError || !detail ? (
          <View style={styles.center}>
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              Could not load this article. Pull back and try again.
            </Text>
          </View>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Current banner preview */}
            {selectedUrl ? (
              <Image
                source={{ uri: selectedUrl }}
                style={[styles.preview, { backgroundColor: colors.muted }]}
                contentFit="cover"
                transition={200}
              />
            ) : (
              <View
                style={[
                  styles.previewEmpty,
                  { backgroundColor: colors.muted, borderColor: colors.border },
                ]}
              >
                <Feather name="image" size={28} color={colors.mutedForeground} />
                <Text
                  style={[styles.previewEmptyText, { color: colors.mutedForeground }]}
                >
                  No banner set
                </Text>
              </View>
            )}

            {/* Alt text */}
            <Text style={[styles.label, { color: colors.foreground }]}>
              Alt text
            </Text>
            <TextInput
              testID="banner-alt-input"
              value={alt}
              onChangeText={setAlt}
              editable={!!selectedUrl}
              placeholder="Describe the banner for accessibility"
              placeholderTextColor={colors.mutedForeground}
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                  opacity: selectedUrl ? 1 : 0.5,
                },
              ]}
              multiline
            />

            {/* Media library */}
            <Text style={[styles.label, { color: colors.foreground }]}>
              Choose from media library
            </Text>
            <TextInput
              testID="banner-media-search"
              value={search}
              onChangeText={setSearch}
              placeholder="Search images…"
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
              returnKeyType="search"
            />

            {mediaQuery.isLoading ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : media.length === 0 ? (
              <Text style={[styles.empty, { color: colors.mutedForeground }]}>
                No images found.
              </Text>
            ) : (
              <View style={styles.grid}>
                {media.map((item) => {
                  const active = item.url === selectedUrl;
                  return (
                    <Pressable
                      key={item.url}
                      testID={`banner-media-${item.url}`}
                      onPress={() => handleSelect(item)}
                      style={[
                        styles.thumb,
                        {
                          borderColor: active ? colors.primary : colors.border,
                          borderWidth: active ? 3 : 1,
                          borderRadius: colors.radius,
                        },
                      ]}
                    >
                      <Image
                        source={{ uri: item.url }}
                        style={styles.thumbImage}
                        contentFit="cover"
                        transition={150}
                      />
                      {active ? (
                        <View
                          style={[
                            styles.thumbCheck,
                            { backgroundColor: colors.primary },
                          ]}
                        >
                          <Feather
                            name="check"
                            size={14}
                            color={colors.primaryForeground}
                          />
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </ScrollView>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          <Pressable
            testID="banner-clear"
            onPress={handleClear}
            disabled={!detail || !selectedUrl}
            style={({ pressed }) => [
              styles.clearButton,
              {
                borderColor: colors.border,
                borderRadius: colors.radius,
                opacity: !detail || !selectedUrl ? 0.4 : pressed ? 0.85 : 1,
              },
            ]}
          >
            <Feather name="trash-2" size={16} color={colors.foreground} />
            <Text style={[styles.clearText, { color: colors.foreground }]}>
              Clear
            </Text>
          </Pressable>
          <Pressable
            testID="banner-save"
            onPress={handleSave}
            disabled={!dirty || updateMutation.isPending}
            style={({ pressed }) => [
              styles.saveButton,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius,
                opacity: !dirty || updateMutation.isPending ? 0.5 : pressed ? 0.85 : 1,
              },
            ]}
          >
            {updateMutation.isPending ? (
              <ActivityIndicator color={colors.primaryForeground} size="small" />
            ) : (
              <Text style={[styles.saveText, { color: colors.primaryForeground }]}>
                Save banner
              </Text>
            )}
          </Pressable>
        </View>
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
    maxHeight: "88%",
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 14,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: {
    fontFamily: fonts.serifBold,
    fontSize: 22,
  },
  center: {
    paddingVertical: 32,
    alignItems: "center",
  },
  preview: {
    width: "100%",
    height: 170,
    borderRadius: 12,
  },
  previewEmpty: {
    width: "100%",
    height: 170,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  previewEmptyText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
  },
  label: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 14,
    marginTop: 18,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.sans,
    fontSize: 15,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 12,
  },
  thumb: {
    width: "31%",
    aspectRatio: 1,
    overflow: "hidden",
  },
  thumbImage: {
    width: "100%",
    height: "100%",
  },
  thumbCheck: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    paddingVertical: 24,
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  clearButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  clearText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 15,
  },
  saveButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  saveText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 15,
  },
});
