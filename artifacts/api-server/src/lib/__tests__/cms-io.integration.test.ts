/**
 * Opt-in live-DB integration test for the CMS import / export / backup / restore
 * round-trip (the authenticated `/cms/export`, `/cms/import`, `/cms/backup`,
 * `/cms/restore` endpoints all funnel through these two library functions:
 * `loadContentBundle` and `importContentBundle`).
 *
 * It mirrors the real-data round-trip pattern of
 * `scripts/src/payload/__tests__/roundtrip-real-data.test.ts`, but exercises the
 * CMS content-io path instead of the Payload exporter. Each batch of pages runs
 * the same round-trip (`checkBatch`):
 *   1. EXPORT  — `loadContentBundle(db, { pageIds })` reads just that batch, then
 *      we serialize it in EVERY supported format (json/csv/markdown/sql/payload).
 *   2. IMPORT  — we re-import the JSON and Payload bundles via
 *      `importContentBundle(bundle, tx)` and assert posts are *matched* (none
 *      created — they all resolve by canonicalUrl), the re-import is idempotent
 *      (a second pass is fully "unchanged"), and internal links are resolved.
 *   3. RESTORE — we round-trip the JSON backup wire format and force the update
 *      (clear + rewrite children) path, then read the freshly-written child rows
 *      back and assert NO image / link / metadata is lost.
 *
 * The corpus is processed in BATCHES rather than all at once: full mode chunks
 * every page id into `CMS_IO_BATCH_SIZE` groups and runs the round-trip per
 * batch, so peak memory tracks one batch instead of materializing + serializing
 * all ~3.7k pages in five formats simultaneously (which grows unbounded with the
 * blog). Bounded mode is simply a single small sample batch. Either way the
 * no-image/link/metadata-loss assertion now spans every page that is processed.
 *
 * Non-destructive by construction: the export leg only SELECTs, and every import
 * runs inside a transaction that is ALWAYS rolled back, so the live database is
 * never mutated. Because it touches the real DB it is OPT-IN — it only runs when
 * `VERIFY_CMS_IO=1` is set, so the normal suite skips it.
 *
 * Run with: `pnpm --filter @workspace/api-server run verify:cms-io`
 *   (or: `VERIFY_CMS_IO=1 pnpm exec vitest run \
 *     artifacts/api-server/src/lib/__tests__/cms-io.integration.test.ts`)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, desc, eq, sql } from "drizzle-orm";
import {
  db,
  pool,
  pagesTable,
  imagesTable,
  internalLinksTable,
  externalLinksTable,
  componentTreeTable,
  metadataTable,
} from "@workspace/db";
import {
  serializeBundle,
  parseBundle,
  EXPORT_FORMATS,
  type ContentBundle,
} from "@workspace/content-io";
import { loadContentBundle, importContentBundle } from "../content-io";

const RUN = process.env.VERIFY_CMS_IO === "1";

// Sample size: the page with the MOST images (stress many-inline-image pages)
// plus the two with the FEWEST (empty/near-empty shapes). A tiny sample still
// exercises both extremes while keeping the rolled-back imports fast.
const SAMPLE_TOP = 1;
const SAMPLE_BOTTOM = 2;

/**
 * Bounded mode (`CMS_IO_VERIFY_LIMIT=N`, N a positive integer): load ONLY a
 * sample of N pages (1 with the most images + the rest with the fewest) directly
 * from the DB instead of materializing + serializing all ~3.7k pages. This is
 * what lets the round-trip run automatically as a registered validation step /
 * scheduled job in a few seconds; left unset, the full corpus is exercised
 * (the manual `verify:cms-io` run). The sample still spans the many-image and
 * empty-shape extremes, so it covers the same import/restore regressions.
 */
const VERIFY_LIMIT = (() => {
  const raw = process.env.CMS_IO_VERIFY_LIMIT;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
})();

/**
 * FULL-mode batch size: how many pages are loaded + serialized + round-tripped
 * at once. Tunable via `CMS_IO_BATCH_SIZE` (positive integer); defaults to 200.
 * Smaller batches lower peak memory at the cost of more per-batch overhead.
 */
