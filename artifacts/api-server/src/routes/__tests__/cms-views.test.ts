process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = "silent";

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { makeDbMock, makeDrizzleMock, type Tables } from "../../__tests__/fakeDb";
import { ROLES, type Role } from "@workspace/cms-auth";

/**
 * Route tests for the per-user saved-views CRUD (`/api/cms/saved-views`). They
 * run the REAL middleware chain (auth -> requirePermission("content.view"))
 * over the in-memory fake DB and assert:
 *  - auth gating (401 unauthenticated; every role with content.view passes)
 *  - per-user scoping: a user can never list/update/delete another user's view
 *    (the owner filter makes another user's row invisible -> 404 on write).
 *
 * A session is presented via `Bearer sid-<role>` whose `sid` resolves to a
 * seeded `sessions` row (mirrors `cms.test.ts`).
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

// Pre-seeded views belonging to two distinct users so scoping can be asserted.
const VIEW_VIEWER = "11111111-2222-4333-8444-555555555555";
const VIEW_EDITOR = "66666666-7777-4888-8999-aaaaaaaaaaaa";

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

function seed(): Tables {
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

  const saved_views = [
    {
      id: VIEW_VIEWER,
      userId: USER_IDS.viewer,
      name: "Viewer drafts",
      description: "My drafts",
      query: { status: "draft", sort: "updated" },
      createdAt: CREATED,
      updatedAt: CREATED,
    },
    {
      id: VIEW_EDITOR,
      userId: USER_IDS.editor,
      name: "Editor SEO queue",
      description: null,
      query: { q: "seo", pageType: "post" },
      createdAt: CREATED,
      updatedAt: CREATED,
    },
  ];

  return { users, sessions, saved_views, audit_logs: [] };
}

const tables: Tables = seed();

vi.mock("@workspace/db", () => makeDbMock(tables));
vi.mock("drizzle-orm", () => makeDrizzleMock());

const app = (await import("../../app")).default;

beforeEach(() => {
  const fresh = seed();
  for (const k of Object.keys(tables)) delete tables[k];
  for (const [k, v] of Object.entries(fresh)) tables[k] = v;
});

const bearer = (role: Role) => `Bearer sid-${role}`;

describe("GET /api/cms/saved-views — auth gating & listing", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/cms/saved-views");
    expect(res.status).toBe(401);
  });

  it("returns 401 for an unknown session token", async () => {
    const res = await request(app)
      .get("/api/cms/saved-views")
      .set("Authorization", "Bearer sid-does-not-exist");
    expect(res.status).toBe(401);
  });

  // Every role carries content.view, so all of them may use saved views.
  for (const role of ROLES) {
    it(`returns 200 for ${role} (has content.view)`, async () => {
      const res = await request(app)
        .get("/api/cms/saved-views")
        .set("Authorization", bearer(role));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  }

  it("lists only the signed-in user's own views", async () => {
    const viewer = await request(app)
      .get("/api/cms/saved-views")
      .set("Authorization", bearer("viewer"));
    expect(viewer.body.items).toHaveLength(1);
    expect(viewer.body.items[0].id).toBe(VIEW_VIEWER);

    const editor = await request(app)
      .get("/api/cms/saved-views")
      .set("Authorization", bearer("editor"));
    expect(editor.body.items).toHaveLength(1);
    expect(editor.body.items[0].id).toBe(VIEW_EDITOR);

    // The writer owns no views.
    const writer = await request(app)
      .get("/api/cms/saved-views")
      .set("Authorization", bearer("writer"));
    expect(writer.body.items).toEqual([]);
  });
});

describe("POST /api/cms/saved-views — create", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .post("/api/cms/saved-views")
      .send({ name: "x", query: {} });
    expect(res.status).toBe(401);
  });

  it("creates a view scoped to the acting user", async () => {
    const res = await request(app)
      .post("/api/cms/saved-views")
      .set("Authorization", bearer("writer"))
      .send({
        name: "Writer queue",
        description: "to do",
        query: { status: "draft" },
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Writer queue",
      description: "to do",
      query: { status: "draft" },
    });
    // Persisted under the writer's id.
    const row = tables.saved_views.find((v) => v.id === res.body.id);
    expect(row?.userId).toBe(USER_IDS.writer);

    // It now shows up in the writer's list (and only theirs).
    const list = await request(app)
      .get("/api/cms/saved-views")
      .set("Authorization", bearer("writer"));
    expect(list.body.items).toHaveLength(1);
  });

  it("returns 400 for an invalid body (missing name)", async () => {
    const res = await request(app)
      .post("/api/cms/saved-views")
      .set("Authorization", bearer("viewer"))
      .send({ query: {} });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/cms/saved-views/:id — update + scoping", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .patch(`/api/cms/saved-views/${VIEW_VIEWER}`)
      .send({ name: "new" });
    expect(res.status).toBe(401);
  });

  it("updates the owner's own view", async () => {
    const res = await request(app)
      .patch(`/api/cms/saved-views/${VIEW_VIEWER}`)
      .set("Authorization", bearer("viewer"))
      .send({ name: "Renamed", query: { status: "published" } });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed");
    expect(res.body.query).toEqual({ status: "published" });
    expect(
      tables.saved_views.find((v) => v.id === VIEW_VIEWER)?.name,
    ).toBe("Renamed");
  });

  it("cannot update another user's view (404, and the row is untouched)", async () => {
    const res = await request(app)
      // viewer trying to patch the editor's view
      .patch(`/api/cms/saved-views/${VIEW_EDITOR}`)
      .set("Authorization", bearer("viewer"))
      .send({ name: "hijacked" });
    expect(res.status).toBe(404);
    expect(
      tables.saved_views.find((v) => v.id === VIEW_EDITOR)?.name,
    ).toBe("Editor SEO queue");
  });

  it("returns 404 for a non-existent view", async () => {
    const res = await request(app)
      .patch("/api/cms/saved-views/99999999-9999-4999-8999-999999999999")
      .set("Authorization", bearer("viewer"))
      .send({ name: "nope" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/cms/saved-views/:id — delete + scoping", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).delete(
      `/api/cms/saved-views/${VIEW_VIEWER}`,
    );
    expect(res.status).toBe(401);
  });

  it("deletes the owner's own view", async () => {
    const res = await request(app)
      .delete(`/api/cms/saved-views/${VIEW_VIEWER}`)
      .set("Authorization", bearer("viewer"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: VIEW_VIEWER });
    expect(tables.saved_views.find((v) => v.id === VIEW_VIEWER)).toBeUndefined();
  });

  it("cannot delete another user's view (404, and the row survives)", async () => {
    const res = await request(app)
      // viewer trying to delete the editor's view
      .delete(`/api/cms/saved-views/${VIEW_EDITOR}`)
      .set("Authorization", bearer("viewer"));
    expect(res.status).toBe(404);
    expect(
      tables.saved_views.find((v) => v.id === VIEW_EDITOR),
    ).toBeDefined();
  });
});
