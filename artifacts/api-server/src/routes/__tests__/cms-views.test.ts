process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = "silent";

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { makeDbMock, makeDrizzleMock, type Tables } from "../../__tests__/fakeDb";
import { ROLES, type Role } from "@workspace/cms-auth";

/**
 * Route tests for the saved-views CRUD (`/api/cms/saved-views`). They run the
 * REAL middleware chain (auth -> requirePermission("content.view")) over the
 * in-memory fake DB. Two concerns are covered, each with its own seed so their
 * fixtures can't leak into one another:
 *  - per-user CRUD & scoping: auth gating (401 unauthenticated; every role with
 *    content.view passes) and per-user scoping (a user can never
 *    list/update/delete another user's PRIVATE view -> 404 on write).
 *  - sharing/visibility: a view marked `shared` is visible (and applyable) to
 *    every authenticated CMS user, but only its owner may rename/update/delete
 *    it (the owner filter makes another user's row unwritable -> 404 on write).
 *
 * A session is presented via `Bearer <sid>` whose `sid` resolves to a seeded
 * `sessions` row (mirrors `cms.test.ts`).
 */

const FUTURE = new Date(Date.now() + 60 * 60 * 1000);
const CREATED = new Date("2025-01-01T00:00:00Z");

// --- Per-user scoping fixtures --------------------------------------------
const USER_IDS: Record<Role, string> = {
  admin: "u-admin",
  editor: "u-editor",
  writer: "u-writer",
  seo: "u-seo",
  reviewer: "u-reviewer",
  translator: "u-translator",
  viewer: "u-viewer",
};

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
      shared: false,
      createdAt: CREATED,
      updatedAt: CREATED,
    },
    {
      id: VIEW_EDITOR,
      userId: USER_IDS.editor,
      name: "Editor SEO queue",
      description: null,
      query: { q: "seo", pageType: "post" },
      shared: false,
      createdAt: CREATED,
      updatedAt: CREATED,
    },
  ];

  return { users, sessions, saved_views, audit_logs: [] };
}

// --- Sharing/visibility fixtures ------------------------------------------
const OWNER_ID = "u-owner";
const OTHER_ID = "u-other";
const VIEW_SHARED = "11111111-1111-4111-8111-111111111111";
const VIEW_PRIVATE = "22222222-2222-4222-8222-222222222222";
const VIEW_OTHER_PRIVATE = "33333333-3333-4333-8333-333333333333";

function seedTables(): Tables {
  const users = [
    {
      id: OWNER_ID,
      email: "owner@example.com",
      firstName: "Owner",
      lastName: "User",
      profileImageUrl: null,
      role: "editor",
      createdAt: CREATED,
      updatedAt: CREATED,
    },
    {
      id: OTHER_ID,
      email: "other@example.com",
      firstName: "Other",
      lastName: "User",
      profileImageUrl: null,
      role: "editor",
      createdAt: CREATED,
      updatedAt: CREATED,
    },
  ];

  const sessions = [
    {
      sid: "sid-owner",
      sess: {
        user: {
          id: OWNER_ID,
          email: "owner@example.com",
          firstName: "Owner",
          lastName: "User",
          profileImageUrl: null,
        },
        access_token: "tok",
      },
      expire: FUTURE,
    },
    {
      sid: "sid-other",
      sess: {
        user: {
          id: OTHER_ID,
          email: "other@example.com",
          firstName: "Other",
          lastName: "User",
          profileImageUrl: null,
        },
        access_token: "tok",
      },
      expire: FUTURE,
    },
  ];

  const saved_views = [
    {
      id: VIEW_SHARED,
      userId: OWNER_ID,
      name: "Shared draft SEO",
      description: "Drafts needing SEO",
      query: { status: "draft" },
      shared: true,
      createdAt: CREATED,
      updatedAt: new Date("2025-02-01T00:00:00Z"),
    },
    {
      id: VIEW_PRIVATE,
      userId: OWNER_ID,
      name: "Owner private",
      description: null,
      query: { q: "secret" },
      shared: false,
      createdAt: CREATED,
      updatedAt: new Date("2025-01-15T00:00:00Z"),
    },
    {
      id: VIEW_OTHER_PRIVATE,
      userId: OTHER_ID,
      name: "Other private",
      description: null,
      query: { q: "mine" },
      shared: false,
      createdAt: CREATED,
      updatedAt: new Date("2025-01-10T00:00:00Z"),
    },
  ];

  return { users, sessions, saved_views, audit_logs: [] };
}

