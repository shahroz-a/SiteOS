/**
 * Resolve the Postgres connection target.
 *
 * Defaults to the Replit-managed `DATABASE_URL`. `SUPABASE_DATABASE_URL` is an
 * *explicit* opt-in, used only when `USE_SUPABASE` is truthy — set both to move
 * to Supabase later. We deliberately do NOT prefer `SUPABASE_DATABASE_URL`
 * implicitly and there is no fallback to it from the default branch: a leftover
 * value can linger in a long-running workflow process' environment even after
 * the secret is removed, and silently preferring (or falling back to) it would
 * hijack the connection to a paused/old database.
 */
export function resolveConnectionString(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const databaseUrl = env.DATABASE_URL?.trim() || undefined;
  const supabaseUrl = env.SUPABASE_DATABASE_URL?.trim() || undefined;
  const useSupabase = /^(1|true)$/i.test((env.USE_SUPABASE ?? "").trim());

  if (useSupabase) {
    if (!supabaseUrl) {
      throw new Error(
        "USE_SUPABASE is set but SUPABASE_DATABASE_URL is empty. Set a Supabase connection string or unset USE_SUPABASE.",
      );
    }
    return supabaseUrl;
  }

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL must be set (or USE_SUPABASE=true with SUPABASE_DATABASE_URL). Did you forget to provision a database?",
    );
  }
  return databaseUrl;
}

/** True when the chosen connection string targets a Supabase host (needs TLS). */
export function needsSupabaseSsl(connectionString: string): boolean {
  return /supabase\.(co|com)/.test(connectionString);
}
