import { describe, expect, it } from "vitest";
import { planRedirectCleanup } from "../../cleanup-redirects";

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
