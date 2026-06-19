/**
 * In-memory fake of the Drizzle `db` used by the read API (`lib/posts.ts` and
 * the route handlers). It implements just enough of the SELECT query-builder
 * chain — projections, innerJoin, where, orderBy, limit, offset and the
 * `count(*)` aggregate — to exercise the list/detail serializers and the
 * filtering/pagination logic without a real database.
 *
 * It is paired with `mockDrizzle()` (the operator factory below) so the
 * `eq` / `and` / `or` / `inArray` / `ilike` / `desc` / `asc` / `sql` calls in
 * production code produce introspectable AST nodes this fake can evaluate.
 *
 * Tables are referenced through Proxy objects whose `table.column` access yields
 * a `{ __table, __col }` descriptor, mirroring how Drizzle columns are passed
 * around.
 */

type ColRef = { __table: string; __col: string };
type Cond =
  | { __op: "eq"; col: ColRef; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "or"; conds: Cond[] }
  | { __op: "inArray"; col: ColRef; vals: unknown[] }
  | { __op: "ilike"; col: ColRef; pattern: string }
  | { __op: "sql"; strings: string[]; values: unknown[] };
type OrderKey =
  | { __op: "desc"; col: ColRef }
  | { __op: "asc"; col: ColRef }
  | { __op: "sql"; strings: string[]; values: unknown[] };

type Row = Record<string, unknown>;
type Combined = Record<string, Row>;
export type Tables = Record<string, Row[]>;

function isColRef(v: unknown): v is ColRef {
  return (
    typeof v === "object" &&
    v !== null &&
    "__table" in v &&
    "__col" in v
  );
}

function resolveCol(col: ColRef, combined: Combined): unknown {
  return combined[col.__table]?.[col.__col];
}

function likeToRegex(pattern: string): RegExp {
  const escaped = pattern
    .split("%")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, "i");
}

function evalCond(cond: Cond, combined: Combined): boolean {
  switch (cond.__op) {
    case "eq": {
      const right = isColRef(cond.val)
        ? resolveCol(cond.val, combined)
        : cond.val;
      return resolveCol(cond.col, combined) === right;
    }
    case "and":
      return cond.conds.every((c) => evalCond(c, combined));
    case "or":
      return cond.conds.some((c) => evalCond(c, combined));
    case "inArray":
      return cond.vals.includes(resolveCol(cond.col, combined));
    case "ilike": {
      const v = resolveCol(cond.col, combined);
      if (v == null) return false;
      return likeToRegex(cond.pattern).test(String(v));
    }
    default:
      return true;
  }
}

