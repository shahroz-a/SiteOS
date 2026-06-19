/**
 * Re-extract a single already-stored page from its source URL.
 *
 * Held-back articles (pages.status="draft", page_type="post") failed
 * content-fidelity validation at crawl time. An editor reviewing the queue can
 * trigger a re-extract: this re-runs the same fetch → parse → validate → store
 * pipeline the crawler uses for one page, so a transient source hiccup (or a
 * since-improved parser) gets a fresh chance. If the re-extracted page now
 * passes validation, {@link storePage} flips it back to "published" and it
 * leaves the review queue automatically.
 *
 * Two entry points share one core:
 *  - {@link reextractPage} — the in-process function (used by tests / future
 *    callers), reporting progress through an `onProgress` callback.
 *  - the CLI `main()` — invoked as a child process by the API server. It writes
 *    one NDJSON progress object per stage to **stderr** and the final result (or
 *    error) as a single JSON object to **stdout**, so the server can stream live
 *    progress to the CMS review drawer without importing crawler code.
 */
import { eq } from "drizzle-orm";
import { db, pagesTable } from "@workspace/db";
import { DEFAULT_CONFIG } from "./crawler/config";
import { fetchPage } from "./crawler/fetcher";
import { assemblePage } from "./crawler/assemble";
import { validateExtraction } from "./crawler/validate";
import { logCrawl, storePage, storeValidation } from "./crawler/store";
import { isBlogUrl } from "./crawler/util";

/** Ordered pipeline stages reported back to the UI. */
export type ReextractStage =
  | "loading"
  | "fetching"
  | "parsing"
  | "validating"
  | "storing";

export interface ReextractProgress {
  stage: ReextractStage;
}

export interface ReextractResult {
  pageId: string;
  slug: string;
  url: string;
  changed: boolean;
  validationStatus: "pass" | "warn" | "fail";
  validationScore: number;
  /** "draft" while held back, "published" once validation passes. */
  pageStatus: "draft" | "published";
  heldBack: boolean;
}

export type ReextractErrorCode = "not_found" | "non_article" | "unreachable";

export class ReextractError extends Error {
  readonly code: ReextractErrorCode;
  constructor(code: ReextractErrorCode, message: string) {
    super(message);
    this.name = "ReextractError";
    this.code = code;
  }
}

/**
 * Re-run the crawler pipeline for one stored page, reporting progress per stage.
 * Uses the HTTP fetch path (no browser) — Headout's blog is server-rendered, so
 * plain HTTP returns the full article and a browser would only be slower.
 */
export async function reextractPage(
  pageId: string,
  opts: { onProgress?: (p: ReextractProgress) => void } = {},
): Promise<ReextractResult> {
  const onProgress = opts.onProgress ?? (() => {});

  onProgress({ stage: "loading" });
  const [page] = await db
    .select({
      id: pagesTable.id,
      slug: pagesTable.slug,
      url: pagesTable.originalUrl,
      canonicalUrl: pagesTable.canonicalUrl,
      pageType: pagesTable.pageType,
    })
    .from(pagesTable)
    .where(eq(pagesTable.id, pageId))
    .limit(1);

  if (!page) {
    throw new ReextractError("not_found", "Article not found.");
  }
  if (page.pageType !== "post") {
    throw new ReextractError(
      "non_article",
      "Only article pages can be re-extracted.",
    );
  }
  const sourceUrl = page.url || page.canonicalUrl;
  if (!sourceUrl) {
    throw new ReextractError(
      "unreachable",
      "This article has no source URL to re-extract from.",
    );
  }

  const config = { ...DEFAULT_CONFIG, useBrowser: false };

  onProgress({ stage: "fetching" });
  const fetchResult = await fetchPage(sourceUrl, config);

  if (
    fetchResult.nonHtml ||
    fetchResult.httpStatus >= 400 ||
    (!fetchResult.html && fetchResult.httpStatus !== 200)
  ) {
    throw new ReextractError(
      "unreachable",
      `The source responded with HTTP ${fetchResult.httpStatus}.`,
    );
  }
  if (
    fetchResult.redirectChain.length > 0 &&
    isBlogUrl(sourceUrl) &&
    !isBlogUrl(fetchResult.finalUrl)
  ) {
    throw new ReextractError(
      "unreachable",
      `The source has moved off the blog (now ${fetchResult.finalUrl}).`,
    );
  }

  onProgress({ stage: "parsing" });
  const extracted = assemblePage(fetchResult, null, config);

  onProgress({ stage: "validating" });
  const validation = validateExtraction(extracted);

  onProgress({ stage: "storing" });
  const stored = await storePage(extracted, {
    validationStatus: validation.status,
  });
  await storeValidation(stored.pageId, validation);

  const heldBack = validation.status === "fail";
  await logCrawl({
    url: sourceUrl,
    pageId: stored.pageId,
    level: heldBack ? "warn" : "info",
    httpStatus: fetchResult.httpStatus,
    message: `re-extracted via CMS review queue (${extracted.via}); validation=${validation.status}${heldBack ? " (held back for review)" : ""}`,
    details: { counts: extracted.counts },
  });

  return {
    pageId: stored.pageId,
    slug: extracted.slug || page.slug,
    url: sourceUrl,
    changed: stored.changed,
    validationStatus: validation.status,
    validationScore: validation.score,
    pageStatus: heldBack ? "draft" : "published",
    heldBack,
  };
}

/** Emit one NDJSON line on the given stream. */
function emit(stream: NodeJS.WriteStream, payload: unknown): void {
  stream.write(`${JSON.stringify(payload)}\n`);
}

async function main(): Promise<void> {
  const pageId = process.argv[2];
  if (!pageId) {
    emit(process.stdout, { type: "error", code: "not_found", message: "Missing page id argument." });
    process.exit(1);
    return;
  }

  try {
    const result = await reextractPage(pageId, {
      onProgress: (p) => emit(process.stderr, { type: "progress", ...p }),
    });
    emit(process.stdout, { type: "result", ...result });
    process.exit(0);
  } catch (err) {
    if (err instanceof ReextractError) {
      emit(process.stdout, { type: "error", code: err.code, message: err.message });
    } else {
      const message = err instanceof Error ? err.message : String(err);
      emit(process.stdout, { type: "error", code: "failed", message });
    }
    process.exit(1);
  }
}

// Run as a CLI only when executed directly (not when imported by a test).
const invokedDirectly =
  process.argv[1] != null &&
  (process.argv[1].endsWith("reextract.ts") ||
    process.argv[1].endsWith("reextract.mjs"));
if (invokedDirectly) {
  void main();
}
