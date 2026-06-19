import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { ReextractResultEvent } from "../../lib/reextract-client";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// `held-back.tsx` pulls in the whole CMS dependency graph at module load. Only
// `ReextractPanel` (a pure presentational component) is under test here, so the
// `@/`-aliased modules (the alias isn't wired into the vitest resolver) and the
// heavy generated API client are stubbed. The real `@workspace/ui/button` and
// lucide icons render so the assertions exercise the actual outcome copy.
vi.mock("@workspace/api-client-react", () => ({}));
vi.mock("@workspace/blog-renderer", () => ({ ContentRenderer: () => null }));
vi.mock("@workspace/ui", () => ({
  useToast: () => ({ toast: vi.fn() }),
  cn: (...args: unknown[]) =>
    args
      .flat(Infinity)
      .filter((v) => typeof v === "string" && v)
      .join(" "),
}));
vi.mock("@/lib/reextract-client", () => ({ streamReextract: vi.fn() }));
vi.mock("@/lib/cms-auth-context", () => ({
  useCmsAuth: () => ({ can: () => true }),
}));
vi.mock("@/components/source-diff", () => ({ SourceDiff: () => null }));
vi.mock("@/hooks/use-debounced-value", () => ({
  useDebouncedValue: (value: unknown) => value,
}));

// Imported after the mocks are registered.
import { ReextractPanel } from "../held-back";

/** Recursively join every string node in a react-test-renderer JSON tree. */
function rawText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(rawText).join(" ");
  return rawText((node as { children?: unknown }).children);
}

/** Visible text with runs of whitespace collapsed, as a reader would see it. */
function textOf(node: unknown): string {
  return rawText(node).replace(/\s+/g, " ").trim();
}

function makeResult(
  overrides: Partial<ReextractResultEvent> = {},
): ReextractResultEvent {
  return {
    type: "result",
    pageId: "page-1",
    slug: "some-article",
    url: "https://www.headout.com/blog/some-article/",
    changed: true,
    validationStatus: "fail",
    validationScore: 42,
    pageStatus: "draft",
    heldBack: true,
    ...overrides,
  };
}

function renderResult(result: ReextractResultEvent): string {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      createElement(ReextractPanel, {
        stage: null,
        elapsedMs: 0,
        error: null,
        result,
        onReextract: vi.fn(),
        disabled: false,
      }),
    );
  });
  return textOf(renderer.toJSON());
}

describe("ReextractPanel — changed note", () => {
  it("reports the extracted content changed when changed=true", () => {
    const text = renderResult(makeResult({ changed: true }));
    expect(text).toContain("The extracted content changed.");
    expect(text).not.toContain("The extracted content is unchanged.");
  });

  it("reports the extracted content unchanged when changed=false", () => {
    const text = renderResult(makeResult({ changed: false }));
    expect(text).toContain("The extracted content is unchanged.");
    expect(text).not.toContain("The extracted content changed.");
  });
});

describe("ReextractPanel — held-back outcome message", () => {
  it("still held back shows the validation status and score", () => {
    const text = renderResult(
      makeResult({
        heldBack: true,
        validationStatus: "fail",
        validationScore: 42,
      }),
    );
    expect(text).toContain("still held back");
    expect(text).toContain("validation: fail");
    expect(text).toContain("score 42");
    expect(text).not.toContain("left the queue");
  });

  it("cleared the queue shows it passed validation and left the queue", () => {
    const text = renderResult(
      makeResult({
        heldBack: false,
        validationStatus: "pass",
        validationScore: 95,
      }),
    );
    expect(text).toContain("it passed validation and left the queue");
    expect(text).not.toContain("still held back");
    // No validation status/score is surfaced once it has cleared the queue.
    expect(text).not.toContain("validation: pass");
    expect(text).not.toContain("score 95");
  });
});
