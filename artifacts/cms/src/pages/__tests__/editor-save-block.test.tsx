import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { SeoCheck } from "@workspace/seo-validation";
import type { CmsPostDetail } from "@workspace/api-client-react";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// EditorBody registers a keydown listener on `window` in an effect; the node
// test env has no `window`, so stub the two methods it touches.
vi.stubGlobal("window", {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
});

// Capture the `onError` handler the editor hands to `useUpdateCmsPost` so the
// test can drive the save outcome, plus the `toast` spy so the generic-toast
// fallthrough can be asserted.
const h = vi.hoisted(() => ({
  captured: {
    onError: null as ((err: unknown) => void) | null,
  },
  toast: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/editor", vi.fn()],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: h.invalidateQueries }),
}));

vi.mock("@workspace/ui", () => ({
  useToast: () => ({ toast: h.toast }),
}));

vi.mock("@/lib/cms-auth-context", () => ({
  useCmsAuth: () => ({ can: () => true }),
}));

// The editor's save mutation: capture the onError handler. The other read
// hooks are inert.
vi.mock("@workspace/api-client-react", () => ({
  useUpdateCmsPost: (opts: { mutation: { onError: (err: unknown) => void } }) => {
    h.captured.onError = opts.mutation.onError;
    return { mutate: vi.fn(), isPending: false };
  },
  useGetCmsPost: () => ({ data: undefined, isLoading: false, isError: false }),
  useGetCmsPostSource: () => ({ data: undefined, isLoading: false, isError: false }),
  useGetCmsPostAnalytics: () => ({ data: undefined, isLoading: false, isError: false }),
  useRecordCmsAiDecision: () => ({ mutate: vi.fn(), isPending: false }),
  useSuggestCmsAi: () => ({ mutate: vi.fn(), isPending: false }),
  getGetCmsPostAnalyticsQueryKey: () => ["analytics"],
  getGetCmsPostQueryKey: () => ["post"],
  getGetCmsPostSourceQueryKey: () => ["source"],
  getListCmsPostQueryKey: () => ["posts"],
}));

// The PublishPanel pulls in its own mutations/UI — stub it inert so this test
// focuses on the editor's own save path. extractPublishBlock and the real
// PublishBlockDialog stay live.
vi.mock("@/editor/publish-panel", async () => {
  const actual = await vi.importActual<typeof import("../../editor/publish-panel")>(
    "../../editor/publish-panel",
  );
  return {
    extractPublishBlock: actual.extractPublishBlock,
    PublishBlockDialog: actual.PublishBlockDialog,
    PublishPanel: () => null,
  };
});

vi.mock("@/editor/seo-panel", () => ({ SeoPanel: () => null }));
vi.mock("@/components/source-diff", () => ({ SourceDiff: () => null }));
vi.mock("@/editor/canvas", () => ({ EditorCanvas: () => null }));
vi.mock("@/editor/preview", () => ({ EditorPreview: () => null }));
vi.mock("@/editor/link-assistant", () => ({
  LinkPickerProvider: ({ children }: { children?: unknown }) =>
    createElement("div", null, children as never),
}));
vi.mock("@/editor/block-editors", () => ({
  ImageUploadButton: () => null,
  LibraryButton: () => null,
}));

vi.mock("@/editor/use-editor", () => ({
  useEditor: () => ({
    blocks: [],
    canUndo: false,
    canRedo: false,
    undo: vi.fn(),
    redo: vi.fn(),
  }),
}));

vi.mock("@/editor/model", () => ({
  blocksFromDetail: () => [],
  buildEditorValidationInput: () => ({}),
  detailToInput: () => ({}),
  initialSeoState: () => ({}),
}));

vi.mock("@workspace/seo-validation", () => ({
  validateSeo: () => ({ blocking: [] }),
}));

