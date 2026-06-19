process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = "silent";

/**
 * Real-data, end-to-end integration test for the audit logging on
 * `PATCH /cms/media/alt`.
 *
 * The in-memory fake DB used by the route's RBAC test (`cms-media.test.ts`)
 * does not implement `db.execute`, so the route's before/after alt snapshot SQL
 * (`updateAltByUrl`) and the audit insert (`recordAudit`) are never exercised
 * in CI. This test drives the REAL Express route via supertest against the LIVE
 * migration database: it seeds a real admin session, saves new alt text for a
 * known image, and asserts a `media.metadata.update` audit row is written with
 * the documented shape (entityId = CDN URL, before/after = {alt, altStatus}).
 * It also asserts the 404 path (unknown URL) writes NO audit row.
 *
 * It is OPT-IN. Because it WRITES to the real database, it only runs when
 * `VERIFY_REAL_DATA=1` is set, so the normal test / validation suite skips it.
 * Run it on demand with:
 *
 *   pnpm --filter @workspace/api-server run verify:media-audit
 *
 * Non-destructive by construction: every mutation is undone in `afterAll` —
 * each touched `images` row's alt is restored to its original value, the audit
 * rows it wrote are deleted, and the seeded user + session rows are removed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import {
  db,
  pool,
  imagesTable,
  auditLogsTable,
  usersTable,
  sessionsTable,
} from "@workspace/db";
import { sql, eq } from "drizzle-orm";

const RUN = process.env.VERIFY_REAL_DATA === "1";

// --- Independent JS oracle mirroring `altStatusCaseSql` in lib/media.ts. -----
// Kept deliberately separate from the production source so the test fails if
// the SQL classification drifts from the documented rules.
type AltStatus = "ok" | "missing" | "poor";
const MIN_ALT_LENGTH = 10;
const GENERIC_ALT_WORDS = new Set([
  "image",
  "photo",
  "picture",
  "img",
  "untitled",
  "logo",
  "icon",
  "banner",
  "thumbnail",
  "image1",
  "photo1",
]);
const FILENAME_RE = /\.(jpg|jpeg|png|gif|webp|svg|avif)$/;

/** Mirror Postgres `btrim` (default: strips spaces only, not all whitespace). */
function btrim(s: string): string {
  return s.replace(/^ +/, "").replace(/ +$/, "");
}

/** Independent re-implementation of the SQL alt-status CASE expression. */
function classifyAlt(alt: string | null): AltStatus {
  if (alt == null) return "missing";
  const trimmed = btrim(alt);
  if (trimmed === "") return "missing";
  const lower = trimmed.toLowerCase();
  const len = Array.from(trimmed).length;
  if (len < MIN_ALT_LENGTH || GENERIC_ALT_WORDS.has(lower) || FILENAME_RE.test(lower)) {
    return "poor";
  }
  return "ok";
}

// A descriptive, non-generic, non-filename alt long enough to classify "ok".
const NEW_ALT = `End-to-end audit verification alt text ${randomUUID()}`;
// A URL that does not exist in the corpus — exercises the 404 / no-audit path.
const UNKNOWN_URL = `https://cdn.example.invalid/never-${randomUUID()}.jpg`;

