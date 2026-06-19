import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CmsPostDetail } from "../cms-content";

/**
 * Unit tests for the AI assist server core (`generateAiSuggestions`). They
 * exercise the deterministic, model-independent logic: per-kind prompt
 * assembly, parsing/normalization of the raw model JSON into the uniform
 * `AiSuggestion` shape, field-target validation, and candidate grounding for
 * the related/duplicate/internal-links kinds.
 *
 * Everything external is stubbed so the suite is fully offline:
 *   - `@workspace/integrations-openai-ai-server` — the OpenAI client's
 *     `chat.completions.create` is a `vi.fn()` whose response each test sets.
 *     No network call is ever made and no API key/env is required.
 *   - `../cms-content` — `serializeCmsPostDetail` returns a fixture article
 *     (or null) so we don't touch the DB for the article body.
 *   - `@workspace/db` / `drizzle-orm` — `fetchCandidates`' query chain resolves
 *     to a per-test candidate set; the operator helpers are no-ops the fake
 *     query simply ignores.
 */

const h = vi.hoisted(() => ({
  create: vi.fn(),
  serialize: vi.fn(),
  candidates: [] as Array<{
    title: string;
    pathname: string;
    excerpt: string | null;
  }>,
}));

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: h.create } } },
}));

vi.mock("../cms-content", () => ({
  serializeCmsPostDetail: h.serialize,
}));

// `fetchCandidates` builds `db.select({...}).from(...).where(...).orderBy(...).limit(...)`
// and awaits it. We don't evaluate the predicate here — the test controls the
// returned candidate set directly — so the chain just resolves to `h.candidates`.
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(h.candidates),
          }),
        }),
      }),
    }),
  },
  pagesTable: new Proxy({}, { get: () => ({}) }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conds: unknown[]) => ({ conds }),
  eq: () => ({}),
  ne: () => ({}),
  sql: () => ({}),
}));

const { generateAiSuggestions, AI_FIELD_TARGETS, AI_SUGGESTION_KINDS } =
  await import("../ai-assist");

/** Build a complete-enough CmsPostDetail fixture for `articleContext`. */
function makeDetail(over: Partial<CmsPostDetail> = {}): CmsPostDetail {
  return {
    id: "page-1",
    slug: "rome-in-a-day",
    status: "published",
    pageType: "post",
    title: "Rome in a Day",
    subtitle: "A whirlwind guide",
    excerpt: "See the best of Rome.",
    canonicalUrl: "https://www.headout.com/blog/rome-in-a-day/",
    originalUrl: null,
    pathname: "/blog/rome-in-a-day/",
    parentPath: null,
    featuredImageUrl: null,
    featuredImageAlt: null,
    readingTimeMinutes: 5,
    wordCount: 800,
    language: "en",
    publishedAt: null,
    scheduledFor: null,
    modifiedAt: null,
    updatedAt: null,
    contentHtml: "<p>Visit the Colosseum and the Vatican.</p>",
    richText: null,
    componentTree: [],
    author: null,
    primaryCategory: { id: "c1", name: "Italy", slug: "italy" },
    categories: [{ id: "c1", name: "Italy", slug: "italy" }],
    tags: [{ id: "t1", name: "Rome", slug: "rome" }],
    breadcrumbs: [],
    faq: [],
    images: [],
    galleries: [],
    seo: null,
    jsonld: [],
    internalLinks: [],
    externalLinks: [],
    latestVersion: 1,
    redirects: [],
    ...over,
  } as CmsPostDetail;
}

/** Stub the model's reply with a JSON object string. */
function mockModelJson(obj: unknown): void {
  h.create.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(obj) } }],
  });
}

/** Stub the model's reply with an arbitrary (possibly invalid) raw string. */
function mockModelRaw(content: string): void {
  h.create.mockResolvedValue({ choices: [{ message: { content } }] });
}

/** The user prompt sent to the model in the most recent create() call. */
function lastUserPrompt(): string {
  const args = h.create.mock.calls.at(-1)?.[0] as {
    messages: { role: string; content: string }[];
  };
  return args.messages.find((m) => m.role === "user")!.content;
}

