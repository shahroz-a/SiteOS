import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCmsPost,
  useGetCmsPostSource,
  useUpdateCmsPost,
  useGetCmsPostAnalytics,
  getGetCmsPostAnalyticsQueryKey,
  getGetCmsPostQueryKey,
  getGetCmsPostSourceQueryKey,
  getListCmsPostQueryKey,
  type CmsPostDetail,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Eye,
  GitCompareArrows,
  Loader2,
  Redo2,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@workspace/ui/button";
import { Input } from "@workspace/ui/input";
import { Textarea } from "@workspace/ui/textarea";
import { Skeleton } from "@workspace/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/sheet";
import { useToast } from "@workspace/ui";
import { useCmsAuth } from "@/lib/cms-auth-context";
import { SourceDiff } from "@/components/source-diff";
import { useEditor } from "@/editor/use-editor";
import { EditorCanvas } from "@/editor/canvas";
import { EditorPreview } from "@/editor/preview";
import { LinkPickerProvider } from "@/editor/link-assistant";
import { ImageUploadButton, LibraryButton } from "@/editor/block-editors";
import { validateSeo } from "@workspace/seo-validation";
import {
  blocksFromDetail,
  buildEditorValidationInput,
  createBlock,
  detailToInput,
  initialSeoState,
  type EditorBlock,
  type EditorSeoState,
  type SeoMetaInput,
} from "@/editor/model";
import {
  PublishPanel,
  PublishBlockDialog,
  extractPublishBlock,
  type PublishBlock,
} from "@/editor/publish-panel";
import { SeoPanel } from "@/editor/seo-panel";
import {
  AiSuggestionList,
  EDITOR_AI_KINDS,
  type AiApplyField,
  type AiApplyFaq,
} from "@/editor/ai-assistant";

const AUTOSAVE_DELAY = 1500;

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

interface EditorBodyProps {
  detail: CmsPostDetail;
  canEdit: boolean;
}

