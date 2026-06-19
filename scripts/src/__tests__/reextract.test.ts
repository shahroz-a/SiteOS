import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReextractStage } from "../reextract";

/**
 * Unit tests for the held-back-article re-extraction core (`reextractPage`).
 *
 * The function re-runs the crawler's fetch → parse → validate → store pipeline
 * for ONE stored page so an editor can give a transiently-broken extraction a
 * fresh try. Every collaborator it touches (`@workspace/db` and the crawler
 * modules) is mocked so the test never opens a database or makes a network
 * request — we assert the *control flow*: which guard rejects bad input, that a
 * skip/fail branch never stores, that progress is reported per stage, and that a
 * fresh PASS releases a held-back draft to "published" while a FAIL keeps it a
 * draft and logs a warning.
 */
const h = vi.hoisted(() => ({
  pageRows: [] as Array<Record<string, unknown>>,
  fetchPage: vi.fn(),
  assemblePage: vi.fn(),
  validateExtraction: vi.fn(),
  storePage: vi.fn(),
  storeValidation: vi.fn(),
  logCrawl: vi.fn(),
  isBlogUrl: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({ eq: (col: unknown, val: unknown) => ({ col, val }) }));
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => h.pageRows,
        }),
      }),
    }),
  },
  pagesTable: new Proxy({}, { get: (_t, p) => ({ __col: String(p) }) }),
}));
vi.mock("../crawler/config", () => ({ DEFAULT_CONFIG: { useBrowser: true } }));
vi.mock("../crawler/fetcher", () => ({ fetchPage: h.fetchPage }));
vi.mock("../crawler/assemble", () => ({ assemblePage: h.assemblePage }));
vi.mock("../crawler/validate", () => ({ validateExtraction: h.validateExtraction }));
vi.mock("../crawler/store", () => ({
  storePage: h.storePage,
  storeValidation: h.storeValidation,
  logCrawl: h.logCrawl,
}));
vi.mock("../crawler/util", () => ({ isBlogUrl: h.isBlogUrl }));

const { reextractPage, ReextractError } = await import("../reextract");

const SOURCE_URL = "https://www.headout.com/blog/things-to-do-in-rome/";

// A held-back blog article: a draft post the reviewer wants to re-extract.
function draftPostRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "page-1",
    slug: "things-to-do-in-rome",
    url: SOURCE_URL,
    canonicalUrl: SOURCE_URL,
    pageType: "post",
    ...overrides,
  };
}

function okFetch(overrides: Record<string, unknown> = {}) {
  return {
    requestedUrl: SOURCE_URL,
    finalUrl: SOURCE_URL,
    httpStatus: 200,
    html: "<html><body>ok</body></html>",
    nonHtml: false,
    redirectChain: [],
    via: "http",
    ...overrides,
  };
}

beforeEach(() => {
  h.pageRows = [];
  vi.clearAllMocks();
  h.isBlogUrl.mockImplementation((url: string) => url.includes("headout.com/blog"));
  h.assemblePage.mockReturnValue({ slug: "things-to-do-in-rome", via: "http", counts: {} });
  h.storePage.mockResolvedValue({ pageId: "page-1", changed: true });
  h.storeValidation.mockResolvedValue(undefined);
  h.logCrawl.mockResolvedValue(undefined);
});

describe("reextractPage", () => {
  it("throws not_found when the page id does not resolve, before fetching", async () => {
    h.pageRows = [];
    await expect(reextractPage("missing")).rejects.toMatchObject({
      code: "not_found",
    });
    expect(h.fetchPage).not.toHaveBeenCalled();
  });

  it("rejects a non-article page with non_article", async () => {
    h.pageRows = [draftPostRow({ pageType: "category" })];
    await expect(reextractPage("page-1")).rejects.toMatchObject({
      code: "non_article",
    });
    expect(h.fetchPage).not.toHaveBeenCalled();
  });

  it("rejects a page with no source URL as unreachable", async () => {
    h.pageRows = [draftPostRow({ url: null, canonicalUrl: null })];
    await expect(reextractPage("page-1")).rejects.toBeInstanceOf(ReextractError);
    expect(h.fetchPage).not.toHaveBeenCalled();
  });

  it("treats an HTTP >= 400 source as unreachable without storing", async () => {
    h.pageRows = [draftPostRow()];
    h.fetchPage.mockResolvedValue(okFetch({ httpStatus: 503, html: "" }));
    await expect(reextractPage("page-1")).rejects.toMatchObject({
      code: "unreachable",
    });
    expect(h.assemblePage).not.toHaveBeenCalled();
    expect(h.storePage).not.toHaveBeenCalled();
  });

  it("treats a source that has moved off the blog as unreachable", async () => {
    h.pageRows = [draftPostRow()];
    h.fetchPage.mockResolvedValue(
      okFetch({
        finalUrl: "https://www.headout.com/rome/",
        redirectChain: [{ from: SOURCE_URL, to: "https://www.headout.com/rome/" }],
      }),
    );
    await expect(reextractPage("page-1")).rejects.toMatchObject({
      code: "unreachable",
    });
    expect(h.storePage).not.toHaveBeenCalled();
  });

  it("releases a now-passing article to published and reports every stage", async () => {
    h.pageRows = [draftPostRow()];
    h.fetchPage.mockResolvedValue(okFetch());
    h.validateExtraction.mockReturnValue({ status: "pass", score: 0.95 });

    const stages: ReextractStage[] = [];
    const result = await reextractPage("page-1", {
      onProgress: (p) => stages.push(p.stage),
    });

    expect(result).toMatchObject({
      pageId: "page-1",
      slug: "things-to-do-in-rome",
      validationStatus: "pass",
      pageStatus: "published",
      heldBack: false,
    });
    expect(stages).toEqual(["loading", "fetching", "parsing", "validating", "storing"]);
    expect(h.storePage).toHaveBeenCalledTimes(1);
    expect(h.storeValidation).toHaveBeenCalledTimes(1);
    // A passing re-extract logs at info level (not held back).
    expect(h.logCrawl).toHaveBeenCalledWith(
      expect.objectContaining({ level: "info", pageId: "page-1" }),
    );
  });

  it("keeps a still-failing article a draft and logs a warning", async () => {
    h.pageRows = [draftPostRow()];
    h.fetchPage.mockResolvedValue(okFetch());
    h.validateExtraction.mockReturnValue({ status: "fail", score: 0.1 });

    const result = await reextractPage("page-1");

    expect(result).toMatchObject({
      validationStatus: "fail",
      pageStatus: "draft",
      heldBack: true,
    });
    expect(h.storePage).toHaveBeenCalledTimes(1);
    expect(h.logCrawl).toHaveBeenCalledWith(
      expect.objectContaining({ level: "warn", pageId: "page-1" }),
    );
  });
});
