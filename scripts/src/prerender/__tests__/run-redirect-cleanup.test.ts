import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit test for `runRedirectCleanup` (`cleanup-redirects.ts`) — the reusable
 * entry point the standalone CLI and the crawl/report pipeline both call. It
 * verifies the machine-readable summary it returns and that the apply path
 * actually repairs/deactivates rows (while a dry run leaves them untouched),
 * driven against a tiny in-memory fake of the `@workspace/db` redirects table.
 */

type Redirect = { id: string; fromPath: string; toPath: string; isActive: boolean };

let rows: Redirect[] = [];

type ColRef = { __col: string };
type UpdateCond =
  | { __op: "eq"; col: ColRef; val: unknown }
  | { __op: "inArray"; col: ColRef; vals: unknown[] };

function makeTx() {
  return {
    update: (_t: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: (cond: UpdateCond) => {
          for (const r of rows as unknown as Array<Record<string, unknown>>) {
            const match =
              cond.__op === "eq"
                ? r[cond.col.__col] === cond.val
                : cond.vals.includes(r[cond.col.__col]);
            if (match) Object.assign(r, vals);
          }
          return Promise.resolve();
        },
      }),
    }),
  };
}

const redirectsTable = new Proxy(
  {},
  { get: (_t, p) => ({ __col: String(p) }) },
) as Record<string, ColRef>;

const db = {
  select: (proj: Record<string, ColRef>) => ({
    from: (_t: unknown) =>
      Promise.resolve(
        rows.map((r) => {
          const out: Record<string, unknown> = {};
          for (const [k, c] of Object.entries(proj)) {
            out[k] = (r as unknown as Record<string, unknown>)[c.__col];
          }
          return out;
        }),
      ),
  }),
  transaction: async (cb: (tx: ReturnType<typeof makeTx>) => Promise<void>) => {
    await cb(makeTx());
  },
};

vi.mock("@workspace/db", () => ({ db, pool: { end: async () => {} }, redirectsTable }));
vi.mock("drizzle-orm", () => ({
  eq: (col: ColRef, val: unknown) => ({ __op: "eq", col, val }),
  inArray: (col: ColRef, vals: unknown[]) => ({ __op: "inArray", col, vals }),
}));

const { runRedirectCleanup } = await import("../../cleanup-redirects");

const noopLog = () => {};

beforeEach(() => {
  rows = [
    // Serveable — must be left alone.
    { id: "ok", fromPath: "/blog/old/", toPath: "/blog/new/", isActive: true },
    // Repairable — accidental double slash.
    { id: "dup", fromPath: "/blog/acropolis//tickets/", toPath: "/blog/acropolis-tickets/", isActive: true },
    // Off-blog source — must be deactivated.
    { id: "off", fromPath: "/london-tickets/", toPath: "/blog/new/", isActive: true },
    // True self-loop — must be deactivated.
    { id: "loop", fromPath: "/blog/loop/", toPath: "/blog/loop/", isActive: true },
    // Inactive — never considered.
    { id: "inactive", fromPath: "/off-blog/", toPath: "/blog/new/", isActive: false },
  ];
});

describe("runRedirectCleanup", () => {
  it("dry run reports the plan without mutating any rows", async () => {
    const before = structuredClone(rows);
    const summary = await runRedirectCleanup({ apply: false, log: noopLog });

    expect(summary.applied).toBe(false);
    expect(summary.total).toBe(5);
    expect(summary.active).toBe(4);
    expect(summary.forwardingNowhere).toBe(3);
    expect(summary.repairs).toBe(1);
    expect(summary.deactivations).toBe(2);
    expect(summary.repairsByReason).toEqual({ "malformed-segment": 1 });
    expect(summary.deactivationsByReason).toEqual({
      "non-blog-source": 1,
      "self-redirect": 1,
    });

    // Nothing written.
    expect(rows).toEqual(before);
  });

  it("apply repairs and deactivates the forwards-to-nowhere rows", async () => {
    const summary = await runRedirectCleanup({ apply: true, log: noopLog });
    expect(summary.applied).toBe(true);
    expect(summary.repairs).toBe(1);
    expect(summary.deactivations).toBe(2);

    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    // Serveable row untouched.
    expect(byId.ok).toMatchObject({ fromPath: "/blog/old/", isActive: true });
    // Repaired: double slash collapsed, still active.
    expect(byId.dup).toMatchObject({ fromPath: "/blog/acropolis/tickets/", isActive: true });
    // Deactivated, paths preserved.
    expect(byId.off).toMatchObject({ fromPath: "/london-tickets/", isActive: false });
    expect(byId.loop).toMatchObject({ fromPath: "/blog/loop/", isActive: false });
    // Inactive row stays inactive and unconsidered.
    expect(byId.inactive).toMatchObject({ isActive: false });
  });
});
