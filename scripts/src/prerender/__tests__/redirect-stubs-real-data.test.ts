/**
 * Post-build verification: real prerender against the LIVE database.
 *
 * The unit test (`prerender-blog.test.ts`) runs the prerender against an
 * in-memory fake DB. That proves the *logic* but can't catch a regression in
 * the real build path: a changed query, a drifted `redirects` table shape, or a
 * real renamed/retired URL whose stub silently stops being written. This opt-in
 * check closes that gap. It runs the REAL redirect prerender
 * (`prerenderRedirects`, the exact function `run()` uses) against the live
 * `redirects` table into a throwaway dist dir, then asserts that — for actual
 * known renamed (on-blog) and retired (off-blog) URLs — the forwarding stub
 * files were materialised on disk with the correct meta-refresh + canonical
 * targets.
 *
 * It deliberately covers BOTH redirect kinds the task cares about:
 *  - an on-blog rename (old slug -> new `/blog/...` slug, root-relative target);
 *  - an off-blog / retired page (old slug -> absolute `https://www.headout.com/...`).
 *
 * OPT-IN. Like the payload round-trip, it touches the real database and so only
 * runs when `VERIFY_REAL_DATA=1` is set; the normal test / validation suite
 * skips it (avoiding flakiness and pooler pressure). Run it on demand with:
 *
 *   pnpm --filter @workspace/scripts run verify:redirects
 *
 * Non-destructive by construction: the prerender only SELECTs from the DB and
 * writes into a temp dist dir that is removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const RUN = process.env.VERIFY_REAL_DATA === "1";

interface RedirectRow {
  fromPath: string;
  toPath: string;
}

/** A single chosen redirect plus its expected on-disk artifacts. */
interface VerifiableStub {
  fromPath: string;
  toPath: string;
  /** Resolved forwarding target (root-relative on-blog or absolute off-blog). */
  target: string;
  /** `<rel>.html` and `<rel>/index.html`, relative to the dist dir. */
  files: [string, string];
}

describe.skipIf(!RUN)("redirect stubs — real prerender against live DB", () => {
  let DIST = "";
  // Resolved after a real prerender run: known on-blog renames and off-blog /
  // retired redirects whose stubs were actually written (i.e. not clobbered by
  // a still-live article at the same path).
  let onBlog: VerifiableStub[] = [];
  let offBlog: VerifiableStub[] = [];

  beforeAll(async () => {
    DIST = mkdtempSync(path.join(os.tmpdir(), "verify-redirects-"));
    await mkdir(DIST, { recursive: true });

    const { db, redirectsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { redirectFilePaths, redirectTargetUrl } = await import(
      "../redirects"
    );
    const { prerenderRedirects } = await import("../../prerender-blog");

    // The real redirect prerender: query the live DB and materialise every stub.
    await prerenderRedirects(DIST);

    const rows: RedirectRow[] = await db
      .select({
        fromPath: redirectsTable.fromPath,
        toPath: redirectsTable.toPath,
      })
      .from(redirectsTable)
      .where(eq(redirectsTable.isActive, true));

    // A stub was actually written only if the safe path produced files AND the
    // file on disk is a forwarding stub (a live article/category/author page at
    // the same path legitimately wins, so skip those — they aren't redirects).
    const stubWritten = (fromPath: string): [string, string] | null => {
      const files = redirectFilePaths(fromPath);
      if (!files) return null;
      const flat = path.join(DIST, files[0]);
      if (!existsSync(flat)) return null;
      const html = readFileSync(flat, "utf8");
      if (!html.includes('http-equiv="refresh"')) return null; // real content won
      return [files[0], files[1]];
    };

    for (const r of rows) {
      const files = stubWritten(r.fromPath);
      if (!files) continue;
      const target = redirectTargetUrl(r.toPath);
      const entry: VerifiableStub = {
        fromPath: r.fromPath,
        toPath: r.toPath,
        target,
        files,
      };
      if (r.toPath.startsWith("/blog/")) onBlog.push(entry);
      else offBlog.push(entry);
    }
  }, 600_000);

  afterAll(async () => {
    if (DIST) rmSync(DIST, { recursive: true, force: true });
    try {
      const { pool } = await import("@workspace/db");
      await pool.end();
    } catch {
      // pool may already be closed; ignore.
    }
  });

  async function assertStub(stub: VerifiableStub): Promise<void> {
    const { renderRedirectHtml } = await import("../redirects");
    const expected = renderRedirectHtml(stub.target);

    const flat = await readFile(path.join(DIST, stub.files[0]), "utf8");
    // The exact bytes the redirect helper produces (escaping included).
    expect(flat).toBe(expected);
    // ...and, spelled out, the crawler-facing forwarding signals the task asks
    // us to guarantee point at the right destination.
    expect(flat).toContain(
      `<meta http-equiv="refresh" content="0; url=${stub.target}" />`,
    );
    expect(flat).toContain(`<link rel="canonical" href="${stub.target}" />`);
    expect(flat).toContain('<meta name="robots" content="noindex, follow" />');

    // Both clean-URL forms are written and byte-identical, so the old URL
    // resolves with or without a trailing slash.
    const nested = await readFile(path.join(DIST, stub.files[1]), "utf8");
    expect(nested).toBe(flat);
  }

  it("materialises forwarding stubs for renamed on-blog article URLs", async () => {
    expect(
      onBlog.length,
      "no active on-blog rename redirects produced a stub; the redirects table " +
        "or the prerender redirect step has regressed",
    ).toBeGreaterThan(0);

    for (const stub of onBlog.slice(0, 5)) {
      // On-blog renames forward to a root-relative /blog/... target.
      expect(stub.target.startsWith("/blog/")).toBe(true);
      await assertStub(stub);
    }
  });

  it("materialises forwarding stubs for retired / off-blog URLs", async () => {
    expect(
      offBlog.length,
      "no active off-blog/retired redirects produced a stub; the redirects " +
        "table or the prerender redirect step has regressed",
    ).toBeGreaterThan(0);

    for (const stub of offBlog.slice(0, 5)) {
      // Off-blog/retired pages forward to an absolute Headout URL.
      expect(stub.target.startsWith("https://www.headout.com/")).toBe(true);
      await assertStub(stub);
    }
  });
});
