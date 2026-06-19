import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement as h } from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { MediaItem } from "@workspace/api-client-react";
import type { BulkSuggestSession } from "@/components/bulk-alt-review-dialog";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Programmable handles for the media page's data sources and side-effects,
 * hoisted so the `vi.mock` factories (which run before imports) can close over
 * them. Each test drives the paged `listCmsMedia` corpus and the persisted
 * skip set, then inspects the `session` / `fetchNext` the page hands to the
 * review dialog.
 */
const h_ = vi.hoisted(() => {
  interface ListResult {
    items: MediaItem[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }
  type ListParams = {
    q?: string;
    onlyIssues?: boolean;
    page: number;
    limit: number;
  };
  // Default: a single empty page (overridden per test).
  const listImplRef: { current: (params: ListParams) => Promise<ListResult> } = {
    current: async (params) => ({
      items: [],
      pagination: { page: params.page, limit: params.limit, total: 0, totalPages: 1 },
    }),
  };
  // Summary surfaced by the list hook; drives the flagged total + button.
  const summaryRef: { current: { totalImages: number; withAltIssues: number } } = {
    current: { totalImages: 100, withAltIssues: 7 },
  };
  const loadSkippedRef: { current: (filter: string) => string[] } = {
    current: () => [],
  };
  const loadApprovedRef: {
    current: (filter: string) => Record<string, string>;
  } = {
    current: () => ({}),
  };

  const listCmsMedia = vi.fn((params: ListParams) => listImplRef.current(params));
  const loadSkipped = vi.fn((filter: string) => loadSkippedRef.current(filter));
  const saveSkipped = vi.fn();
  const clearSkipped = vi.fn();
  const loadApproved = vi.fn((filter: string) =>
    loadApprovedRef.current(filter),
  );
  const saveApproved = vi.fn();
  const clearApproved = vi.fn();
  const toast = vi.fn();

  // Latest props the page passed to <BulkAltReviewDialog>.
  const dialogProps: {
    current: {
      session: BulkSuggestSession | null;
      open: boolean;
      fetchNext: (excludeUrls: string[]) => Promise<MediaItem[]>;
    } | null;
  } = { current: null };

  return {
    listImplRef,
    summaryRef,
    loadSkippedRef,
    loadApprovedRef,
    listCmsMedia,
    loadSkipped,
    saveSkipped,
    clearSkipped,
    loadApproved,
    saveApproved,
    clearApproved,
    toast,
    dialogProps,
  };
});

vi.mock("@workspace/api-client-react", () => ({
  useListCmsMedia: () => ({
    data: {
      items: [{ url: "loaded-1" }] as MediaItem[],
      pagination: { page: 1, limit: 24, total: 1, totalPages: 1 },
      summary: h_.summaryRef.current,
    },
    isLoading: false,
    isError: false,
    isFetching: false,
  }),
  listCmsMedia: h_.listCmsMedia,
}));

vi.mock("@workspace/ui", () => ({
  useToast: () => ({ toast: h_.toast }),
}));

vi.mock("@/lib/bulk-alt-progress", () => ({
  loadSkipped: h_.loadSkipped,
  saveSkipped: h_.saveSkipped,
  clearSkipped: h_.clearSkipped,
  loadApproved: h_.loadApproved,
  saveApproved: h_.saveApproved,
  clearApproved: h_.clearApproved,
}));

vi.mock("@/hooks/use-debounced-value", () => ({
  // Identity: the snapshot filter equals the current search box value.
  useDebouncedValue: (value: unknown) => value,
}));

// Capture the props the page wires into the review dialog; render nothing.
vi.mock("@/components/bulk-alt-review-dialog", () => ({
  BulkAltReviewDialog: (props: {
    session: BulkSuggestSession | null;
    open: boolean;
    fetchNext: (excludeUrls: string[]) => Promise<MediaItem[]>;
  }) => {
    h_.dialogProps.current = props;
    return null;
  },
}));

// The remaining child components are irrelevant to the session/fetchNext logic.
vi.mock("@/components/media-grid", () => ({ MediaGrid: () => null }));
vi.mock("@/components/media-details-sheet", () => ({
  MediaDetailsSheet: () => null,
}));
vi.mock("@/components/media-picker", () => ({ MediaPicker: () => null }));

// Lightweight UI primitives so the page renders under react-test-renderer
// without a DOM. Button/Input forward the props the test interacts with.
vi.mock("@workspace/ui/input", () => ({
  Input: (props: Record<string, unknown>) =>
    h("input", {
      value: props.value,
      onChange: props.onChange,
      placeholder: props.placeholder,
    }),
}));
vi.mock("@workspace/ui/button", () => ({
  Button: (props: Record<string, unknown>) =>
    h(
      "button",
      { onClick: props.onClick, disabled: props.disabled },
      props.children as never,
    ),
}));
vi.mock("@workspace/ui/switch", () => ({
  Switch: () => h("span", null),
}));
vi.mock("@workspace/ui/label", () => ({
  Label: (props: { children?: unknown }) =>
    h("label", null, props.children as never),
}));
vi.mock("@workspace/ui/spinner", () => ({ Spinner: () => h("span", null) }));
vi.mock("@workspace/ui/empty", () => ({
  Empty: (props: { children?: unknown }) =>
    h("div", null, props.children as never),
  EmptyTitle: (props: { children?: unknown }) =>
    h("div", null, props.children as never),
  EmptyDescription: (props: { children?: unknown }) =>
    h("div", null, props.children as never),
}));
vi.mock("lucide-react", () => ({
  ImagePlus: () => null,
  Sparkles: () => null,
}));

// Imported after the mocks are registered.
import MediaPage from "../media";

const CEILING = 200;

function mkItem(url: string): MediaItem {
  return { url, altStatus: "missing" } as MediaItem;
}

/** A `listCmsMedia` impl over a fixed corpus split into pages of `pageSize`. */
function pagedCorpus(urls: string[], pageSize: number) {
  return (params: { page: number; limit: number }) => {
    const totalPages = Math.max(1, Math.ceil(urls.length / pageSize));
    const start = (params.page - 1) * pageSize;
    const slice = urls.slice(start, start + pageSize);
    return Promise.resolve({
      items: slice.map(mkItem),
      pagination: {
        page: params.page,
        limit: params.limit,
        total: urls.length,
        totalPages,
      },
    });
  };
}

/** Visible text of a TestInstance subtree. */
function instText(inst: TestRenderer.ReactTestInstance): string {
  return inst.children
    .map((c: TestRenderer.ReactTestInstance | string) =>
      typeof c === "string" ? c : instText(c),
    )
    .join(" ");
}

function renderPage() {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(h(MediaPage));
  });
  return renderer;
}

