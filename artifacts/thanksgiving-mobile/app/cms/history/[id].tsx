import { useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useMemo, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Pill,
  ScreenHeader,
  StatusBadge,
  formatDateTime,
} from "@/components/cms/CmsCommon";
import { ErrorView, LoadingView } from "@/components/StateViews";
import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import { useCmsSession } from "@/lib/cms-session";
import {
  getCompareCmsPostVersionsQueryKey,
  getGetCmsPostQueryKey,
  getListCmsPostVersionsQueryKey,
  useCompareCmsPostVersions,
  useGetCmsPost,
  useListCmsPostVersions,
  useRestoreCmsPostVersion,
  type PageVersionSummary,
  type VersionFieldChange,
} from "@workspace/api-client-react";

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.length ? value : "—";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function ChangeCard({ change }: { change: VersionFieldChange }) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.changeCard,
        { borderColor: colors.border, borderRadius: colors.radius },
      ]}
    >
      <Text style={[styles.changeLabel, { color: colors.foreground }]}>
        {change.label}
      </Text>
      <View style={styles.changeCol}>
        <Text style={[styles.changeTag, { color: colors.mutedForeground }]}>
          BEFORE
        </Text>
        <Text
          style={[styles.changeValue, { color: colors.foreground }]}
          numberOfLines={6}
        >
          {formatFieldValue(change.before)}
        </Text>
      </View>
      <View style={styles.changeCol}>
        <Text style={[styles.changeTag, { color: colors.mutedForeground }]}>
          AFTER
        </Text>
        <Text
          style={[styles.changeValue, { color: colors.foreground }]}
          numberOfLines={6}
        >
          {formatFieldValue(change.after)}
        </Text>
      </View>
    </View>
  );
}

function VersionChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderRadius: colors.radius * 2,
          backgroundColor: selected ? colors.primary : colors.card,
          borderColor: selected ? colors.primary : colors.border,
        },
      ]}
    >
      <Text
        style={[
          styles.chipText,
          { color: selected ? colors.primaryForeground : colors.foreground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function VersionHistoryScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const queryClient = useQueryClient();
  const session = useCmsSession();
  const canRestore = session.can("content.edit");

  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = typeof rawId === "string" ? rawId : "";

  const post = useGetCmsPost(id);
  const versionsQuery = useListCmsPostVersions(id);

  const [fromVersion, setFromVersion] = useState<number | null>(null);
  const [toVersion, setToVersion] = useState<number | null>(null);

  const versions = useMemo(
    () => versionsQuery.data?.items ?? [],
    [versionsQuery.data],
  );
  const latestVersion = versionsQuery.data?.latestVersion ?? null;

  const compareReady = fromVersion !== null && toVersion !== null;
  const compareFrom = compareReady ? fromVersion : 0;
  const compareTo = compareReady ? toVersion : 0;
  const compare = useCompareCmsPostVersions(id, compareFrom, compareTo, {
    query: {
      queryKey: getCompareCmsPostVersionsQueryKey(id, compareFrom, compareTo),
      enabled: compareReady,
    },
  });

  const restore = useRestoreCmsPostVersion({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListCmsPostVersionsQueryKey(id),
        });
        queryClient.invalidateQueries({ queryKey: getGetCmsPostQueryKey(id) });
        Alert.alert("Version restored", "A new version was created from it.");
      },
      onError: () => {
        Alert.alert("Could not restore", "Please try again.");
      },
    },
  });

  const confirmRestore = (version: PageVersionSummary) => {
    Alert.alert(
      `Restore version ${version.versionNumber}?`,
      "This creates a new version with that content. Your existing history is preserved — nothing is overwritten.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          onPress: () =>
            restore.mutate({ id, versionNumber: version.versionNumber }),
        },
      ],
    );
  };

  const paddingTop = insets.top + (isWeb ? 67 : 12);
  const title = post.data?.title ?? "Article";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title={title}
        subtitle="Version history"
        onBack={() => router.back()}
        paddingTop={paddingTop}
        right={
          <Pressable
            onPress={() => router.push(`/cms/source/${id}` as Href)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="View import fidelity"
            style={[
              styles.sourceButton,
              { borderColor: colors.border, borderRadius: colors.radius },
            ]}
          >
            <Feather name="columns" size={14} color={colors.foreground} />
            <Text style={[styles.sourceButtonText, { color: colors.foreground }]}>
              Source diff
            </Text>
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {versionsQuery.isLoading ? (
          <LoadingView label="Loading history…" />
        ) : versionsQuery.isError ? (
          <ErrorView
            message="Failed to load version history."
            onRetry={versionsQuery.refetch}
          />
        ) : versions.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            No versions recorded for this article yet.
          </Text>
        ) : (
          <>
            <View
              style={[
                styles.card,
                { borderColor: colors.border, borderRadius: colors.radius * 1.5 },
              ]}
            >
              <View style={styles.cardTitleRow}>
                <Feather name="git-merge" size={16} color={colors.primary} />
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                  Compare versions
                </Text>
              </View>

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                From
              </Text>
              <View style={styles.chipRow}>
                {versions.map((v) => (
                  <VersionChip
                    key={`from-${v.versionNumber}`}
                    label={`v${v.versionNumber}`}
                    selected={fromVersion === v.versionNumber}
                    onPress={() => setFromVersion(v.versionNumber)}
                  />
                ))}
              </View>

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                To
              </Text>
              <View style={styles.chipRow}>
                {versions.map((v) => (
                  <VersionChip
                    key={`to-${v.versionNumber}`}
                    label={`v${v.versionNumber}`}
                    selected={toVersion === v.versionNumber}
                    onPress={() => setToVersion(v.versionNumber)}
                  />
                ))}
              </View>

              {!compareReady ? (
                <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                  Pick two versions to see what changed.
                </Text>
              ) : compare.isLoading ? (
                <LoadingView />
              ) : compare.isError ? (
                <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                  Failed to compare these versions.
                </Text>
              ) : compare.data && compare.data.changes.length > 0 ? (
                <View style={styles.changeList}>
                  <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                    {compare.data.changes.length}{" "}
                    {compare.data.changes.length === 1 ? "field" : "fields"}{" "}
                    changed between v{compare.data.fromVersion} and v
                    {compare.data.toVersion}.
                  </Text>
                  {compare.data.changes.map((change) => (
                    <ChangeCard key={change.field} change={change} />
                  ))}
                </View>
              ) : (
                <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                  No differences between these versions.
                </Text>
              )}
            </View>

            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              All versions
            </Text>
            <View style={styles.versionList}>
              {versions.map((version) => {
                const isLatest = version.versionNumber === latestVersion;
                return (
                  <View
                    key={version.versionNumber}
                    style={[
                      styles.versionCard,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        borderRadius: colors.radius * 1.5,
                      },
                    ]}
                  >
                    <View style={styles.versionTop}>
                      <Text
                        style={[styles.versionNum, { color: colors.foreground }]}
                      >
                        Version {version.versionNumber}
                      </Text>
                      {isLatest ? <Pill label="Current" tone="accent" /> : null}
                      <StatusBadge status={version.status} />
                    </View>
                    <Text
                      style={[styles.versionSummary, { color: colors.foreground }]}
                    >
                      {version.changeSummary ?? "No change summary"}
                    </Text>
                    <Text
                      style={[styles.versionMeta, { color: colors.mutedForeground }]}
                    >
                      {version.author?.name ? `${version.author.name} · ` : ""}
                      {formatDateTime(version.createdAt)}
                    </Text>
                    {canRestore && !isLatest ? (
                      <Pressable
                        onPress={() => confirmRestore(version)}
                        disabled={restore.isPending}
                        style={({ pressed }) => [
                          styles.restoreButton,
                          {
                            borderColor: colors.border,
                            borderRadius: colors.radius,
                            opacity: pressed || restore.isPending ? 0.6 : 1,
                          },
                        ]}
                      >
                        <Feather
                          name="rotate-ccw"
                          size={14}
                          color={colors.foreground}
                        />
                        <Text
                          style={[
                            styles.restoreText,
                            { color: colors.foreground },
                          ]}
                        >
                          Restore
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 16, gap: 16 },
  empty: {
    fontFamily: fonts.sans,
    fontSize: 15,
    textAlign: "center",
    paddingVertical: 40,
  },
  card: { borderWidth: 1, padding: 16, gap: 10 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontFamily: fonts.serifSemiBold, fontSize: 17 },
  fieldLabel: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
    letterSpacing: 0.4,
    marginTop: 4,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 7 },
  chipText: { fontFamily: fonts.sansSemiBold, fontSize: 13 },
  hint: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, marginTop: 4 },
  changeList: { gap: 10, marginTop: 4 },
  changeCard: { borderWidth: 1, padding: 12, gap: 8 },
  changeLabel: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  changeCol: { gap: 3 },
  changeTag: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 10,
    letterSpacing: 0.5,
  },
  changeValue: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
  sectionTitle: { fontFamily: fonts.serifBold, fontSize: 22 },
  versionList: { gap: 10 },
  versionCard: { borderWidth: 1, padding: 14, gap: 8 },
  versionTop: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  versionNum: { fontFamily: fonts.sansBold, fontSize: 15 },
  versionSummary: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 20 },
  versionMeta: { fontFamily: fonts.sansMedium, fontSize: 12 },
  restoreButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 2,
  },
  restoreText: { fontFamily: fonts.sansSemiBold, fontSize: 13 },
  sourceButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  sourceButtonText: { fontFamily: fonts.sansSemiBold, fontSize: 12 },
});
