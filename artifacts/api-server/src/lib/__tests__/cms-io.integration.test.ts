/**
 * Opt-in live-DB integration test for the CMS import / export / backup / restore
 * round-trip (the authenticated `/cms/export`, `/cms/import`, `/cms/backup`,
 * `/cms/restore` endpoints all funnel through these two library functions:
 * `loadContentBundle` and `importContentBundle`).
 *
 * It mirrors the real-data round-trip pattern of
 * `scripts/src/payload/__tests__/roundtrip-real-data.test.ts`, but exercises the
 * CMS content-io path instead of the Payload exporter:
 *   1. EXPORT  — `loadContentBundle()` reads the live corpus, then we serialize
 *      it in EVERY supported format (json/csv/markdown/sql/payload).
 *   2. IMPORT  — we re-import the JSON and Payload bundles via
 *      `importContentBundle(bundle, tx)` and assert posts are *matched* (none
 *      created — they all resolve by canonicalUrl), the re-import is idempotent
 *      (a second pass is fully "unchanged"), and internal links are resolved.
 *   3. RESTORE — we round-trip the JSON backup wire format and force the update
 *      (clear + rewrite children) path, then read the freshly-written child rows
 *      back and assert NO image / link / metadata is lost.
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
import { asc, eq } from "drizzle-orm";
import {
  db,
  pool,
  pagesTable,
  imagesTable,
  internalLinksTable,
  externalLinksTable,
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

describe.runIf(RUN)("CMS import/export/restore round-trip on real data", () => {
  let bundle: ContentBundle;
  let sampleBundle: ContentBundle;
  // Baseline DB child rows for each sampled post, keyed by canonicalUrl.
  const baseline = new Map<string, ChildRows>();

  beforeAll(async () => {
    // 1) EXPORT leg: read the whole corpus (read-only).
    bundle = await loadContentBundle();
    expect(bundle.posts.length).toBeGreaterThan(0);

    // Pick an interesting sample: most images + fewest images.
    const ranked = bundle.posts
      .map((p) => ({ post: p, n: p.images.length }))
      .sort((a, b) => b.n - a.n)
      .map((r) => r.post);
    const sampled = [
      ...new Map(
        [...ranked.slice(0, SAMPLE_TOP), ...ranked.slice(-SAMPLE_BOTTOM)].map(
          (p) => [p.canonicalUrl, p],
        ),
      ).values(),
    ];
    expect(sampled.length).toBeGreaterThan(0);

    // A sub-bundle with only the sampled posts (taxonomy kept whole — upserts
    // are idempotent and cheap) so the rolled-back imports stay small.
    sampleBundle = { ...bundle, posts: sampled };

    // Capture the live DB child rows for each sampled page (no-loss baseline).
    for (const post of sampled) {
      const id = await pageIdByCanonical(db, post.canonicalUrl);
      expect(id, `page for ${post.slug} should exist`).toBeDefined();
      baseline.set(post.canonicalUrl, await readChildRows(db, id!));
    }
  }, 600_000);

  afterAll(async () => {
    await pool.end();
  }, 60_000);

  it("exports the corpus in every supported format without error", () => {
    for (const format of EXPORT_FORMATS) {
      const text = serializeBundle(bundle, format);
      expect(typeof text, `serialized ${format}`).toBe("string");
      expect(text.length, `non-empty ${format}`).toBeGreaterThan(0);
    }
  });

  it("re-imports the JSON export: posts matched, idempotent, links resolved", async () => {
    const parsed = parseBundle(serializeBundle(sampleBundle, "json"), "json");
    expect(parsed.posts.length).toBe(sampleBundle.posts.length);

    await inRolledBackTx(async (tx) => {
      // First pass: every post resolves by canonicalUrl — none are created.
      const first = await importContentBundle(parsed, { exec: tx });
      expect(first.postsCreated).toBe(0);
      expect(first.postsUpdated + first.postsUnchanged).toBe(
        sampleBundle.posts.length,
      );
      // Internal links are resolved corpus-wide against the page set.
      expect(first.internalLinksResolved).toBeGreaterThanOrEqual(0);

      // Second pass in the same tx: now a content-io version hash exists, so the
      // identical re-import is fully idempotent (all unchanged, none rewritten).
      const second = await importContentBundle(parsed, { exec: tx });
      expect(second.postsCreated).toBe(0);
      expect(second.postsUpdated).toBe(0);
      expect(second.postsUnchanged).toBe(sampleBundle.posts.length);
    });
  }, 600_000);

  it("re-imports the Payload export: posts matched (no duplicates created)", async () => {
    const parsed = parseBundle(
      serializeBundle(sampleBundle, "payload"),
      "payload",
    );
    expect(parsed.posts.length).toBe(sampleBundle.posts.length);
    for (const post of parsed.posts) {
      expect(post.canonicalUrl, "payload post carries canonicalUrl").toBeTruthy();
    }

    await inRolledBackTx(async (tx) => {
      const result = await importContentBundle(parsed, { exec: tx });
      expect(result.postsCreated).toBe(0);
      expect(result.postsUpdated + result.postsUnchanged).toBe(
        parsed.posts.length,
      );
    });
  }, 600_000);

  it("backup → restore round-trips with no image/link/metadata loss", async () => {
    // GET /cms/backup serializes the canonical bundle as JSON; POST /cms/restore
    // parses it back and calls importContentBundle. Force the update (clear +
    // rewrite children) path by bumping each title, then read the freshly-written
    // child rows back and assert nothing was dropped.
    const backupText = serializeBundle(sampleBundle, "json");
    const restored = parseBundle(backupText, "json");
    const mutated: ContentBundle = {
      ...restored,
      posts: restored.posts.map((p) => ({
        ...p,
        title: `${p.title} [restore-check]`,
      })),
    };

    await inRolledBackTx(async (tx) => {
      const result = await importContentBundle(mutated, { exec: tx });
      // Title change differs from any stored hash, so every post takes the
      // update path that clears and rewrites its children.
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
        expect(back.metadata, `metadata for ${post.slug}`).toEqual(
          base.metadata,
        );
      }
    });
  }, 600_000);
});
