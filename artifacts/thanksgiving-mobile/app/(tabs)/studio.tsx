import { Feather } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Pill,
  ScreenHeader,
  StatusBadge,
  formatDate,
} from "@/components/cms/CmsCommon";
import { EmptyView, ErrorView, LoadingView } from "@/components/StateViews";
import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import { roleLabel, useCmsSession } from "@/lib/cms-session";
import {
  getListCmsPostQueryKey,
  useListCmsPost,
  type CmsPostSummary,
} from "@workspace/api-client-react";

function SignInGate() {
  const colors = useColors();
  const { login } = useCmsSession();
  return (
    <View style={styles.gate}>
      <View
        style={[
          styles.gateIcon,
          { backgroundColor: colors.secondary, borderRadius: colors.radius * 2 },
        ]}
      >
        <Feather name="lock" size={28} color={colors.primary} />
      </View>
      <Text style={[styles.gateTitle, { color: colors.foreground }]}>
        Sign in to Studio
      </Text>
      <Text style={[styles.gateBody, { color: colors.mutedForeground }]}>
        Review who changed what, compare article versions, and restore — all on
        the go. Sign in with your editor account to continue.
      </Text>
      <Pressable
        onPress={login}
        style={({ pressed }) => [
          styles.primaryButton,
          {
            backgroundColor: colors.primary,
            borderRadius: colors.radius,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
          Sign in
        </Text>
      </Pressable>
    </View>
  );
}

function ArticleRow({
  post,
  onPress,
}: {
  post: CmsPostSummary;
  onPress: (id: string) => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={() => onPress(post.id)}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius * 1.5,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.rowBody}>
        <Text
          style={[styles.rowTitle, { color: colors.foreground }]}
          numberOfLines={2}
        >
          {post.title}
        </Text>
        <View style={styles.rowMeta}>
          <StatusBadge status={post.status} />
          <Text style={[styles.rowMetaText, { color: colors.mutedForeground }]}>
            Updated {formatDate(post.updatedAt ?? post.publishedAt)}
          </Text>
        </View>
      </View>
      <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
    </Pressable>
  );
}

export default function StudioScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const session = useCmsSession();

  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setQuery(input.trim()), 350);
    return () => clearTimeout(handle);
  }, [input]);

  const canView = session.can("content.view");

  const params = useMemo(
    () => ({ q: query || undefined, page: 1, limit: 30 }),
    [query],
  );
  const { data, isLoading, isError, refetch } = useListCmsPost(params, {
    query: {
      enabled: session.isAuthenticated && canView,
      queryKey: getListCmsPostQueryKey(params),
    },
  });

  const items = data?.items ?? [];
  const paddingTop = insets.top + (isWeb ? 67 : 12);

  if (session.isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <LoadingView />
      </View>
    );
  }

  if (!session.isAuthenticated) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScreenHeader
          title="Studio"
          subtitle="Version history & activity"
          paddingTop={paddingTop}
        />
        <SignInGate />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="Studio"
        subtitle={session.userName ?? undefined}
        paddingTop={paddingTop}
        right={
          <View style={styles.headerRight}>
            <Pill label={roleLabel(session.role)} />
            <Pressable
              onPress={session.logout}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
            >
              <Feather name="log-out" size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
        }
      />

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ArticleRow
            post={item}
            onPress={(id) => router.push(`/cms/history/${id}` as Href)}
          />
        )}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Pressable
              onPress={() => router.push("/cms/activity" as Href)}
              style={({ pressed }) => [
                styles.activityCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius * 1.5,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.activityIcon,
                  { backgroundColor: colors.secondary, borderRadius: colors.radius },
                ]}
              >
                <Feather name="activity" size={20} color={colors.primary} />
              </View>
              <View style={styles.activityText}>
                <Text style={[styles.activityTitle, { color: colors.foreground }]}>
                  Activity timeline
                </Text>
                <Text
                  style={[styles.activitySub, { color: colors.mutedForeground }]}
                >
                  Who changed what, across the whole blog
                </Text>
              </View>
              <Feather
                name="chevron-right"
                size={20}
                color={colors.mutedForeground}
              />
            </Pressable>

            {canView ? (
              <>
                <Text style={[styles.sectionLabel, { color: colors.foreground }]}>
                  Articles
                </Text>
                <View
                  style={[
                    styles.searchBox,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderRadius: colors.radius * 1.5,
                    },
                  ]}
                >
                  <Feather
                    name="search"
                    size={18}
                    color={colors.mutedForeground}
                  />
                  <TextInput
                    value={input}
                    onChangeText={setInput}
                    placeholder="Search articles…"
                    placeholderTextColor={colors.mutedForeground}
                    style={[styles.searchInput, { color: colors.foreground }]}
                    autoCorrect={false}
                  />
                  {input.length > 0 ? (
                    <Feather
                      name="x"
                      size={18}
                      color={colors.mutedForeground}
                      onPress={() => setInput("")}
                    />
                  ) : null}
                </View>
              </>
            ) : null}
          </View>
        }
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + (isWeb ? 100 : 40) },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          !canView ? (
            <EmptyView
              icon="lock"
              title="No content access"
              message="Your account can view activity but not the article list."
            />
          ) : isLoading ? (
            <LoadingView label="Loading articles…" />
          ) : isError ? (
            <ErrorView onRetry={refetch} />
          ) : (
            <EmptyView
              icon="file-text"
              title="No articles"
              message={query ? `Nothing matches “${query}”.` : undefined}
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  listHeader: { gap: 14, paddingBottom: 6 },
  listContent: { paddingHorizontal: 20, paddingTop: 14, flexGrow: 1 },
  activityCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderWidth: 1,
  },
  activityIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  activityText: { flex: 1, gap: 2 },
  activityTitle: { fontFamily: fonts.serifSemiBold, fontSize: 17 },
  activitySub: { fontFamily: fonts.sans, fontSize: 13 },
  sectionLabel: {
    fontFamily: fonts.serifBold,
    fontSize: 20,
    marginTop: 4,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontFamily: fonts.sans, fontSize: 16, padding: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  rowBody: { flex: 1, gap: 8 },
  rowTitle: { fontFamily: fonts.serifSemiBold, fontSize: 16, lineHeight: 22 },
  rowMeta: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowMetaText: { fontFamily: fonts.sansMedium, fontSize: 12 },
  gate: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 36,
    gap: 14,
  },
  gateIcon: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  gateTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 24,
    textAlign: "center",
  },
  gateBody: {
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  primaryButton: {
    marginTop: 6,
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  primaryButtonText: { fontFamily: fonts.sansSemiBold, fontSize: 16 },
});
