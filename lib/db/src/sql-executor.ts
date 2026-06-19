import { sql } from "drizzle-orm";

/** Minimal executor shape satisfied by both the `db` client and a transaction. */
export interface SqlExecutor {
  execute: (query: ReturnType<typeof sql>) => Promise<{
    rows: Record<string, unknown>[];
  }>;
}
