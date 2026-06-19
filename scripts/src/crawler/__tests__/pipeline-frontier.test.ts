import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Verifies frontier expansion in `processItem` only enqueues real, fetchable
 * blog links: it normalizes accidental `//`, and drops assets plus structurally
 * malformed hrefs (bare-domain/concatenated links) so they never inflate the
 * queue's permanent-failure count. `assemble`/`validate` are mocked so the test
 * controls exactly which internal links a page yields.
 */

const fetchPage = vi.fn();
const storePage = vi.fn();
const storeValidation = vi.fn();
const logCrawl = vi.fn();
const enqueueOne = vi.fn();
const assemblePage = vi.fn();
const validateExtraction = vi.fn();

vi.mock("../fetcher", () => ({ fetchPage }));
vi.mock("../store", () => ({ storePage, storeValidation, logCrawl }));
vi.mock("../assemble", () => ({ assemblePage }));
vi.mock("../validate", () => ({ validateExtraction }));
vi.mock("../queue", () => ({
  enqueueOne,
  claimBatch: vi.fn(),
  enqueueUrls: vi.fn(),
  hasPendingWork: vi.fn(),
  markCompleted: vi.fn(),
  markFailed: vi.fn(),
  markSkipped: vi.fn(),
  queueStats: vi.fn(),
  recoverStaleInProgress: vi.fn(),
}));
vi.mock("../browser", () => ({ closeBrowser: vi.fn(), isBrowserAvailable: vi.fn() }));
vi.mock("../reports", () => ({ generateReports: vi.fn() }));
vi.mock("../sitemap", () => ({ discoverFromSitemaps: vi.fn() }));

const { processItem } = await import("../pipeline");
const { DEFAULT_CONFIG } = await import("../config");

const config = { ...DEFAULT_CONFIG, perRequestDelayMs: 0 };
const SOURCE = "https://www.headout.com/blog/source-article/";

type Item = Parameters<typeof processItem>[0];
function makeItem(url: string): Item {
  return { url, discoveredFrom: null } as Item;
}

function pageWithLinks(hrefs: string[]) {
  return {
    via: "http" as const,
    counts: {},
    redirectChain: [],
    internalLinks: hrefs.map((href, position) => ({ href, anchorText: null, rel: null, position })),
  };
}

describe("processItem frontier expansion", () => {
  beforeEach(() => {
    fetchPage.mockReset();
    storePage.mockReset();
    storeValidation.mockReset();
    logCrawl.mockReset();
    enqueueOne.mockReset();
    assemblePage.mockReset();
    validateExtraction.mockReset();
    fetchPage.mockResolvedValue({
      requestedUrl: SOURCE,
      finalUrl: SOURCE,
      httpStatus: 200,
      html: "<html></html>",
      redirectChain: [],
      via: "http",
      httpHeaders: { "content-type": "text/html" },
    });
    storePage.mockResolvedValue({ pageId: "page-1", created: true, changed: true, versionNumber: 1 });
    validateExtraction.mockReturnValue({ status: "pass", score: 100, issues: [], source: {}, parsed: {} });
  });

  it("enqueues clean links (collapsing `//`) and drops asset/malformed ones", async () => {
    assemblePage.mockReturnValue(
      pageWithLinks([
        "https://www.headout.com/blog/singapore-zoo/", // clean
        "https://www.headout.com/blog/acropolis-athens//", // accidental double slash
        "https://www.headout.com/blog/athens-in-august/introducingathens.com/bus", // bare domain
        "https://www.headout.com/blog/aladdin/:%22https://en.wikipedia.org/x", // embedded protocol
        "https://www.headout.com/blog/wp-content/uploads/2020/x.jpg", // asset
        "https://www.example.com/blog/external/", // off-domain, not a blog url
      ]),
    );

    const outcome = await processItem(makeItem(SOURCE), config, () => {});
    expect(outcome.status).toBe("completed");

    const enqueued = enqueueOne.mock.calls.map((c) => c[0] as string);
    expect(enqueued).toContain("https://www.headout.com/blog/singapore-zoo/");
    // The double slash is normalized away before enqueue.
    expect(enqueued).toContain("https://www.headout.com/blog/acropolis-athens/");
    expect(enqueued).not.toContain("https://www.headout.com/blog/acropolis-athens//");
    // Garbage never reaches the queue.
    expect(enqueued).toHaveLength(2);
  });
});
