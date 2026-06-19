process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = "silent";

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import {
  makeDbMock,
  makeDrizzleMock,
  type Tables,
} from "../../__tests__/fakeDb";
import { ROLES, hasPermission, type Permission, type Role } from "@workspace/cms-auth";

/**
 * RBAC / validation tests for the CMS import/export/backup/restore endpoints
 * (`/api/cms/export`, `/cms/export/full`, `/cms/import`, `/cms/backup`,
 * `/cms/restore`, `/cms/payload-mapping`). These exercise the REAL middleware
 * chain (`authMiddleware` -> `requireAuth` -> `requirePermission`) over the
 * in-memory fake DB, asserting the authenticated CMS surface:
 *   - 401 when unauthenticated,
 *   - 403 for roles lacking the route's permission,
 *   - that a permitted role gets PAST the guards and reaches the handler
 *     (proven by a 400 from the handler's own input validation, which runs
 *     before any DB access).
 *
 * The 200 success paths call loadContentBundle / importContentBundle, which run
 * a full multi-table read / transactional upsert the in-memory fake DB can't
 * model; those are covered end-to-end against a live database by the opt-in
 * `lib/__tests__/cms-io.integration.test.ts`.
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

function makeUser(id: string, role: Role) {
  return {
    id,
    email: `${role}@example.com`,
    firstName: role,
    lastName: "User",
    profileImageUrl: null,
    role,
    createdAt: CREATED,
    updatedAt: CREATED,
  };
}

function seedAuthTables(): Tables {
  const users = ROLES.map((role) => makeUser(USER_IDS[role], role));
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
const rolesWith = (perm: Permission) => ROLES.filter((r) => hasPermission(r, perm));
const rolesWithout = (perm: Permission) =>
  ROLES.filter((r) => !hasPermission(r, perm));

describe("GET /api/cms/export (content.view)", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/cms/export");
    expect(res.status).toBe(401);
  });

  for (const role of rolesWithout("content.view")) {
    it(`returns 403 for ${role}`, async () => {
      const res = await request(app)
        .get("/api/cms/export")
        .set("Authorization", bearer(role));
      expect(res.status).toBe(403);
    });
  }

  it("lets a permitted role past the guards (400 on unsupported format)", async () => {
    const res = await request(app)
      .get("/api/cms/export?format=bogus")
      .set("Authorization", bearer("viewer"));
    expect(res.status).toBe(400);
    expect(res.body.supported).toContain("json");
  });
});

describe("GET /api/cms/export/full (content.view)", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/cms/export/full");
    expect(res.status).toBe(401);
  });

  // Every role holds content.view, so there is no 403 case; the 200 path needs
  // a live DB (covered by the integration test).
  it("content.view is held by every role", () => {
    expect(rolesWithout("content.view")).toEqual([]);
  });
});

describe("GET /api/cms/payload-mapping (content.view)", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/cms/payload-mapping");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/cms/import (content.create)", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .post("/api/cms/import")
      .send({ format: "json", content: "{}" });
    expect(res.status).toBe(401);
  });

  for (const role of rolesWithout("content.create")) {
    it(`returns 403 for ${role}`, async () => {
      const res = await request(app)
        .post("/api/cms/import")
        .set("Authorization", bearer(role))
        .send({ format: "json", content: "{}" });
      expect(res.status).toBe(403);
    });
  }

  for (const role of rolesWith("content.create")) {
    it(`lets ${role} past the guards (400 on unsupported format)`, async () => {
      const res = await request(app)
        .post("/api/cms/import")
        .set("Authorization", bearer(role))
        .send({ format: "bogus", content: "{}" });
      expect(res.status).toBe(400);
      expect(res.body.supported).toBeDefined();
    });
  }

  it("returns 400 for missing content (permitted role)", async () => {
    const res = await request(app)
      .post("/api/cms/import")
      .set("Authorization", bearer("admin"))
      .send({ format: "json" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/cms/backup (settings.manage)", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/cms/backup");
    expect(res.status).toBe(401);
  });

  for (const role of rolesWithout("settings.manage")) {
    it(`returns 403 for ${role}`, async () => {
      const res = await request(app)
        .get("/api/cms/backup")
        .set("Authorization", bearer(role));
      expect(res.status).toBe(403);
    });
  }
});

describe("POST /api/cms/restore (settings.manage)", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .post("/api/cms/restore")
      .send({ content: "{}" });
    expect(res.status).toBe(401);
  });

  for (const role of rolesWithout("settings.manage")) {
    it(`returns 403 for ${role}`, async () => {
      const res = await request(app)
        .post("/api/cms/restore")
        .set("Authorization", bearer(role))
        .send({ content: "{}" });
      expect(res.status).toBe(403);
    });
  }

  it("lets admin past the guards (400 on missing content)", async () => {
    const res = await request(app)
      .post("/api/cms/restore")
      .set("Authorization", bearer("admin"))
      .send({});
    expect(res.status).toBe(400);
  });
});
