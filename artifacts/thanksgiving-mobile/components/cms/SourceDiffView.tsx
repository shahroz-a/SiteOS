import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  findNodeHandle,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import {
  buildDiffMarkers,
  type DiffMarker,
  type SourceDiffResult,
  type WordSeg,
} from "@workspace/content-diff";

/**
 * Renders the importer fidelity diff (source HTML vs parsed content) on mobile.
 *
 * Mirrors the web `SourceDiff`: the source body is shown with each block tagged
 * by how the importer treated it — dropped paragraphs are flagged in the
 * destructive color, lightly garbled ("changed") paragraphs show an inline
 * word-level diff, and source images/links the importer never carried over are
 * listed separately. A fixed Prev/Next bar lets a reviewer step through every
 * difference top-to-bottom (the active one is ringed + scrolled into view), the
 * same way they can on web. All diff math AND the ordered marker list come from
 * the shared `@workspace/content-diff` helpers, so this view can't drift from
 * the web one.
 */

const MARKER_META: Record<
  DiffMarker["type"],
  { icon: keyof typeof Feather.glyphMap; verb: string }
> = {
  removed: { icon: "trash-2", verb: "Dropped paragraph" },
  changed: { icon: "edit-3", verb: "Changed text" },
  image: { icon: "image", verb: "Missing image" },
  link: { icon: "link", verb: "Dropped link" },
};

/** Stable key locating the rendered element a marker points at. */
function markerKey(m: DiffMarker): string {
  if (m.type === "image") return `image-${m.index}`;
  if (m.type === "link") return `link-${m.index}`;
  return `block-${m.index}`;
}

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

/**
 * Fixed navigation bar for stepping through differences. Stays pinned above the
 * scrolling source so the reviewer can keep tapping Next as they read down.
 */
