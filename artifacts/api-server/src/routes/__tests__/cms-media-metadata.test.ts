process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = "silent";

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { makeDbMock, makeDrizzleMock, type Tables } from "../../__tests__/fakeDb";
import { ROLES, hasPermission, type Role } from "@workspace/cms-auth";

/**
 * Route tests for PATCH /cms/media/metadata. The real `updateMetadataByUrl`
 * issues raw `db.execute` SQL the in-memory fake DB does not implement (its SQL
 * is verified against the real database, like `listMedia`), so we mock just that
 * one lib function to drive the route. This exercises the auth/RBAC chain, the
 * "at least one field" validation, the 404 path, and — the point of the task —
 * that a successful edit writes a `media.metadata.update` audit row carrying
 * before/after for ONLY the changed fields, and that a no-op edit writes none.
 */

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

const updateMetadataByUrlMock = vi.fn();
vi.mock("../../lib/media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/media")>();
  return {
    ...actual,
    updateMetadataByUrl: (...args: unknown[]) => updateMetadataByUrlMock(...args),
  };
});

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
  updateMetadataByUrlMock.mockReset();
});

const bearer = (role: Role) => `Bearer sid-${role}`;
const ENDPOINT = "/api/cms/media/metadata";
const permittedRole = ROLES.find((r) => hasPermission(r, "media.manage"))!;
const URL = "https://cdn.headout.com/media/eiffel.jpg";

describe("PATCH /api/cms/media/metadata (RBAC)", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).patch(ENDPOINT).send({ url: URL, title: "x" });
    expect(res.status).toBe(401);
    expect(updateMetadataByUrlMock).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown session token", async () => {
    const res = await request(app)
      .patch(ENDPOINT)
      .set("Authorization", "Bearer sid-nope")
      .send({ url: URL, title: "x" });
    expect(res.status).toBe(401);
  });

  for (const role of ROLES.filter((r) => !hasPermission(r, "media.manage"))) {
    it(`returns 403 for ${role} (lacks media.manage)`, async () => {
      const res = await request(app)
        .patch(ENDPOINT)
        .set("Authorization", bearer(role))
        .send({ url: URL, title: "x" });
      expect(res.status).toBe(403);
      expect(updateMetadataByUrlMock).not.toHaveBeenCalled();
    });
  }
});

describe("PATCH /api/cms/media/metadata (validation)", () => {
  it("returns 400 when no metadata field is provided", async () => {
    const res = await request(app)
      .patch(ENDPOINT)
      .set("Authorization", bearer(permittedRole))
      .send({ url: URL });
    expect(res.status).toBe(400);
    expect(updateMetadataByUrlMock).not.toHaveBeenCalled();
  });

  it("returns 400 when url is missing", async () => {
    const res = await request(app)
      .patch(ENDPOINT)
      .set("Authorization", bearer(permittedRole))
      .send({ title: "x" });
    expect(res.status).toBe(400);
    expect(updateMetadataByUrlMock).not.toHaveBeenCalled();
  });

  it("passes only the provided fields through to the lib", async () => {
    updateMetadataByUrlMock.mockResolvedValue({
      updatedUsages: 1,
      before: { title: null, caption: null, credit: null },
      after: { title: "New", caption: null, credit: null },
      changedFields: ["title"],
    });
    const res = await request(app)
      .patch(ENDPOINT)
      .set("Authorization", bearer(permittedRole))
      .send({ url: URL, title: "New" });
    expect(res.status).toBe(200);
    expect(updateMetadataByUrlMock).toHaveBeenCalledWith(URL, { title: "New" });
  });
});

describe("PATCH /api/cms/media/metadata (behaviour)", () => {
  it("returns 404 when no image with that URL exists", async () => {
    updateMetadataByUrlMock.mockResolvedValue({
      updatedUsages: 0,
      before: { title: null, caption: null, credit: null },
      after: { title: null, caption: null, credit: null },
      changedFields: [],
    });
    const res = await request(app)
      .patch(ENDPOINT)
      .set("Authorization", bearer(permittedRole))
      .send({ url: URL, title: "New" });
    expect(res.status).toBe(404);
    expect(tables.audit_logs).toHaveLength(0);
  });

  it("records a media.metadata.update audit row with before/after of only the changed fields", async () => {
    updateMetadataByUrlMock.mockResolvedValue({
      updatedUsages: 3,
      before: { title: "Old title", caption: "kept", credit: null },
      after: { title: "New title", caption: "kept", credit: "Jane Doe" },
      changedFields: ["title", "credit"],
    });

    const res = await request(app)
      .patch(ENDPOINT)
      .set("Authorization", bearer(permittedRole))
      .send({ url: URL, title: "New title", caption: "kept", credit: "Jane Doe" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      url: URL,
      title: "New title",
      caption: "kept",
      credit: "Jane Doe",
      updatedUsages: 3,
      changedFields: ["title", "credit"],
    });

    expect(tables.audit_logs).toHaveLength(1);
    const entry = tables.audit_logs[0];
    expect(entry.action).toBe("media.metadata.update");
    expect(entry.entityType).toBe("media");
    expect(entry.entityId).toBe(URL);
    // Only the changed fields are carried — caption (unchanged) is excluded.
    expect(entry.before).toEqual({ title: "Old title", credit: null });
    expect(entry.after).toEqual({ title: "New title", credit: "Jane Doe" });
    expect(entry.metadata).toMatchObject({
      url: URL,
      updatedUsages: 3,
      changedFields: ["title", "credit"],
    });
  });

  it("does not record an audit row when nothing actually changed", async () => {
    updateMetadataByUrlMock.mockResolvedValue({
      updatedUsages: 2,
      before: { title: "Same", caption: null, credit: null },
      after: { title: "Same", caption: null, credit: null },
      changedFields: [],
    });

    const res = await request(app)
      .patch(ENDPOINT)
      .set("Authorization", bearer(permittedRole))
      .send({ url: URL, title: "Same" });

    expect(res.status).toBe(200);
    expect(res.body.changedFields).toEqual([]);
    expect(tables.audit_logs).toHaveLength(0);
  });
});
