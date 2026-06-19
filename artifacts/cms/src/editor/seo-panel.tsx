/**
 * Per-article SEO panel.
 *
 * A right-hand Sheet opened from the editor header. It surfaces every SEO field
 * (meta title/description, canonical, robots, focus keyword/keywords, Open Graph
 * + Twitter), live Google + social-card previews, and a real-time validation
 * report.
 *
 * Previews are built ONLY from `@workspace/blog-seo` (`articleSeo` →
 * `buildSeoTagList`) — the exact tag logic the public blog and prerender use —
 * so the panel can never drift from what crawlers actually see. The warnings
 * come from `@workspace/seo-validation`'s pure `validateSeo`, run on the live
 * editor state, with DB-derived duplicate refs folded in from the server.
 */
import { useMemo } from "react";
import {
  useGetCmsPostValidation,
  getGetCmsPostValidationQueryKey,
  type CmsPostDetail,
} from "@workspace/api-client-react";
import { articleSeo, buildSeoTagList } from "@workspace/blog-seo";
import {
  validateSeo,
  effectiveTitle,
  effectiveDescription,
  effectiveCanonical,
  effectiveOgImage,
  TITLE_MIN,
  TITLE_MAX,
  DESC_MIN,
  DESC_MAX,
  type SeoCheck,
  type CheckSeverity,
  type DuplicateContext,
} from "@workspace/seo-validation";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
  Search,
  Share2,
} from "lucide-react";
import { Input } from "@workspace/ui/input";
import { Textarea } from "@workspace/ui/textarea";
import { Label } from "@workspace/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@workspace/ui/sheet";
import {
  buildEditorValidationInput,
  type EditorBlock,
  type EditorSeoState,
  type SeoMetaInput,
} from "@/editor/model";
import {
  AiSuggestionList,
  SEO_AI_KINDS,
  type AiApplyField,
  type AiApplyFaq,
} from "@/editor/ai-assistant";
import { Sparkles } from "lucide-react";

interface SeoPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: CmsPostDetail;
  blocks: EditorBlock[];
  state: EditorSeoState;
  /** Patch the lifted SEO meta block (merged into the current value). */
  onSeoChange: (patch: Partial<SeoMetaInput>) => void;
  /** Patch the page-level canonical URL override. */
  onCanonicalChange: (value: string | null) => void;
  /** Apply an accepted AI field suggestion to whichever editor state owns it. */
  onAiApplyField: AiApplyField;
  /** Apply an accepted AI FAQ suggestion (inserts a FAQ block). */
  onAiApplyFaq: AiApplyFaq;
  disabled: boolean;
}

const ROBOTS_OPTIONS = [
  { value: "", label: "Default (index, follow)" },
  { value: "index,follow", label: "index, follow" },
  { value: "noindex,follow", label: "noindex, follow" },
  { value: "index,nofollow", label: "index, nofollow" },
  { value: "noindex,nofollow", label: "noindex, nofollow" },
];

const OG_TYPE_OPTIONS = ["article", "website"];
const TWITTER_CARD_OPTIONS = ["summary_large_image", "summary"];

