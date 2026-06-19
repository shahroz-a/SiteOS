import { describe, expect, it } from "vitest";
import {
  buildCleanupRecord,
  planRedirectCleanup,
  planRedirectRestore,
  type CleanupRunRecord,
} from "../../cleanup-redirects";

describe("planRedirectCleanup", () => {
  it("leaves serveable active redirects untouched", () => {
    const actions = planRedirectCleanup(
      [{ id: "1", fromPath: "/blog/old-name/", toPath: "/blog/new-name/" }],
      new Set(["/blog/old-name/"]),
    );
    expect(actions).toEqual([]);
  });

  it("repairs a malformed path that only had accidental repeated slashes", () => {
    const actions = planRedirectCleanup(
      [{ id: "1", fromPath: "/blog/acropolis//tickets/", toPath: "/blog/acropolis-tickets/" }],
      new Set(["/blog/acropolis//tickets/"]),
    );
    expect(actions).toEqual([
      {
        kind: "repair",
        id: "1",
        fromPath: "/blog/acropolis//tickets/",
        toPath: "/blog/acropolis-tickets/",
        reason: "malformed-segment",
        newFromPath: "/blog/acropolis/tickets/",
      },
    ]);
  });

  it("deactivates a non-blog source (cannot be salvaged)", () => {
    const actions = planRedirectCleanup(
      [{ id: "1", fromPath: "/london-theatre-tickets/foo/", toPath: "/blog/new/" }],
      new Set(["/london-theatre-tickets/foo/"]),
    );
    expect(actions).toEqual([
      {
        kind: "deactivate",
        id: "1",
        fromPath: "/london-theatre-tickets/foo/",
        toPath: "/blog/new/",
        reason: "non-blog-source",
      },
    ]);
  });

  it("deactivates a true self-redirect (normalizing can't break the loop)", () => {
    const actions = planRedirectCleanup(
      [{ id: "1", fromPath: "/blog/loop/", toPath: "/blog/loop/" }],
      new Set(["/blog/loop/"]),
    );
    expect(actions).toEqual([
      {
        kind: "deactivate",
        id: "1",
        fromPath: "/blog/loop/",
        toPath: "/blog/loop/",
        reason: "self-redirect",
      },
    ]);
  });

  it("deactivates irrecoverable junk segments (embedded URLs, encoded punctuation)", () => {
    const actions = planRedirectCleanup(
      [
        {
          id: "1",
          fromPath: "/blog/x/https://www.headout.com/blog/y/",
          toPath: "/blog/new/",
        },
        { id: "2", fromPath: "/blog/with%20space/", toPath: "/blog/new/" },
      ],
      new Set(["/blog/x/https://www.headout.com/blog/y/", "/blog/with%20space/"]),
    );
    expect(actions.every((a) => a.kind === "deactivate")).toBe(true);
    expect(actions).toHaveLength(2);
    expect(actions.map((a) => a.reason)).toEqual([
      "malformed-segment",
      "malformed-segment",
    ]);
  });

  it("deactivates instead of repairing when the salvaged path would become a self-loop", () => {
    // Normalizing "/blog//foo/" yields "/blog/foo/", which equals the target →
    // a self-redirect, so the row must be deactivated, not repaired.
    const actions = planRedirectCleanup(
      [{ id: "1", fromPath: "/blog//foo/", toPath: "/blog/foo/" }],
      new Set(["/blog//foo/"]),
    );
    expect(actions).toEqual([
      {
        kind: "deactivate",
        id: "1",
        fromPath: "/blog//foo/",
        toPath: "/blog/foo/",
        reason: "malformed-segment",
      },
    ]);
  });

  it("deactivates instead of repairing when the salvaged path collides with an existing row", () => {
    const actions = planRedirectCleanup(
      [{ id: "1", fromPath: "/blog/dup//path/", toPath: "/blog/target/" }],
      // The clean form already exists on another row.
      new Set(["/blog/dup//path/", "/blog/dup/path/"]),
    );
    expect(actions).toEqual([
      {
        kind: "deactivate",
        id: "1",
        fromPath: "/blog/dup//path/",
        toPath: "/blog/target/",
        reason: "malformed-segment",
      },
    ]);
  });

  it("does not salvage two junk rows onto the same clean path", () => {
    const actions = planRedirectCleanup(
      [
        { id: "1", fromPath: "/blog/dup//path/", toPath: "/blog/a/" },
        { id: "2", fromPath: "/blog/dup///path/", toPath: "/blog/b/" },
      ],
      new Set(["/blog/dup//path/", "/blog/dup///path/"]),
    );
    const repairs = actions.filter((a) => a.kind === "repair");
    const deactivations = actions.filter((a) => a.kind === "deactivate");
    expect(repairs).toHaveLength(1);
    expect(deactivations).toHaveLength(1);
    expect(repairs[0]?.newFromPath).toBe("/blog/dup/path/");
  });
});

