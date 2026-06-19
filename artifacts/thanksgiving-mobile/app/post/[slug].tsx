import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ArticleContent } from "@/components/ArticleContent";
import { ErrorView, LoadingView } from "@/components/StateViews";
import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import { useFavorites } from "@/hooks/useFavorites";
import { useGetPostBySlug, type FaqItem } from "@workspace/api-client-react";

function formatDate(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function FaqRow({ item }: { item: FaqItem }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      onPress={() => setOpen((v) => !v)}
      style={[styles.faqRow, { borderColor: colors.border }]}
    >
      <View style={styles.faqHeader}>
        <Text style={[styles.faqQuestion, { color: colors.foreground }]}>
          {item.question}
        </Text>
        <Feather
          name={open ? "minus" : "plus"}
          size={20}
          color={colors.primary}
        />
      </View>
      {open ? (
        <Text style={[styles.faqAnswer, { color: colors.mutedForeground }]}>
          {item.answer}
        </Text>
      ) : null}
    </Pressable>
  );
}

export default function PostDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { isFavorite, toggleFavorite } = useFavorites();

  const { data: post, isLoading, isError, refetch } = useGetPostBySlug(slug);

  const date = formatDate(post?.publishedAt);
  const saved = post ? isFavorite(post.id) : false;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Floating back button */}
      <Pressable
        testID="back-button"
        onPress={() => router.back()}
        style={[
          styles.backButton,
          {
            top: insets.top + (isWeb ? 67 : 8),
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <Feather name="arrow-left" size={20} color={colors.foreground} />
      </Pressable>

      {/* Floating favorite button */}
      {post ? (
        <Pressable
          testID="favorite-toggle"
          accessibilityRole="button"
          accessibilityLabel={saved ? "Remove from saved" : "Save article"}
          onPress={() => toggleFavorite(post)}
          style={[
            styles.favButton,
            {
              top: insets.top + (isWeb ? 67 : 8),
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <Feather
            name="heart"
            size={20}
            color={saved ? colors.primary : colors.foreground}
          />
        </Pressable>
      ) : null}

      {isLoading ? (
        <LoadingView label="Loading article…" />
      ) : isError || !post ? (
        <ErrorView onRetry={refetch} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingBottom: insets.bottom + 60,
          }}
        >
          {post.featuredImageUrl ? (
            <Image
              source={{ uri: post.featuredImageUrl }}
              style={[styles.hero, { backgroundColor: colors.muted }]}
              contentFit="cover"
              transition={250}
            />
          ) : (
            <View style={{ height: insets.top + (isWeb ? 67 : 8) + 56 }} />
          )}

          <View style={styles.content}>
            {post.primaryCategory ? (
              <Text style={[styles.kicker, { color: colors.primary }]}>
                {post.primaryCategory.name.toUpperCase()}
              </Text>
            ) : null}

            <Text style={[styles.title, { color: colors.foreground }]}>
              {post.title}
            </Text>

            {post.subtitle ? (
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                {post.subtitle}
              </Text>
            ) : null}

            <View style={styles.metaRow}>
              {post.author?.name ? (
                <Text style={[styles.metaText, { color: colors.foreground }]}>
                  {post.author.name}
                </Text>
              ) : null}
              {date ? (
                <Text
                  style={[styles.metaText, { color: colors.mutedForeground }]}
                >
                  {post.author?.name ? "·  " : ""}
                  {date}
                </Text>
              ) : null}
              {post.readingTimeMinutes ? (
                <Text
                  style={[styles.metaText, { color: colors.mutedForeground }]}
                >
                  ·  {post.readingTimeMinutes} min read
                </Text>
              ) : null}
            </View>

            <View
              style={[styles.divider, { backgroundColor: colors.border }]}
            />

            <ArticleContent
              componentTree={post.componentTree}
              excerpt={post.excerpt}
              images={post.images}
            />

            {post.faq.length > 0 ? (
              <View style={styles.faqSection}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                  Frequently asked questions
                </Text>
                {post.faq
                  .slice()
                  .sort((a, b) => a.position - b.position)
                  .map((item) => (
                    <FaqRow key={item.id} item={item} />
                  ))}
              </View>
            ) : null}

            {post.author?.name ? (
              <View
                style={[
                  styles.authorCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius * 1.5,
                  },
                ]}
              >
                <View
                  style={[
                    styles.authorAvatar,
                    { backgroundColor: colors.secondary },
                  ]}
                >
                  <Feather name="user" size={22} color={colors.primary} />
                </View>
                <View style={styles.authorInfo}>
                  <Text
                    style={[styles.authorLabel, { color: colors.mutedForeground }]}
                  >
                    WRITTEN BY
                  </Text>
                  <Text style={[styles.authorName, { color: colors.foreground }]}>
                    {post.author.name}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backButton: {
    position: "absolute",
    left: 16,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  favButton: {
    position: "absolute",
    right: 16,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  hero: {
    width: "100%",
    height: 300,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  kicker: {
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  title: {
    fontFamily: fonts.serifExtraBold,
    fontSize: 30,
    lineHeight: 38,
  },
  subtitle: {
    fontFamily: fonts.serifMedium,
    fontSize: 18,
    lineHeight: 26,
    marginTop: 10,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 4,
    marginTop: 16,
  },
  metaText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
  },
  divider: {
    height: 1,
    marginTop: 20,
  },
  faqSection: {
    marginTop: 36,
  },
  sectionTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 24,
    marginBottom: 8,
  },
  faqRow: {
    borderBottomWidth: 1,
    paddingVertical: 16,
  },
  faqHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  faqQuestion: {
    flex: 1,
    fontFamily: fonts.sansSemiBold,
    fontSize: 16,
    lineHeight: 22,
  },
  faqAnswer: {
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 23,
    marginTop: 10,
  },
  authorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderWidth: 1,
    marginTop: 36,
  },
  authorAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  authorInfo: {
    gap: 2,
  },
  authorLabel: {
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 1,
  },
  authorName: {
    fontFamily: fonts.serifBold,
    fontSize: 18,
  },
});
