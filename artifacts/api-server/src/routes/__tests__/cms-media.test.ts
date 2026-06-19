process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = "silent";

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { makeDbMock, makeDrizzleMock, type Tables } from "../../__tests__/fakeDb";
import { ROLES, hasPermission, type Role } from "@workspace/cms-auth";

/**
 * RBAC gating tests for GET /cms/media. The list handler issues raw
 * `db.execute` queries that the in-memory fake DB does not implement, so these
 * tests only exercise the auth/permission middleware chain, which short-circuits
 * (401/403) before the handler runs. The list SQL itself is verified against the
 * real database; the alt-classification messaging is unit-tested in lib/media.
 */

const USER_IDS: Record<Role, string> = {
  admin: "u-admin",
  editor: "u-editor",
  writer: "u-writer",
  seo: "u-seo",
  reviewer: "u-reviewer",
  translator: "u-translator",
  viewer: "u-viewer",
};

const FUTURE = new Date(Date.now() + 60 * 60 * 1000);
const CREATED = new Date("2025-01-01T00:00:00Z");

function seedAuthTables(): Tables {
  const users = ROLES.map((role) => ({
    id: USER_IDS[role],
    email: `${role}@example.com`,
    firstName: role,
    lastName: "User",
    profileImageUrl: null,
    role,
    createdAt: CREATED,
    updatedAt: CREATED,
  }));

  const sessions = ROLES.map((role) => ({
    sid: `sid-${role}`,
    sess: {
      user: {
        id: USER_IDS[role],
        email: `${role}@example.com`,
        firstName: role,
        lastName: "User",
        profileImageUrl: null,
      },
      access_token: "tok",
    },
    expire: FUTURE,
  }));

  return { users, sessions, audit_logs: [] };
}

const tables: Tables = seedAuthTables();

vi.mock("@workspace/db", () => makeDbMock(tables));
vi.mock("drizzle-orm", () => makeDrizzleMock());

const app = (await import("../../app")).default;

beforeEach(() => {
  const fresh = seedAuthTables();
  for (const k of Object.keys(tables)) delete tables[k];
  for (const [k, v] of Object.entries(fresh)) tables[k] = v;
});

const bearer = (role: Role) => `Bearer sid-${role}`;

describe("GET /api/cms/media (RBAC)", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/cms/media");
    expect(res.status).toBe(401);
  });

  it("returns 401 for an unknown session token", async () => {
    const res = await request(app)
      .get("/api/cms/media")
      .set("Authorization", "Bearer sid-nope");
    expect(res.status).toBe(401);
  });

  for (const role of ROLES.filter((r) => !hasPermission(r, "media.manage"))) {
    it(`returns 403 for ${role} (lacks media.manage)`, async () => {
      const res = await request(app)
        .get("/api/cms/media")
        .set("Authorization", bearer(role));
      expect(res.status).toBe(403);
    });
  }

  it("passes the permission gate for media.manage roles (reaches the handler)", async () => {
    // For a permitted role the middleware lets the request through; the handler
    // then hits the unimplemented fake `db.execute`, so we assert only that the
    // status is NOT a gating rejection (401/403).
    const permitted = ROLES.filter((r) => hasPermission(r, "media.manage"));
    expect(permitted.length).toBeGreaterThan(0);
    for (const role of permitted) {
      const res = await request(app)
        .get("/api/cms/media")
        .set("Authorization", bearer(role));
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    }
  });
});