export function SeoPanel({
  open,
  onOpenChange,
  detail,
  blocks,
  state,
  onSeoChange,
  onCanonicalChange,
  onAiApplyField,
  onAiApplyFaq,
  disabled,
}: SeoPanelProps) {
  // Live, instant validation input from the current editor state.
  const input = useMemo(
    () => buildEditorValidationInput(detail, blocks, state),
    [detail, blocks, state],
  );

  // DB-derived duplicate refs from the server (the client can't see other rows).
  const validationQuery = useGetCmsPostValidation(detail.id, {
    query: {
      enabled: open,
      queryKey: getGetCmsPostValidationQueryKey(detail.id),
    },
  });
  const duplicates: DuplicateContext = useMemo(
    () => validationQuery.data?.duplicates ?? {},
    [validationQuery.data],
  );

  // Run the SAME pure engine the server uses, folding in the duplicate refs.
  const result = useMemo(() => validateSeo(input, duplicates), [input, duplicates]);

  const seoTags = useMemo(
    () =>
      buildSeoTagList(
        articleSeo({
          title: state.title,
          excerpt: state.excerpt,
          canonicalUrl: state.canonicalUrl,
          featuredImageUrl: state.featuredImageUrl,
          seo: state.seo,
        }),
      ),
    [state],
  );

  const previewTitle = effectiveTitle(input);
  const previewDesc = effectiveDescription(input);
  const previewCanonical = effectiveCanonical(input);
  const previewImage = effectiveOgImage(input);

  const seo = state.seo;
  const set = (patch: Partial<SeoMetaInput>) => onSeoChange(patch);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b border-border/60 px-6 py-4">
          <SheetTitle>SEO & metadata</SheetTitle>
          <SheetDescription>
            Search & social metadata, live previews and a validation report.
            Critical issues block publishing.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {/* Score + summary */}
          <ScoreCard result={result} loadingDupes={validationQuery.isLoading} />

          {/* AI assist (suggest-only) */}
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles className="h-4 w-4" /> AI assistant
            </h3>
            <p className="text-xs text-muted-foreground">
              Suggestions only — review and accept what you want. Nothing is
              applied automatically.
            </p>
            <AiSuggestionList
              postId={detail.id}
              kinds={SEO_AI_KINDS}
              disabled={disabled}
              onApplyField={onAiApplyField}
              onApplyFaq={onAiApplyFaq}
            />
          </section>

          {/* Google preview */}
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Search className="h-4 w-4" /> Google preview
            </h3>
            <div className="rounded-lg border border-border/60 bg-card p-4">
              <p className="truncate text-xs text-muted-foreground">
                {previewCanonical || `${detail.pathname ?? "/" + detail.slug}`}
              </p>
              <p className="mt-0.5 truncate text-lg text-[#1a0dab] dark:text-blue-400">
                {previewTitle || "Untitled article"}
              </p>
              <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                {previewDesc || "No meta description — search engines will guess a snippet."}
              </p>
            </div>
          </section>

          {/* Social preview */}
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Share2 className="h-4 w-4" /> Social card
            </h3>
            <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
              {previewImage ? (
                <img
                  src={previewImage}
                  alt=""
                  className="h-44 w-full object-cover"
                />
              ) : (
                <div className="flex h-44 w-full items-center justify-center bg-muted/40 text-sm text-muted-foreground">
                  No social image
                </div>
              )}
              <div className="space-y-1 p-3">
                <p className="truncate text-xs uppercase tracking-wide text-muted-foreground">
                  {hostOf(previewCanonical) || "headout.com"}
                </p>
                <p className="truncate text-sm font-semibold">
                  {clean(seo?.ogTitle) || previewTitle || "Untitled article"}
                </p>
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {clean(seo?.ogDescription) || previewDesc || ""}
                </p>
              </div>
            </div>
          </section>

          {/* Editable fields */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold">Search metadata</h3>

            <Field
              label="Meta title"
              hint={lengthHint(previewTitle.length, TITLE_MIN, TITLE_MAX)}
            >
              <Input
                value={seo?.metaTitle ?? ""}
                disabled={disabled}
                placeholder={state.title || "Falls back to the article title"}
                onChange={(e) => set({ metaTitle: e.target.value || null })}
              />
            </Field>

            <Field
              label="Meta description"
              hint={lengthHint(previewDesc.length, DESC_MIN, DESC_MAX)}
            >
              <Textarea
                value={seo?.metaDescription ?? ""}
                disabled={disabled}
                rows={3}
                placeholder={state.excerpt || "Falls back to the excerpt"}
                onChange={(e) => set({ metaDescription: e.target.value || null })}
              />
            </Field>

            <Field label="Canonical URL">
              <Input
                value={state.canonicalUrl ?? ""}
                disabled={disabled}
                placeholder="https://www.headout.com/blog/…"
                onChange={(e) => onCanonicalChange(e.target.value || null)}
              />
            </Field>

            <Field label="Robots">
              <select
                value={clean(seo?.robots)}
                disabled={disabled}
                onChange={(e) => set({ robots: e.target.value || null })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {ROBOTS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Focus keyword">
                <Input
                  value={seo?.focusKeyword ?? ""}
                  disabled={disabled}
                  onChange={(e) => set({ focusKeyword: e.target.value || null })}
                />
              </Field>
              <Field label="Keywords (comma-separated)">
                <Input
                  value={(seo?.keywords ?? []).join(", ")}
                  disabled={disabled}
                  onChange={(e) =>
                    set({
                      keywords: e.target.value
                        .split(",")
                        .map((k) => k.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </Field>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold">Open Graph (Facebook, LinkedIn)</h3>
            <Field label="OG title">
              <Input
                value={seo?.ogTitle ?? ""}
                disabled={disabled}
                placeholder={previewTitle}
                onChange={(e) => set({ ogTitle: e.target.value || null })}
              />
            </Field>
            <Field label="OG description">
              <Textarea
                value={seo?.ogDescription ?? ""}
                disabled={disabled}
                rows={2}
                placeholder={previewDesc}
                onChange={(e) => set({ ogDescription: e.target.value || null })}
              />
            </Field>
            <Field label="OG image URL">
              <Input
                value={seo?.ogImage ?? ""}
                disabled={disabled}
                placeholder={state.featuredImageUrl ?? "Falls back to the banner image"}
                onChange={(e) => set({ ogImage: e.target.value || null })}
              />
            </Field>
            <Field label="OG type">
              <select
                value={clean(seo?.ogType) || "article"}
                disabled={disabled}
                onChange={(e) => set({ ogType: e.target.value || null })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {OG_TYPE_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold">Twitter / X</h3>
            <Field label="Card type">
              <select
                value={clean(seo?.twitterCard) || "summary_large_image"}
                disabled={disabled}
                onChange={(e) => set({ twitterCard: e.target.value || null })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {TWITTER_CARD_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Twitter title">
              <Input
                value={seo?.twitterTitle ?? ""}
                disabled={disabled}
                placeholder={clean(seo?.ogTitle) || previewTitle}
                onChange={(e) => set({ twitterTitle: e.target.value || null })}
              />
            </Field>
            <Field label="Twitter description">
              <Textarea
                value={seo?.twitterDescription ?? ""}
                disabled={disabled}
                rows={2}
                placeholder={clean(seo?.ogDescription) || previewDesc}
                onChange={(e) => set({ twitterDescription: e.target.value || null })}
              />
            </Field>
            <Field label="Twitter image URL">
              <Input
                value={seo?.twitterImage ?? ""}
                disabled={disabled}
                placeholder={clean(seo?.ogImage) || (state.featuredImageUrl ?? "")}
                onChange={(e) => set({ twitterImage: e.target.value || null })}
              />
            </Field>
          </section>

          {/* Full validation report */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Validation report</h3>
            <ul className="space-y-1.5">
              {result.checks.map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
            </ul>
          </section>

          {/* Crawler-visible head tags (from blog-seo) */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Rendered head tags</h3>
            <pre className="overflow-x-auto rounded-md border border-border/60 bg-muted/30 p-3 text-xs leading-relaxed">
              {seoTags.map(describeTag).join("\n")}
            </pre>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ScoreCard({
  result,
  loadingDupes,
}: {
  result: ReturnType<typeof validateSeo>;
  loadingDupes: boolean;
}) {
  const tone =
    result.status === "fail"
      ? "border-destructive/40 bg-destructive/5"
      : result.status === "warn"
        ? "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10"
        : "border-green-300 bg-green-50 dark:border-green-500/40 dark:bg-green-500/10";
  return (
    <div className={`rounded-lg border p-4 ${tone}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            SEO score
          </p>
          <p className="text-3xl font-semibold tabular-nums">{result.score}</p>
        </div>
        <div className="text-right text-sm">
          <p className="font-medium">
            {result.passedCount}/{result.totalCount} checks passed
          </p>
          {result.blocking.length > 0 ? (
            <p className="text-destructive">
              {result.blocking.length} blocking issue(s)
            </p>
          ) : (
            <p className="text-green-700 dark:text-green-400">No blocking issues</p>
          )}
          {loadingDupes ? (
            <p className="text-xs text-muted-foreground">Checking duplicates…</p>
          ) : null}
        </div>
      </div>
      {result.blocking.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-border/40 pt-3 text-sm">
          {result.blocking.map((c) => (
            <li key={c.id} className="flex items-start gap-1.5 text-destructive">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{c.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CheckRow({ check }: { check: SeoCheck }) {
  const Icon = check.passed
    ? CheckCircle2
    : check.severity === "error"
      ? XCircle
      : check.severity === "warn"
        ? AlertTriangle
        : Info;
  const color = check.passed
    ? "text-green-600 dark:text-green-400"
    : severityColor(check.severity);
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
      <span className="flex-1">
        <span className="font-medium">{check.label}.</span>{" "}
        <span className="text-muted-foreground">{check.message}</span>
      </span>
    </li>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function severityColor(severity: CheckSeverity): string {
  if (severity === "error") return "text-destructive";
  if (severity === "warn") return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground";
}

function lengthHint(len: number, min: number, max: number): string {
  if (len === 0) return `0 / ${min}–${max}`;
  const flag = len < min ? " (short)" : len > max ? " (long)" : " ✓";
  return `${len} / ${min}–${max}${flag}`;
}

function clean(v: string | null | undefined): string {
  return (v ?? "").trim();
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function describeTag(tag: ReturnType<typeof buildSeoTagList>[number]): string {
  switch (tag.kind) {
    case "title":
      return `<title>${tag.text}</title>`;
    case "meta":
      return `<meta ${tag.attr}="${tag.key}" content="${tag.content}">`;
    case "link":
      return `<link rel="${tag.rel}" href="${tag.href}">`;
    case "jsonld":
      return `<script type="application/ld+json">${JSON.stringify(tag.block)}</script>`;
    default:
      return "";
  }
}
