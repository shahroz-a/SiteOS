/**
 * AI Writing & SEO Assistant — server core.
 *
 * Suggest-only: every endpoint here READS the article (and, for grounding,
 * sibling article metadata) and asks the OpenAI integration for structured
 * suggestions. It NEVER writes to content — the editor decides what to apply.
 *
 * The model output is parsed and normalized into a single uniform
 * `AiSuggestion` shape so the CMS can render accept/reject controls the same
 * way for every suggestion type. The `apply` discriminator (and, for field
 * suggestions, the allowed `target`) is decided HERE, not by the model, so a
 * hallucinated target can never be applied to the wrong field.
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, pagesTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { serializeCmsPostDetail, type CmsPostDetail } from "./cms-content";

const MODEL = "gpt-5.4";
const MAX_BODY_CHARS = 6000;
const CANDIDATE_LIMIT = 150;

/** The suggestion kinds the assistant can produce. */
export const AI_SUGGESTION_KINDS = [
  "seo",
  "metadata",
  "summary",
  "social",
  "faq",
  "related",
  "readability",
  "duplicate",
  "internal-links",
] as const;

export type AiSuggestionKind = (typeof AI_SUGGESTION_KINDS)[number];

/** How the editor applies an accepted suggestion. */
export type AiSuggestionApply = "field" | "faq" | "info";

/** Field targets a `field` suggestion is allowed to write. */
export const AI_FIELD_TARGETS = [
  "metaTitle",
  "metaDescription",
  "focusKeyword",
  "keywords",
  "excerpt",
  "subtitle",
  "ogTitle",
  "ogDescription",
  "ogImage",
  "twitterTitle",
  "twitterDescription",
  "canonicalUrl",
] as const;

export type AiFieldTarget = (typeof AI_FIELD_TARGETS)[number];

const FIELD_TARGET_SET = new Set<string>(AI_FIELD_TARGETS);

export interface AiSuggestion {
  id: string;
  apply: AiSuggestionApply;
  label: string;
  detail: string;
  /** Set when `apply === "field"`: the editor field this writes to. */
  target: string | null;
  /** Suggested value: the new field value, or copyable text for `info`. */
  value: string | null;
  /** Set when `apply === "faq"`. */
  question: string | null;
  answer: string | null;
}

export interface AiSuggestResult {
  kind: AiSuggestionKind;
  model: string;
  summary: string;
  suggestions: AiSuggestion[];
}

/* ------------------------------------------------------------------ */
/* article -> compact text context                                    */
/* ------------------------------------------------------------------ */

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

interface TreeNode {
  type?: string;
  blockType?: string;
  text?: string;
  data?: Record<string, unknown>;
  children?: unknown[];
}

/** Walk a componentTree collecting readable body text. */
function collectText(tree: unknown, out: string[]): void {
  if (!Array.isArray(tree)) return;
  for (const raw of tree) {
    if (!raw || typeof raw !== "object") continue;
    const node = raw as TreeNode;
    const kind = node.blockType ?? node.type;
    const d = node.data ?? {};
    if (node.text) out.push(String(node.text));
    if (typeof d.html === "string") out.push(stripHtml(d.html));
    if (typeof d.heading === "string") out.push(d.heading);
    if (typeof d.title === "string") out.push(d.title);
    if (typeof d.subtitle === "string") out.push(d.subtitle);
    if (typeof d.body === "string") out.push(d.body);
    if (Array.isArray(d.items)) {
      for (const it of d.items) if (typeof it === "string") out.push(it);
    }
    if (Array.isArray(d.entries)) {
      for (const e of d.entries as Array<Record<string, unknown>>) {
        if (typeof e.question === "string") out.push(e.question);
        if (typeof e.answer === "string") out.push(e.answer);
        if (typeof e.title === "string") out.push(e.title);
        if (typeof e.body === "string") out.push(e.body);
      }
    }
    if (kind === "section" && Array.isArray(node.children)) {
      collectText(node.children, out);
    }
  }
}

function bodyText(detail: CmsPostDetail): string {
  const parts: string[] = [];
  collectText(detail.componentTree, parts);
  if (parts.join(" ").trim().length === 0 && detail.contentHtml) {
    parts.push(stripHtml(detail.contentHtml));
  }
  const joined = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return joined.length > MAX_BODY_CHARS
    ? joined.slice(0, MAX_BODY_CHARS) + "\n…[truncated]"
    : joined;
}

