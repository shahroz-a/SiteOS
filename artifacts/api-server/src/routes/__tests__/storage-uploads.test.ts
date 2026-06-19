process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = "silent";

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { makeDbMock, makeDrizzleMock, type Tables } from "../../__tests__/fakeDb";
import { ROLES, hasPermission, type Role } from "@workspace/cms-auth";

/**
 * RBAC gating tests for GET /storage/uploads. The handler lists object-storage
 * uploads (not implemented in this unit context), so these tests only exercise
 * the auth/permission middleware chain, which short-circuits (401/403) before
 * the handler does any storage work. The endpoint requires content.create OR
 * content.edit.
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

const canList = (r: Role) =>
  hasPermission(r, "content.create") || hasPermission(r, "content.edit");

describe("GET /api/storage/uploads (RBAC)", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/storage/uploads");
    expect(res.status).toBe(401);
  });

  it("returns 401 for an unknown session token", async () => {
    const res = await request(app)
      .get("/api/storage/uploads")
      .set("Authorization", "Bearer sid-nope");
    expect(res.status).toBe(401);
  });

  for (const role of ROLES.filter((r) => !canList(r))) {
    it(`returns 403 for ${role} (lacks content.create/content.edit)`, async () => {
      const res = await request(app)
        .get("/api/storage/uploads")
        .set("Authorization", bearer(role));
      expect(res.status).toBe(403);
    });
  }

  it("passes the permission gate for content.create/content.edit roles (reaches the handler)", async () => {
    const permitted = ROLES.filter(canList);
    expect(permitted.length).toBeGreaterThan(0);
    for (const role of permitted) {
      const res = await request(app)
        .get("/api/storage/uploads")
        .set("Authorization", bearer(role));
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    }
  });
});

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

describe("POST /api/storage/uploads/request-url (size guard)", () => {
  const permitted = ROLES.find(canList) as Role;

  it("rejects an oversized declared size before issuing an upload URL", async () => {
    const res = await request(app)
      .post("/api/storage/uploads/request-url")
      .set("Authorization", bearer(permitted))
      .send({
        name: "huge.jpg",
        size: MAX_IMAGE_BYTES + 1,
        contentType: "image/jpeg",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too large/i);
    expect(res.body.uploadURL).toBeUndefined();
  });

  it("still enforces RBAC before the size guard", async () => {
    const denied = ROLES.find((r) => !canList(r)) as Role;
    const res = await request(app)
      .post("/api/storage/uploads/request-url")
      .set("Authorization", bearer(denied))
      .send({
        name: "huge.jpg",
        size: MAX_IMAGE_BYTES + 1,
        contentType: "image/jpeg",
      });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/storage/uploads/request-url (content-type guard)", () => {
  const permitted = ROLES.find(canList) as Role;

  it("rejects a non-image declared contentType before issuing an upload URL", async () => {
    const res = await request(app)
      .post("/api/storage/uploads/request-url")
      .set("Authorization", bearer(permitted))
      .send({
        name: "doc.pdf",
        size: 1024,
        contentType: "application/pdf",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/image/i);
    expect(res.body.uploadURL).toBeUndefined();
  });

  it("still enforces RBAC before the content-type guard", async () => {
    const denied = ROLES.find((r) => !canList(r)) as Role;
    const res = await request(app)
      .post("/api/storage/uploads/request-url")
      .set("Authorization", bearer(denied))
      .send({
        name: "doc.pdf",
        size: 1024,
        contentType: "application/pdf",
      });
    expect(res.status).toBe(403);
  });
});
