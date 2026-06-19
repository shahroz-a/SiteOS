/**
 * In-memory fake of the Drizzle `db` used by the Payload export orchestration
 * (`export-payload.ts`). It implements just enough of the SELECT query-builder
 * chain — full-row reads, projections, `where(eq(...))`, `orderBy(asc(...))`
 * and `limit` — to exercise `buildExport` (hero-image selection, avatar lookup,
 * relationship wiring, and collection insertion order) without a real database.
 *
 * Tables are referenced through Proxy objects whose `table.column` access yields
 * a `{ __table, __col }` descriptor, mirroring how Drizzle columns are passed
 * around. It is paired with `makeDrizzleMock()` so the `eq` / `asc` operators in
 * production code produce introspectable AST nodes this fake can evaluate.
 *
 * Mirrors the read-API harness in
 * `artifacts/api-server/src/__tests__/fakeDb.ts` (workspace packages can't
 * import across artifacts, so the relevant subset lives here too).
 */

type ColRef = { __table: string; __col: string };
type Cond = { __op: "eq"; col: ColRef; val: unknown };
type OrderKey = { __op: "desc" | "asc"; col: ColRef };

type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

function isColRef(v: unknown): v is ColRef {
  return (
    typeof v === "object" && v !== null && "__table" in v && "__col" in v
  );
}

function evalCond(cond: Cond, row: Row): boolean {
  const right = isColRef(cond.val) ? row[cond.val.__col] : cond.val;
  return row[cond.col.__col] === right;
}

function baseCompare(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

class SelectBuilder {
  private fromTable = "";
  private cond?: Cond;
  private orderKeys: OrderKey[] = [];
  private _limit?: number;

  constructor(
    private tables: Tables,
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
  orderBy(...keys: OrderKey[]) {
    this.orderKeys = keys;
    return this;
  }
  limit(n: number) {
    this._limit = n;
    return this;
  }

  private run(): Row[] {
    let rows: Row[] = [...(this.tables[this.fromTable] ?? [])];

    if (this.cond) {
      const cond = this.cond;
      rows = rows.filter((r) => evalCond(cond, r));
    }

    if (this.orderKeys.length > 0) {
      const keys = this.orderKeys;
      rows = [...rows].sort((a, b) => {
        for (const { col, __op } of keys) {
          const av = a[col.__col];
          const bv = b[col.__col];
          const an = av == null;
          const bn = bv == null;
          if (an && bn) continue;
          if (an) return 1; // nulls last
          if (bn) return -1;
          const c = baseCompare(av, bv);
          if (c !== 0) return __op === "desc" ? -c : c;
        }
        return 0;
      });
    }

    if (this._limit != null) rows = rows.slice(0, this._limit);

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
  constructor(public tables: Tables) {}
  select(projection?: Record<string, unknown>) {
    return new SelectBuilder(this.tables, projection);
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
export function makeDbMock(tables: Tables) {
  const db = new FakeDb(tables);
  return {
    db,
    pool: { end: async () => {} },
    pagesTable: tableProxy("pages"),
    authorsTable: tableProxy("authors"),
    categoriesTable: tableProxy("categories"),
    tagsTable: tableProxy("tags"),
    pageTagsTable: tableProxy("page_tags"),
    pageCategoriesTable: tableProxy("page_categories"),
    breadcrumbsTable: tableProxy("breadcrumbs"),
    faqTable: tableProxy("faq"),
    imagesTable: tableProxy("images"),
    jsonldTable: tableProxy("jsonld"),
    seoTable: tableProxy("seo"),
    internalLinksTable: tableProxy("internal_links"),
    externalLinksTable: tableProxy("external_links"),
    metadataTable: tableProxy("metadata"),
  };
}

/** Build the `drizzle-orm` mock so operators yield introspectable AST nodes. */
export function makeDrizzleMock() {
  return {
    eq: (col: ColRef, val: unknown) => ({ __op: "eq", col, val }),
    asc: (col: ColRef) => ({ __op: "asc", col }),
    desc: (col: ColRef) => ({ __op: "desc", col }),
  };
}