// Radix dialog/sheet portals need a real document; render them as plain
// passthroughs. The Dialog mock respects `open` so the block dialog's contents
// only appear once a publish block is set.
vi.mock("@workspace/ui/dialog", () => {
  const pass =
    (tag: string) =>
    ({ children }: { children?: unknown }) =>
      createElement(tag, null, children as never);
  return {
    Dialog: ({ open, children }: { open?: boolean; children?: unknown }) =>
      open ? createElement("div", null, children as never) : null,
    DialogContent: pass("div"),
    DialogHeader: pass("div"),
    DialogFooter: pass("div"),
    DialogTitle: pass("div"),
    DialogDescription: pass("div"),
  };
});
vi.mock("@workspace/ui/button", () => ({
  Button: ({
    children,
    onClick,
  }: {
    children?: unknown;
    onClick?: () => void;
  }) => createElement("button", { onClick }, children as never),
}));
vi.mock("@workspace/ui/input", () => ({ Input: () => null }));
vi.mock("@workspace/ui/textarea", () => ({ Textarea: () => null }));
vi.mock("@workspace/ui/skeleton", () => ({ Skeleton: () => null }));
vi.mock("@workspace/ui/sheet", () => {
  const pass =
    (tag: string) =>
    ({ children }: { children?: unknown }) =>
      createElement(tag, null, children as never);
  return {
    Sheet: pass("div"),
    SheetContent: pass("div"),
    SheetDescription: pass("div"),
    SheetHeader: pass("div"),
    SheetTitle: pass("div"),
  };
});

// Imported after the mocks are registered.
import { EditorBody } from "../editor";

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

function makeDetail(): CmsPostDetail {
  return {
    id: "post-1",
    slug: "some-article",
    title: "Some Article",
    subtitle: null,
    excerpt: null,
    status: "draft",
    scheduledFor: null,
    originalUrl: null,
    featuredImageUrl: null,
    featuredImageAlt: null,
    pathname: "/blog/some-article",
    canonicalUrl: "https://www.headout.com/blog/some-article",
    redirects: [],
  } as unknown as CmsPostDetail;
}

function makeCheck(overrides: Partial<SeoCheck> = {}): SeoCheck {
  return {
    id: "title-missing",
    label: "Title is missing",
    severity: "error",
    message: "Add an SEO title between 30 and 60 characters.",
    ...overrides,
  } as SeoCheck;
}

/** Build the orval-style 422 error the publish gate returns. */
function blockError(blocking: SeoCheck[], error?: string) {
  return {
    status: 422,
    data: { error, blocking },
  };
}

function render(): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      createElement(EditorBody, { detail: makeDetail(), canEdit: true }),
    );
  });
  return renderer;
}

beforeEach(() => {
  h.captured.onError = null;
  h.toast.mockClear();
  h.invalidateQueries.mockClear();
});

describe("EditorBody — main save publish-gate block", () => {
  it("renders the block dialog (not the generic toast) when the save returns a 422 publish block", () => {
    const renderer = render();

    const checks = [
      makeCheck({
        id: "title-missing",
        label: "Title is missing",
        message: "Add an SEO title between 30 and 60 characters.",
      }),
      makeCheck({
        id: "description-too-short",
        label: "Description too short",
        message: "The meta description is shorter than 70 characters.",
      }),
    ];

    act(() => {
      h.captured.onError?.(
        blockError(checks, "This article has critical SEO issues."),
      );
    });

    const text = textOf(renderer.toJSON());
    expect(text).toContain("SEO issues blocking publish");
    expect(text).toContain("This article has critical SEO issues.");
    for (const c of checks) {
      expect(text).toContain(c.label);
      expect(text).toContain(c.message);
    }
    // The generic autosave-failed toast must NOT fire for a publish-gate block.
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("falls through to the generic toast for a non-422 error", () => {
    const renderer = render();

    act(() => {
      h.captured.onError?.(new Error("Internal Server Error"));
    });

    const text = textOf(renderer.toJSON());
    expect(text).not.toContain("SEO issues blocking publish");
    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(h.toast).toHaveBeenCalledWith({
      title: "Autosave failed",
      description: "Your latest changes weren't saved.",
      variant: "destructive",
    });
  });

  it("falls through to the generic toast for a 422 with an empty blocking list", () => {
    const renderer = render();

    act(() => {
      h.captured.onError?.(blockError([]));
    });

    const text = textOf(renderer.toJSON());
    expect(text).not.toContain("SEO issues blocking publish");
    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(h.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Autosave failed",
        variant: "destructive",
      }),
    );
  });
});
