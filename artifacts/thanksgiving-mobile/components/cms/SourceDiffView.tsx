import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";

import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import type { SourceDiffResult, WordSeg } from "@workspace/content-diff";

/**
 * Renders the importer fidelity diff (source HTML vs parsed content) on mobile.
 *
 * Mirrors the web `SourceDiff`: the source body is shown with each block tagged
 * by how the importer treated it — dropped paragraphs are flagged in the
 * destructive color, lightly garbled ("changed") paragraphs show an inline
 * word-level diff, and source images/links the importer never carried over are
 * listed separately. All diff math comes from the shared `@workspace/content-diff`
 * helpers, so this view can't drift from the web one.
 */

function SummaryChip({
  icon,
  count,
  label,
  tone,
}: {
  icon: keyof typeof Feather.glyphMap;
  count: number;
  label: string;
  tone: "loss" | "info";
}) {
  const colors = useColors();
  const active = count > 0;
  const color =
    tone === "loss" && active ? colors.destructive : colors.mutedForeground;
  return (
    <View
      style={[
        styles.chip,
        {
          borderColor: colors.border,
          borderRadius: colors.radius,
          backgroundColor: colors.card,
        },
      ]}
    >
      <Feather name={icon} size={13} color={color} />
      <Text style={[styles.chipCount, { color: colors.foreground }]}>
        {count}
      </Text>
      <Text style={[styles.chipLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
    </View>
  );
}

function WordDiff({ words }: { words: WordSeg[] }) {
  const colors = useColors();
  return (
    <Text style={[styles.blockText, { color: colors.foreground }]}>
      {words.map((w, i) => {
        if (w.type === "added") return null;
        const removed = w.type === "removed";
        return (
          <Text
            key={i}
            style={
              removed
                ? {
                    color: colors.destructive,
                    textDecorationLine: "line-through",
                  }
                : undefined
            }
          >
            {w.text}
            {i < words.length - 1 ? " " : ""}
          </Text>
        );
      })}
    </Text>
  );
}

export function SourceDiffView({ diff }: { diff: SourceDiffResult }) {
  const colors = useColors();

  if (!diff.hasSource) {
    return (
      <View style={styles.notice}>
        <Feather name="file-minus" size={28} color={colors.mutedForeground} />
        <Text style={[styles.noticeTitle, { color: colors.foreground }]}>
          No source stored
        </Text>
        <Text style={[styles.noticeText, { color: colors.mutedForeground }]}>
          This article has no original source HTML to compare against.
        </Text>
      </View>
    );
  }

  const clean = diff.total === 0;

  return (
    <View style={styles.root}>
      <View
        style={[
          styles.summary,
          clean
            ? { backgroundColor: colors.secondary, borderColor: colors.border }
            : { backgroundColor: colors.card, borderColor: colors.destructive },
          { borderRadius: colors.radius * 1.5 },
        ]}
      >
        <View style={styles.summaryHead}>
          <Feather
            name={clean ? "check-circle" : "alert-triangle"}
            size={16}
            color={clean ? colors.primary : colors.destructive}
          />
          <Text style={[styles.summaryTitle, { color: colors.foreground }]}>
            {clean
              ? "Clean import — nothing lost"
              : `${diff.total} ${diff.total === 1 ? "difference" : "differences"} from source`}
          </Text>
        </View>
        <View style={styles.chipRow}>
          <SummaryChip
            icon="trash-2"
            count={diff.counts.dropped}
            label="dropped"
            tone="loss"
          />
          <SummaryChip
            icon="edit-3"
            count={diff.counts.changed}
            label="changed"
            tone="loss"
          />
          <SummaryChip
            icon="image"
            count={diff.counts.missingImages}
            label="images"
            tone="loss"
          />
          <SummaryChip
            icon="link"
            count={diff.counts.droppedLinks}
            label="links"
            tone="loss"
          />
          {diff.counts.added > 0 ? (
            <SummaryChip
              icon="plus-circle"
              count={diff.counts.added}
              label="added"
              tone="info"
            />
          ) : null}
        </View>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
        Source content
      </Text>
      <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>
        The original article. Text in red was dropped or garbled by the importer.
      </Text>

      <View style={styles.blocks}>
        {diff.sourceBlocks.map((block, i) => {
          if (block.kind === "removed") {
            return (
              <View
                key={i}
                style={[
                  styles.block,
                  styles.removedBlock,
                  {
                    borderLeftColor: colors.destructive,
                    backgroundColor: colors.card,
                    borderRadius: colors.radius,
                  },
                ]}
              >
                <View style={styles.tagRow}>
                  <Feather name="trash-2" size={11} color={colors.destructive} />
                  <Text style={[styles.tag, { color: colors.destructive }]}>
                    Dropped
                  </Text>
                </View>
                <Text
                  style={[
                    styles.blockText,
                    {
                      color: colors.destructive,
                      textDecorationLine: "line-through",
                    },
                  ]}
                >
                  {block.text}
                </Text>
              </View>
            );
          }
          if (block.kind === "changed" && block.words) {
            return (
              <View
                key={i}
                style={[
                  styles.block,
                  styles.removedBlock,
                  {
                    borderLeftColor: colors.destructive,
                    backgroundColor: colors.card,
                    borderRadius: colors.radius,
                  },
                ]}
              >
                <View style={styles.tagRow}>
                  <Feather name="edit-3" size={11} color={colors.destructive} />
                  <Text style={[styles.tag, { color: colors.destructive }]}>
                    Changed
                  </Text>
                </View>
                <WordDiff words={block.words} />
              </View>
            );
          }
          return (
            <Text
              key={i}
              style={[styles.blockText, styles.equalBlock, { color: colors.foreground }]}
            >
              {block.text}
            </Text>
          );
        })}
      </View>

      {diff.missingImages.length > 0 ? (
        <View style={styles.assetSection}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Missing images
          </Text>
          <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>
            In the source but not carried into the parsed article.
          </Text>
          {diff.missingImages.map((img, i) => (
            <View
              key={`${img.url}-${i}`}
              style={[
                styles.assetRow,
                { borderColor: colors.border, borderRadius: colors.radius },
              ]}
            >
              <Image
                source={{ uri: img.url }}
                style={[styles.thumb, { borderRadius: colors.radius }]}
                contentFit="cover"
                transition={150}
              />
              <View style={styles.assetMeta}>
                <Text
                  style={[styles.assetAlt, { color: colors.foreground }]}
                  numberOfLines={2}
                >
                  {img.alt || "No alt text"}
                </Text>
                <Text
                  style={[styles.assetUrl, { color: colors.mutedForeground }]}
                  numberOfLines={1}
                >
                  {img.url}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {diff.droppedLinks.length > 0 ? (
        <View style={styles.assetSection}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Dropped links
          </Text>
          <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>
            Source links the importer didn&apos;t preserve.
          </Text>
          {diff.droppedLinks.map((link, i) => (
            <View
              key={`${link.url}-${i}`}
              style={[
                styles.linkRow,
                { borderColor: colors.border, borderRadius: colors.radius },
              ]}
            >
              <Feather name="link" size={14} color={colors.destructive} />
              <View style={styles.assetMeta}>
                <Text
                  style={[styles.assetAlt, { color: colors.foreground }]}
                  numberOfLines={2}
                >
                  {link.text || "(no link text)"}
                </Text>
                <Text
                  style={[styles.assetUrl, { color: colors.mutedForeground }]}
                  numberOfLines={1}
                >
                  {link.url}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 14 },
  summary: { borderWidth: 1, padding: 14, gap: 12 },
  summaryHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryTitle: { fontFamily: fonts.serifSemiBold, fontSize: 16, flex: 1 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  chipCount: { fontFamily: fonts.sansBold, fontSize: 13 },
  chipLabel: { fontFamily: fonts.sansMedium, fontSize: 12 },
  sectionTitle: { fontFamily: fonts.serifBold, fontSize: 20 },
  sectionHint: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 18, marginTop: -6 },
  blocks: { gap: 10 },
  block: { padding: 12, gap: 6 },
  removedBlock: { borderLeftWidth: 3 },
  equalBlock: { paddingVertical: 2 },
  tagRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  tag: {
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  blockText: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 23 },
  assetSection: { gap: 10 },
  assetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    padding: 10,
  },
  thumb: { width: 64, height: 64, backgroundColor: "#00000010" },
  assetMeta: { flex: 1, gap: 3 },
  assetAlt: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  assetUrl: { fontFamily: fonts.sans, fontSize: 12 },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    padding: 10,
  },
  notice: { alignItems: "center", gap: 10, paddingVertical: 48, paddingHorizontal: 24 },
  noticeTitle: { fontFamily: fonts.serifBold, fontSize: 18 },
  noticeText: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 20, textAlign: "center" },
});