function baseCompare(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function orderKeyParts(key: OrderKey): { col: ColRef; dir: "asc" | "desc" } {
  if (key.__op === "sql") {
    const col = key.values.find(isColRef) as ColRef;
    const text = key.strings.join(" ").toLowerCase();
    return { col, dir: text.includes("desc") ? "desc" : "asc" };
  }
  return { col: key.col, dir: key.__op };
}

class SelectBuilder {
  private fromTable = "";
  private joins: { table: string; on: Cond }[] = [];
  private cond?: Cond;
  private orderKeys: OrderKey[] = [];
  private _limit?: number;
  private _offset?: number;

  constructor(
    private tables: Tables,
    private projection?: Record<string, unknown>,
  ) {}

  from(table: { __table: string }) {
    this.fromTable = table.__table;
    return this;
  }
  innerJoin(table: { __table: string }, on: Cond) {
    this.joins.push({ table: table.__table, on });
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
  offset(n: number) {
    this._offset = n;
    return this;
  }

  private run(): Row[] {
    let rows: Combined[] = (this.tables[this.fromTable] ?? []).map((r) => ({
      [this.fromTable]: r,
    }));

    for (const join of this.joins) {
      const next: Combined[] = [];
      for (const cr of rows) {
        for (const jr of this.tables[join.table] ?? []) {
          const merged = { ...cr, [join.table]: jr };
          if (evalCond(join.on, merged)) next.push(merged);
        }
      }
      rows = next;
    }

    if (this.cond) rows = rows.filter((r) => evalCond(this.cond as Cond, r));

    const proj = this.projection;
    if (proj) {
      const aggKey = Object.entries(proj).find(
        ([, v]) => (v as { __op?: string })?.__op === "sql",
      );
      if (aggKey) {
        return [{ [aggKey[0]]: rows.length }];
      }
    }

    if (this.orderKeys.length > 0) {
      const keys = this.orderKeys.map(orderKeyParts);
      rows = [...rows].sort((a, b) => {
        for (const { col, dir } of keys) {
          const av = resolveCol(col, a);
          const bv = resolveCol(col, b);
          const an = av == null;
          const bn = bv == null;
          if (an && bn) continue;
          if (an) return 1; // nulls last
          if (bn) return -1;
          const c = baseCompare(av, bv);
          if (c !== 0) return dir === "desc" ? -c : c;
        }
        return 0;
      });
    }

    if (this._offset != null) rows = rows.slice(this._offset);
    if (this._limit != null) rows = rows.slice(0, this._limit);

    if (proj) {
      return rows.map((r) => {
        const out: Row = {};
        for (const [key, desc] of Object.entries(proj)) {
          out[key] = isColRef(desc) ? resolveCol(desc, r) : undefined;
        }
        return out;
      });
    }
    return rows.map((r) => r[this.fromTable]);
  }

  then(
    resolve: (rows: Row[]) => unknown,
    reject?: (e: unknown) => unknown,
  ) {
    try {
      return Promise.resolve(resolve(this.run()));
    } catch (e) {
      return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
    }
  }
}

function projectRows(rows: Row[], proj?: Record<string, unknown>): Row[] {
  if (!proj) return rows;
  return rows.map((r) => {
    const out: Row = {};
    for (const [key, desc] of Object.entries(proj)) {
      out[key] = isColRef(desc)
        ? (r as Combined)[(desc as ColRef).__table]?.[(desc as ColRef).__col] ??
          r[(desc as ColRef).__col]
        : undefined;
    }
    return out;
  });
}

class InsertBuilder {
  private _values: Row[] = [];
  private _conflict?: { target: ColRef | ColRef[]; set: Row };
  private _returning = false;
  private _proj?: Record<string, unknown>;
  private _ran = false;

  constructor(
    private tables: Tables,
    private table: string,
  ) {}

  values(vals: Row | Row[]) {
    this._values = Array.isArray(vals) ? vals : [vals];
    return this;
  }
  onConflictDoUpdate(cfg: { target: ColRef | ColRef[]; set: Row }) {
    this._conflict = cfg;
    return this;
  }
  returning(proj?: Record<string, unknown>) {
    this._returning = true;
    this._proj = proj;
    return this;
  }

  private run(): Row[] {
    if (this._ran) return [];
    this._ran = true;
    const dest = (this.tables[this.table] ??= []);
    const targets = this._conflict
      ? (Array.isArray(this._conflict.target)
          ? this._conflict.target
          : [this._conflict.target]
        ).map((c) => c.__col)
      : [];
    const out: Row[] = [];
    for (const v of this._values) {
      const existing =
        this._conflict &&
        dest.find((r) => targets.every((col) => r[col] === v[col]));
      if (existing) {
        Object.assign(existing, this._conflict!.set);
        out.push(existing);
      } else {
        dest.push(v);
        out.push(v);
      }
    }
    return projectRows(out, this._proj);
  }

  then(resolve: (rows: Row[]) => unknown, reject?: (e: unknown) => unknown) {
    try {
      return Promise.resolve(resolve(this.run()));
    } catch (e) {
      return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
    }
  }
}

class UpdateBuilder {
  private _set: Row = {};
  private cond?: Cond;
  private _proj?: Record<string, unknown>;
  private _ran = false;

  constructor(
    private tables: Tables,
    private table: string,
  ) {}

  set(vals: Row) {
    this._set = vals;
    return this;
  }
  where(cond: Cond) {
    this.cond = cond;
    return this;
  }
  returning(proj?: Record<string, unknown>) {
    this._proj = proj;
    return this;
  }

  private run(): Row[] {
    if (this._ran) return [];
    this._ran = true;
    const dest = this.tables[this.table] ?? [];
    const updated: Row[] = [];
    for (const r of dest) {
      const combined: Combined = { [this.table]: r };
      if (!this.cond || evalCond(this.cond, combined)) {
        Object.assign(r, this._set);
        updated.push(r);
      }
    }
    return projectRows(updated, this._proj);
  }

  then(resolve: (rows: Row[]) => unknown, reject?: (e: unknown) => unknown) {
    try {
      return Promise.resolve(resolve(this.run()));
    } catch (e) {
      return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
    }
  }
}

class DeleteBuilder {
  private cond?: Cond;
  private _ran = false;

  constructor(
    private tables: Tables,
    private table: string,
  ) {}

  where(cond: Cond) {
    this.cond = cond;
    return this;
  }

  private run(): Row[] {
    if (this._ran) return [];
    this._ran = true;
    const dest = this.tables[this.table] ?? [];
    const kept: Row[] = [];
    for (const r of dest) {
      const combined: Combined = { [this.table]: r };
      if (this.cond && !evalCond(this.cond, combined)) kept.push(r);
    }
    this.tables[this.table] = kept;
    return [];
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
  insert(table: { __table: string }) {
    return new InsertBuilder(this.tables, table.__table);
  }
  update(table: { __table: string }) {
    return new UpdateBuilder(this.tables, table.__table);
  }
  delete(table: { __table: string }) {
    return new DeleteBuilder(this.tables, table.__table);
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

/** Build the `@workspace/db` mock object (db + every table the API touches). */
export function makeDbMock(tables: Tables) {
  const db = new FakeDb(tables);
  return {
    db,
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
    usersTable: tableProxy("users"),
    sessionsTable: tableProxy("sessions"),
    auditLogsTable: tableProxy("audit_logs"),
    validationReportsTable: tableProxy("validation_reports"),
  };
}

/** Build the `drizzle-orm` mock so operators yield introspectable AST nodes. */
export function makeDrizzleMock() {
  return {
    eq: (col: ColRef, val: unknown) => ({ __op: "eq", col, val }),
    and: (...conds: (Cond | undefined)[]) => ({
      __op: "and",
      conds: conds.filter(Boolean),
    }),
    or: (...conds: (Cond | undefined)[]) => ({
      __op: "or",
      conds: conds.filter(Boolean),
    }),
    inArray: (col: ColRef, vals: unknown[]) => ({ __op: "inArray", col, vals }),
    ilike: (col: ColRef, pattern: string) => ({ __op: "ilike", col, pattern }),
    desc: (col: ColRef) => ({ __op: "desc", col }),
    asc: (col: ColRef) => ({ __op: "asc", col }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      __op: "sql",
      strings: Array.from(strings),
      values,
    }),
  };
}