beforeEach(() => {
  h.create.mockReset();
  h.serialize.mockReset();
  h.candidates = [];
  h.serialize.mockResolvedValue(makeDetail());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("generateAiSuggestions — page lookup", () => {
  it("returns null when the article does not exist", async () => {
    h.serialize.mockResolvedValue(null);
    const res = await generateAiSuggestions("missing", "seo");
    expect(res).toBeNull();
    expect(h.create).not.toHaveBeenCalled();
  });
});

describe("field suggestions — target validation", () => {
  it("keeps only suggestions whose target is in the allowed set", async () => {
    mockModelJson({
      summary: "  SEO ideas  ",
      suggestions: [
        { target: "metaTitle", value: "Rome in a Day: The Ultimate Guide" },
        { target: "metaDescription", value: "Everything to see in Rome." },
        // hallucinated / non-field targets must be dropped
        { target: "bodyHtml", value: "<p>nope</p>" },
        { target: "slug", value: "rome" },
        { target: "", value: "no target" },
      ],
    });

    const res = await generateAiSuggestions("page-1", "seo");
    expect(res).not.toBeNull();
    const targets = res!.suggestions.map((s) => s.target);
    expect(targets).toEqual(["metaTitle", "metaDescription"]);
    for (const s of res!.suggestions) {
      expect(s.apply).toBe("field");
      expect(AI_FIELD_TARGETS).toContain(s.target as never);
    }
    // summary is trimmed
    expect(res!.summary).toBe("SEO ideas");
  });

  it("drops field suggestions with an empty value", async () => {
    mockModelJson({
      suggestions: [
        { target: "focusKeyword", value: "   " },
        { target: "focusKeyword", value: "rome travel" },
      ],
    });
    const res = await generateAiSuggestions("page-1", "seo");
    expect(res!.suggestions).toHaveLength(1);
    expect(res!.suggestions[0]).toMatchObject({
      target: "focusKeyword",
      value: "rome travel",
      apply: "field",
    });
  });

  it("defaults a field suggestion's label to its target when none is given", async () => {
    mockModelJson({
      suggestions: [{ target: "excerpt", value: "A snappy excerpt." }],
    });
    const res = await generateAiSuggestions("page-1", "metadata");
    expect(res!.suggestions[0].label).toBe("excerpt");
  });

  it("validates every allowed field target round-trips", async () => {
    mockModelJson({
      suggestions: AI_FIELD_TARGETS.map((t) => ({
        target: t,
        value: `value-for-${t}`,
      })),
    });
    const res = await generateAiSuggestions("page-1", "metadata");
    expect(res!.suggestions.map((s) => s.target)).toEqual([
      ...AI_FIELD_TARGETS,
    ]);
  });
});

describe("faq suggestions", () => {
  it("keeps only Q&A pairs that have both a question and an answer", async () => {
    mockModelJson({
      suggestions: [
        { question: "How long in Rome?", answer: "A day is enough for highlights." },
        { question: "Missing answer?", answer: "  " },
        { question: "  ", answer: "Missing question" },
        { detail: "neither" },
      ],
    });
    const res = await generateAiSuggestions("page-1", "faq");
    expect(res!.suggestions).toHaveLength(1);
    expect(res!.suggestions[0]).toMatchObject({
      apply: "faq",
      label: "How long in Rome?",
      question: "How long in Rome?",
      answer: "A day is enough for highlights.",
      target: null,
      value: null,
    });
  });
});

describe("info suggestions (ungrounded)", () => {
  it("keeps social captions and falls back the label to the value", async () => {
    mockModelJson({
      suggestions: [
        { label: "X", value: "See Rome in a day! #travel" },
        { value: "A caption with no label that is rather long indeed yes" },
        { label: "", value: "" }, // dropped: no label and no value
      ],
    });
    const res = await generateAiSuggestions("page-1", "social");
    expect(res!.suggestions).toHaveLength(2);
    expect(res!.suggestions[0]).toMatchObject({
      apply: "info",
      label: "X",
      value: "See Rome in a day! #travel",
      target: null,
    });
    // label falls back to the first 60 chars of value
    expect(res!.suggestions[1].label).toBe(
      "A caption with no label that is rather long indeed yes",
    );
  });
});

describe("grounded suggestions — candidate validation", () => {
  const candidates = [
    { title: "Vatican Guide", pathname: "/blog/vatican-guide/", excerpt: null },
    { title: "Colosseum Tips", pathname: "/blog/colosseum-tips/", excerpt: null },
  ];

  for (const kind of ["related", "duplicate", "internal-links"] as const) {
    it(`(${kind}) drops suggestions referencing a non-candidate path`, async () => {
      h.candidates = candidates;
      mockModelJson({
        suggestions: [
          { label: "Vatican Guide", value: "/blog/vatican-guide/" },
          // invented path — not in the candidate list, must be dropped
          { label: "Made Up", value: "/blog/this-does-not-exist/" },
        ],
      });
      const res = await generateAiSuggestions("page-1", kind);
      expect(res!.suggestions).toHaveLength(1);
      expect(res!.suggestions[0].value).toBe("/blog/vatican-guide/");
    });
  }

  it("rewrites a normalized/variant path back to the exact stored pathname", async () => {
    h.candidates = candidates;
    mockModelJson({
      suggestions: [
        // no trailing slash
        { label: "Vatican", value: "/blog/vatican-guide" },
        // full absolute URL with a trailing slash
        {
          label: "Colosseum",
          value: "https://www.headout.com/blog/colosseum-tips/",
        },
      ],
    });
    const res = await generateAiSuggestions("page-1", "related");
    expect(res!.suggestions.map((s) => s.value)).toEqual([
      "/blog/vatican-guide/",
      "/blog/colosseum-tips/",
    ]);
  });

  it("drops every grounded suggestion when no candidates are available", async () => {
    h.candidates = [];
    mockModelJson({
      suggestions: [{ label: "Anything", value: "/blog/vatican-guide/" }],
    });
    const res = await generateAiSuggestions("page-1", "internal-links");
    expect(res!.suggestions).toHaveLength(0);
  });

  it("does not ground (accepts any value) for ungrounded info kinds", async () => {
    h.candidates = candidates;
    mockModelJson({
      suggestions: [{ label: "Passive voice", value: "Rewrite this sentence." }],
    });
    const res = await generateAiSuggestions("page-1", "readability");
    expect(res!.suggestions).toHaveLength(1);
    expect(res!.suggestions[0].value).toBe("Rewrite this sentence.");
  });
});

describe("prompt assembly", () => {
  it("includes the article context and the per-kind instruction", async () => {
    mockModelJson({ suggestions: [] });
    await generateAiSuggestions("page-1", "seo");
    const prompt = lastUserPrompt();
    expect(prompt).toContain("Title: Rome in a Day");
    expect(prompt).toContain("TASK:");
    expect(prompt).toContain("search metadata");
  });

  it("appends the candidate list for grounded kinds", async () => {
    h.candidates = [
      { title: "Vatican Guide", pathname: "/blog/vatican-guide/", excerpt: null },
    ];
    mockModelJson({ suggestions: [] });
    await generateAiSuggestions("page-1", "related");
    const prompt = lastUserPrompt();
    expect(prompt).toContain("CANDIDATE ARTICLES");
    expect(prompt).toContain("Vatican Guide — /blog/vatican-guide/");
  });

  it("shows '(none available)' when a grounded kind has no candidates", async () => {
    h.candidates = [];
    mockModelJson({ suggestions: [] });
    await generateAiSuggestions("page-1", "duplicate");
    expect(lastUserPrompt()).toContain("(none available)");
  });

  it("does not include a candidate list for ungrounded kinds", async () => {
    mockModelJson({ suggestions: [] });
    await generateAiSuggestions("page-1", "seo");
    expect(lastUserPrompt()).not.toContain("CANDIDATE ARTICLES");
  });

  it("requests JSON output from the configured model", async () => {
    mockModelJson({ suggestions: [] });
    const res = await generateAiSuggestions("page-1", "summary");
    const args = h.create.mock.calls.at(-1)?.[0] as {
      model: string;
      response_format: { type: string };
    };
    expect(args.response_format).toEqual({ type: "json_object" });
    expect(res!.model).toBe(args.model);
  });
});

describe("malformed model output", () => {
  it("returns an empty suggestion list and a fallback summary on invalid JSON", async () => {
    mockModelRaw("this is not json");
    const res = await generateAiSuggestions("page-1", "seo");
    expect(res!.suggestions).toEqual([]);
    expect(res!.summary).toMatch(/unexpected response/i);
    expect(res!.kind).toBe("seo");
  });

  it("tolerates a missing suggestions array", async () => {
    mockModelJson({ summary: "nothing to add" });
    const res = await generateAiSuggestions("page-1", "readability");
    expect(res!.suggestions).toEqual([]);
    expect(res!.summary).toBe("nothing to add");
  });

  it("handles an empty message content (treated as invalid JSON)", async () => {
    h.create.mockResolvedValue({ choices: [{ message: { content: "" } }] });
    const res = await generateAiSuggestions("page-1", "seo");
    expect(res!.suggestions).toEqual([]);
    expect(res!.summary).toMatch(/unexpected response/i);
  });
});

describe("result envelope", () => {
  it("echoes the requested kind for every supported kind", async () => {
    mockModelJson({ suggestions: [] });
    for (const kind of AI_SUGGESTION_KINDS) {
      const res = await generateAiSuggestions("page-1", kind);
      expect(res!.kind).toBe(kind);
    }
  });
});
