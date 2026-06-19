import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { HeldBackArticle } from "@workspace/api-client-react";
import type {
  ReextractEvent,
  ReextractResultEvent,
} from "../../lib/reextract-client";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// ArticleDrawer ticks an elapsed timer via `window.setInterval` while a
// re-extract runs. The suite runs in the node env (matching held-back.test.tsx),
// where `window` is undefined, so provide a no-op timer shim. Returning a fake
// id with a no-op interval keeps the elapsed counter from firing state updates
// outside `act`, while still letting the running UI render.
(globalThis as unknown as { window: unknown }).window = {
  setInterval: () => 0,
  clearInterval: () => {},
};

// Capture the AbortSignal + event sink handed to the mocked stream so the test
// can assert the controller is aborted and drive progress/error/result events.
const h = vi.hoisted(() => ({
  captured: {
    signal: null as AbortSignal | null,
    onEvent: null as ((event: ReextractEvent) => void) | null,
  },
}));

// `held-back.tsx` pulls in the whole CMS dependency graph at module load. The
// stateful `ArticleDrawer` is under test, so the `@/`-aliased modules (the alias
// isn't wired into the vitest resolver), the generated API client, and the
// portal-backed Sheet are stubbed. `streamReextract` returns a never-resolving
// promise so the stream stays in-flight until the article switches or unmounts.
vi.mock("@/lib/reextract-client", () => ({
  streamReextract: vi.fn(
    (
      _articleId: string,
      onEvent: (event: ReextractEvent) => void,
      signal: AbortSignal,
    ) => {
      h.captured.signal = signal;
      h.captured.onEvent = onEvent;
      return new Promise<void>(() => {});
    },
  ),
}));
vi.mock("@/lib/cms-auth-context", () => ({
  useCmsAuth: () => ({ can: () => true }),
}));
vi.mock("@/components/source-diff", () => ({ SourceDiff: () => null }));
vi.mock("@/hooks/use-debounced-value", () => ({
  useDebouncedValue: (value: unknown) => value,
}));

vi.mock("@workspace/blog-renderer", () => ({ ContentRenderer: () => null }));
vi.mock("@workspace/ui", () => ({
  useToast: () => ({ toast: vi.fn() }),
  cn: (...args: unknown[]) =>
    args
      .flat(Infinity)
      .filter((v) => typeof v === "string" && v)
      .join(" "),
}));

// The Sheet wraps its content in a Radix dialog portal (needs a real document),
// so render its parts as plain passthrough wrappers in the node env.
vi.mock("@workspace/ui/sheet", () => {
  const pass =
    (tag: string) =>
    ({ children }: { children?: unknown }) =>
      createElement(tag, null, children as never);
  return {
    Sheet: pass("div"),
    SheetContent: pass("div"),
    SheetHeader: pass("div"),
    SheetFooter: pass("div"),
    SheetTitle: pass("div"),
    SheetDescription: pass("div"),
    SheetPortal: pass("div"),
    SheetOverlay: pass("div"),
    SheetTrigger: pass("div"),
    SheetClose: pass("div"),
  };
});
vi.mock("@workspace/ui/separator", () => ({ Separator: () => null }));
vi.mock("@workspace/ui/badge", () => ({
  Badge: ({ children }: { children?: unknown }) =>
    createElement("span", null, children as never),
}));
vi.mock("@workspace/ui/skeleton", () => ({ Skeleton: () => null }));
vi.mock("@workspace/ui/textarea", () => ({ Textarea: () => null }));

vi.mock("@workspace/api-client-react", () => ({
  useResolveCmsHeldBackArticle: () => ({ mutate: vi.fn(), isPending: false }),
  useReparseCmsHeldBackArticle: () => ({ mutate: vi.fn(), isPending: false }),
  useGetCmsHeldBackArticleSource: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
  }),
  useListCmsAuditLogs: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
  }),
  getListCmsHeldBackArticlesQueryKey: () => ["held-back"],
  getGetCmsHeldBackArticleSourceQueryKey: () => ["held-back-source"],
  getListCmsAuditLogsQueryKey: () => ["audit"],
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// Imported after the mocks are registered.
import { ArticleDrawer } from "../held-back";
import { streamReextract } from "@/lib/reextract-client";

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

