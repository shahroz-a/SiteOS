import { defineConfig } from "drizzle-kit";
import path from "path";
import { resolveConnectionString, needsSupabaseSsl } from "./src/connection";

// Shares lib/db's selection: default to the Replit-managed DATABASE_URL and only
// use SUPABASE_DATABASE_URL when explicitly opted in via USE_SUPABASE, so a stale
// leftover SUPABASE_DATABASE_URL can't hijack schema pushes to a paused database.
const connectionString = resolveConnectionString();

// Ensure TLS for Supabase pooled connections during schema push. Use
// `no-verify`: newer pg-connection-string treats `require` as `verify-full`,
// and Supabase's pooler certificate does not chain to a public CA here.
const needsSsl =
  needsSupabaseSsl(connectionString) && !/sslmode=/.test(connectionString);
const url = needsSsl
  ? `${connectionString}${connectionString.includes("?") ? "&" : "?"}sslmode=no-verify`
  : connectionString;

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  },
});
