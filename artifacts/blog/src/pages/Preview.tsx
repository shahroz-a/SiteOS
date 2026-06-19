import { useRoute } from "wouter";
import {
  useGetPostByPreviewToken,
  getGetPostByPreviewTokenQueryKey,
} from "@workspace/api-client-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { LoadingState, ErrorState } from "@/components/StateViews";
import { ArticleView } from "@/pages/Article";

/**
 * Authenticated draft preview. The token is resolved server-side (it must be
 * unexpired and bound to the page); the draft is then rendered through the EXACT
 * same {@link ArticleView} used for published articles so what a reviewer sees is
 * what readers will get. Expired/invalid tokens 404 from the API.
 */
export default function Preview() {
  const [, params] = useRoute("/preview/:token");
  const token = params?.token ?? "";
  const { data: post, isLoading, isError } = useGetPostByPreviewToken(token, {
    query: {
      enabled: token.length > 0,
      retry: false,
      queryKey: getGetPostByPreviewTokenQueryKey(token),
    },
  });

  return (
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/20">
      <Header />

      {isLoading ? (
        <LoadingState label="Loading preview…" />
      ) : isError || !post ? (
        <ErrorState
          title="Preview unavailable"
          message="This preview link is invalid or has expired. Ask the author for a fresh link."
        />
      ) : (
        <ArticleView post={post} isPreview />
      )}

      <Footer />
    </div>
  );
}
