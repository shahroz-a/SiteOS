import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCmsPost,
  useUpdateCmsPost,
  getGetCmsPostQueryKey,
  getListCmsPostQueryKey,
  type CmsPostDetail,
} from "@workspace/api-client-react";
import {
  ArrowLeft,
  Check,
  Loader2,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@workspace/ui/button";
import { Input } from "@workspace/ui/input";
import { Textarea } from "@workspace/ui/textarea";
import { Skeleton } from "@workspace/ui/skeleton";
import { useToast } from "@workspace/ui";
import { useCmsAuth } from "@/lib/cms-auth-context";
import { useEditor } from "@/editor/use-editor";
import { EditorCanvas } from "@/editor/canvas";
import { EditorPreview } from "@/editor/preview";
import { LinkPickerProvider } from "@/editor/link-assistant";
import { ImageUploadButton, LibraryButton } from "@/editor/block-editors";
import {
  blocksFromDetail,
  detailToInput,
  type EditorBlock,
} from "@/editor/model";

const AUTOSAVE_DELAY = 1500;

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

interface EditorBodyProps {
  detail: CmsPostDetail;
  canEdit: boolean;
}

function EditorBody({ detail, canEdit }: EditorBodyProps) {
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

  const update = useUpdateCmsPost({
    mutation: {
      onSuccess: () => {
        setSaveState("saved");
        queryClient.invalidateQueries({ queryKey: getGetCmsPostQueryKey(detail.id) });
        queryClient.invalidateQueries({ queryKey: getListCmsPostQueryKey() });
      },
      onError: () => {
        setSaveState("error");
        toast({ title: "Autosave failed", description: "Your latest changes weren't saved.", variant: "destructive" });
      },
    },
  });

  // Latest values captured for the debounced save without re-arming the timer.
  const latest = useRef({ blocks: editor.blocks, title, subtitle, excerpt, bannerUrl, bannerAlt });
  latest.current = { blocks: editor.blocks, title, subtitle, excerpt, bannerUrl, bannerAlt };

  const updateMutate = update.mutate;
  const save = useCallback(() => {
    const { blocks, title: t, subtitle: s, excerpt: e, bannerUrl: bu, bannerAlt: ba } = latest.current;
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
  }, [editor.blocks, title, subtitle, excerpt, bannerUrl, bannerAlt, canEdit, save]);

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
        <SaveIndicator state={saveState} />
        <div className="flex items-center gap-1">
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
    </div>
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
