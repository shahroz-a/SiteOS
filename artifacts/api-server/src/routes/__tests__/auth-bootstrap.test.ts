process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = "silent";

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  makeDbMock,
  makeDrizzleMock,
  type Tables,
} from "../../__tests__/fakeDb";

/**
 * Covers the first-user-becomes-admin bootstrap in `upsertUser`. The role is
 * only ever applied on INSERT: the very first user to sign in is promoted to
 * `admin` so the CMS is usable out of the box; everyone after defaults to
 * `viewer`, and an existing user's role is never downgraded on re-login.
 */

const tables: Tables = { users: [] };

vi.mock("@workspace/db", () => makeDbMock(tables));
vi.mock("drizzle-orm", () => makeDrizzleMock());

const { upsertUser } = await import("../auth");

beforeEach(() => {
  tables.users = [];
});

const claims = (sub: string, email: string) => ({
  sub,
  email,
  first_name: "Test",
  last_name: "User",
});

describe("upsertUser bootstrap", () => {
  it("promotes the very first user to admin", async () => {
    const user = await upsertUser(claims("user-1", "first@example.com"));
    expect(user.role).toBe("admin");
    expect(tables.users).toHaveLength(1);
  });

  it("defaults every subsequent user to viewer", async () => {
    await upsertUser(claims("user-1", "first@example.com"));
    const second = await upsertUser(claims("user-2", "second@example.com"));
    const third = await upsertUser(claims("user-3", "third@example.com"));
    expect(second.role).toBe("viewer");
    expect(third.role).toBe("viewer");
    expect(tables.users).toHaveLength(3);
    expect(tables.users.filter((u) => u.role === "admin")).toHaveLength(1);
  });

  it("preserves an existing user's role on re-login (never re-bootstraps)", async () => {
    await upsertUser(claims("user-1", "first@example.com")); // admin
    await upsertUser(claims("user-2", "second@example.com")); // viewer

    // The admin signs in again: their row already exists, so the conflict
    // update path runs and must NOT touch `role`.
    const again = await upsertUser({
      ...claims("user-1", "first@example.com"),
      first_name: "Renamed",
    });
    expect(again.role).toBe("admin");
    expect(again.firstName).toBe("Renamed");
    expect(tables.users).toHaveLength(2);
  });
});
