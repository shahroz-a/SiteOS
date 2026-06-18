import { defineConfig } from "drizzle-kit";
import path from "path";

const connectionString =
  process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "SUPABASE_DATABASE_URL or DATABASE_URL must be set; ensure the database is provisioned",
  );
}

// Ensure TLS for Supabase pooled connections during schema push. Use
// `no-verify`: newer pg-connection-string treats `require` as `verify-full`,
// and Supabase's pooler certificate does not chain to a public CA here.
const needsSsl =
  /supabase\.(co|com)/.test(connectionString) &&
  !/sslmode=/.test(connectionString);
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
