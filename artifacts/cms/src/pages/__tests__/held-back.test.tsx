import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import type {
  ReextractResultEvent,
  ReextractStage,
} from "../../lib/reextract-client";

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
import { ReextractPanel, reparseVerdictToast } from "../held-back";
import type { ReparseHeldBackArticleResponse } from "@workspace/api-client-react";

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

interface RenderedNode {
  type: string;
  props: Record<string, unknown>;
  children?: unknown;
}

function isRenderedNode(node: unknown): node is RenderedNode {
  return (
    typeof node === "object" &&
    node !== null &&
    typeof (node as { type?: unknown }).type === "string"
  );
}

/** Collect every element node matching `predicate`, depth-first. */
function findAll(
  node: unknown,
  predicate: (n: RenderedNode) => boolean,
): RenderedNode[] {
  const out: RenderedNode[] = [];
  function visit(n: unknown) {
    if (n == null) return;
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (isRenderedNode(n)) {
      if (predicate(n)) out.push(n);
      visit(n.children);
    }
  }
  visit(node);
  return out;
}

type StepState = "done" | "active" | "pending";

/** Classify a stepper `<li>` by its rendered marker. */
function stepStateOf(li: RenderedNode): StepState {
  if (li.props["aria-current"] === "step") return "active";
  if (rawText(li).includes("✓")) return "done";
  return "pending";
}

/** Map each stepper row to `{ label, state }` in render order. */
function stepRows(renderer: TestRenderer.ReactTestRenderer) {
  return findAll(renderer.toJSON(), (n) => n.type === "li").map((li) => ({
    label: textOf(li),
    state: stepStateOf(li),
  }));
}

function renderPanel(
  props: Partial<{
    stage: ReextractStage | null;
    elapsedMs: number;
    error: string | null;
    result: ReextractResultEvent | null;
    disabled: boolean;
  }> = {},
): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      createElement(ReextractPanel, {
        stage: null,
        elapsedMs: 0,
        error: null,
        result: null,
        onReextract: vi.fn(),
        disabled: false,
        ...props,
      }),
    );
  });
  return renderer;
}

const IDLE_HELPER =
  "Re-fetches the original URL and re-runs extraction";

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

describe("ReextractPanel — live progress stepper", () => {
  it("marks earlier stages done, the current stage active, and later stages pending", () => {
    // "parsing" is the 3rd stage (index 2) of 5.
    const renderer = renderPanel({ stage: "parsing", elapsedMs: 3400 });
    const rows = stepRows(renderer);

    expect(rows.map((r) => r.state)).toEqual([
      "done", // Loading article
      "done", // Fetching source
      "active", // Parsing content
      "pending", // Validating
      "pending", // Saving
    ]);

    const active = rows.find((r) => r.state === "active");
    expect(active?.label).toContain("Parsing content");
  });

  it("marks every stage pending while the first stage is active", () => {
    const renderer = renderPanel({ stage: "loading", elapsedMs: 0 });
    const rows = stepRows(renderer);

    expect(rows.map((r) => r.state)).toEqual([
      "active", // Loading article
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("marks all earlier stages done when the final stage is active", () => {
    const renderer = renderPanel({ stage: "storing", elapsedMs: 12000 });
    const rows = stepRows(renderer);

    expect(rows.map((r) => r.state)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "active", // Saving
    ]);
  });

  it("renders the elapsed-time line while running", () => {
    const text = textOf(renderPanel({ stage: "validating", elapsedMs: 3400 }).toJSON());
    expect(text).toContain("Elapsed 3.4s");
    expect(text).toContain("times out at 90s");
  });

  it("hides the idle helper text and result/error copy while running", () => {
    const text = textOf(renderPanel({ stage: "fetching", elapsedMs: 500 }).toJSON());
    expect(text).not.toContain(IDLE_HELPER);
    expect(text).not.toContain("still held back");
    expect(text).not.toContain("left the queue");
  });
});

describe("ReextractPanel — error state", () => {
  it("shows the failure message and nothing from the other states", () => {
    const text = textOf(
      renderPanel({
        stage: null,
        error: "The article could not be reached (HTTP 503).",
      }).toJSON(),
    );
    expect(text).toContain("The article could not be reached (HTTP 503).");
    // The idle helper, the running stepper, and any result copy must be gone.
    expect(text).not.toContain(IDLE_HELPER);
    expect(text).not.toContain("Elapsed");
    expect(text).not.toContain("left the queue");
    expect(text).not.toContain("still held back");
  });

  it("renders the message in the destructive style", () => {
    const renderer = renderPanel({
      stage: null,
      error: "Re-extract failed.",
    });
    const destructive = findAll(
      renderer.toJSON(),
      (n) =>
        n.type === "p" &&
        typeof n.props.className === "string" &&
        n.props.className.includes("text-destructive"),
    );
    expect(destructive).toHaveLength(1);
    expect(textOf(destructive[0])).toContain("Re-extract failed.");
  });
});

describe("ReextractPanel — idle state", () => {
  it("shows the explanatory helper text when nothing has run", () => {
    const text = textOf(renderPanel().toJSON());
    expect(text).toContain(IDLE_HELPER);
    expect(text).toContain(
      "If it now passes validation it leaves the queue automatically.",
    );
    // None of the running/error/result copy leaks into the idle state.
    expect(text).not.toContain("Elapsed");
    expect(text).not.toContain("still held back");
    expect(text).not.toContain("The extracted content");
  });
});

function makeReparseResult(
  overrides: Partial<ReparseHeldBackArticleResponse> = {},
): ReparseHeldBackArticleResponse {
  return {
    mode: "reparse",
    validationStatus: "fail",
    validationScore: 42,
    ...overrides,
  } as ReparseHeldBackArticleResponse;
}

describe("reparseVerdictToast — title by mode", () => {
  it('mode "edit" titles the toast "Edited body re-checked"', () => {
    const { title } = reparseVerdictToast(makeReparseResult({ mode: "edit" }));
    expect(title).toBe("Edited body re-checked");
  });

  it('mode "reparse" titles the toast "Re-parsed"', () => {
    const { title } = reparseVerdictToast(
      makeReparseResult({ mode: "reparse" }),
    );
    expect(title).toBe("Re-parsed");
  });
});

describe("reparseVerdictToast — description by validation status", () => {
  it("fail reports it is still failing and includes the score", () => {
    const { description } = reparseVerdictToast(
      makeReparseResult({ validationStatus: "fail", validationScore: 42 }),
    );
    expect(description).toContain("Still failing");
    expect(description).toContain("score 42");
    expect(description).not.toContain("can be published");
  });

  it("pass reports it is now passing and can be published, with the score", () => {
    const { description } = reparseVerdictToast(
      makeReparseResult({ validationStatus: "pass", validationScore: 95 }),
    );
    expect(description).toContain("Now passing");
    expect(description).toContain("score 95");
    expect(description).toContain("can be published");
    expect(description).not.toContain("warning-only");
  });

  it("warn reports it is now warning-only and can be published, with the score", () => {
    const { description } = reparseVerdictToast(
      makeReparseResult({ validationStatus: "warn", validationScore: 80 }),
    );
    expect(description).toContain("Now warning-only");
    expect(description).toContain("score 80");
    expect(description).toContain("can be published");
    expect(description).not.toContain("passing");
  });
});
