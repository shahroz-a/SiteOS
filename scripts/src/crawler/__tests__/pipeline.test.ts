import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ValidationResult } from "../validate";

/**
 * Verifies that the crawl pipeline *acts* on a validation result instead of
 * computing it and ignoring it. A genuinely broken article (one whose title
 * cannot be extracted) must, when run through `processItem`:
 *   1. be retried once (extraction is attempted a second time), and
 *   2. have its failing validation recorded — both as an error-level crawl log
 *      and as a `validation_reports` row (via `storeValidation`).
 *
 * That stored fail row is exactly what the migration reports read back: see
 * reports.ts, where `validation-report.json` lists `status === "fail"` rows and
 * `migration-readiness.json` counts them as blocking issues. Asserting the row
 * is written here proves failing articles surface in ./reports/.
 *
 * Every sibling module that touches `@workspace/db` is mocked so importing the
 * pipeline never loads a real database client. `assemble`/`validate` stay real
 * and run against saved-HTML fixtures (the same approach as the other tests).
 */

const fetchPage = vi.fn();
const storePage = vi.fn();
const storeValidation = vi.fn();
const logCrawl = vi.fn();
const enqueueOne = vi.fn();

vi.mock("../fetcher", () => ({ fetchPage }));
vi.mock("../store", () => ({ storePage, storeValidation, logCrawl }));
vi.mock("../queue", () => ({
  enqueueOne,
  // Imported at pipeline module scope but unused by processItem itself.
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

// Imported after the mocks are registered.
const { processItem } = await import("../pipeline");
const { DEFAULT_CONFIG } = await import("../config");
const { loadFixture, makeFetchResult } = await import("./helpers");

const GOOD_URL = "https://www.headout.com/blog/sample-article/";
const BROKEN_URL = "https://www.headout.com/blog/broken-article/";
const goodHtml = loadFixture("sample-article.html");
const brokenHtml = loadFixture("broken-article.html");

// Zero the politeness delay so the retry path doesn't slow the test down.
const config = { ...DEFAULT_CONFIG, perRequestDelayMs: 0 };

type Item = Parameters<typeof processItem>[0];
function makeItem(url: string): Item {
  return { url, discoveredFrom: null } as Item;
}

/** Pull the single ValidationResult passed to storeValidation. */
function storedValidation(): ValidationResult {
  expect(storeValidation).toHaveBeenCalledTimes(1);
  return storeValidation.mock.calls[0]![1] as ValidationResult;
}

/** All crawl-log payloads recorded during the run. */
function crawlLogs(): Array<{ level: string; message: string; pageId?: string | null }> {
  return logCrawl.mock.calls.map((c) => c[0] as { level: string; message: string });
}

describe("processItem validation gate", () => {
  beforeEach(() => {
    fetchPage.mockReset();
    storePage.mockReset();
    storeValidation.mockReset();
    logCrawl.mockReset();
    enqueueOne.mockReset();
    storePage.mockResolvedValue({ pageId: "page-1", created: true, changed: true, versionNumber: 1 });
  });

  it("processes a healthy article once and records a non-failing result", async () => {
    fetchPage.mockResolvedValue(makeFetchResult(goodHtml, GOOD_URL));

    const outcome = await processItem(makeItem(GOOD_URL), config, () => {});

    expect(outcome.status).toBe("completed");
    expect(outcome.validation?.status).not.toBe("fail");
    // No retry: a passing/warning page is fetched exactly once.
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(storedValidation().status).not.toBe("fail");
    // Recorded at info level (not error) since it did not fail.
    expect(crawlLogs().some((l) => l.level === "error")).toBe(false);
    expect(crawlLogs().some((l) => l.level === "info" && /validation=/.test(l.message))).toBe(true);
  });

  it("retries a broken article, then quarantines it by recording the failure", async () => {
    fetchPage.mockResolvedValue(makeFetchResult(brokenHtml, BROKEN_URL));
    const log = vi.fn();

    const outcome = await processItem(makeItem(BROKEN_URL), config, log);

    // Extraction is attempted twice before giving up (retry-on-fail wiring).
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("retrying extraction"));

    // The failing result is acted on, not ignored: the page is still stored but
    // the fail status is persisted for editors to review.
    expect(outcome.status).toBe("completed");
    const validation = storedValidation();
    expect(validation.status).toBe("fail");
    expect(validation.issues.some((i) => i.severity === "fail")).toBe(true);

    // Surfaced as an error-level crawl log mentioning the failure.
    const errorLog = crawlLogs().find((l) => l.level === "error");
    expect(errorLog).toBeDefined();
    expect(errorLog!.message).toContain("validation=fail");
  });

  it("records a fail row whose shape is what the migration reports read back", async () => {
    fetchPage.mockResolvedValue(makeFetchResult(brokenHtml, BROKEN_URL));

    await processItem(makeItem(BROKEN_URL), config, () => {});

    // reports.ts builds validation-report.json / migration-readiness.json from
    // exactly these fields, so a populated fail row guarantees ./reports/ surfaces it.
    const v = storedValidation();
    expect(v).toMatchObject({
      status: "fail",
      score: expect.any(Number),
      issues: expect.any(Array),
      source: expect.any(Object),
      parsed: expect.any(Object),
    });
    expect(v.issues.find((i) => i.field === "title")).toMatchObject({
      severity: "fail",
      message: "page title could not be extracted",
    });
  });

  it("treats a non-OK HTTP response as a recorded failure without storing a page", async () => {
    fetchPage.mockResolvedValue({
      requestedUrl: BROKEN_URL,
      finalUrl: BROKEN_URL,
      httpStatus: 503,
      html: "",
      redirectChain: [],
      via: "http" as const,
      httpHeaders: {},
    });

    const outcome = await processItem(makeItem(BROKEN_URL), config, () => {});

    expect(outcome.status).toBe("failed");
    expect(storePage).not.toHaveBeenCalled();
    expect(storeValidation).not.toHaveBeenCalled();
    const warnLog = crawlLogs().find((l) => l.level === "warn");
    expect(warnLog?.message).toContain("503");
  });
});
