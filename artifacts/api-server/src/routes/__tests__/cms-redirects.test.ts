process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = "silent";

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { makeDbMock, makeDrizzleMock, type Tables } from "../../__tests__/fakeDb";
import { ROLES, type Role } from "@workspace/cms-auth";

/**
 * RBAC + behaviour tests for the redirect review endpoints. They exercise the
 * real middleware chain over the in-memory fake DB, asserting url.manage gating
 * and the list/reactivate behaviour against seeded `redirects` rows.
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

// Redirect rows are addressed by UUID (CmsIdParam enforces `format: uuid`).
const ID_ONBLOG_DEAD = "11111111-1111-1111-1111-111111111111";
const ID_OFFBLOG_DEAD = "22222222-2222-2222-2222-222222222222";
const ID_HEALTHY = "33333333-3333-3333-3333-333333333333";
const ID_ATRISK = "44444444-4444-4444-4444-444444444444";
const ID_MISSING = "99999999-9999-9999-9999-999999999999";

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

function seedRedirects(): Tables {
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

  const redirects = [
    // Auto-deactivated on-blog target (missing page).
    {
      id: ID_ONBLOG_DEAD,
      fromPath: "/blog/old-guide/",
      toPath: "/blog/new-guide/",
      statusCode: 301,
      isActive: false,
      targetCheckFailures: 1,
      targetCheckedAt: new Date("2025-03-02T00:00:00Z"),
      targetLastStatus: null,
      deactivatedReason: "on-blog-target-missing",
      deactivatedAt: new Date("2025-03-02T00:00:00Z"),
      createdAt: CREATED,
    },
    // Auto-deactivated off-blog target (dead, reached threshold).
    {
      id: ID_OFFBLOG_DEAD,
      fromPath: "/blog/moved/",
      toPath: "https://www.headout.com/gone/",
      statusCode: 301,
      isActive: false,
      targetCheckFailures: 2,
      targetCheckedAt: new Date("2025-03-03T00:00:00Z"),
      targetLastStatus: 404,
      deactivatedReason: "off-blog-target-dead",
      deactivatedAt: new Date("2025-03-03T00:00:00Z"),
      createdAt: CREATED,
    },
    // Healthy active redirect — must not appear in either list.
    {
      id: ID_HEALTHY,
      fromPath: "/blog/fine/",
      toPath: "/blog/fine-target/",
      statusCode: 301,
      isActive: true,
      targetCheckFailures: 0,
      targetCheckedAt: new Date("2025-03-01T00:00:00Z"),
      targetLastStatus: 200,
      deactivatedReason: null,
      deactivatedAt: null,
      createdAt: CREATED,
    },
    // At-risk: still active, off-blog target failed once (below threshold).
    {
      id: ID_ATRISK,
      fromPath: "/blog/watch/",
      toPath: "https://www.headout.com/flaky/",
      statusCode: 301,
      isActive: true,
      targetCheckFailures: 1,
      targetCheckedAt: new Date("2025-03-04T00:00:00Z"),
      targetLastStatus: 404,
      deactivatedReason: null,
      deactivatedAt: null,
      createdAt: CREATED,
    },
  ];

  return { users, sessions, audit_logs: [], redirects };
}

const tables: Tables = seedRedirects();

vi.mock("@workspace/db", () => makeDbMock(tables));
vi.mock("drizzle-orm", () => makeDrizzleMock());

const app = (await import("../../app")).default;

beforeEach(() => {
  const fresh = seedRedirects();
  for (const k of Object.keys(tables)) delete tables[k];
  for (const [k, v] of Object.entries(fresh)) tables[k] = v;
});

const bearer = (role: Role) => `Bearer sid-${role}`;
const PERMITTED: Role[] = ["admin", "editor", "seo"];

describe("GET /api/cms/redirects/deactivated", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/cms/redirects/deactivated");
    expect(res.status).toBe(401);
  });

  for (const role of ROLES.filter((r) => !PERMITTED.includes(r))) {
    it(`returns 403 for ${role} (lacks url.manage)`, async () => {
      const res = await request(app)
        .get("/api/cms/redirects/deactivated")
        .set("Authorization", bearer(role));
      expect(res.status).toBe(403);
    });
  }

  for (const role of PERMITTED) {
    it(`returns 200 for ${role} (has url.manage)`, async () => {
      const res = await request(app)
        .get("/api/cms/redirects/deactivated")
        .set("Authorization", bearer(role));
      expect(res.status).toBe(200);
    });
  }

  it("splits auto-deactivated from at-risk and excludes healthy redirects", async () => {
    const res = await request(app)
      .get("/api/cms/redirects/deactivated")
      .set("Authorization", bearer("seo"));
    expect(res.status).toBe(200);

    const deactivatedIds = res.body.deactivated.map((r: { id: string }) => r.id);
    expect(deactivatedIds.sort()).toEqual([ID_OFFBLOG_DEAD, ID_ONBLOG_DEAD].sort());

    const atRiskIds = res.body.atRisk.map((r: { id: string }) => r.id);
    expect(atRiskIds).toEqual([ID_ATRISK]);

    // Derived kind + serialized timestamps are present.
    const byId = Object.fromEntries(
      res.body.deactivated.map((r: { id: string }) => [r.id, r]),
    );
    expect(byId[ID_ONBLOG_DEAD].kind).toBe("on-blog");
    expect(byId[ID_OFFBLOG_DEAD].kind).toBe("off-blog");
    expect(byId[ID_OFFBLOG_DEAD].targetLastStatus).toBe(404);
    expect(typeof byId[ID_ONBLOG_DEAD].deactivatedAt).toBe("string");
  });
});

describe("POST /api/cms/redirects/:id/reactivate", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).post(
      `/api/cms/redirects/${ID_ONBLOG_DEAD}/reactivate`,
    );
    expect(res.status).toBe(401);
  });

  for (const role of ROLES.filter((r) => !PERMITTED.includes(r))) {
    it(`returns 403 for ${role} (lacks url.manage)`, async () => {
      const res = await request(app)
        .post(`/api/cms/redirects/${ID_ONBLOG_DEAD}/reactivate`)
        .set("Authorization", bearer(role));
      expect(res.status).toBe(403);
    });
  }

  it("returns 404 for an unknown redirect (permitted role)", async () => {
    const res = await request(app)
      .post(`/api/cms/redirects/${ID_MISSING}/reactivate`)
      .set("Authorization", bearer("admin"));
    expect(res.status).toBe(404);
  });

  it("re-activates, clears health bookkeeping, and audits the change", async () => {
    const res = await request(app)
      .post(`/api/cms/redirects/${ID_OFFBLOG_DEAD}/reactivate`)
      .set("Authorization", bearer("editor"));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ID_OFFBLOG_DEAD);
    expect(res.body.isActive).toBe(true);
    expect(res.body.deactivatedReason).toBeNull();
    expect(res.body.deactivatedAt).toBeNull();
    expect(res.body.targetCheckFailures).toBe(0);

    // Persisted in the row.
    const row = tables.redirects.find((r) => r.id === ID_OFFBLOG_DEAD);
    expect(row?.isActive).toBe(true);
    expect(row?.deactivatedReason).toBeNull();
    expect(row?.targetCheckFailures).toBe(0);

    // Audited.
    expect(tables.audit_logs).toHaveLength(1);
    expect(tables.audit_logs[0].action).toBe("redirect.reactivate");
    expect(tables.audit_logs[0].entityId).toBe(ID_OFFBLOG_DEAD);
  });
});
