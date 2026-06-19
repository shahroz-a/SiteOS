/**
 * AI Writing & SEO Assistant — editor UI.
 *
 * SUGGEST-ONLY: the server returns structured suggestions and this surface
 * renders them with Accept / Reject controls. NOTHING is auto-applied — the
 * editor explicitly accepts (which writes the value into the relevant field /
 * inserts a FAQ block / copies advisory text) or rejects (dismisses it).
 *
 * `AiSuggestionList` is shared by both surfaces: the SEO panel (search/social
 * metadata kinds) and the editor's AI Assistant sheet (FAQ, related, internal
 * links, readability, duplicates). The parent supplies the apply handlers so
 * the same component can write into whichever editor state owns the field.
 */
import { useState } from "react";
import {
  useSuggestCmsAi,
  type AiSuggestion,
  type AiSuggestRequestKind,
} from "@workspace/api-client-react";
import { useToast } from "@workspace/ui";
import { Button } from "@workspace/ui/button";
import { Badge } from "@workspace/ui/badge";
import {
  Check,
  Copy,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";

export interface AiKindOption {
  kind: AiSuggestRequestKind;
  label: string;
  description: string;
}

/** Field targets that map onto editor state (mirrors the server allow-list). */
export type AiApplyField = (target: string, value: string) => boolean;
export type AiApplyFaq = (question: string, answer: string) => void;

interface AiSuggestionListProps {
  postId: string;
  kinds: AiKindOption[];
  disabled: boolean;
  onApplyField: AiApplyField;
  onApplyFaq: AiApplyFaq;
}

export function AiSuggestionList({
  postId,
  kinds,
  disabled,
  onApplyField,
  onApplyFaq,
}: AiSuggestionListProps) {
  const { toast } = useToast();
  const [activeKind, setActiveKind] = useState<AiSuggestRequestKind | null>(null);
  const [summary, setSummary] = useState("");
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());

  const suggest = useSuggestCmsAi({
    mutation: {
      onSuccess: (data) => {
        setSummary(data.summary);
        setSuggestions(data.suggestions);
        setAccepted(new Set());
        if (data.suggestions.length === 0) {
          toast({
            title: "No suggestions",
            description: data.summary || "The assistant had nothing to suggest here.",
          });
        }
      },
      onError: () => {
        toast({
          title: "AI assistant failed",
          description: "Couldn't generate suggestions. Try again in a moment.",
          variant: "destructive",
        });
      },
    },
  });

  const run = (kind: AiSuggestRequestKind) => {
    setActiveKind(kind);
    setSummary("");
    setSuggestions([]);
    suggest.mutate({ id: postId, data: { kind } });
  };

  const dismiss = (id: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  };

  const markAccepted = (id: string) => {
    setAccepted((prev) => new Set(prev).add(id));
  };

  const accept = (s: AiSuggestion) => {
    if (s.apply === "field" && s.target && s.value !== null) {
      const ok = onApplyField(s.target, s.value);
      if (!ok) {
        toast({
          title: "Couldn't apply",
          description: `Unknown field "${s.target}".`,
          variant: "destructive",
        });
        return;
      }
      markAccepted(s.id);
      toast({ title: "Applied", description: s.label });
    } else if (s.apply === "faq" && s.question && s.answer) {
      onApplyFaq(s.question, s.answer);
      markAccepted(s.id);
      toast({ title: "FAQ added", description: s.question });
    }
  };

  const copy = async (s: AiSuggestion) => {
    const text = s.value ?? s.label;
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: "Copied to clipboard." });
    } catch {
      toast({
        title: "Copy failed",
        description: "Your browser blocked clipboard access.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {kinds.map((k) => (
          <Button
            key={k.kind}
            type="button"
            variant={activeKind === k.kind ? "default" : "outline"}
            size="sm"
            disabled={suggest.isPending}
            title={k.description}
            onClick={() => run(k.kind)}
          >
            {suggest.isPending && activeKind === k.kind ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            {k.label}
          </Button>
        ))}
      </div>

      {suggest.isPending ? (
        <p className="text-sm text-muted-foreground">Thinking…</p>
      ) : null}

      {!suggest.isPending && activeKind && summary ? (
        <div className="flex items-start justify-between gap-2 rounded-md border border-border/60 bg-muted/30 p-3">
          <p className="text-sm text-muted-foreground">{summary}</p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            title="Regenerate"
            disabled={suggest.isPending}
            onClick={() => run(activeKind)}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}

      {suggestions.length > 0 ? (
        <ul className="space-y-2">
          {suggestions.map((s) => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              accepted={accepted.has(s.id)}
              disabled={disabled}
              onAccept={() => accept(s)}
              onReject={() => dismiss(s.id)}
              onCopy={() => copy(s)}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  metaTitle: "Meta title",
  metaDescription: "Meta description",
  focusKeyword: "Focus keyword",
  keywords: "Keywords",
  excerpt: "Excerpt",
  subtitle: "Subtitle",
  ogTitle: "OG title",
  ogDescription: "OG description",
  ogImage: "OG image",
  twitterTitle: "Twitter title",
  twitterDescription: "Twitter description",
  canonicalUrl: "Canonical URL",
};

function SuggestionCard({
  suggestion: s,
  accepted,
  disabled,
  onAccept,
  onReject,
  onCopy,
}: {
  suggestion: AiSuggestion;
  accepted: boolean;
  disabled: boolean;
  onAccept: () => void;
  onReject: () => void;
  onCopy: () => void;
}) {
  const applicable = s.apply === "field" || s.apply === "faq";

  return (
    <li className="rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          {s.apply === "field" && s.target ? (
            <Badge variant="secondary" className="mb-0.5 text-[10px] uppercase">
              {FIELD_LABELS[s.target] ?? s.target}
            </Badge>
          ) : null}
          {s.apply === "faq" ? (
            <p className="text-sm font-medium">{s.question}</p>
          ) : (
            <p className="text-sm font-medium">{s.label}</p>
          )}
          {s.apply === "faq" ? (
            <p className="text-sm text-muted-foreground">{s.answer}</p>
          ) : s.value ? (
            <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {s.value}
            </p>
          ) : null}
          {s.detail ? (
            <p className="text-xs italic text-muted-foreground/80">{s.detail}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {accepted ? (
            <span className="flex items-center gap-1 px-1 text-xs text-green-600 dark:text-green-400">
              <Check className="h-3.5 w-3.5" /> Applied
            </span>
          ) : (
            <>
              {applicable ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-green-600 hover:text-green-700 dark:text-green-400"
                  title={s.apply === "faq" ? "Add FAQ" : "Apply"}
                  disabled={disabled}
                  onClick={onAccept}
                >
                  {s.apply === "faq" ? (
                    <Plus className="h-4 w-4" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  title="Copy"
                  onClick={onCopy}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              )}
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground"
                title="Dismiss"
                onClick={onReject}
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/** Kind groups for the two surfaces. */
export const SEO_AI_KINDS: AiKindOption[] = [
  { kind: "seo", label: "Improve SEO", description: "Suggest better meta title, description, keywords" },
  { kind: "metadata", label: "Complete metadata", description: "Fill missing social / search metadata" },
  { kind: "summary", label: "Summarize", description: "Generate excerpt / meta description variants" },
  { kind: "social", label: "Social captions", description: "Share-ready captions for each platform" },
];

export const EDITOR_AI_KINDS: AiKindOption[] = [
  { kind: "faq", label: "Generate FAQ", description: "Suggest Q&A pairs to add to the article" },
  { kind: "related", label: "Related articles", description: "Recommend related published posts" },
  { kind: "internal-links", label: "Internal links", description: "Suggest internal links to add" },
  { kind: "readability", label: "Readability", description: "Actionable writing-quality notes" },
  { kind: "duplicate", label: "Duplicate check", description: "Flag overlapping / cannibalizing posts" },
];