const BATCH_SIZE = (() => {
  const raw = process.env.CMS_IO_BATCH_SIZE;
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : 200;
})();

type Executor = typeof db;

class Rollback extends Error {}

/** Run `fn` inside a transaction that is always rolled back. */
async function inRolledBackTx(
  fn: (tx: Executor) => Promise<void>,
): Promise<void> {
  try {
    await db.transaction(async (txRaw) => {
      await fn(txRaw as unknown as Executor);
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
}

/** The child rows we assert no loss for, normalized to comparable shapes. */
interface ChildRows {
  images: Array<{ url: string; role: string | null; position: number }>;
  internal: Array<{
    href: string;
    anchorText: string | null;
    rel: string | null;
    position: number;
  }>;
  external: Array<{
    href: string;
    anchorText: string | null;
    rel: string | null;
    domain: string | null;
    position: number;
  }>;
  metadata: {
    metaTags: unknown;
    httpHeaders: unknown;
    openGraph: unknown;
    twitter: unknown;
    custom: unknown;
  } | null;
}

const byPosition = <T extends { position: number }>(rows: T[]): T[] =>
  rows.slice().sort((a, b) => a.position - b.position);

const sortImages = (images: ChildRows["images"]): ChildRows["images"] =>
  images
    .slice()
    .sort(
      (a, b) =>
        a.position - b.position ||
        (a.url < b.url ? -1 : a.url > b.url ? 1 : 0) ||
        (a.role ?? "").localeCompare(b.role ?? ""),
    );

async function readChildRows(
  exec: Executor,
  pageId: string,
): Promise<ChildRows> {
  const [images, internal, external, meta] = await Promise.all([
    exec
      .select()
      .from(imagesTable)
      .where(eq(imagesTable.pageId, pageId))
      .orderBy(asc(imagesTable.position)),
    exec
      .select()
      .from(internalLinksTable)
      .where(eq(internalLinksTable.pageId, pageId))
      .orderBy(asc(internalLinksTable.position)),
    exec
      .select()
      .from(externalLinksTable)
      .where(eq(externalLinksTable.pageId, pageId))
      .orderBy(asc(externalLinksTable.position)),
    exec
      .select()
      .from(metadataTable)
      .where(eq(metadataTable.pageId, pageId))
      .limit(1),
  ]);
  const m = meta[0];
  return {
    images: images.map((i) => ({
      url: i.url,
      role: i.role,
      position: i.position,
    })),
    internal: internal.map((l) => ({
      href: l.href,
      anchorText: l.anchorText,
      rel: l.rel,
      position: l.position,
    })),
    external: external.map((l) => ({
      href: l.href,
      anchorText: l.anchorText,
      rel: l.rel,
      domain: l.domain,
      position: l.position,
    })),
    metadata: m
      ? {
          metaTags: m.metaTags,
          httpHeaders: m.httpHeaders,
          openGraph: m.openGraph,
          twitter: m.twitter,
          custom: m.custom,
        }
      : null,
  };
}

async function pageIdByCanonical(
  exec: Executor,
  canonicalUrl: string,
): Promise<string | undefined> {
  const [row] = await exec
    .select({ id: pagesTable.id })
    .from(pagesTable)
    .where(eq(pagesTable.canonicalUrl, canonicalUrl))
    .limit(1);
  return row?.id;
}

/**
 * Cheap, bounded sample selection for BOUNDED mode. Spans several independent
 * "stress" dimensions so the round-trip catches more than image-loss bugs, all
 * via small LIMITed aggregate queries (no full-corpus materialization):
 *   - the `topN` pages with the MOST images + the `bottomN` with the FEWEST
 *     (many-inline-image vs empty/near-empty shapes),
 *   - the page with the MOST internal + external links (link-heavy pages, where
 *     dropped/mangled links surface that image sampling never touches),
 *   - the page with the LARGEST assembled component tree (deeply nested blocks,
 *     where structural regressions hide).
 * De-duplicated, preserving the extremes a small corpus might share.
 */
async function pickSamplePageIds(
  topN: number,
  bottomN: number,
): Promise<string[]> {
  const imageCount = sql<number>`count(${imagesTable.id})`;
  const base = () =>
    db
      .select({ id: pagesTable.id })
      .from(pagesTable)
      .leftJoin(imagesTable, eq(imagesTable.pageId, pagesTable.id))
      .groupBy(pagesTable.id);
  const ids: string[] = [];
  if (topN > 0) {
    const top = await base()
      .orderBy(desc(imageCount), asc(pagesTable.slug))
      .limit(topN);
    ids.push(...top.map((r) => r.id));
  }
  if (bottomN > 0) {
    const bottom = await base()
      .orderBy(asc(imageCount), asc(pagesTable.slug))
      .limit(bottomN);
    ids.push(...bottom.map((r) => r.id));
  }

  // Page with the MOST internal + external links. count(distinct …) over the
  // two left joins avoids the cartesian-product double counting.
  const linkCount = sql<number>`count(distinct ${internalLinksTable.id}) + count(distinct ${externalLinksTable.id})`;
  const [mostLinks] = await db
    .select({ id: pagesTable.id })
    .from(pagesTable)
    .leftJoin(internalLinksTable, eq(internalLinksTable.pageId, pagesTable.id))
    .leftJoin(externalLinksTable, eq(externalLinksTable.pageId, pagesTable.id))
    .groupBy(pagesTable.id)
    .orderBy(desc(linkCount), asc(pagesTable.slug))
    .limit(1);
  if (mostLinks) ids.push(mostLinks.id);

  // Page with the LARGEST assembled component tree (one row per page), ranked by
  // the JSON text length so the deepest/most-complex tree is sampled.
  const [biggestTree] = await db
    .select({ id: componentTreeTable.pageId })
    .from(componentTreeTable)
    .orderBy(desc(sql`length(${componentTreeTable.tree}::text)`))
    .limit(1);
  if (biggestTree) ids.push(biggestTree.id);

  return [...new Set(ids)];
}

/** Split `items` into fixed-size chunks (the last chunk may be smaller). */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * The whole round-trip for ONE batch of pages: it loads only those pages into a
 * bundle, serializes them in every format, re-imports the JSON + Payload bundles
 * (matched, idempotent) and forces a backup→restore rewrite, asserting no
 * image/link/metadata is lost. The bundle and its per-page baseline are scoped
 * to this call, so they are GC'd between batches — peak memory tracks one batch,
 * not the whole corpus. This is the unit of work for BOTH modes: bounded mode
 * runs it once over the small sample; full mode runs it over every batch of the
 * corpus in turn.
 */
async function checkBatch(pageIds: string[]): Promise<void> {
  const bundle = await loadContentBundle(db, { pageIds });
  expect(bundle.posts.length, "batch loaded posts").toBeGreaterThan(0);

  // EXPORT: serialize this batch in every supported format without error.
  for (const format of EXPORT_FORMATS) {
    const text = serializeBundle(bundle, format);
    expect(typeof text, `serialized ${format}`).toBe("string");
    expect(text.length, `non-empty ${format}`).toBeGreaterThan(0);
  }

  // Capture the live DB child rows for each page in the batch (no-loss baseline).
  const baseline = new Map<string, ChildRows>();
  for (const post of bundle.posts) {
    const id = await pageIdByCanonical(db, post.canonicalUrl);
    expect(id, `page for ${post.slug} should exist`).toBeDefined();
    baseline.set(post.canonicalUrl, await readChildRows(db, id!));
  }

  // IMPORT (JSON): every post resolves by canonicalUrl (none created), and an
  // identical second pass in the same tx is fully idempotent.
  const parsedJson = parseBundle(serializeBundle(bundle, "json"), "json");
  expect(parsedJson.posts.length).toBe(bundle.posts.length);
  await inRolledBackTx(async (tx) => {
    const first = await importContentBundle(parsedJson, { exec: tx });
    expect(first.postsCreated).toBe(0);
    expect(first.postsUpdated + first.postsUnchanged).toBe(bundle.posts.length);
    // Internal links are resolved corpus-wide against the page set.
    expect(first.internalLinksResolved).toBeGreaterThanOrEqual(0);

    const second = await importContentBundle(parsedJson, { exec: tx });
    expect(second.postsCreated).toBe(0);
    expect(second.postsUpdated).toBe(0);
    expect(second.postsUnchanged).toBe(bundle.posts.length);
  });

  // IMPORT (Payload): posts matched (no duplicates created).
  const parsedPayload = parseBundle(
    serializeBundle(bundle, "payload"),
    "payload",
  );
  expect(parsedPayload.posts.length).toBe(bundle.posts.length);
  for (const post of parsedPayload.posts) {
    expect(post.canonicalUrl, "payload post carries canonicalUrl").toBeTruthy();
  }
  await inRolledBackTx(async (tx) => {
    const result = await importContentBundle(parsedPayload, { exec: tx });
    expect(result.postsCreated).toBe(0);
    expect(result.postsUpdated + result.postsUnchanged).toBe(
      parsedPayload.posts.length,
    );
  });

  // BACKUP → RESTORE: force the update (clear + rewrite children) path by bumping
  // each title, then read the freshly-written child rows back and assert nothing
  // was dropped for any page in the batch.
  const restored = parseBundle(serializeBundle(bundle, "json"), "json");
  const mutated: ContentBundle = {
    ...restored,
    posts: restored.posts.map((p) => ({
      ...p,
      title: `${p.title} [restore-check]`,
    })),
  };
  await inRolledBackTx(async (tx) => {
    const result = await importContentBundle(mutated, { exec: tx });
    expect(result.postsCreated).toBe(0);
    expect(result.postsUpdated).toBe(mutated.posts.length);

    for (const post of mutated.posts) {
      const id = await pageIdByCanonical(tx, post.canonicalUrl);
      expect(id, `restored page for ${post.slug}`).toBeDefined();
      const back = await readChildRows(tx, id!);
      const base = baseline.get(post.canonicalUrl)!;
      expect(sortImages(back.images), `images for ${post.slug}`).toEqual(
        sortImages(base.images),
      );
      expect(
        byPosition(back.internal),
        `internal links for ${post.slug}`,
      ).toEqual(byPosition(base.internal));
      expect(
        byPosition(back.external),
        `external links for ${post.slug}`,
      ).toEqual(byPosition(base.external));
      expect(back.metadata, `metadata for ${post.slug}`).toEqual(base.metadata);
    }
  });
}

describe.runIf(RUN)("CMS import/export/restore round-trip on real data", () => {
  // The batches of page ids to process, one bundle's worth at a time.
  let batches: string[][] = [];

  beforeAll(async () => {
    if (VERIFY_LIMIT !== null) {
      // BOUNDED mode: a single small sample batch resolved straight from the DB
      // (image extremes + the most-linked page + the largest component tree) —
      // never the whole corpus.
      const topN = Math.min(SAMPLE_TOP, VERIFY_LIMIT);
      const bottomN = VERIFY_LIMIT - topN;
      const ids = await pickSamplePageIds(topN, bottomN);
      expect(ids.length, "bounded sample resolved page ids").toBeGreaterThan(0);
      batches = [ids];
    } else {
      // FULL mode: chunk the ENTIRE corpus into fixed-size batches. Only the page
      // ids (not their content) are materialized here; each batch's content is
      // loaded + serialized + round-tripped one at a time in `checkBatch`, so
      // peak memory stays roughly flat as the blog grows instead of holding all
      // ~3.7k pages serialized in five formats at once.
      const rows = await db
        .select({ id: pagesTable.id })
        .from(pagesTable)
        .orderBy(asc(pagesTable.slug));
      expect(rows.length, "corpus page ids").toBeGreaterThan(0);
      batches = chunk(
        rows.map((r) => r.id),
        BATCH_SIZE,
      );
    }
  }, 600_000);

  afterAll(async () => {
    await pool.end();
  }, 60_000);

  it("round-trips every page with no image/link/metadata loss (batched)", async () => {
    expect(batches.length, "batches to process").toBeGreaterThan(0);
    for (const batch of batches) {
      await checkBatch(batch);
    }
  }, 3_600_000);
});
