/**
 * Real-dataset round-trip verification (export -> load -> import).
 *
 * Unlike the synthetic `export-load.e2e.test.ts` (which seeds a fabricated DB),
 * this test runs the *real* exporter against the live migration database, loads
 * a small but deliberately-interesting sample of actual migrated pages into a
 * real (ephemeral SQLite) Payload instance, and re-imports the same export back
 * into the database — then asserts NO inline image / link / metadata is lost at
 * any hop. Its job is to catch shape surprises that hand-built fixtures don't
 * model: pages with many inline images, empty/absent metadata, unusual `rel`
 * values, etc.
 *
 * It is OPT-IN. Because it touches the real database (read-only) and boots
 * Payload, it only runs when `VERIFY_REAL_DATA=1` is set, so the normal test /
 * validation suite skips it (avoiding flakiness and Supabase pooler pressure).
 * Run it on demand with:
 *
 *   pnpm --filter @workspace/scripts run verify:roundtrip
 *
 * Non-destructive by construction:
 *  - the export leg only SELECTs;
 *  - the load leg targets a throwaway SQLite Payload and stubs media fetches;
 *  - the import leg runs inside a transaction that is always ROLLED BACK, so the
 *    live database is never mutated.
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
import { buildExport } from "../../export-payload.js";
import { importExport } from "../import.js";
import { loadPayloadExport, type PayloadLike } from "../load.js";
import type { PayloadExport, SourceMetadata } from "../mapping.js";
import { createTestPayload, type TestPayload } from "./payloadTestConfig";

const RUN = process.env.VERIFY_REAL_DATA === "1";

// How many real pages to sample. We take the pages with the MOST images (to
// stress many-inline-image pages) and the FEWEST (to cover empty/near-empty
// shapes), so a tiny sample still exercises both extremes.
const SAMPLE_TOP = 3;
const SAMPLE_BOTTOM = 2;

// A 1x1 transparent PNG, so the upload collection can store a real file without
// touching the network (every media URL resolves to this).
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const fetchImpl = (async () =>
  new Response(PNG_1x1, {
    status: 200,
    headers: { "content-type": "image/png" },
  })) as unknown as typeof fetch;

/** The child rows we assert no loss for, normalized to comparable shapes. */
interface ChildRows {
  /** Image rows by (url, role, position) — order-independent comparison. */
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
  metadata: SourceMetadata | null;
}

const byPosition = <T extends { position: number }>(rows: T[]): T[] =>
  rows.slice().sort((a, b) => a.position - b.position);