const tables: Tables = seed();

vi.mock("@workspace/db", () => makeDbMock(tables));
vi.mock("drizzle-orm", () => makeDrizzleMock());

const app = (await import("../../app")).default;

/** Swap the shared `tables` contents in-place (the mock holds it by reference). */
function reseed(make: () => Tables) {
  const fresh = make();
  for (const k of Object.keys(tables)) delete tables[k];
  for (const [k, v] of Object.entries(fresh)) tables[k] = v;
}

const bearer = (sid: string) => `Bearer ${sid}`;

describe("saved-views — per-user CRUD & scoping", () => {
  beforeEach(() => reseed(seed));

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
          .set("Authorization", bearer(`sid-${role}`));
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });
    }

    it("lists only the signed-in user's own views", async () => {
      const viewer = await request(app)
        .get("/api/cms/saved-views")
        .set("Authorization", bearer("sid-viewer"));
      expect(viewer.body.items).toHaveLength(1);
      expect(viewer.body.items[0].id).toBe(VIEW_VIEWER);

      const editor = await request(app)
        .get("/api/cms/saved-views")
        .set("Authorization", bearer("sid-editor"));
      expect(editor.body.items).toHaveLength(1);
      expect(editor.body.items[0].id).toBe(VIEW_EDITOR);

      // The writer owns no views.
      const writer = await request(app)
        .get("/api/cms/saved-views")
        .set("Authorization", bearer("sid-writer"));
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
        .set("Authorization", bearer("sid-writer"))
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
        .set("Authorization", bearer("sid-writer"));
      expect(list.body.items).toHaveLength(1);
    });

    it("returns 400 for an invalid body (missing name)", async () => {
      const res = await request(app)
        .post("/api/cms/saved-views")
        .set("Authorization", bearer("sid-viewer"))
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
        .set("Authorization", bearer("sid-viewer"))
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
        .set("Authorization", bearer("sid-viewer"))
        .send({ name: "hijacked" });
      expect(res.status).toBe(404);
      expect(
        tables.saved_views.find((v) => v.id === VIEW_EDITOR)?.name,
      ).toBe("Editor SEO queue");
    });

    it("returns 404 for a non-existent view", async () => {
      const res = await request(app)
        .patch("/api/cms/saved-views/99999999-9999-4999-8999-999999999999")
        .set("Authorization", bearer("sid-viewer"))
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
        .set("Authorization", bearer("sid-viewer"));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, id: VIEW_VIEWER });
      expect(
        tables.saved_views.find((v) => v.id === VIEW_VIEWER),
      ).toBeUndefined();
    });

    it("cannot delete another user's view (404, and the row survives)", async () => {
      const res = await request(app)
        // viewer trying to delete the editor's view
        .delete(`/api/cms/saved-views/${VIEW_EDITOR}`)
        .set("Authorization", bearer("sid-viewer"));
      expect(res.status).toBe(404);
      expect(
        tables.saved_views.find((v) => v.id === VIEW_EDITOR),
      ).toBeDefined();
    });
  });
});