/** A compact, model-friendly description of the article. */
function articleContext(detail: CmsPostDetail): string {
  const seo = detail.seo;
  const lines: string[] = [
    `Title: ${detail.title}`,
    detail.subtitle ? `Subtitle: ${detail.subtitle}` : "",
    `Slug: ${detail.slug}`,
    `Path: ${detail.pathname}`,
    detail.excerpt ? `Excerpt: ${detail.excerpt}` : "Excerpt: (none)",
    detail.primaryCategory ? `Primary category: ${detail.primaryCategory.name}` : "",
    detail.categories.length
      ? `Categories: ${detail.categories.map((c) => c.name).join(", ")}`
      : "",
    detail.tags.length ? `Tags: ${detail.tags.map((t) => t.name).join(", ")}` : "",
    seo?.metaTitle ? `Current meta title: ${seo.metaTitle}` : "Current meta title: (none)",
    seo?.metaDescription
      ? `Current meta description: ${seo.metaDescription}`
      : "Current meta description: (none)",
    seo?.focusKeyword ? `Current focus keyword: ${seo.focusKeyword}` : "",
    seo?.keywords?.length ? `Current keywords: ${seo.keywords.join(", ")}` : "",
    detail.faq.length
      ? `Existing FAQ questions: ${detail.faq.map((f) => f.question).join(" | ")}`
      : "Existing FAQ: (none)",
    detail.internalLinks.length
      ? `Existing internal links: ${detail.internalLinks
          .map((l) => l.anchorText || l.href)
          .slice(0, 20)
          .join(" | ")}`
      : "Existing internal links: (none)",
    "",
    "Article body:",
    bodyText(detail),
  ];
  return lines.filter((l) => l !== "").join("\n");
}

/* ------------------------------------------------------------------ */
/* grounding: sibling article candidates                              */
/* ------------------------------------------------------------------ */

interface CandidatePost {
  title: string;
  pathname: string;
  excerpt: string | null;
}

/** Published siblings (excluding self) to ground link/related/dupe suggestions. */
async function fetchCandidates(pageId: string): Promise<CandidatePost[]> {
  const rows = await db
    .select({
      title: pagesTable.title,
      pathname: pagesTable.pathname,
      excerpt: pagesTable.excerpt,
    })
    .from(pagesTable)
    .where(
      and(
        ne(pagesTable.id, pageId),
        eq(pagesTable.status, "published"),
        eq(pagesTable.pageType, "post"),
      ),
    )
    .orderBy(sql`${pagesTable.updatedAt} desc nulls last`)
    .limit(CANDIDATE_LIMIT);
  return rows;
}

function candidateList(candidates: CandidatePost[]): string {
  return candidates
    .map((c) => `- ${c.title} — ${c.pathname}`)
    .join("\n");
}