describe.runIf(RUN)("PATCH /api/cms/media/alt audit logging (real data)", () => {
  let server: import("express").Express;

  // The known image we edit, and the snapshot needed to restore it.
  let targetUrl = "";
  let originalRows: Array<{ id: string; alt: string | null }> = [];
  // The seeded admin actor + session.
  const userId = `test-audit-actor-${randomUUID()}`;
  const userEmail = `${userId}@example.test`;
  let sid = "";

  beforeAll(async () => {
    server = (await import("../../app")).default;

    // Pick the busiest image URL: a "known" item used on >=1 page. Snapshot
    // every row sharing that URL so we can restore exact original alts later.
    const pick = await db.execute(sql`
      SELECT url FROM images
      GROUP BY url
      ORDER BY count(*) DESC, url ASC
      LIMIT 1
    `);
    targetUrl = String((pick.rows[0] as Record<string, unknown>).url);
    expect(targetUrl.length).toBeGreaterThan(0);

    const rows = await db
      .select({ id: imagesTable.id, alt: imagesTable.alt })
      .from(imagesTable)
      .where(eq(imagesTable.url, targetUrl));
    originalRows = rows.map((r) => ({ id: r.id, alt: r.alt }));
    expect(originalRows.length).toBeGreaterThan(0);

    // Seed a real admin user + session so the route's auth + RBAC chain passes.
    await db
      .insert(usersTable)
      .values({ id: userId, email: userEmail, role: "admin" });

    sid = randomUUID().replace(/-/g, "");
    await db.insert(sessionsTable).values({
      sid,
      sess: {
        user: {
          id: userId,
          email: userEmail,
          firstName: "Audit",
          lastName: "Tester",
          profileImageUrl: null,
        },
        access_token: "test-token",
      },
      expire: new Date(Date.now() + 60 * 60 * 1000),
    });
  }, 120_000);

  afterAll(async () => {
    // Restore every touched image row's alt to its original value.
    for (const row of originalRows) {
      await db
        .update(imagesTable)
        .set({ alt: row.alt })
        .where(eq(imagesTable.id, row.id));
    }
    // Remove the audit rows this test wrote, then the seeded session + user.
    await db.delete(auditLogsTable).where(eq(auditLogsTable.actorId, userId));
    if (sid) await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await pool.end();
  }, 60_000);

  it("writes a media.metadata.update audit row with the correct entityId + before/after on save", async () => {
    // The representative (longest) original alt is what the route snapshots as
    // `before`. Tie-breaking among equal-length alts is nondeterministic, so we
    // assert membership + max-length rather than a single fixed value.
    const maxLen = Math.max(
      ...originalRows.map((r) => Array.from(btrim(r.alt ?? "")).length),
    );

    const res = await request(server)
      .patch("/api/cms/media/alt")
      .set("Authorization", `Bearer ${sid}`)
      .send({ url: targetUrl, alt: NEW_ALT });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe(targetUrl);
    expect(res.body.alt).toBe(NEW_ALT);
    expect(res.body.updatedUsages).toBe(originalRows.length);

    // Exactly one audit row should have been written for this entity.
    const auditRows = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.entityId, targetUrl));
    const mine = auditRows.filter(
      (r) =>
        r.actorId === userId && r.action === "media.metadata.update",
    );
    expect(mine.length).toBe(1);
    const entry = mine[0];

    expect(entry.entityType).toBe("media");
    expect(entry.entityId).toBe(targetUrl);
    expect(entry.actorRole).toBe("admin");
    expect(entry.actorEmail).toBe(userEmail);

    const before = entry.before as { alt: string | null; altStatus: AltStatus };
    const after = entry.after as { alt: string | null; altStatus: AltStatus };

    // `before.alt` must be one of the original stored alts AND a longest one,
    // and its recorded status must match the independent classifier.
    const originalAlts = originalRows.map((r) => r.alt);
    expect(originalAlts).toContain(before.alt);
    expect(Array.from(btrim(before.alt ?? "")).length).toBe(maxLen);
    expect(before.altStatus).toBe(classifyAlt(before.alt));

    // `after` reflects the freshly-saved alt (long + descriptive => "ok").
    expect(after.alt).toBe(NEW_ALT);
    expect(after.altStatus).toBe("ok");
    expect(classifyAlt(after.alt)).toBe("ok");

    // The metadata envelope carries the URL + how many usages were updated.
    const metadata = entry.metadata as { url: string; updatedUsages: number };
    expect(metadata.url).toBe(targetUrl);
    expect(metadata.updatedUsages).toBe(originalRows.length);
  });

  it("does NOT write an audit row when the URL is unknown (404)", async () => {
    const before = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.entityId, UNKNOWN_URL));
    expect(before.length).toBe(0);

    const res = await request(server)
      .patch("/api/cms/media/alt")
      .set("Authorization", `Bearer ${sid}`)
      .send({ url: UNKNOWN_URL, alt: NEW_ALT });

    expect(res.status).toBe(404);

    const after = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.entityId, UNKNOWN_URL));
    expect(after.length).toBe(0);
  });
});