export function EditorBody({ detail, canEdit }: EditorBodyProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const initialBlocks = useMemo<EditorBlock[]>(() => blocksFromDetail(detail), [detail]);
  const editor = useEditor(initialBlocks);

  const [title, setTitle] = useState(detail.title);
  const [subtitle, setSubtitle] = useState(detail.subtitle ?? "");
  const [excerpt, setExcerpt] = useState(detail.excerpt ?? "");
  const [bannerUrl, setBannerUrl] = useState(detail.featuredImageUrl ?? "");
  const [bannerAlt, setBannerAlt] = useState(detail.featuredImageAlt ?? "");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [bannerWarningDismissed, setBannerWarningDismissed] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [seoOpen, setSeoOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [seo, setSeo] = useState<SeoMetaInput>(() => initialSeoState(detail));
  const [canonicalUrl, setCanonicalUrl] = useState(detail.canonicalUrl ?? "");
  const [publishBlock, setPublishBlock] = useState<PublishBlock | null>(null);

  // Apply an accepted AI field suggestion to whichever editor state owns the
  // field. Returns false for an unknown target so the UI can warn instead of
  // silently dropping it. Suggest-only: only fires on an explicit Accept.
  const applyAiField = useCallback<AiApplyField>((target, value) => {
    switch (target) {
      case "excerpt":
        setExcerpt(value);
        return true;
      case "subtitle":
        setSubtitle(value);
        return true;
      case "canonicalUrl":
        setCanonicalUrl(value);
        return true;
      case "keywords":
        setSeo((prev) => ({
          ...prev,
          keywords: value
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
        }));
        return true;
      case "metaTitle":
      case "metaDescription":
      case "focusKeyword":
      case "ogTitle":
      case "ogDescription":
      case "ogImage":
      case "twitterTitle":
      case "twitterDescription":
        setSeo((prev) => ({ ...prev, [target]: value }));
        return true;
      default:
        return false;
    }
  }, []);

  // Insert an accepted AI FAQ suggestion as a new FAQ block at the end.
  const applyAiFaq = useCallback<AiApplyFaq>(
    (question, answer) => {
      const block = createBlock("faq");
      block.data = { heading: "", entries: [{ question, answer }] };
      editor.insertBlock(block);
    },
    [editor],
  );

  // Non-blocking nudge: a published article with no banner image looks bare on
  // the public blog and weak in social/SEO previews. Drafts/archived are exempt.
  const showBannerWarning =
    detail.status === "published" && !bannerUrl.trim() && !bannerWarningDismissed;

  // Re-arm the nudge once a banner is added: if the writer dismisses it, then
  // sets a banner, then later clears it again, the warning should reappear.
  useEffect(() => {
    if (bannerUrl.trim()) setBannerWarningDismissed(false);
  }, [bannerUrl]);

  // The live SEO state shared by the SEO panel and the publish-gate indicator.
  const seoState = useMemo<EditorSeoState>(
    () => ({
      title,
      excerpt: excerpt || null,
      featuredImageUrl: bannerUrl || null,
      canonicalUrl: canonicalUrl || null,
      seo,
    }),
    [title, excerpt, bannerUrl, canonicalUrl, seo],
  );

  // Run the same pure engine the server publish gate uses, on the LIVE editor
  // state, to flag blocking SEO issues before the editor attempts to publish.
  // Duplicate checks (the only DB-derived signal) are all `warn`, so they never
  // block — the blocking set is fully derivable client-side without the server.
  const blockingSeoIssues = useMemo(
    () => validateSeo(buildEditorValidationInput(detail, editor.blocks, seoState)).blocking,
    [detail, editor.blocks, seoState],
  );

  const analytics = useGetCmsPostAnalytics(detail.slug, {
    query: { queryKey: getGetCmsPostAnalyticsQueryKey(detail.slug) },
  });

  const update = useUpdateCmsPost({
    mutation: {
      onSuccess: () => {
        setSaveState("saved");
        queryClient.invalidateQueries({ queryKey: getGetCmsPostQueryKey(detail.id) });
        queryClient.invalidateQueries({ queryKey: getListCmsPostQueryKey() });
      },
      onError: (err: unknown) => {
        setSaveState("error");
        // A save that crosses the publish gate (e.g. saving while the status is
        // being moved to published/scheduled) can come back as a 422
        // `CmsPublishBlocked`. Surface the same block dialog the PublishPanel
        // uses rather than the generic autosave-failed toast.
        const block = extractPublishBlock(err);
        if (block) {
          setPublishBlock(block);
          return;
        }
        toast({ title: "Autosave failed", description: "Your latest changes weren't saved.", variant: "destructive" });
      },
    },
  });

  // Latest values captured for the debounced save without re-arming the timer.
  const latest = useRef({ blocks: editor.blocks, title, subtitle, excerpt, bannerUrl, bannerAlt, seo, canonicalUrl });
  latest.current = { blocks: editor.blocks, title, subtitle, excerpt, bannerUrl, bannerAlt, seo, canonicalUrl };

  const updateMutate = update.mutate;
  const save = useCallback(() => {
    const { blocks, title: t, subtitle: s, excerpt: e, bannerUrl: bu, bannerAlt: ba, seo: seoMeta, canonicalUrl: cu } = latest.current;
    setSaveState("saving");
    updateMutate({
      id: detail.id,
      data: detailToInput(detail, blocks, {
        title: t,
        subtitle: s,
        excerpt: e,
        // Empty banner URL clears the hero (no banner) rather than promoting an inline image.
        featuredImageUrl: bu || null,
        featuredImageAlt: bu ? ba || null : null,
        canonicalUrl: cu || null,
        seo: seoMeta,
      }),
    });
  }, [detail, updateMutate]);

  // Debounced autosave: any content/metadata change marks dirty and schedules a save.
  const firstRun = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (!canEdit) return;
    setSaveState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, AUTOSAVE_DELAY);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [editor.blocks, title, subtitle, excerpt, bannerUrl, bannerAlt, seo, canonicalUrl, canEdit, save]);

  // Keyboard shortcuts: undo / redo / save.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      } else if (key === "y") {
        e.preventDefault();
        editor.redo();
      } else if (key === "s") {
        e.preventDefault();
        if (canEdit) save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, save, canEdit]);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <header className="flex items-center gap-3 border-b border-border/60 px-4 py-2">
        <Button variant="ghost" size="icon" onClick={() => navigate("/content")} title="Back to content">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <Input
            value={title}
            disabled={!canEdit}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled article"
            className="h-9 border-0 bg-transparent px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
          />
        </div>
        <ViewCounts
          data={analytics.data}
          isLoading={analytics.isLoading}
          isError={analytics.isError}
        />
        <SaveIndicator state={saveState} />
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            title="Compare the imported article against its original source"
            onClick={() => setDiffOpen(true)}
          >
            <GitCompareArrows className="mr-1 h-4 w-4" /> Import diff
          </Button>
          <Button
            variant="ghost"
            size="sm"
            title="SEO & metadata"
            onClick={() => setSeoOpen(true)}
          >
            <Search className="mr-1 h-4 w-4" /> SEO
          </Button>
          <Button
            variant="ghost"
            size="sm"
            title="AI writing & SEO assistant"
            onClick={() => setAiOpen(true)}
          >
            <Sparkles className="mr-1 h-4 w-4" /> AI assist
          </Button>
          <Button variant="ghost" size="icon" title="Undo" disabled={!editor.canUndo} onClick={editor.undo}>
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" title="Redo" disabled={!editor.canRedo} onClick={editor.redo}>
            <Redo2 className="h-4 w-4" />
          </Button>
          <Button size="sm" disabled={!canEdit || saveState === "saving"} onClick={save}>
            Save
          </Button>
        </div>
        <div className="ml-1 border-l border-border/60 pl-2">
          <PublishPanel
            detail={detail}
            blocking={blockingSeoIssues}
            onOpenSeoPanel={() => setSeoOpen(true)}
          />
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-2">
        <div className="overflow-auto border-r border-border/60 bg-muted/20">
          <div className="mx-auto max-w-2xl space-y-4 p-4 lg:p-6">
            <div className="space-y-3 rounded-lg border border-border/60 bg-card p-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Subtitle</label>
                <Input value={subtitle} disabled={!canEdit} onChange={(e) => setSubtitle(e.target.value)} placeholder="Optional subtitle" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Excerpt</label>
                <Textarea value={excerpt} disabled={!canEdit} onChange={(e) => setExcerpt(e.target.value)} placeholder="Short summary" rows={2} />
              </div>
              <BannerImageField
                url={bannerUrl}
                alt={bannerAlt}
                disabled={!canEdit}
                onChange={({ url, alt }) => {
                  if (url !== undefined) setBannerUrl(url);
                  if (alt !== undefined) setBannerAlt(alt);
                }}
              />
              {showBannerWarning ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="flex-1">
                    This article has no banner image. Published articles look bare
                    without one and get weaker social/SEO previews.
                  </p>
                  <button
                    type="button"
                    aria-label="Dismiss banner warning"
                    className="shrink-0 rounded-sm p-0.5 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/20"
                    onClick={() => setBannerWarningDismissed(true)}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
            </div>
            <EditorCanvas editor={editor} />
          </div>
        </div>
        <div className="hidden overflow-hidden lg:block">
          <EditorPreview
            blocks={editor.blocks}
            title={title}
            bannerUrl={bannerUrl || null}
            bannerAlt={bannerAlt || null}
          />
        </div>
      </div>

      <ImportDiffSheet
        articleId={detail.id}
        open={diffOpen}
        onOpenChange={setDiffOpen}
      />

      <SeoPanel
        open={seoOpen}
        onOpenChange={setSeoOpen}
        detail={detail}
        blocks={editor.blocks}
        state={seoState}
        onSeoChange={(patch) => setSeo((prev) => ({ ...prev, ...patch }))}
        onCanonicalChange={(value) => setCanonicalUrl(value ?? "")}
        onAiApplyField={applyAiField}
        onAiApplyFaq={applyAiFaq}
        disabled={!canEdit}
      />

      <Sheet open={aiOpen} onOpenChange={setAiOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
          <SheetHeader className="border-b border-border/60 px-6 py-4">
            <SheetTitle className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4" /> AI assistant
            </SheetTitle>
            <SheetDescription>
              Suggestions only — review and accept what you want. Nothing is
              applied automatically.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <AiSuggestionList
              postId={detail.id}
              kinds={EDITOR_AI_KINDS}
              disabled={!canEdit}
              onApplyField={applyAiField}
              onApplyFaq={applyAiFaq}
            />
          </div>
        </SheetContent>
      </Sheet>

      <PublishBlockDialog
        block={publishBlock}
        onClose={() => setPublishBlock(null)}
        onOpenSeoPanel={() => setSeoOpen(true)}
      />
    </div>
  );
}

