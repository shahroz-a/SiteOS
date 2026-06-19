import { describe, expect, it } from "vitest";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { SQL, is } from "drizzle-orm";
import * as schema from "@workspace/db/schema";
import { TRIGRAM_INDEXES } from "../ensure-search-indexes";

/**
 * Guards that the hard-coded `TRIGRAM_INDEXES` list in
 * `ensure-search-indexes.ts` stays in lockstep with the `gin_trgm_ops` indexes
 * actually declared in the drizzle schema (the source of truth). If a trigram
 * index is added, removed, or renamed in one place but not the other, CMS
 * search silently loses coverage after a rollback/restore — this test fails
 * loudly instead.
 */

const dialect = new PgDialect();

/** A trigram index reduced to a stable, comparable shape. */
type CanonicalIndex = { name: string; table: string; expr: string };

/**
 * Normalize an index expression so the schema's rendered SQL and the script's
 * hand-written column string compare equal despite cosmetic differences
 * (quoting, table qualifiers, redundant parens, whitespace, the trailing
 * `gin_trgm_ops` opclass token).
 */
function normalizeExpr(table: string, raw: string): string {
  return raw
    .toLowerCase()
    .replace(/"/g, "")
    .replace(/gin_trgm_ops/g, "")
    .replace(new RegExp(`\\b${table.toLowerCase()}\\.`, "g"), "")
    .replace(/[()\s]/g, "");
}

function isDrizzleTable(value: unknown): value is Parameters<typeof getTableConfig>[0] {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[Symbol.for("drizzle:IsDrizzleTable")] ===
      true
  );
}

/** Walk every schema table and collect the trigram (`gin_trgm_ops`) indexes. */
function collectSchemaTrigramIndexes(): CanonicalIndex[] {
  const out: CanonicalIndex[] = [];
  for (const value of Object.values(schema)) {
    if (!isDrizzleTable(value)) continue;
    const cfg = getTableConfig(value);
    for (const idx of cfg.indexes) {
      const config = idx.config;
      if (config.method !== "gin" || !config.name) continue;

      const parts = config.columns.map((col) =>
        is(col, SQL) ? dialect.sqlToQuery(col).sql : (col as { name: string }).name,
      );
      const usesTrigram =
        config.columns.some(
          (col) =>
            !is(col, SQL) &&
            ((col as { indexConfig?: { opClass?: string } }).indexConfig
              ?.opClass ?? "").includes("trgm"),
        ) || parts.some((p) => p.includes("gin_trgm_ops"));
      if (!usesTrigram) continue;

      out.push({
        name: config.name,
        table: cfg.name,
        expr: parts.map((p) => normalizeExpr(cfg.name, p)).join(","),
      });
    }
  }
  return out;
}

function sortByName(rows: CanonicalIndex[]): CanonicalIndex[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

describe("ensure-search-indexes TRIGRAM_INDEXES list", () => {
  const schemaIndexes = collectSchemaTrigramIndexes();
  const scriptIndexes: CanonicalIndex[] = TRIGRAM_INDEXES.map((idx) => ({
    name: idx.name,
    table: idx.table,
    expr: normalizeExpr(idx.table, idx.column),
  }));

  it("the schema declares at least one trigram index (sanity check)", () => {
    expect(schemaIndexes.length).toBeGreaterThan(0);
  });

  it("covers exactly the trigram indexes declared in the schema", () => {
    // toEqual on the sorted canonical rows catches add / remove / rename of any
    // trigram index, plus any change to the indexed table or column/expression.
    expect(sortByName(scriptIndexes)).toEqual(sortByName(schemaIndexes));
  });

  it("has no duplicate index names in the script list", () => {
    const names = TRIGRAM_INDEXES.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