describe("buildCleanupRecord", () => {
  it("captures exactly which ids were repaired and deactivated", () => {
    const actions = planRedirectCleanup(
      [
        { id: "r1", fromPath: "/blog/acropolis//tickets/", toPath: "/blog/acropolis-tickets/" },
        { id: "d1", fromPath: "/london-theatre-tickets/foo/", toPath: "/blog/new/" },
      ],
      new Set(["/blog/acropolis//tickets/", "/london-theatre-tickets/foo/"]),
    );
    const record = buildCleanupRecord(actions, "2026-06-19T00:00:00.000Z");
    expect(record).toEqual({
      ranAt: "2026-06-19T00:00:00.000Z",
      repaired: [
        {
          id: "r1",
          originalFromPath: "/blog/acropolis//tickets/",
          newFromPath: "/blog/acropolis/tickets/",
          toPath: "/blog/acropolis-tickets/",
          reason: "malformed-segment",
        },
      ],
      deactivated: [
        {
          id: "d1",
          fromPath: "/london-theatre-tickets/foo/",
          toPath: "/blog/new/",
          reason: "non-blog-source",
        },
      ],
    });
  });
});

describe("planRedirectRestore", () => {
  it("reactivates deactivated rows and reverts repaired from_paths", () => {
    const record: CleanupRunRecord = {
      ranAt: "2026-06-19T00:00:00.000Z",
      repaired: [
        {
          id: "r1",
          originalFromPath: "/blog/acropolis//tickets/",
          newFromPath: "/blog/acropolis/tickets/",
          toPath: "/blog/acropolis-tickets/",
          reason: "malformed-segment",
        },
      ],
      deactivated: [
        {
          id: "d1",
          fromPath: "/london-theatre-tickets/foo/",
          toPath: "/blog/new/",
          reason: "non-blog-source",
        },
      ],
    };
    expect(planRedirectRestore(record)).toEqual([
      {
        kind: "revert-path",
        id: "r1",
        fromPath: "/blog/acropolis//tickets/",
        currentFromPath: "/blog/acropolis/tickets/",
      },
      {
        kind: "reactivate",
        id: "d1",
        fromPath: "/london-theatre-tickets/foo/",
      },
    ]);
  });

  it("undoes a full apply run produced by buildCleanupRecord (round-trip)", () => {
    const actions = planRedirectCleanup(
      [
        { id: "r1", fromPath: "/blog/dup//path/", toPath: "/blog/target/" },
        { id: "d1", fromPath: "/blog/loop/", toPath: "/blog/loop/" },
        { id: "d2", fromPath: "/other-site/foo/", toPath: "/blog/new/" },
      ],
      new Set(["/blog/dup//path/", "/blog/loop/", "/other-site/foo/"]),
    );
    const record = buildCleanupRecord(actions, "2026-06-19T00:00:00.000Z");
    const restore = planRedirectRestore(record);

    // Every repaired row gets its original path back...
    for (const r of record.repaired) {
      expect(restore).toContainEqual({
        kind: "revert-path",
        id: r.id,
        fromPath: r.originalFromPath,
        currentFromPath: r.newFromPath,
      });
    }
    // ...and every deactivated row is reactivated.
    for (const d of record.deactivated) {
      expect(restore).toContainEqual({
        kind: "reactivate",
        id: d.id,
        fromPath: d.fromPath,
      });
    }
    expect(restore).toHaveLength(
      record.repaired.length + record.deactivated.length,
    );
  });

  it("produces no actions for an empty cleanup record", () => {
    const record: CleanupRunRecord = {
      ranAt: "2026-06-19T00:00:00.000Z",
      repaired: [],
      deactivated: [],
    };
    expect(planRedirectRestore(record)).toEqual([]);
  });
});