/**
 * Drawer showing the source-vs-parsed importer diff for the current article.
 * Lazily fetches the source body only while open (lifted to its own component
 * so the large source HTML is never loaded until an editor asks for it), then
 * hands it to the shared `SourceDiff` — the same component the held-back review
 * queue uses, so the fidelity view can't drift between the two surfaces. Works
 * for published or draft articles alike.
 */
function ImportDiffSheet({
  articleId,
  open,
  onOpenChange,
}: {
  articleId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const source = useGetCmsPostSource(articleId, {
    query: { enabled: open, queryKey: getGetCmsPostSourceQueryKey(articleId) },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex h-[92vh] flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b border-border/60 px-6 py-4">
          <SheetTitle>Importer diff</SheetTitle>
          <SheetDescription>
            The original crawled article on the left, and what the importer
            extracted on the right. Anything highlighted on the left is missing
            or garbled in the parsed content.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <SourceDiff
            data={source.data}
            isLoading={source.isLoading}
            isError={source.isError}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Banner/hero image picker for the article. Lets writers choose the post's
 * featured image from the media library or upload a new one, preview it, edit
 * its alt text, and remove it. Clearing the banner sends `null` on save so the
 * public hero shows no image rather than promoting a random inline picture.
 */
function BannerImageField({
  url,
  alt,
  disabled,
  onChange,
}: {
  url: string;
  alt: string;
  disabled: boolean;
  onChange: (patch: { url?: string; alt?: string }) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">Banner image</label>
      {url ? (
        <div className="space-y-2">
          <img
            src={url}
            alt={alt}
            className="h-36 w-full rounded-md border border-border/60 object-cover"
          />
          <Input
            value={alt}
            disabled={disabled}
            onChange={(e) => onChange({ alt: e.target.value })}
            placeholder="Banner alt text (for accessibility & SEO)"
          />
          {!disabled ? (
            <div className="flex flex-wrap gap-2">
              <LibraryButton
                label="Replace from library"
                onPick={({ url: u, alt: a }) => onChange({ url: u, alt: alt || a })}
              />
              <ImageUploadButton label="Upload new" onUploaded={(u) => onChange({ url: u })} />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange({ url: "", alt: "" })}
              >
                <Trash2 className="mr-1 h-4 w-4" /> Remove banner
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex h-36 w-full items-center justify-center rounded-md border border-dashed border-border/60 bg-muted/30 text-sm text-muted-foreground">
            No banner image
          </div>
          {!disabled ? (
            <div className="flex flex-wrap gap-2">
              <LibraryButton
                label="Choose from library"
                onPick={({ url: u, alt: a }) => onChange({ url: u, alt: a })}
              />
              <ImageUploadButton label="Upload image" onUploaded={(u) => onChange({ url: u })} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

interface ViewCountsProps {
  data: { total: number; last7Days: number; last30Days: number } | undefined;
  isLoading: boolean;
  isError: boolean;
}

function ViewCounts({ data, isLoading, isError }: ViewCountsProps) {
  if (isError) return null;
  if (isLoading || !data) {
    return <Skeleton className="h-5 w-40" />;
  }
  const fmt = (n: number) => n.toLocaleString();
  return (
    <div
      className="flex items-center gap-3 text-xs text-muted-foreground"
      title="Page views: all-time · last 7 days · last 30 days"
    >
      <Eye className="h-3.5 w-3.5 shrink-0" />
      <span>
        <span className="font-medium text-foreground">{fmt(data.total)}</span> all-time
      </span>
      <span className="text-border">·</span>
      <span>
        <span className="font-medium text-foreground">{fmt(data.last7Days)}</span> 7d
      </span>
      <span className="text-border">·</span>
      <span>
        <span className="font-medium text-foreground">{fmt(data.last30Days)}</span> 30d
      </span>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="h-3.5 w-3.5 text-green-600" /> Saved
      </span>
    );
  }
  if (state === "dirty") {
    return <span className="text-xs text-muted-foreground">Unsaved changes</span>;
  }
  if (state === "error") {
    return <span className="text-xs text-destructive">Save failed</span>;
  }
  return null;
}

export default function EditorPage({ params }: { params: { id: string } }) {
  const { can } = useCmsAuth();
  const [, navigate] = useLocation();
  const canEdit = can("content.edit");

  const { data, isLoading, isError } = useGetCmsPost(params.id);

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <h1 className="font-serif text-3xl tracking-tight">Article not found</h1>
        <p className="mt-2 text-muted-foreground">It may have been deleted.</p>
        <Button className="mt-4" variant="outline" onClick={() => navigate("/content")}>
          Back to content
        </Button>
      </div>
    );
  }

  return (
    <LinkPickerProvider>
      <EditorBody detail={data} canEdit={canEdit} />
    </LinkPickerProvider>
  );
}