/** Normalize a path for comparison: strip origin, query/hash, trailing slash. */
function normalizePathForMatch(value: string): string {
  let p = value.trim();
  // Drop an absolute origin if the model returned a full URL.
  const schemeMatch = p.match(/^https?:\/\/[^/]+(\/.*)?$/i);
  if (schemeMatch) p = schemeMatch[1] ?? "/";
  // Drop query string / fragment.
  p = p.replace(/[?#].*$/, "");
  // Collapse a trailing slash (but keep a bare "/").
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p;
}

/**
 * Build a lookup from normalized candidate path -> canonical pathname so a
 * grounded suggestion's `value` can be validated (and corrected to the exact
 * stored path) before it ever reaches an editor. Paths can't be hallucinated.
 */
function candidatePathLookup(candidates: CandidatePost[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of candidates) {
    map.set(normalizePathForMatch(c.pathname), c.pathname);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* per-kind prompt + parsing                                          */
/* ------------------------------------------------------------------ */

const FIELD_TARGET_HELP =
  `One of: metaTitle (30-60 chars), metaDescription (70-160 chars), ` +
  `focusKeyword, keywords (comma-separated), excerpt, subtitle, ogTitle, ` +
  `ogDescription, ogImage, twitterTitle, twitterDescription, canonicalUrl.`;

interface KindSpec {
  apply: AiSuggestionApply;
  needsCandidates: boolean;
  /** Per-kind instruction block appended to the user prompt. */
  instruction: string;
}

const KIND_SPECS: Record<AiSuggestionKind, KindSpec> = {
  seo: {
    apply: "field",
    needsCandidates: false,
    instruction:
      `Suggest concrete improvements to this article's search metadata. Focus ` +
      `on the meta title, meta description, focus keyword and keywords. Each ` +
      `suggestion must propose a ready-to-use value.\n` +
      `Return JSON: {"summary": string, "suggestions": [{"target": string, ` +
      `"value": string, "label": string, "detail": string}]}. ` +
      `"target" = ${FIELD_TARGET_HELP} "label" = short headline, "detail" = ` +
      `why it helps. Give 3-6 suggestions.`,
  },
  metadata: {
    apply: "field",
    needsCandidates: false,
    instruction:
      `Fill in MISSING or weak social/share metadata (Open Graph & Twitter) ` +
      `and any empty search fields, deriving values from the article content. ` +
      `Only suggest fields that are currently empty or clearly inadequate.\n` +
      `Return JSON: {"summary": string, "suggestions": [{"target": string, ` +
      `"value": string, "label": string, "detail": string}]}. ` +
      `"target" = ${FIELD_TARGET_HELP} Give up to 8 suggestions.`,
  },
  summary: {
    apply: "field",
    needsCandidates: false,
    instruction:
      `Write a concise, engaging summary of this article suitable for the ` +
      `excerpt and/or meta description. Offer 2-3 variants of different ` +
      `lengths/tones.\n` +
      `Return JSON: {"summary": string, "suggestions": [{"target": string, ` +
      `"value": string, "label": string, "detail": string}]}. ` +
      `"target" must be "excerpt" or "metaDescription".`,
  },
  social: {
    apply: "info",
    needsCandidates: false,
    instruction:
      `Write share-ready social captions promoting this article — one each ` +
      `for X/Twitter (short, with 1-2 hashtags), Facebook/LinkedIn (a sentence ` +
      `or two), and Instagram (punchy, emoji ok).\n` +
      `Return JSON: {"summary": string, "suggestions": [{"label": string, ` +
      `"value": string, "detail": string}]}. "label" = platform, "value" = ` +
      `the caption text, "detail" = optional note.`,
  },
  faq: {
    apply: "faq",
    needsCandidates: false,
    instruction:
      `Generate frequently-asked questions (with answers) a reader of this ` +
      `article would have. Do NOT repeat existing FAQ questions. Answers must ` +
      `be grounded in the article content, 1-3 sentences each.\n` +
      `Return JSON: {"summary": string, "suggestions": [{"question": string, ` +
      `"answer": string, "detail": string}]}. Give 3-6 Q&A pairs.`,
  },
  related: {
    apply: "info",
    needsCandidates: true,
    instruction:
      `From the CANDIDATE ARTICLES list ONLY, pick the most topically related ` +
      `articles to recommend alongside this one. Never invent a path that is ` +
      `not in the list.\n` +
      `Return JSON: {"summary": string, "suggestions": [{"label": string, ` +
      `"value": string, "detail": string}]}. "label" = the article title, ` +
      `"value" = its exact path from the list, "detail" = why it's related. ` +
      `Give up to 6.`,
  },
  readability: {
    apply: "info",
    needsCandidates: false,
    instruction:
      `Review the article's writing for readability: long/convoluted ` +
      `sentences, jargon, passive voice, weak structure, missing headings. ` +
      `Each suggestion is a specific, actionable note.\n` +
      `Return JSON: {"summary": string, "suggestions": [{"label": string, ` +
      `"value": string, "detail": string}]}. "label" = short issue title, ` +
      `"value" = the concrete fix or rewritten example, "detail" = where/why. ` +
      `Give 3-6 notes.`,
  },
  duplicate: {
    apply: "info",
    needsCandidates: true,
    instruction:
      `Compare this article against the CANDIDATE ARTICLES list and flag any ` +
      `that substantially overlap in topic or intent (potential duplicate / ` +
      `cannibalization risk). If none overlap, return an empty suggestions ` +
      `array.\n` +
      `Return JSON: {"summary": string, "suggestions": [{"label": string, ` +
      `"value": string, "detail": string}]}. "label" = the candidate title, ` +
      `"value" = its exact path from the list, "detail" = how they overlap and ` +
      `what to do.`,
  },
  "internal-links": {
    apply: "info",
    needsCandidates: true,
    instruction:
      `Suggest internal links to add to THIS article, pointing to relevant ` +
      `CANDIDATE ARTICLES. For each, give natural anchor text that appears (or ` +
      `could fit) in the body, and the target path. Use ONLY paths from the ` +
      `list; do not duplicate existing internal links.\n` +
      `Return JSON: {"summary": string, "suggestions": [{"label": string, ` +
      `"value": string, "detail": string}]}. "label" = suggested anchor text, ` +
      `"value" = the exact target path, "detail" = where to place it. Give ` +
      `up to 6.`,
  },
};

const rawSuggestionSchema = z.object({
  target: z.string().optional(),
  value: z.string().optional(),
  label: z.string().optional(),
  detail: z.string().optional(),
  question: z.string().optional(),
  answer: z.string().optional(),
});

const rawResponseSchema = z.object({
  summary: z.string().optional(),
  suggestions: z.array(rawSuggestionSchema).optional(),
});

let counter = 0;
function nextId(): string {
  counter += 1;
  return `ai-${Date.now().toString(36)}-${counter}`;
}

function normalize(
  kind: AiSuggestionKind,
  raw: z.infer<typeof rawSuggestionSchema>,
  candidatePaths: Map<string, string> | null,
): AiSuggestion | null {
  const spec = KIND_SPECS[kind];
  const label = (raw.label ?? "").trim();
  const detail = (raw.detail ?? "").trim();

  if (spec.apply === "faq") {
    const question = (raw.question ?? "").trim();
    const answer = (raw.answer ?? "").trim();
    if (!question || !answer) return null;
    return {
      id: nextId(),
      apply: "faq",
      label: question,
      detail,
      target: null,
      value: null,
      question,
      answer,
    };
  }

  if (spec.apply === "field") {
    const target = (raw.target ?? "").trim();
    const value = (raw.value ?? "").trim();
    if (!FIELD_TARGET_SET.has(target) || !value) return null;
    return {
      id: nextId(),
      apply: "field",
      label: label || target,
      detail,
      target,
      value,
      question: null,
      answer: null,
    };
  }

  // info
  let value = (raw.value ?? "").trim();

  // Grounded kinds (related / duplicate / internal-links) carry a candidate
  // article PATH in `value`. Reject anything the model invented: the value
  // MUST resolve to one of the fetched sibling paths. We also rewrite it to
  // the exact stored pathname so a normalized/variant match can't leak a
  // subtly-wrong URL into the editor.
  if (candidatePaths) {
    const canonical = candidatePaths.get(normalizePathForMatch(value));
    if (!canonical) return null;
    value = canonical;
  }

  if (!label && !value) return null;
  return {
    id: nextId(),
    apply: "info",
    label: label || value.slice(0, 60),
    detail,
    target: null,
    value: value || null,
    question: null,
    answer: null,
  };
}

/* ------------------------------------------------------------------ */
/* public entry                                                       */
/* ------------------------------------------------------------------ */

/**
 * Generate suggestions of `kind` for the article `pageId`. Returns null when
 * the page does not exist. Never writes to content.
 */
export async function generateAiSuggestions(
  pageId: string,
  kind: AiSuggestionKind,
): Promise<AiSuggestResult | null> {
  const detail = await serializeCmsPostDetail(pageId);
  if (!detail) return null;

  const spec = KIND_SPECS[kind];
  let prompt = articleContext(detail);

  let candidatePaths: Map<string, string> | null = null;
  if (spec.needsCandidates) {
    const candidates = await fetchCandidates(pageId);
    candidatePaths = candidatePathLookup(candidates);
    prompt +=
      "\n\nCANDIDATE ARTICLES (title — path):\n" +
      (candidates.length ? candidateList(candidates) : "(none available)");
  }

  prompt += "\n\nTASK:\n" + spec.instruction;

  const completion = await openai.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 8192,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are an expert content editor and SEO specialist for a travel " +
          "blog. You return ONLY valid JSON in the exact shape requested. You " +
          "never fabricate facts, URLs, or paths beyond what you are given. " +
          "Your suggestions are advisory — a human editor decides what to apply.",
      },
      { role: "user", content: prompt },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "";
  let parsed: z.infer<typeof rawResponseSchema>;
  try {
    parsed = rawResponseSchema.parse(JSON.parse(content));
  } catch {
    return {
      kind,
      model: MODEL,
      summary: "The assistant returned an unexpected response. Try again.",
      suggestions: [],
    };
  }

  const suggestions = (parsed.suggestions ?? [])
    .map((s) => normalize(kind, s, candidatePaths))
    .filter((s): s is AiSuggestion => s !== null);

  return {
    kind,
    model: MODEL,
    summary: (parsed.summary ?? "").trim(),
    suggestions,
  };
}