/** Drain the awaited gather/listCmsMedia chain, flushing effects. */
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** Type into the search box (debounce is mocked to identity). */
function typeSearch(renderer: TestRenderer.ReactTestRenderer, value: string) {
  const input = renderer.root.findAllByType("input")[0]!;
  act(() => {
    (input.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value },
    });
  });
}

/** Click the "Suggest alt for N flagged" button and let the gather settle. */
async function clickSuggest(renderer: TestRenderer.ReactTestRenderer) {
  const btn = renderer.root
    .findAllByType("button")
    .find((b) => instText(b).includes("Suggest alt"));
  if (!btn) throw new Error("suggest button not rendered");
  await act(async () => {
    (btn.props.onClick as () => void)();
    await new Promise((r) => setTimeout(r, 0));
  });
}

function session(): BulkSuggestSession {
  const s = h_.dialogProps.current?.session;
  if (!s) throw new Error("no session opened");
  return s;
}

function urls(items: MediaItem[]): string[] {
  return items.map((it) => it.url);
}

beforeEach(() => {
  h_.listCmsMedia.mockClear();
  h_.loadSkipped.mockClear();
  h_.saveSkipped.mockClear();
  h_.clearSkipped.mockClear();
  h_.loadApproved.mockClear();
  h_.saveApproved.mockClear();
  h_.clearApproved.mockClear();
  h_.toast.mockClear();
  h_.dialogProps.current = null;
  h_.summaryRef.current = { totalImages: 100, withAltIssues: 7 };
  h_.loadSkippedRef.current = () => [];
  h_.loadApprovedRef.current = () => ({});
  h_.listImplRef.current = async (params) => ({
    items: [],
    pagination: { page: params.page, limit: params.limit, total: 0, totalPages: 1 },
  });
});

