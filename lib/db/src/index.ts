import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { resolveConnectionString, needsSupabaseSsl } from "./connection";

const { Pool } = pg;

const connectionString = resolveConnectionString();

// Supabase (and most hosted Postgres) require TLS. The session pooler presents
// a certificate that does not chain to a public CA in this environment, so we
// disable verification rather than full SSL.
const useSsl = needsSupabaseSsl(connectionString);

// The Supabase session-mode pooler caps total clients (pool_size, typically
// 15). Without an explicit `max`, node-postgres' default (10) plus any other
// connected process can overrun that cap and the pooler rejects new
// connections with `EMAXCONNSESSION` (surfacing as 500s under concurrent
// requests). Cap `max` well below the pooler limit so excess queries queue
// client-side instead of failing, wait (rather than erroring) for a free
// connection, and release idle connections promptly so they don't linger at
// the pooler.
export const pool = new Pool({
  connectionString,
  max: 8,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 15_000,
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});

export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./search-indexes";
export * from "./publishing-shapes";
export * from "./analytics-shapes";