/** The "Re-extract" button inside the drawer footer's ReextractPanel. */
function reextractButton(
  renderer: TestRenderer.ReactTestRenderer,
): RenderedNode {
  const buttons = findAll(
    renderer.toJSON(),
    (n) => n.type === "button" && textOf(n).includes("Re-extract"),
  );
  if (buttons.length !== 1) {
    throw new Error(
      `expected exactly one Re-extract button, found ${buttons.length}`,
    );
  }
  return buttons[0];
}

function makeArticle(id: string): HeldBackArticle {
  return {
    id,
    slug: `article-${id}`,
    title: `Article ${id}`,
    url: `https://www.headout.com/blog/article-${id}/`,
    pageType: "post",
    language: "en",
    validationStatus: "fail",
    validationScore: 40,
    issues: [],
  } as unknown as HeldBackArticle;
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

const IDLE_HELPER = "Re-fetches the original URL and re-runs extraction";

function render(
  article: HeldBackArticle | null,
): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      createElement(ArticleDrawer, {
        article,
        open: true,
        onOpenChange: vi.fn(),
      }),
    );
  });
  return renderer;
}

function startReextract(renderer: TestRenderer.ReactTestRenderer) {
  const onClick = reextractButton(renderer).props.onClick as () => void;
  act(() => {
    onClick();
  });
}

beforeEach(() => {
  h.captured.signal = null;
  h.captured.onEvent = null;
  vi.mocked(streamReextract).mockClear();
});

describe("ArticleDrawer — re-extract lifecycle", () => {
  it("aborts the in-flight stream and clears stage/error/result/elapsed when a different article is shown", () => {
    const renderer = render(makeArticle("a1"));

    startReextract(renderer);

    // The stream is in-flight against article a1 and not yet aborted.
    expect(streamReextract).toHaveBeenCalledTimes(1);
    expect(h.captured.signal).toBeInstanceOf(AbortSignal);
    expect(h.captured.signal?.aborted).toBe(false);

    // Drive a progress stage plus error + result events. The error and result
    // are stored but stay hidden behind the running stepper; if the reset
    // failed they would resurface (the error takes precedence) after the
    // article switch instead of the idle helper.
    act(() => {
      h.captured.onEvent?.({ type: "progress", stage: "parsing" });
      h.captured.onEvent?.({
        type: "error",
        code: "x",
        message: "Stale error from article a1",
      });
      h.captured.onEvent?.(makeResult());
    });
    expect(textOf(renderer.toJSON())).toContain("Re-extracting");

    // Switch to a different article.
    act(() => {
      renderer.update(
        createElement(ArticleDrawer, {
          article: makeArticle("b1"),
          open: true,
          onOpenChange: vi.fn(),
        }),
      );
    });

    // The controller for article a1's stream is aborted.
    expect(h.captured.signal?.aborted).toBe(true);

    // The panel is back to its idle state: no running stepper, and no stale
    // error or result copy — proving stage, error, and result were all reset.
    const text = textOf(renderer.toJSON());
    expect(text).toContain(IDLE_HELPER);
    expect(text).not.toContain("Re-extracting");
    expect(text).not.toContain("Stale error from article a1");
    expect(text).not.toContain("still held back");
    expect(text).not.toContain("Elapsed");
  });

  it("aborts the in-flight stream on unmount", () => {
    const renderer = render(makeArticle("a1"));

    startReextract(renderer);
    expect(h.captured.signal?.aborted).toBe(false);

    act(() => {
      renderer.unmount();
    });

    expect(h.captured.signal?.aborted).toBe(true);
  });
});
