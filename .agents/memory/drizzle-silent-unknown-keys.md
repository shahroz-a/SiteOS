---
name: Drizzle silently drops unknown columns
description: Why a wrong-table column in .values()/.set() neither type-errors nor throws — it's a silent no-op.
---

# Drizzle silently drops unknown keys in `.values()` / `.set()`

Passing a key that is NOT a column of the target table to `db.insert(t).values(obj)`
or `db.update(t).set(obj)` is a **silent no-op**: no TypeScript error, no runtime SQL
error, and the value is simply never written.

**Why it slips past TypeScript:** excess-property checking only fires on *fresh object
literals* passed inline. If you build the row as a separate `const pageValues = {...}`
and then pass the variable, structural typing accepts extra keys. Drizzle then maps only
the keys it recognizes as columns and drops the rest before emitting SQL.

**How to apply:**
- Don't trust "typecheck + import ran without error" as proof a field was persisted.
  Verify with a SELECT (or `'colName' in table` at runtime).
- When a column "won't save," first confirm it actually belongs to *that* table. Easy
  trap: a name like `contentHash` may live on a sibling table (e.g. `page_versions`),
  not the one you're inserting into.
- To get real excess-key errors, pass the object literal inline to `.values({...})`
  instead of via an intermediate variable.
