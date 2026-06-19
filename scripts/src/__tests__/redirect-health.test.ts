import { describe, expect, it } from "vitest";
import {
  pagesTable,
  categoriesTable,
  authorsTable,
  redirectsTable,
  auditLogsTable,
  crawlLogsTable,
} from "@workspace/db";
import { run, type HealthExecutor } from "../redirect-health";

interface InsertCapture {
  table: unknown;
  values: Record<string, unknown>;
}

interface UpdateCapture {
  table: unknown;
  set: Record<string, unknown>;
}

/**
 * A minimal fake of the slice of the drizzle client `run()` touches, so the
 * audit/crawl/update writes can be captured without a DB. `select(...).from(t)`
 * returns the rows registered for table `t` (also `.where(...)`-able);
 * `update(...).set(...).where(...)` and `insert(...).values(...)` record what
 * they were given. The `.values(...)` result is a real Promise so the job's
 * best-effort `.catch(() => {})` chaining works.
 */
function makeFakeExecutor(activeRedirects: unknown[]): {
  executor: HealthExecutor;
  inserts: InsertCapture[];
  updates: UpdateCapture[];
} {
  const inserts: InsertCapture[] = [];
  const updates: UpdateCapture[] = [];

  const rowsForTable = (table: unknown): unknown[] => {
    if (table === redirectsTable) return activeRedirects;
    return []; // pages / categories / authors → nothing served
  };

  const executor = {
    select: () => ({
      from: (table: unknown) => {
        const rows = rowsForTable(table);
        const result = Promise.resolve(rows) as Promise<unknown[]> & {
          where: () => Promise<unknown[]>;
        };
        result.where = () => Promise.resolve(rows);
        return result;
      },
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          updates.push({ table, set });
          return Promise.resolve(undefined);
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        return Promise.resolve(undefined);
      },
    }),
  } as unknown as HealthExecutor;

  return { executor, inserts, updates };
}

describe("redirect-health run() audit trail", () => {
  const baseOpts = {
    dryRun: false,
    noNetwork: true,
    concurrency: 5,
    timeoutMs: 15000,
    reportDir: "reports",
  };

  it("writes an audit_logs row with the expected shape for an on-blog deactivation", async () => {
    const redirect = {
      id: "redir-1",
      fromPath: "/blog/old-guide",
      toPath: "/blog/gone-guide",
      targetCheckFailures: 0,
    };
    const { executor, inserts, updates } = makeFakeExecutor([redirect]);

    const result = await run(baseOpts, executor);

    // The confirmed-missing on-blog target is deactivated immediately.
    expect(result.deactivated).toHaveLength(1);
    expect(result.deactivated[0]).toMatchObject({
      id: "redir-1",
      kind: "on-blog",
      reason: "on-blog-target-missing",
    });

    // The redirect row is flipped inactive.
    const redirectUpdate = updates.find((u) => u.table === redirectsTable);
    expect(redirectUpdate?.set).toMatchObject({
      isActive: false,
      deactivatedReason: "on-blog-target-missing",
    });

    // The audit_logs insert carries the exact contract the CMS audit-log
    // renderer depends on: action / entityType / entityId / before / after /
    // metadata (fromPath, toPath).
    const auditInsert = inserts.find((i) => i.table === auditLogsTable);
    expect(auditInsert).toBeDefined();
    expect(auditInsert?.values).toEqual({
      action: "redirect.deactivate.auto",
      entityType: "redirect",
      entityId: "redir-1",
      before: { isActive: true },
      after: {
        isActive: false,
        deactivatedReason: "on-blog-target-missing",
        targetLastStatus: null,
      },
      metadata: {
        source: "redirect-health-job",
        fromPath: "/blog/old-guide",
        toPath: "/blog/gone-guide",
        kind: "on-blog",
      },
    });

    // A durable crawl_logs warn line is also written.
    const crawlInsert = inserts.find((i) => i.table === crawlLogsTable);
    expect(crawlInsert?.values).toMatchObject({
      url: "/blog/old-guide",
      level: "warn",
    });
  });

  it("writes no audit_logs row when nothing is deactivated", async () => {
    // Off-blog target with --no-network: cannot be judged, so it is skipped.
    const redirect = {
      id: "redir-2",
      fromPath: "/blog/old-product",
      toPath: "https://www.headout.com/some-thing/",
      targetCheckFailures: 0,
    };
    const { executor, inserts } = makeFakeExecutor([redirect]);

    const result = await run(baseOpts, executor);

    expect(result.deactivated).toHaveLength(0);
    expect(inserts.find((i) => i.table === auditLogsTable)).toBeUndefined();
  });

  it("writes no audit_logs row in dry-run mode even when a target is dead", async () => {
    const redirect = {
      id: "redir-3",
      fromPath: "/blog/old-guide",
      toPath: "/blog/gone-guide",
      targetCheckFailures: 0,
    };
    const { executor, inserts, updates } = makeFakeExecutor([redirect]);

    const result = await run({ ...baseOpts, dryRun: true }, executor);

    // Still reported as a deactivation, but nothing is written.
    expect(result.deactivated).toHaveLength(1);
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });
});