describe("saved-views — sharing/visibility", () => {
  beforeEach(() => reseed(seedTables));

  describe("GET /api/cms/saved-views (sharing)", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app).get("/api/cms/saved-views");
      expect(res.status).toBe(401);
    });

    it("returns the owner's own views (private + shared) with isOwner=true", async () => {
      const res = await request(app)
        .get("/api/cms/saved-views")
        .set("Authorization", bearer("sid-owner"));
      expect(res.status).toBe(200);
      const ids = res.body.items.map((v: { id: string }) => v.id).sort();
      expect(ids).toEqual([VIEW_SHARED, VIEW_PRIVATE].sort());
      for (const v of res.body.items) {
        expect(v.isOwner).toBe(true);
        expect(v.ownerId).toBe(OWNER_ID);
      }
    });

    it("shows another user's shared view (read-only) but not their private one", async () => {
      const res = await request(app)
        .get("/api/cms/saved-views")
        .set("Authorization", bearer("sid-other"));
      expect(res.status).toBe(200);
      const byId = Object.fromEntries(
        res.body.items.map((v: { id: string }) => [v.id, v]),
      );
      // Other user sees the owner's SHARED view plus their own private view.
      expect(Object.keys(byId).sort()).toEqual(
        [VIEW_SHARED, VIEW_OTHER_PRIVATE].sort(),
      );
      expect(byId[VIEW_SHARED].isOwner).toBe(false);
      expect(byId[VIEW_SHARED].shared).toBe(true);
      // A non-owner sees who shared the view, resolved from the owner's record.
      expect(byId[VIEW_SHARED].ownerName).toBe("Owner User");
      expect(byId[VIEW_OTHER_PRIVATE].isOwner).toBe(true);
    });
  });

  describe("POST /api/cms/saved-views (sharing)", () => {
    it("creates a shared view for the owner", async () => {
      const res = await request(app)
        .post("/api/cms/saved-views")
        .set("Authorization", bearer("sid-owner"))
        .send({
          name: "New shared",
          query: { status: "published" },
          shared: true,
        });
      expect(res.status).toBe(201);
      expect(res.body.shared).toBe(true);
      expect(res.body.isOwner).toBe(true);
      expect(res.body.ownerId).toBe(OWNER_ID);
    });

    it("defaults shared to false when omitted", async () => {
      const res = await request(app)
        .post("/api/cms/saved-views")
        .set("Authorization", bearer("sid-owner"))
        .send({ name: "Defaults private", query: {} });
      expect(res.status).toBe(201);
      expect(res.body.shared).toBe(false);
    });
  });

  describe("PATCH /api/cms/saved-views/:id (sharing)", () => {
    it("lets the owner toggle shared off", async () => {
      const res = await request(app)
        .patch(`/api/cms/saved-views/${VIEW_SHARED}`)
        .set("Authorization", bearer("sid-owner"))
        .send({ shared: false });
      expect(res.status).toBe(200);
      expect(res.body.shared).toBe(false);
    });

    it("does not let a non-owner update a shared view", async () => {
      const res = await request(app)
        .patch(`/api/cms/saved-views/${VIEW_SHARED}`)
        .set("Authorization", bearer("sid-other"))
        .send({ name: "Hijacked" });
      expect(res.status).toBe(404);
      // The owner's view is untouched.
      expect(tables.saved_views.find((v) => v.id === VIEW_SHARED)?.name).toBe(
        "Shared draft SEO",
      );
    });
  });

  describe("DELETE /api/cms/saved-views/:id (sharing)", () => {
    it("does not let a non-owner delete a shared view", async () => {
      const res = await request(app)
        .delete(`/api/cms/saved-views/${VIEW_SHARED}`)
        .set("Authorization", bearer("sid-other"));
      expect(res.status).toBe(404);
      expect(tables.saved_views.some((v) => v.id === VIEW_SHARED)).toBe(true);
    });

    it("lets the owner delete their shared view", async () => {
      const res = await request(app)
        .delete(`/api/cms/saved-views/${VIEW_SHARED}`)
        .set("Authorization", bearer("sid-owner"));
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(tables.saved_views.some((v) => v.id === VIEW_SHARED)).toBe(false);
    });
  });
});
