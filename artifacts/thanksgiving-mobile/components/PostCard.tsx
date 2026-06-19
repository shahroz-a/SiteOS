import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import type { PostSummary } from "@workspace/api-client-react";

type Props = {
  post: PostSummary;
  onPress: (slug: string) => void;
  featured?: boolean;
};

function formatDate(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function PostCardBase({ post, onPress, featured = false }: Props) {
  const colors = useColors();
  const date = formatDate(post.publishedAt);

  return (
    <Pressable
      testID={`post-card-${post.slug}`}
      onPress={() => onPress(post.slug)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius * 1.75,
          opacity: pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.99 : 1 }],
        },
      ]}
    >
      {post.featuredImageUrl ? (
        <Image
          source={{ uri: post.featuredImageUrl }}
          style={[
            featured ? styles.featuredImage : styles.image,
            { backgroundColor: colors.muted },
          ]}
          contentFit="cover"
          transition={250}
        />
      ) : (
        <View
          style={[
            featured ? styles.featuredImage : styles.image,
            styles.imageFallback,
            { backgroundColor: colors.muted },
          ]}
        >
          <Feather name="image" size={28} color={colors.mutedForeground} />
        </View>
      )}

      <View style={styles.body}>
        {post.primaryCategory ? (
          <Text
            style={[styles.category, { color: colors.primary }]}
            numberOfLines={1}
          >
            {post.primaryCategory.name.toUpperCase()}
          </Text>
        ) : null}

        <Text
          style={[
            featured ? styles.featuredTitle : styles.title,
            { color: colors.foreground },
          ]}
          numberOfLines={featured ? 3 : 2}
        >
          {post.title}
        </Text>

        {post.excerpt ? (
          <Text
            style={[styles.excerpt, { color: colors.mutedForeground }]}
            numberOfLines={featured ? 3 : 2}
          >
            {post.excerpt}
          </Text>
        ) : null}

        <View style={styles.metaRow}>
          {post.author?.name ? (
            <Text
              style={[styles.metaText, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              {post.author.name}
            </Text>
          ) : null}
          {post.author?.name && (date || post.readingTimeMinutes) ? (
            <Text style={[styles.metaDot, { color: colors.mutedForeground }]}>
              ·
            </Text>
          ) : null}
          {date ? (
            <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
              {date}
            </Text>
          ) : null}
          {post.readingTimeMinutes ? (
            <>
              <Text style={[styles.metaDot, { color: colors.mutedForeground }]}>
                ·
              </Text>
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                {post.readingTimeMinutes} min
              </Text>
            </>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 18,
  },
  image: {
    width: "100%",
    height: 190,
  },
  featuredImage: {
    width: "100%",
    height: 240,
  },
  imageFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    padding: 16,
    gap: 8,
  },
  category: {
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 1,
  },
  title: {
    fontFamily: fonts.serifBold,
    fontSize: 20,
    lineHeight: 26,
  },
  featuredTitle: {
    fontFamily: fonts.serifExtraBold,
    fontSize: 26,
    lineHeight: 32,
  },
  excerpt: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
  },
  metaText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
  },
  metaDot: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
  },
});

export const PostCard = memo(PostCardBase);