function DiffNav({
  markers,
  active,
  onPrev,
  onNext,
}: {
  markers: DiffMarker[];
  active: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const colors = useColors();
  const current = active >= 0 ? markers[active] : null;
  const meta = current ? MARKER_META[current.type] : null;

  return (
    <View
      style={[
        styles.nav,
        { backgroundColor: colors.background, borderBottomColor: colors.border },
      ]}
    >
      <View style={styles.navRow}>
        <Pressable
          onPress={onPrev}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Previous difference"
          style={[
            styles.navBtn,
            { borderColor: colors.border, borderRadius: colors.radius },
          ]}
        >
          <Feather name="chevron-up" size={16} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.navCount, { color: colors.mutedForeground }]}>
          {active >= 0 ? active + 1 : "—"} / {markers.length}
        </Text>
        <Pressable
          onPress={onNext}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Next difference"
          style={[
            styles.navBtnPrimary,
            { backgroundColor: colors.primary, borderRadius: colors.radius },
          ]}
        >
          <Text style={[styles.navBtnLabel, { color: colors.primaryForeground }]}>
            Next
          </Text>
          <Feather
            name="chevron-down"
            size={16}
            color={colors.primaryForeground}
          />
        </Pressable>
      </View>
      {meta ? (
        <View style={styles.navCurrent}>
          <Feather name={meta.icon} size={12} color={colors.destructive} />
          <Text
            style={[styles.navVerb, { color: colors.destructive }]}
          >
            {meta.verb}
          </Text>
          <Text
            style={[styles.navLabel, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            {current?.label}
          </Text>
        </View>
      ) : (
        <Text style={[styles.navHint, { color: colors.mutedForeground }]}>
          Tap Next to step through each difference.
        </Text>
      )}
    </View>
  );
}

export function SourceDiffView({
  diff,
  bottomInset = 40,
}: {
  diff: SourceDiffResult;
  bottomInset?: number;
}) {
  const colors = useColors();
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const itemRefs = useRef<Record<string, View | null>>({});
  const [active, setActive] = useState(-1);

  const markers = useMemo(() => buildDiffMarkers(diff), [diff]);

  // Reset the cursor whenever a different article's diff loads.
  useEffect(() => {
    setActive(-1);
  }, [diff]);

  // Scroll the active difference into view after each step. Runs from an effect
  // so the element ref is committed before we measure it.
  useEffect(() => {
    if (active < 0) return;
    const marker = markers[active];
    if (!marker) return;
    const node = itemRefs.current[markerKey(marker)];
    const container = contentRef.current;
    const scroll = scrollRef.current;
    if (!node || !container || !scroll) return;
    const containerHandle = findNodeHandle(container);
    if (containerHandle == null) return;
    node.measureLayout(
      containerHandle,
      (_x, y) => scroll.scrollTo({ y: Math.max(y - 24, 0), animated: true }),
      () => {},
    );
    // markers is derived from diff; stepping only depends on `active`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

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
  const activeMarker = active >= 0 ? markers[active] : null;
  const activeKey = activeMarker ? markerKey(activeMarker) : null;

  const step = (dir: 1 | -1) => {
    if (markers.length === 0) return;
    const base = active < 0 ? (dir === 1 ? -1 : 0) : active;
    const next = ((base + dir) % markers.length + markers.length) % markers.length;
    setActive(next);
  };

  return (
    <View style={styles.flex}>
      {markers.length > 0 ? (
        <DiffNav
          markers={markers}
          active={active}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
        />
      ) : null}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: bottomInset },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View ref={contentRef} style={styles.root}>
          <View
            style={[
              styles.summary,
              clean
                ? { backgroundColor: colors.secondary, borderColor: colors.border }
                : {
                    backgroundColor: colors.card,
                    borderColor: colors.destructive,
                  },
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
            The original article. Text in red was dropped or garbled by the
            importer.
          </Text>

          <View style={styles.blocks}>
            {diff.sourceBlocks.map((block, i) => {
              const key = `block-${i}`;
              const isActive = key === activeKey;
              const activeStyle = isActive
                ? { borderColor: colors.primary, borderWidth: 2 }
                : null;
              if (block.kind === "removed") {
                return (
                  <View
                    key={i}
                    ref={(el) => {
                      itemRefs.current[key] = el;
                    }}
                    style={[
                      styles.block,
                      styles.removedBlock,
                      {
                        borderLeftColor: colors.destructive,
                        backgroundColor: colors.card,
                        borderRadius: colors.radius,
                      },
                      activeStyle,
                    ]}
                  >
                    <View style={styles.tagRow}>
                      <Feather
                        name="trash-2"
                        size={11}
                        color={colors.destructive}
                      />
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
                    ref={(el) => {
                      itemRefs.current[key] = el;
                    }}
                    style={[
                      styles.block,
                      styles.removedBlock,
                      {
                        borderLeftColor: colors.destructive,
                        backgroundColor: colors.card,
                        borderRadius: colors.radius,
                      },
                      activeStyle,
                    ]}
                  >
                    <View style={styles.tagRow}>
                      <Feather
                        name="edit-3"
                        size={11}
                        color={colors.destructive}
                      />
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
                  style={[
                    styles.blockText,
                    styles.equalBlock,
                    { color: colors.foreground },
                  ]}
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
              <Text
                style={[styles.sectionHint, { color: colors.mutedForeground }]}
              >
                In the source but not carried into the parsed article.
              </Text>
              {diff.missingImages.map((img, i) => {
                const key = `image-${i}`;
                const isActive = key === activeKey;
                return (
                  <View
                    key={`${img.url}-${i}`}
                    ref={(el) => {
                      itemRefs.current[key] = el;
                    }}
                    style={[
                      styles.assetRow,
                      { borderColor: colors.border, borderRadius: colors.radius },
                      isActive
                        ? { borderColor: colors.primary, borderWidth: 2 }
                        : null,
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
                        style={[
                          styles.assetUrl,
                          { color: colors.mutedForeground },
                        ]}
                        numberOfLines={1}
                      >
                        {img.url}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          {diff.droppedLinks.length > 0 ? (
            <View style={styles.assetSection}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Dropped links
              </Text>
              <Text
                style={[styles.sectionHint, { color: colors.mutedForeground }]}
              >
                Source links the importer didn&apos;t preserve.
              </Text>
              {diff.droppedLinks.map((link, i) => {
                const key = `link-${i}`;
                const isActive = key === activeKey;
                return (
                  <View
                    key={`${link.url}-${i}`}
                    ref={(el) => {
                      itemRefs.current[key] = el;
                    }}
                    style={[
                      styles.linkRow,
                      { borderColor: colors.border, borderRadius: colors.radius },
                      isActive
                        ? { borderColor: colors.primary, borderWidth: 2 }
                        : null,
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
                        style={[
                          styles.assetUrl,
                          { color: colors.mutedForeground },
                        ]}
                        numberOfLines={1}
                      >
                        {link.url}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 16 },
  root: { gap: 14 },
  nav: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  navBtn: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  navBtnPrimary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  navBtnLabel: { fontFamily: fonts.sansSemiBold, fontSize: 13 },
  navCount: { fontFamily: fonts.sansBold, fontSize: 13, flex: 1 },
  navCurrent: { flexDirection: "row", alignItems: "center", gap: 6 },
  navVerb: { fontFamily: fonts.sansBold, fontSize: 11 },
  navLabel: { fontFamily: fonts.sans, fontSize: 12, flex: 1 },
  navHint: { fontFamily: fonts.sans, fontSize: 12 },
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
  sectionHint: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    marginTop: -6,
  },
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
  notice: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  noticeTitle: { fontFamily: fonts.serifBold, fontSize: 18 },
  noticeText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
});
