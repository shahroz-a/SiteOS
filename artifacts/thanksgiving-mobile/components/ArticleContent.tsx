import { Image } from "expo-image";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import type { ImageItem, PostDetail } from "@workspace/api-client-react";

type TreeNode = {
  type?: string;
  blockType?: string;
  text?: string;
  anchorId?: string;
  data?: { level?: number; heading?: string };
  children?: TreeNode[];
};

type Props = {
  componentTree?: PostDetail["componentTree"];
  excerpt?: string | null;
  images?: ImageItem[];
};

function headingStyle(level: number) {
  if (level <= 2) return { fontSize: 24, lineHeight: 30, marginTop: 28 };
  if (level === 3) return { fontSize: 20, lineHeight: 26, marginTop: 22 };
  return { fontSize: 17, lineHeight: 23, marginTop: 18 };
}

export function ArticleContent({ componentTree, excerpt, images }: Props) {
  const colors = useColors();

  const root = componentTree as TreeNode | null | undefined;
  const nodes = root?.children ?? [];

  const elements: React.ReactNode[] = [];
  let key = 0;

  const renderNode = (node: TreeNode) => {
    if (typeof node.text === "string" && node.text.trim().length > 0) {
      elements.push(
        <Text
          key={key++}
          style={[styles.paragraph, { color: colors.foreground }]}
        >
          {node.text}
        </Text>,
      );
    }

    const heading = node.data?.heading;
    if (heading && heading.trim().length > 0) {
      const hs = headingStyle(node.data?.level ?? 2);
      elements.push(
        <Text
          key={key++}
          style={[
            styles.heading,
            { color: colors.foreground, ...hs },
          ]}
        >
          {heading}
        </Text>,
      );
    }

    if (Array.isArray(node.children)) {
      node.children.forEach(renderNode);
    }
  };

  nodes.forEach(renderNode);

  // Fallback to the excerpt when no structured content is available.
  if (elements.length === 0 && excerpt) {
    elements.push(
      <Text
        key={key++}
        style={[styles.paragraph, { color: colors.foreground }]}
      >
        {excerpt}
      </Text>,
    );
  }

  const galleryImages = (images ?? []).filter(
    (img) => img.role !== "featured" && !!img.url,
  );

  return (
    <View>
      {elements}

      {galleryImages.length > 0 ? (
        <View style={styles.gallery}>
          <Text style={[styles.heading, { color: colors.foreground, fontSize: 22, marginTop: 28 }]}>
            Gallery
          </Text>
          {galleryImages.slice(0, 12).map((img) => (
            <View key={img.id} style={styles.galleryItem}>
              <Image
                source={{ uri: img.url }}
                style={[
                  styles.galleryImage,
                  { backgroundColor: colors.muted, borderRadius: colors.radius },
                ]}
                contentFit="cover"
                transition={200}
              />
              {img.caption ? (
                <Text
                  style={[styles.caption, { color: colors.mutedForeground }]}
                >
                  {img.caption}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  paragraph: {
    fontFamily: fonts.sans,
    fontSize: 16,
    lineHeight: 26,
    marginTop: 14,
  },
  heading: {
    fontFamily: fonts.serifBold,
  },
  gallery: {
    marginTop: 8,
    gap: 16,
  },
  galleryItem: {
    gap: 6,
  },
  galleryImage: {
    width: "100%",
    height: 210,
  },
  caption: {
    fontFamily: fonts.sans,
    fontSize: 13,
    fontStyle: "italic",
    lineHeight: 19,
  },
});
