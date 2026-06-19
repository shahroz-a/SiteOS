import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenHeader } from "@/components/cms/CmsCommon";
import { SourceDiffView } from "@/components/cms/SourceDiffView";
import { ErrorView, LoadingView } from "@/components/StateViews";
import { useColors } from "@/hooks/useColors";
import {
  useGetCmsPost,
  useGetCmsPostSource,
} from "@workspace/api-client-react";
import { computeSourceDiff } from "@workspace/content-diff";

export default function SourceDiffScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";

  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = typeof rawId === "string" ? rawId : "";

  const post = useGetCmsPost(id);
  const sourceQuery = useGetCmsPostSource(id);

  const diff = useMemo(() => {
    const data = sourceQuery.data;
    if (!data) return null;
    return computeSourceDiff({
      sourceHtml: data.sourceHtml,
      sourceKind: data.sourceKind,
      componentTree: data.componentTree,
      richText: data.richText,
    });
  }, [sourceQuery.data]);

  const paddingTop = insets.top + (isWeb ? 67 : 12);
  const title = post.data?.title ?? sourceQuery.data?.title ?? "Article";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title={title}
        subtitle="Import fidelity"
        onBack={() => router.back()}
        paddingTop={paddingTop}
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {sourceQuery.isLoading ? (
          <LoadingView label="Loading source…" />
        ) : sourceQuery.isError ? (
          <ErrorView
            message="Failed to load the source comparison."
            onRetry={sourceQuery.refetch}
          />
        ) : diff ? (
          <SourceDiffView diff={diff} />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 16, gap: 16 },
});
