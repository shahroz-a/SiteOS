import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db, usersTable, sessionsTable } from "@workspace/db";

/**
 * Seed an admin user + a server session so the CMS e2e suite starts
 * authenticated. This uses the SAME session mechanism the running server reads
 * (`lib/auth.ts`): a random `sid` stored in the `sessions` table whose `sess`
 * jsonb holds the AuthUser, surfaced to the browser as an unsigned `sid`
 * cookie. We write that cookie into a Playwright storageState rather than
 * driving the real OIDC login (which can't run from a standalone browser here).
 * Nothing in the application's auth path is bypassed or stubbed.
 */

const USER_ID = "e2e-import-diff-admin";
const EMAIL = "e2e-import-diff@example.com";
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

export default async function globalSetup(): Promise<void> {
  const user = {
    id: USER_ID,
    email: EMAIL,
    firstName: "E2E",
    lastName: "Admin",
    profileImageUrl: null,
  };

  // Ensure the user exists and is an admin (idempotent across runs).
  await db
    .insert(usersTable)
    .values({ ...user, role: "admin" })
    .onConflictDoUpdate({
      target: usersTable.id,
      set: { role: "admin", email: EMAIL },
    });

  const sid = crypto.randomBytes(32).toString("hex");
  await db.insert(sessionsTable).values({
    sid,
    sess: { user, access_token: "e2e" } as unknown as Record<string, unknown>,
    expire: new Date(Date.now() + SESSION_TTL),
  });

  const authDir = path.join(import.meta.dirname, ".auth");
  mkdirSync(authDir, { recursive: true });
  const state = {
    cookies: [
      {
        name: "sid",
        value: sid,
        domain: "localhost",
        path: "/",
        expires: Math.floor((Date.now() + SESSION_TTL) / 1000),
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
      },
    ],
    origins: [],
  };
  writeFileSync(path.join(authDir, "state.json"), JSON.stringify(state, null, 2));
}
