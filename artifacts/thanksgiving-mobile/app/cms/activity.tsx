import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenHeader, formatDateTime } from "@/components/cms/CmsCommon";
import { EmptyView, ErrorView, LoadingView } from "@/components/StateViews";
import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import { useCmsSession } from "@/lib/cms-session";
import {
  getListCmsAuditLogsQueryKey,
  useListCmsAuditLogs,
  type AuditLogEntry,
} from "@workspace/api-client-react";

const PAGE_SIZE = 20;

function humanizeAction(action: string): string {
  return action
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function ActivityRow({ entry }: { entry: AuditLogEntry }) {
  const colors = useColors();
  const actor = entry.actorEmail ?? "Unknown user";
  const entity = entry.entityType
    ? `${entry.entityType}${entry.entityId ? ` · ${entry.entityId}` : ""}`
    : null;

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius * 1.5,
        },
      ]}
    >
      <View
        style={[
          styles.dot,
          { backgroundColor: colors.secondary, borderRadius: colors.radius },
        ]}
      >
        <Feather name="edit-3" size={15} color={colors.primary} />
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.action, { color: colors.foreground }]}>
          {humanizeAction(entry.action)}
        </Text>
        <Text style={[styles.actor, { color: colors.foreground }]}>
          {actor}
          {entry.actorRole ? (
            <Text style={{ color: colors.mutedForeground }}>
              {"  ·  "}
              {entry.actorRole}
            </Text>
          ) : null}
        </Text>
        {entity ? (
          <Text
            style={[styles.entity, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            {entity}
          </Text>
        ) : null}
        <Text style={[styles.time, { color: colors.mutedForeground }]}>
          {formatDateTime(entry.createdAt)}
        </Text>
      </View>
    </View>
  );
}

export default function ActivityScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const session = useCmsSession();

  const [page, setPage] = useState(1);
  const [accumulated, setAccumulated] = useState<AuditLogEntry[]>([]);

  const params = useMemo(() => ({ page, limit: PAGE_SIZE }), [page]);
  const { data, isLoading, isError, refetch, isFetching } = useListCmsAuditLogs(
    params,
    {
      query: {
        enabled: session.isAuthenticated,
        queryKey: getListCmsAuditLogsQueryKey(params),
      },
    },
  );

  const pageItems = useMemo(() => data?.items ?? [], [data]);
  const total = data?.pagination?.total ?? 0;

  // Merge each fetched page into a single growing list (de-duped by id).
  const items = useMemo(() => {
    if (page === 1) return pageItems;
    const seen = new Set(accumulated.map((e) => e.id));
    return [...accumulated, ...pageItems.filter((e) => !seen.has(e.id))];
  }, [page, pageItems, accumulated]);

  const hasMore = items.length < total;

  const loadMore = () => {
    if (isFetching || !hasMore) return;
    setAccumulated(items);
    setPage((p) => p + 1);
  };

  const paddingTop = insets.top + (isWeb ? 67 : 12);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="Activity"
        subtitle={total ? `${total} events` : "Recent changes"}
        onBack={() => router.back()}
        paddingTop={paddingTop}
      />

      {isLoading && page === 1 ? (
        <LoadingView label="Loading activity…" />
      ) : isError && items.length === 0 ? (
        <ErrorView onRetry={refetch} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ActivityRow entry={item} />}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 40 },
          ]}
          showsVerticalScrollIndicator={false}
          onEndReachedThreshold={0.4}
          onEndReached={loadMore}
          ListEmptyComponent={
            <EmptyView
              icon="activity"
              title="No activity yet"
              message="Changes to articles and roles will show up here."
            />
          }
          ListFooterComponent={
            hasMore ? (
              <Pressable
                onPress={loadMore}
                disabled={isFetching}
                style={({ pressed }) => [styles.loadMore, { opacity: pressed ? 0.7 : 1 }]}
              >
                {isFetching ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Text style={[styles.loadMoreText, { color: colors.primary }]}>
                    Load more
                  </Text>
                )}
              </Pressable>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { paddingHorizontal: 20, paddingTop: 14, gap: 10, flexGrow: 1 },
  row: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderWidth: 1,
  },
  dot: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: { flex: 1, gap: 3 },
  action: { fontFamily: fonts.sansBold, fontSize: 15 },
  actor: { fontFamily: fonts.sansMedium, fontSize: 13 },
  entity: { fontFamily: fonts.sans, fontSize: 12 },
  time: { fontFamily: fonts.sansMedium, fontSize: 12, marginTop: 2 },
  loadMore: { paddingVertical: 18, alignItems: "center" },
  loadMoreText: { fontFamily: fonts.sansSemiBold, fontSize: 15 },
});