describe("MediaPage — bulk suggest session construction", () => {
  it("builds a session with the first flagged window, the flagged total, and the snapshot filter", async () => {
    h_.summaryRef.current = { totalImages: 100, withAltIssues: 7 };
    h_.listImplRef.current = pagedCorpus(["a", "b", "c"], 100);

    const renderer = renderPage();
    await clickSuggest(renderer);

    const s = session();
    expect(urls(s.items)).toEqual(["a", "b", "c"]);
    expect(s.total).toBe(7); // from summary.withAltIssues, not the window size
    expect(s.filter).toBe(""); // no search term typed
    expect(s.skipped).toEqual([]);
    expect(s.approved).toEqual({});
    // The dialog is opened with the session.
    expect(h_.dialogProps.current?.open).toBe(true);

    // The gather forces onlyIssues and pages with the fixed gather limit.
    expect(h_.listCmsMedia).toHaveBeenCalledWith({
      q: undefined,
      onlyIssues: true,
      page: 1,
      limit: 100,
    });
  });

  it("excludes persisted skipped URLs from the first window and seeds them into the session", async () => {
    h_.loadSkippedRef.current = () => ["s1", "s2"];
    h_.listImplRef.current = pagedCorpus(["s1", "a", "b"], 100);

    const renderer = renderPage();
    await clickSuggest(renderer);

    const s = session();
    // s1 is restored-as-skipped, so it must not reappear in the window…
    expect(urls(s.items)).toEqual(["a", "b"]);
    // …but it's still seeded into the session's skip set.
    expect(s.skipped).toEqual(["s1", "s2"]);
    expect(h_.loadSkipped).toHaveBeenCalledWith("");
  });

  it("pages through the corpus and caps the first window at the ceiling", async () => {
    h_.summaryRef.current = { totalImages: 500, withAltIssues: 300 };
    // 3 pages of 100 → 300 available, but the window is capped at 200.
    const all = Array.from({ length: 300 }, (_, i) => `u${i}`);
    h_.listImplRef.current = pagedCorpus(all, 100);

    const renderer = renderPage();
    await clickSuggest(renderer);

    const s = session();
    expect(s.items).toHaveLength(CEILING);
    expect(urls(s.items)).toEqual(all.slice(0, CEILING));
    // Only pages 1 and 2 are fetched — the ceiling stops the walk before page 3.
    const pagesFetched = h_.listCmsMedia.mock.calls.map((c) => c[0].page);
    expect(pagesFetched).toEqual([1, 2]);
  });

  it("stops paging at the last page even when below the ceiling", async () => {
    h_.listImplRef.current = pagedCorpus(["a", "b", "c"], 100);

    const renderer = renderPage();
    await clickSuggest(renderer);

    expect(session().items).toHaveLength(3);
    // One page exists, so exactly one request is made (no runaway paging).
    expect(h_.listCmsMedia).toHaveBeenCalledTimes(1);
  });

  it("snapshots the active search filter and scopes the gather + persistence to it", async () => {
    h_.listImplRef.current = pagedCorpus(["a"], 100);

    const renderer = renderPage();
    typeSearch(renderer, "lighthouse");
    await clickSuggest(renderer);

    const s = session();
    expect(s.filter).toBe("lighthouse");
    expect(h_.loadSkipped).toHaveBeenCalledWith("lighthouse");
    expect(h_.listCmsMedia).toHaveBeenCalledWith({
      q: "lighthouse",
      onlyIssues: true,
      page: 1,
      limit: 100,
    });
  });

  it("opens no session, clears stale skip + approval state, and toasts when nothing is left to review", async () => {
    h_.loadSkippedRef.current = () => ["stale"];
    // Everything still flagged is already in the skip set → empty window.
    h_.listImplRef.current = pagedCorpus(["stale"], 100);

    const renderer = renderPage();
    await clickSuggest(renderer);

    expect(h_.dialogProps.current?.session).toBeNull();
    expect(h_.dialogProps.current?.open).toBe(false);
    expect(h_.clearSkipped).toHaveBeenCalledWith("");
    expect(h_.clearApproved).toHaveBeenCalledWith("");
    expect(h_.toast).toHaveBeenCalledWith({
      title: "No flagged images to suggest for.",
    });
  });

  it("excludes persisted approved URLs from the first window and seeds them into the session", async () => {
    h_.loadApprovedRef.current = () => ({ ap1: "alt 1", ap2: "alt 2" });
    h_.listImplRef.current = pagedCorpus(["ap1", "a", "b"], 100);

    const renderer = renderPage();
    await clickSuggest(renderer);

    const s = session();
    // ap1 was already approved (cross-tab), so it must not reappear…
    expect(urls(s.items)).toEqual(["a", "b"]);
    // …but the approval map is seeded into the session for live sync.
    expect(s.approved).toEqual({ ap1: "alt 1", ap2: "alt 2" });
    expect(h_.loadApproved).toHaveBeenCalledWith("");
  });

  it("toasts and opens no session when the gather fails", async () => {
    h_.listImplRef.current = () => Promise.reject(new Error("network"));

    const renderer = renderPage();
    await clickSuggest(renderer);

    expect(h_.dialogProps.current?.session).toBeNull();
    expect(h_.toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });
});

describe("MediaPage — fetchNext (exclude-aware next window)", () => {
  it("loads the next still-flagged window, excluding already-handled URLs", async () => {
    h_.listImplRef.current = pagedCorpus(["a", "b", "c", "d"], 100);

    const renderer = renderPage();
    await clickSuggest(renderer); // open a session so fetchNext is wired

    const fetchNext = h_.dialogProps.current!.fetchNext;
    h_.listCmsMedia.mockClear();

    let next: MediaItem[] = [];
    await act(async () => {
      next = await fetchNext(["a", "c"]);
    });

    // Handled URLs are filtered out of the freshly-fetched window.
    expect(urls(next)).toEqual(["b", "d"]);
    // The next window is still scoped to flagged-only images.
    expect(h_.listCmsMedia).toHaveBeenCalledWith(
      expect.objectContaining({ onlyIssues: true, page: 1, limit: 100 }),
    );
  });

  it("caps each fetchNext window at the ceiling and pages across the corpus", async () => {
    h_.summaryRef.current = { totalImages: 500, withAltIssues: 300 };
    const all = Array.from({ length: 300 }, (_, i) => `u${i}`);
    h_.listImplRef.current = pagedCorpus(all, 100);

    const renderer = renderPage();
    await clickSuggest(renderer);

    const fetchNext = h_.dialogProps.current!.fetchNext;
    h_.listCmsMedia.mockClear();

    let next: MediaItem[] = [];
    await act(async () => {
      next = await fetchNext([]);
    });

    expect(next).toHaveLength(CEILING);
    const pagesFetched = h_.listCmsMedia.mock.calls.map((c) => c[0].page);
    expect(pagesFetched).toEqual([1, 2]);
  });
});
