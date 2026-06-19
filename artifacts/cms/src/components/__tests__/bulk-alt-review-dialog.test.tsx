import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { MediaItem } from "@workspace/api-client-react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * Shared mock handles, hoisted so the `vi.mock` factories below (which run
 * before module imports) can close over them.
 */
const { suggestMutate, updateMutate, toastFn, invalidateQueries } = vi.hoisted(
  () => ({
    suggestMutate: vi.fn(),
    updateMutate: vi.fn(),
    toastFn: vi.fn(),
    invalidateQueries: vi.fn(),
  }),
);

vi.mock("@workspace/api-client-react", () => ({
  useSuggestCmsMediaAltBatch: () => ({ mutate: suggestMutate }),
  useUpdateCmsMediaAlt: () => ({
    mutate: updateMutate,
    isPending: false,
    variables: undefined,
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

vi.mock("@workspace/ui", () => ({
  useToast: () => ({ toast: toastFn }),
  cn: (...args: unknown[]) =>
    args
      .flat(Infinity)
      .filter((v) => typeof v === "string" && v)
      .join(" "),
}));

// The Dialog title/description are radix primitives that need a Dialog context;
// ReviewBody is rendered standalone here, so stub the dialog chrome to plain
// pass-through hosts. The interesting UI (rows, counters, progress) is real.
vi.mock("@workspace/ui/dialog", async () => {
  const { createElement: h } = await import("react");
  const pass = (props: { children?: unknown }) =>
    h("div", null, props.children as never);
  return {
    Dialog: pass,
    DialogContent: pass,
    DialogHeader: pass,
    DialogTitle: pass,
    DialogDescription: pass,
    DialogFooter: pass,
  };
});

// The `@/` alias isn't wired into the vitest resolver; stub the small helper
// module the component pulls from it.
vi.mock("@/lib/media-utils", () => ({
  ALT_STATUS_META: {
    ok: { label: "Alt text OK", shortLabel: "OK", badgeClass: "" },
    missing: { label: "Missing alt text", shortLabel: "Missing alt", badgeClass: "" },
    poor: { label: "Poor alt text", shortLabel: "Poor alt", badgeClass: "" },
  },
  fileNameFromUrl: (url: string) => url.split("/").pop() ?? url,
}));

// Imported after the mocks are registered.
import { ReviewBody } from "../bulk-alt-review-dialog";

const MAX_URLS_PER_BATCH = 50;

function makeItems(n: number): MediaItem[] {
  return Array.from({ length: n }, (_, i) => ({
    url: `https://cdn-img.headout.com/img-${i}.jpg`,
    originalUrl: null,
    alt: null,
    title: null,
    caption: null,
    credit: null,
    width: null,
    height: null,
    mimeType: null,
    role: null,
    usageCount: 1,
    pageCount: 1,
    altStatus: "missing" as const,
    altIssues: [],
    pages: [],
  }));
}

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

/** Recursively join the visible text of a TestInstance subtree. */
function instText(inst: TestRenderer.ReactTestInstance): string {
  return inst.children
    .map((c: TestRenderer.ReactTestInstance | string) =>
      typeof c === "string" ? c : instText(c),
    )
    .join(" ");
}

function render(
  props: Omit<
    Parameters<typeof ReviewBody>[0],
    "initialSkipped" | "initialApproved"
  > & {
    initialSkipped?: string[];
    initialApproved?: Record<string, string>;
  },
) {
  const resolved = { initialSkipped: [], initialApproved: {}, ...props };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(createElement(ReviewBody, resolved));
  });
  return renderer;
}

beforeEach(() => {
  suggestMutate.mockReset();
  updateMutate.mockReset();
  toastFn.mockReset();
  invalidateQueries.mockReset();
});

describe("ReviewBody — suggestion mapping across chunks", () => {
  it("resolves every row to its own suggestion (ready/error) across >50-item chunks", () => {
    const items = makeItems(120); // 3 chunks: 50 + 50 + 20
    // Every 37th url comes back as an error; the rest get a unique suggestion
    // whose text embeds the url so a mis-mapping would surface as wrong text.
    const isErr = (i: number) => i % 37 === 0;
    suggestMutate.mockImplementation(
      (
        { data }: { data: { urls: string[] } },
        { onSuccess }: { onSuccess: (r: { results: unknown[] }) => void },
      ) => {
        onSuccess({
          results: data.urls.map((url) => {
            const i = Number(url.match(/img-(\d+)/)![1]);
            return isErr(i)
              ? { url, suggestion: null, error: `ERR::${url}` }
              : { url, suggestion: `ALT::${url}` };
          }),
        });
      },
    );

    const renderer = render({
      filter: "",
      initialItems: items,
      total: items.length,
      fetchNext: vi.fn().mockResolvedValue([]),
      onClose: vi.fn(),
    });

    // Three chunked requests were fired for 120 items.
    expect(suggestMutate).toHaveBeenCalledTimes(3);
    const chunkSizes = suggestMutate.mock.calls.map(
      (c) => (c[0] as { data: { urls: string[] } }).data.urls.length,
    );
    expect(chunkSizes).toEqual([50, 50, 20]);

    // Ready rows: a textarea per non-error url, valued with its own suggestion.
    const values = renderer.root
      .findAllByType("textarea")
      .map((t) => t.props.value as string);
    const valueSet = new Set(values);
    const fullText = textOf(renderer.toJSON());
    items.forEach((it, i) => {
      if (isErr(i)) {
        expect(fullText).toContain(`ERR::${it.url}`);
      } else {
        expect(valueSet.has(`ALT::${it.url}`)).toBe(true);
      }
    });

    const readyCount = items.filter((_, i) => !isErr(i)).length;
    expect(values).toHaveLength(readyCount);
    expect(new Set(values).size).toBe(readyCount); // no url collides onto another row
  });
});

describe("ReviewBody — approve & skip", () => {
  it("approve saves via the update mutation and skip marks the row, updating header counters", async () => {
    const items = makeItems(2);
    suggestMutate.mockImplementation(
      (
        { data }: { data: { urls: string[] } },
        { onSuccess }: { onSuccess: (r: { results: unknown[] }) => void },
      ) => {
        onSuccess({
          results: data.urls.map((url) => ({ url, suggestion: `ALT::${url}` })),
        });
      },
    );
    updateMutate.mockImplementation(
      (_vars: unknown, { onSuccess }: { onSuccess: () => void }) => onSuccess(),
    );

    const fetchNext = vi.fn().mockResolvedValue([]);
    const renderer = render({
      filter: "",
      initialItems: items,
      total: items.length,
      fetchNext,
      onClose: vi.fn(),
    });

    // Both rows ready → header shows "0 of 2 handled".
    expect(textOf(renderer.toJSON())).toContain("0 of 2 handled");

    // Approve the first ready row.
    const approveBtn = renderer.root
      .findAllByType("button")
      .find((b) => instText(b).includes("Approve"))!;
    act(() => approveBtn.props.onClick());

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect((updateMutate.mock.calls[0]![0] as { data: { url: string; alt: string } }).data).toEqual({
      url: items[0]!.url,
      alt: `ALT::${items[0]!.url}`,
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    let json = textOf(renderer.toJSON());
    expect(json).toContain("Saved");
    expect(json).toContain("1 approved");

    // Skip the remaining ready row. This empties the window, which triggers the
    // async auto-advance (fetchNext → []), so wrap in an async act to flush it.
    await act(async () => {
      const skipBtn = renderer.root
        .findAllByType("button")
        .find((b) => instText(b).includes("Skip"))!;
      skipBtn.props.onClick();
    });

    json = textOf(renderer.toJSON());
    expect(json).toContain("1 approved");
    expect(json).toContain("1 skipped");
    expect(json).toContain("2 of 2 handled");
    expect(fetchNext).toHaveBeenCalled();
  });
});

describe("ReviewBody — skipped review & clear", () => {
  it("surfaces restored skips as a count and pulls them back in via Review", async () => {
    const skipped = ["https://cdn-img.headout.com/old-1.jpg"];
    const refetched = makeItems(1);
    suggestMutate.mockImplementation(
      (
        { data }: { data: { urls: string[] } },
        { onSuccess }: { onSuccess: (r: { results: unknown[] }) => void },
      ) => {
        onSuccess({
          results: data.urls.map((url) => ({ url, suggestion: `ALT::${url}` })),
        });
      },
    );

    const onSkippedChange = vi.fn();
    const fetchNext = vi.fn().mockResolvedValue(refetched);
    const renderer = render({
      filter: "",
      initialItems: makeItems(1),
      total: 2,
      initialSkipped: skipped,
      fetchNext,
      onSkippedChange,
      onClose: vi.fn(),
    });

    // The restored skip count is visible and actionable.
    expect(textOf(renderer.toJSON())).toContain("Review 1 skipped");

    // Click "Review … skipped" → it excludes nothing previously-skipped, so the
    // gather pulls that image back into the queue.
    await act(async () => {
      const reviewBtn = renderer.root
        .findAllByType("button")
        .find((b) =>
          instText(b).replace(/\s+/g, " ").includes("Review 1 skipped"),
        )!;
      reviewBtn.props.onClick();
    });

    // The previously-skipped url is no longer excluded from the gather.
    const excludeArg = fetchNext.mock.calls.at(-1)![0] as string[];
    expect(excludeArg).not.toContain(skipped[0]);
    // Persistence was cleared and the counter reset.
    expect(onSkippedChange).toHaveBeenLastCalledWith([]);
    const json = textOf(renderer.toJSON());
    expect(json).not.toContain("Review 1 skipped");
    expect(fetchNext).toHaveBeenCalled();
  });

  it("Clear forgets restored skips without reviewing them", () => {
    const skipped = ["https://cdn-img.headout.com/old-1.jpg"];
    const onSkippedChange = vi.fn();
    const fetchNext = vi.fn().mockResolvedValue([]);
    const renderer = render({
      filter: "",
      initialItems: makeItems(1),
      total: 2,
      initialSkipped: skipped,
      fetchNext,
      onSkippedChange,
      onClose: vi.fn(),
    });

    expect(textOf(renderer.toJSON())).toContain("Review 1 skipped");

    const clearBtn = renderer.root
      .findAllByType("button")
      .find((b) => b.props["aria-label"] === "Clear skipped images")!;
    act(() => clearBtn.props.onClick());

    // Persistence cleared, count zeroed, and no window reload was triggered.
    expect(onSkippedChange).toHaveBeenLastCalledWith([]);
    expect(fetchNext).not.toHaveBeenCalled();
    expect(textOf(renderer.toJSON())).not.toContain("skipped");
  });
});

describe("ReviewBody — failed chunk", () => {
  it("marks exactly the failed chunks' rows as errored and toasts once", () => {
    const items = makeItems(120); // 3 chunks: [0..49] [50..99] [100..119]
    const chunkOf = (i: number) => Math.floor(i / MAX_URLS_PER_BATCH);
    // First and last chunks fail; the middle chunk succeeds.
    const failChunks = new Set([0, 2]);
    suggestMutate.mockImplementation(
      (
        { data }: { data: { urls: string[] } },
        {
          onSuccess,
          onError,
        }: {
          onSuccess: (r: { results: unknown[] }) => void;
          onError: () => void;
        },
      ) => {
        const firstIdx = Number(data.urls[0]!.match(/img-(\d+)/)![1]);
        if (failChunks.has(chunkOf(firstIdx))) {
          onError();
        } else {
          onSuccess({
            results: data.urls.map((url) => ({
              url,
              suggestion: `ALT::${url}`,
            })),
          });
        }
      },
    );

    const renderer = render({
      filter: "",
      initialItems: items,
      total: items.length,
      fetchNext: vi.fn().mockResolvedValue([]),
      onClose: vi.fn(),
    });

    expect(suggestMutate).toHaveBeenCalledTimes(3);

    // Only the middle chunk produced ready textareas (50 of them).
    const values = renderer.root
      .findAllByType("textarea")
      .map((t) => t.props.value as string);
    expect(values).toHaveLength(50);
    items.forEach((it, i) => {
      if (chunkOf(i) === 1) {
        expect(values).toContain(`ALT::${it.url}`);
      }
    });

    // Failed chunks (0 and 2) → 70 rows show the unavailable-service message.
    const errorCount = textOf(renderer.toJSON()).split(
      "The AI service is unavailable.",
    ).length - 1;
    expect(errorCount).toBe(70);
    expect(textOf(renderer.toJSON())).toContain("70 failed in this set");

    // Two chunks failed, but the editor sees exactly one toast.
    expect(toastFn).toHaveBeenCalledTimes(1);
    expect(toastFn.mock.calls[0]![0]).toMatchObject({ variant: "destructive" });
  });
});
