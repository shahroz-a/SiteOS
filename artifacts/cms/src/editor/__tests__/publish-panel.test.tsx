import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { SeoCheck } from "@workspace/seo-validation";
import type { CmsPostDetail } from "@workspace/api-client-react";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Capture the `onError`/`onSuccess` handlers the panel hands to
// `useTransitionCmsPost` so the test can drive the mutation outcome, plus the
// `toast` spy so the generic-toast fallthrough can be asserted.
const h = vi.hoisted(() => ({
  captured: {
    onError: null as ((err: unknown) => void) | null,
    onSuccess: null as ((data: unknown, vars: unknown) => void) | null,
  },
  toast: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock("@/lib/cms-auth-context", () => ({
  useCmsAuth: () => ({ can: () => true }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: h.invalidateQueries }),
}));

vi.mock("@workspace/ui", () => ({
  useToast: () => ({ toast: h.toast }),
}));

// The panel's mutations: capture the transition handlers; the other two are
// inert (their buttons aren't exercised here).
vi.mock("@workspace/api-client-react", () => ({
  useTransitionCmsPost: (opts: {
    mutation: {
      onError: (err: unknown) => void;
      onSuccess: (data: unknown, vars: unknown) => void;
    };
  }) => {
    h.captured.onError = opts.mutation.onError;
    h.captured.onSuccess = opts.mutation.onSuccess;
    return { mutate: vi.fn(), isPending: false };
  },
  useCreateCmsPreviewLink: () => ({ mutate: vi.fn(), isPending: false }),
  useChangeCmsPostUrl: () => ({ mutate: vi.fn(), isPending: false }),
  getGetCmsPostQueryKey: () => ["post"],
  getListCmsPostQueryKey: () => ["posts"],
}));

// Radix dialog/dropdown portals need a real document; in the node env render
// them as plain passthrough wrappers. The Dialog mock respects the `open` prop
// so the block dialog's contents only appear once `block` is set.
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
vi.mock("@workspace/ui/dropdown-menu", () => {
  const pass =
    (tag: string) =>
    ({ children }: { children?: unknown }) =>
      createElement(tag, null, children as never);
  return {
    DropdownMenu: pass("div"),
    DropdownMenuTrigger: pass("div"),
    DropdownMenuContent: pass("div"),
    DropdownMenuItem: ({
      children,
      onClick,
    }: {
      children?: unknown;
      onClick?: () => void;
    }) => createElement("button", { onClick }, children as never),
    DropdownMenuSeparator: () => null,
    DropdownMenuLabel: pass("div"),
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
vi.mock("@workspace/ui/label", () => ({
  Label: ({ children }: { children?: unknown }) =>
    createElement("label", null, children as never),
}));
vi.mock("@workspace/ui/badge", () => ({
  Badge: ({ children }: { children?: unknown }) =>
    createElement("span", null, children as never),
}));

// Imported after the mocks are registered.
import { PublishPanel, extractPublishBlock } from "../publish-panel";

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
    status: "draft",
    scheduledFor: null,
    originalUrl: null,
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
      createElement(PublishPanel, { detail: makeDetail() }),
    );
  });
  return renderer;
}

beforeEach(() => {
  h.captured.onError = null;
  h.captured.onSuccess = null;
  h.toast.mockClear();
  h.invalidateQueries.mockClear();
});

describe("PublishPanel — publish-gate block dialog", () => {
  it("renders each blocking reason (label + message) in the dialog, not the generic toast", () => {
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
    // The block dialog is open with its heading and the server-supplied message.
    expect(text).toContain("SEO issues blocking publish");
    expect(text).toContain("This article has critical SEO issues.");
    // Every blocking reason — both label and message — is listed.
    for (const c of checks) {
      expect(text).toContain(c.label);
      expect(text).toContain(c.message);
    }
    // The generic failure toast must NOT fire for a publish-gate block.
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("falls back to the server-default message when the 422 body omits `error`", () => {
    const renderer = render();

    act(() => {
      h.captured.onError?.(blockError([makeCheck()]));
    });

    const text = textOf(renderer.toJSON());
    expect(text).toContain(
      "This article has critical SEO issues that must be fixed before publishing.",
    );
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("falls through to the generic toast for a non-422 error", () => {
    const renderer = render();

    act(() => {
      h.captured.onError?.(new Error("Internal Server Error"));
    });

    const text = textOf(renderer.toJSON());
    // No block dialog is shown.
    expect(text).not.toContain("SEO issues blocking publish");
    // The generic destructive toast carries the error message.
    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(h.toast).toHaveBeenCalledWith({
      title: "Transition failed",
      description: "Internal Server Error",
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
        title: "Transition failed",
        variant: "destructive",
      }),
    );
  });
});

describe("extractPublishBlock — parser", () => {
  it("parses a well-formed 422 block with the server message", () => {
    const checks = [makeCheck()];
    const result = extractPublishBlock(blockError(checks, "Critical issues."));
    expect(result).not.toBeNull();
    expect(result?.message).toBe("Critical issues.");
    expect(result?.blocking).toEqual(checks);
  });

  it("substitutes the default message when `error` is missing or blank", () => {
    const fallback =
      "This article has critical SEO issues that must be fixed before publishing.";
    expect(extractPublishBlock(blockError([makeCheck()]))?.message).toBe(
      fallback,
    );
    expect(
      extractPublishBlock(blockError([makeCheck()], "   "))?.message,
    ).toBe(fallback);
  });

  it("returns null for non-422 statuses", () => {
    expect(
      extractPublishBlock({ status: 500, data: { blocking: [makeCheck()] } }),
    ).toBeNull();
    expect(
      extractPublishBlock({ status: 400, data: { blocking: [makeCheck()] } }),
    ).toBeNull();
  });

  it("returns null for malformed or empty payloads", () => {
    expect(extractPublishBlock(null)).toBeNull();
    expect(extractPublishBlock(undefined)).toBeNull();
    expect(extractPublishBlock("nope")).toBeNull();
    expect(extractPublishBlock(42)).toBeNull();
    expect(extractPublishBlock({})).toBeNull();
    expect(extractPublishBlock({ status: 422 })).toBeNull();
    expect(extractPublishBlock({ status: 422, data: null })).toBeNull();
    expect(extractPublishBlock({ status: 422, data: "oops" })).toBeNull();
    expect(extractPublishBlock({ status: 422, data: {} })).toBeNull();
    expect(
      extractPublishBlock({ status: 422, data: { blocking: [] } }),
    ).toBeNull();
    expect(
      extractPublishBlock({ status: 422, data: { blocking: "nope" } }),
    ).toBeNull();
  });
});