/** Read the inline-image / link / metadata rows for a page from the DB. */
async function readChildRows(
  exec: typeof db,
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

/**
 * Derive the image/link/metadata rows the export *says* a page has, in the same
 * normalized shape as {@link readChildRows}, so we can compare DB <-> export
 * and export <-> reimported DB directly.
 */
function expectedFromExport(
  data: PayloadExport,
  post: PayloadExport["collections"]["posts"][number],
): ChildRows {
  const mediaById = new Map(data.collections.media.map((m) => [m.id, m]));
  const images: ChildRows["images"] = [];
  if (post.heroImage) {
    const hero = mediaById.get(post.heroImage);
    if (hero) images.push({ url: hero.url, role: "featured", position: 0 });
  }
  for (const ii of post.inlineImages) {
    const m = mediaById.get(ii.image);
    if (m) images.push({ url: m.url, role: ii.role, position: ii.position });
  }
  return {
    images,
    internal: post.links.internal.map((l) => ({
      href: l.href,
      anchorText: l.anchorText,
      rel: l.rel,
      position: l.position,
    })),
    external: post.links.external.map((l) => ({
      href: l.href,
      anchorText: l.anchorText,
      rel: l.rel,
      domain: l.domain,
      position: l.position,
    })),
    metadata: post.metadata,
  };
}

/** Compare two image lists ignoring order (import normalizes hero to pos 0). */
function sortImages(images: ChildRows["images"]): ChildRows["images"] {
  return images
    .slice()
    .sort(
      (a, b) =>
        a.position - b.position ||
        (a.url < b.url ? -1 : a.url > b.url ? 1 : 0) ||
        (a.role ?? "").localeCompare(b.role ?? ""),
    );
}

class Rollback extends Error {}

interface PayloadPostReadback {
  inlineImages: Array<{
    image: string | number;
    role: string | null;
    position: number;
  }>;
  links: {
    internal: ChildRows["internal"];
    external: ChildRows["external"];
  };
  metadata: SourceMetadata | null;
}

describe.runIf(RUN)("export -> load -> import round-trip on real data", () => {
  let data: PayloadExport;
  let sample: PayloadExport["collections"]["posts"];
  let tp: TestPayload;
  let idMap: Map<string, string | number>;
  // original DB rows (export leg baseline), keyed by original page id
  const dbRows = new Map<string, ChildRows>();
  // rows read back from the rolled-back re-import, keyed by original page id
  const reimported = new Map<string, ChildRows>();
  // posts read back from Payload after load, keyed by original page id
  const payloadPosts = new Map<string, PayloadPostReadback>();

  beforeAll(async () => {
    // 1) Pick an interesting sample: pages with the most + fewest images.
    const [allPages, allImages] = await Promise.all([
      db.select({ id: pagesTable.id }).from(pagesTable),
      db.select({ pageId: imagesTable.pageId }).from(imagesTable),
    ]);
    const countByPage = new Map<string, number>();
    for (const p of allPages) countByPage.set(p.id, 0);
    for (const i of allImages) {
      if (i.pageId && countByPage.has(i.pageId)) {
        countByPage.set(i.pageId, (countByPage.get(i.pageId) ?? 0) + 1);
      }
    }
    const ranked = [...countByPage.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    const sampleIds = [
      ...new Set([
        ...ranked.slice(0, SAMPLE_TOP),
        ...ranked.slice(-SAMPLE_BOTTOM),
      ]),
    ];
    expect(sampleIds.length).toBeGreaterThan(0);

    // 2) Export leg: run the REAL exporter against the live DB for the sample.
    data = await buildExport({ pageIds: sampleIds });
    sample = data.collections.posts;
    expect(sample.length).toBe(sampleIds.length);

    // Capture the live DB child rows for each sampled page (export-leg baseline).
    for (const post of sample) {
      dbRows.set(post.id, await readChildRows(db, post.id));
    }

    // 3) Load leg: into a throwaway Payload instance, media fetch stubbed.
    tp = await createTestPayload();
    const res = await loadPayloadExport(
      tp.payload as unknown as PayloadLike,
      data.collections,
      { fetchImpl },
    );
    idMap = res.idMap;
    for (const post of sample) {
      const pid = idMap.get(post.id);
      expect(pid, `post ${post.slug} should have a Payload id`).toBeDefined();
      const doc = (await tp.payload.findByID({
        collection: "posts",
        id: pid!,
        depth: 0,
      })) as unknown as {
        inlineImages?: Array<{
          image: string | number;
          role: string | null;
          position: number;
        }> | null;
        links?: {
          internal?: ChildRows["internal"] | null;
          external?: ChildRows["external"] | null;
        } | null;
        metadata?: SourceMetadata | null;
      };
      payloadPosts.set(post.id, {
        inlineImages: (doc.inlineImages ?? []).map((ii) => ({
          image: ii.image,
          role: ii.role,
          position: ii.position,
        })),
        links: {
          internal: (doc.links?.internal ?? []).map((l) => ({
            href: l.href,
            anchorText: l.anchorText,
            rel: l.rel,
            position: l.position,
          })),
          external: (doc.links?.external ?? []).map((l) => ({
            href: l.href,
            anchorText: l.anchorText,
            rel: l.rel,
            domain: l.domain,
            position: l.position,
          })),
        },
        metadata: doc.metadata ?? null,
      });
    }

    // 4) Import leg: re-import the export into the real DB inside a transaction
    // that is always rolled back, then read the freshly-written child rows back
    // (within the same transaction, before rollback) to assert no loss.
    try {
      await db.transaction(async (tx) => {
        await importExport(data.collections, tx as unknown as typeof db);
        for (const post of sample) {
          const [row] = await tx
            .select({ id: pagesTable.id })
            .from(pagesTable)
            .where(eq(pagesTable.canonicalUrl, post.url.canonicalUrl))
            .limit(1);
          expect(
            row,
            `imported page for ${post.slug} should resolve by canonicalUrl`,
          ).toBeDefined();
          reimported.set(
            post.id,
            await readChildRows(tx as unknown as typeof db, row!.id),
          );
        }
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }, 180_000);

  afterAll(async () => {
    await tp?.cleanup();
    await pool.end();
  });

  it("export preserves every inline image, link and metadata bag from the DB", () => {
    for (const post of sample) {
      const fromDb = dbRows.get(post.id)!;
      const fromExport = expectedFromExport(data, post);
      // Inline images: the export carries the hero (separately) + every inline
      // image; together they must equal the page's full image set in the DB.
      expect(sortImages(fromExport.images), `images for ${post.slug}`).toEqual(
        sortImages(fromDb.images),
      );
      expect(
        byPosition(fromExport.internal),
        `internal links for ${post.slug}`,
      ).toEqual(byPosition(fromDb.internal));
      expect(
        byPosition(fromExport.external),
        `external links for ${post.slug}`,
      ).toEqual(byPosition(fromDb.external));
      expect(fromExport.metadata, `metadata for ${post.slug}`).toEqual(
        fromDb.metadata,
      );
    }
  });

  it("Payload load preserves inline images, links and metadata", () => {
    for (const post of sample) {
      const loaded = payloadPosts.get(post.id)!;
      // Inline images (hero excluded — it round-trips via heroImage): same
      // count, same role/position, and each points at the remapped media doc.
      const expectedInline = post.inlineImages.map((ii) => ({
        image: idMap.get(ii.image) ?? null,
        role: ii.role,
        position: ii.position,
      }));
      expect(
        loaded.inlineImages,
        `loaded inline images for ${post.slug}`,
      ).toEqual(expectedInline);
      expect(
        byPosition(loaded.links.internal),
        `loaded internal links for ${post.slug}`,
      ).toEqual(byPosition(post.links.internal));
      expect(
        byPosition(loaded.links.external),
        `loaded external links for ${post.slug}`,
      ).toEqual(byPosition(post.links.external));
      expect(loaded.metadata, `loaded metadata for ${post.slug}`).toEqual(
        post.metadata,
      );
    }
  });

  it("import round-trips inline images, links and metadata back into the DB", () => {
    for (const post of sample) {
      const back = reimported.get(post.id)!;
      const expected = expectedFromExport(data, post);
      expect(
        sortImages(back.images),
        `reimported images for ${post.slug}`,
      ).toEqual(sortImages(expected.images));
      expect(
        byPosition(back.internal),
        `reimported internal links for ${post.slug}`,
      ).toEqual(byPosition(expected.internal));
      expect(
        byPosition(back.external),
        `reimported external links for ${post.slug}`,
      ).toEqual(byPosition(expected.external));
      expect(back.metadata, `reimported metadata for ${post.slug}`).toEqual(
        expected.metadata,
      );
    }
  });
});
