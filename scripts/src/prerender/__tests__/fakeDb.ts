/**
 * In-memory fake of the Drizzle `db` used by the blog prerender runner
 * (`prerender-blog.ts`). It implements just enough of the SELECT query-builder
 * chain — projections, `from`, and `where(and(eq(...), inArray(...)))` — to
 * exercise the runner's querying / batching / file-writing logic without a real
 * database.
 *
 * Tables are referenced through Proxy objects whose `table.column` access yields
 * a `{ __table, __col }` descriptor, mirroring how Drizzle columns are passed
 * around. It is paired with `makeDrizzleMock()` so the `and` / `eq` / `inArray`
 * operators in production code produce introspectable AST nodes this fake can
 * evaluate.
 *
 * A shared `control` object lets a test make a query against a given table throw
 * (to cover the runner's graceful-degradation paths: a whole-run DB error vs. a
 * per-batch JSON-LD failure). Mirrors the read-API harness in
 * `artifacts/api-server/src/__tests__/fakeDb.ts` (workspace packages can't
 * import across artifacts, so the relevant subset lives here too).
 */

type ColRef = { __table: string; __col: string };
type Cond =
  | { __op: "eq"; col: ColRef; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "inArray"; col: ColRef; vals: unknown[] };

type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

/** Shared mutable control so tests can inject query failures per table. */
export interface FakeDbControl {
  /** Table names whose SELECT should throw when executed. */
  failTables: Set<string>;
}

function isColRef(v: unknown): v is ColRef {
  return (
    typeof v === "object" && v !== null && "__table" in v && "__col" in v
  );
}

function evalCond(cond: Cond, row: Row): boolean {
  switch (cond.__op) {
    case "eq": {
      const right = isColRef(cond.val) ? row[cond.val.__col] : cond.val;
      return row[cond.col.__col] === right;
    }
    case "and":
      return cond.conds.every((c) => evalCond(c, row));
    case "inArray":
      return cond.vals.includes(row[cond.col.__col]);
  }
}

class SelectBuilder {
  private fromTable = "";
  private cond?: Cond;

  constructor(
    private tables: Tables,
    private control: FakeDbControl,
    private projection?: Record<string, unknown>,
  ) {}

  from(table: { __table: string }) {
    this.fromTable = table.__table;
    return this;
  }
  where(cond: Cond) {
    this.cond = cond;
    return this;
  }

  private run(): Row[] {
    if (this.control.failTables.has(this.fromTable)) {
      throw new Error(`fake DB: query against "${this.fromTable}" failed`);
    }

    let rows: Row[] = [...(this.tables[this.fromTable] ?? [])];
    if (this.cond) {
      const cond = this.cond;
      rows = rows.filter((r) => evalCond(cond, r));
    }

    const proj = this.projection;
    if (proj) {
      return rows.map((r) => {
        const out: Row = {};
        for (const [key, desc] of Object.entries(proj)) {
          out[key] = isColRef(desc) ? r[desc.__col] : undefined;
        }
        return out;
      });
    }
    return rows;
  }

  then(resolve: (rows: Row[]) => unknown, reject?: (e: unknown) => unknown) {
    try {
      return Promise.resolve(resolve(this.run()));
    } catch (e) {
      return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
    }
  }
}

export class FakeDb {
  constructor(
    public tables: Tables,
    public control: FakeDbControl,
  ) {}
  select(projection?: Record<string, unknown>) {
    return new SelectBuilder(this.tables, this.control, projection);
  }
}

function tableProxy(name: string) {
  return new Proxy(
    { __table: name },
    {
      get(target, prop) {
        if (prop === "__table") return name;
        if (typeof prop === "symbol") return Reflect.get(target, prop);
        return { __table: name, __col: String(prop) };
      },
    },
  );
}

/** Build the `@workspace/db` mock object (db + pool + every table touched). */
export function makeDbMock(tables: Tables, control: FakeDbControl) {
  const db = new FakeDb(tables, control);
  return {
    db,
    pool: { end: async () => {} },
    pagesTable: tableProxy("pages"),
    seoTable: tableProxy("seo"),
    jsonldTable: tableProxy("jsonld"),
    categoriesTable: tableProxy("categories"),
    authorsTable: tableProxy("authors"),
  };
}

/** Build the `drizzle-orm` mock so operators yield introspectable AST nodes. */
export function makeDrizzleMock() {
  return {
    and: (...conds: (Cond | undefined)[]) => ({
      __op: "and",
      conds: conds.filter(Boolean),
    }),
    eq: (col: ColRef, val: unknown) => ({ __op: "eq", col, val }),
    inArray: (col: ColRef, vals: unknown[]) => ({ __op: "inArray", col, vals }),
  };
}
