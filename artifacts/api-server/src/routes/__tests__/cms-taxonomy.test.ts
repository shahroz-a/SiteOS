process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = "silent";

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import {
  makeDbMock,
  makeDrizzleMock,
  type Tables,
} from "../../__tests__/fakeDb";
import { ROLES, getPermissionsForRole, type Role } from "@workspace/cms-auth";

/**
 * RBAC + behavioural tests for the taxonomy management endpoints (CMS list,
 * archive, merge). They run the real middleware chain over the in-memory fake
 * DB, asserting 401/403 gating and that merge/archive actually move
 * relationships and delete the source term.
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

// Real UUIDs — the generated response/param zod schemas require `id` (and
// `targetId`) to be valid UUIDs, so short ids would surface as 400s.
const A1 = "aaaaaaaa-0000-4000-8000-000000000001";
const A2 = "aaaaaaaa-0000-4000-8000-000000000002";
const C1 = "cccccccc-0000-4000-8000-000000000001";
const C2 = "cccccccc-0000-4000-8000-000000000002";
const C3 = "cccccccc-0000-4000-8000-000000000003";
const T1 = "11111111-0000-4000-8000-000000000001";
const T2 = "11111111-0000-4000-8000-000000000002";
const P1 = "dddddddd-0000-4000-8000-000000000001";
const P2 = "dddddddd-0000-4000-8000-000000000002";
const MISSING = "ffffffff-0000-4000-8000-000000000000";

const MANAGE_ROLES = ROLES.filter((r) =>
  getPermissionsForRole(r).includes("taxonomy.manage"),
);
const NON_MANAGE_ROLES = ROLES.filter(
  (r) => !getPermissionsForRole(r).includes("taxonomy.manage"),
);

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

function seedTables(): Tables {
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

  const authors = [
    { id: A1, name: "Alice", slug: "alice", bio: null, avatarUrl: null, role: null, email: null, originalUrl: null, social: null, archivedAt: null, createdAt: CREATED, updatedAt: CREATED },
    { id: A2, name: "Bob", slug: "bob", bio: null, avatarUrl: null, role: null, email: null, originalUrl: null, social: null, archivedAt: CREATED, createdAt: CREATED, updatedAt: CREATED },
  ];

  const categories = [
    { id: C1, name: "Travel", slug: "travel", description: null, parentId: null, path: "/blog/category/travel/", originalUrl: null, archivedAt: null, createdAt: CREATED, updatedAt: CREATED },
    { id: C2, name: "Things To Do", slug: "things-to-do", description: null, parentId: null, path: "/blog/category/things-to-do/", originalUrl: null, archivedAt: null, createdAt: CREATED, updatedAt: CREATED },
    { id: C3, name: "City Guides", slug: "city-guides", description: null, parentId: C2, path: "/blog/category/city-guides/", originalUrl: null, archivedAt: null, createdAt: CREATED, updatedAt: CREATED },
  ];

  const tags = [
    { id: T1, name: "Food", slug: "food", description: null, originalUrl: null, archivedAt: null, createdAt: CREATED },
    { id: T2, name: "Foodie", slug: "foodie", description: null, originalUrl: null, archivedAt: null, createdAt: CREATED },
  ];

  const pages = [
    { id: P1, authorId: A1, primaryCategoryId: C1 },
    { id: P2, authorId: A1, primaryCategoryId: C2 },
  ];

  const page_categories = [
    { pageId: P1, categoryId: C1 },
    { pageId: P2, categoryId: C2 },
  ];

  const page_tags = [
    { pageId: P1, tagId: T1 },
    { pageId: P1, tagId: T2 },
    { pageId: P2, tagId: T2 },
  ];

  return {
    users,
    sessions,
    audit_logs: [],
    authors,
    categories,
    tags,
    pages,
    page_categories,
    page_tags,
  };
}

const tables: Tables = seedTables();

vi.mock("@workspace/db", () => makeDbMock(tables));
vi.mock("drizzle-orm", () => makeDrizzleMock());

const app = (await import("../../app")).default;

beforeEach(() => {
  const fresh = seedTables();
  for (const k of Object.keys(tables)) delete tables[k];
  for (const [k, v] of Object.entries(fresh)) tables[k] = v;
});

const bearer = (role: Role) => `Bearer sid-${role}`;

describe("GET /api/cms/authors", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/cms/authors");
    expect(res.status).toBe(401);
  });

  for (const role of NON_MANAGE_ROLES) {
    it(`returns 403 for ${role} (lacks taxonomy.manage)`, async () => {
      const res = await request(app)
        .get("/api/cms/authors")
        .set("Authorization", bearer(role));
      expect(res.status).toBe(403);
    });
  }

  it("returns all authors with archived flag and post counts (admin)", async () => {
    const res = await request(app)
      .get("/api/cms/authors")
      .set("Authorization", bearer("admin"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const alice = res.body.find((a: { slug: string }) => a.slug === "alice");
    const bob = res.body.find((a: { slug: string }) => a.slug === "bob");
    expect(alice.archived).toBe(false);
    expect(alice.postCount).toBe(2);
    expect(bob.archived).toBe(true);
    expect(bob.postCount).toBe(0);
  });
});

describe("GET /api/cms/categories", () => {
  it("returns all categories (incl. archived) with hierarchy + counts (admin)", async () => {
    const res = await request(app)
      .get("/api/cms/categories")
      .set("Authorization", bearer("admin"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    const travel = res.body.find((c: { slug: string }) => c.slug === "travel");
    expect(travel.postCount).toBe(1);
    const child = res.body.find((c: { slug: string }) => c.slug === "city-guides");
    expect(child.parentId).toBe(C2);
  });
});

describe("GET /api/cms/tags", () => {
  it("returns all tags with counts (admin)", async () => {
    const res = await request(app)
      .get("/api/cms/tags")
      .set("Authorization", bearer("admin"));
    expect(res.status).toBe(200);
    const foodie = res.body.find((t: { slug: string }) => t.slug === "foodie");
    expect(foodie.postCount).toBe(2);
  });
});

describe("POST /api/cms/authors/:id/archive", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .post(`/api/cms/authors/${A1}/archive`)
      .send({ archived: true });
    expect(res.status).toBe(401);
  });

  for (const role of NON_MANAGE_ROLES) {
    it(`returns 403 for ${role}`, async () => {
      const res = await request(app)
        .post(`/api/cms/authors/${A1}/archive`)
        .set("Authorization", bearer(role))
        .send({ archived: true });
      expect(res.status).toBe(403);
    });
  }

  it("archives and restores an author (admin) and audits", async () => {
    const archive = await request(app)
      .post(`/api/cms/authors/${A1}/archive`)
      .set("Authorization", bearer("admin"))
      .send({ archived: true });
    expect(archive.status).toBe(200);
    expect(archive.body.archived).toBe(true);
    expect(tables.authors.find((a) => a.id === A1)?.archivedAt).not.toBeNull();
    expect(tables.audit_logs.some((l) => l.action === "author.archive")).toBe(true);

    const restore = await request(app)
      .post(`/api/cms/authors/${A1}/archive`)
      .set("Authorization", bearer("admin"))
      .send({ archived: false });
    expect(restore.status).toBe(200);
    expect(restore.body.archived).toBe(false);
    expect(tables.authors.find((a) => a.id === A1)?.archivedAt).toBeNull();
  });

  it("returns 404 for an unknown author (admin)", async () => {
    const res = await request(app)
      .post(`/api/cms/authors/${MISSING}/archive`)
      .set("Authorization", bearer("admin"))
      .send({ archived: true });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/cms/categories/:id/merge", () => {
  for (const role of NON_MANAGE_ROLES) {
    it(`returns 403 for ${role}`, async () => {
      const res = await request(app)
        .post(`/api/cms/categories/${C2}/merge`)
        .set("Authorization", bearer(role))
        .send({ targetId: C1 });
      expect(res.status).toBe(403);
    });
  }

  it("rejects merging a category into itself (400)", async () => {
    const res = await request(app)
      .post(`/api/cms/categories/${C1}/merge`)
      .set("Authorization", bearer("admin"))
      .send({ targetId: C1 });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the target is missing", async () => {
    const res = await request(app)
      .post(`/api/cms/categories/${C1}/merge`)
      .set("Authorization", bearer("admin"))
      .send({ targetId: MISSING });
    expect(res.status).toBe(404);
  });

  it("merges c2 into c1: moves links, reparents children, deletes source", async () => {
    const res = await request(app)
      .post(`/api/cms/categories/${C2}/merge`)
      .set("Authorization", bearer("admin"))
      .send({ targetId: C1 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(C1);
    expect(res.body.postCount).toBe(2);
    // Source category gone.
    expect(tables.categories.find((c) => c.id === C2)).toBeUndefined();
    // p2's link moved to c1; no dangling link to c2.
    const links = tables.page_categories.filter((l) => l.pageId === P2);
    expect(links).toHaveLength(1);
    expect(links[0].categoryId).toBe(C1);
    // Child c3 reparented from c2 to c1.
    expect(tables.categories.find((c) => c.id === C3)?.parentId).toBe(C1);
    // p2's primary category repointed.
    expect(tables.pages.find((p) => p.id === P2)?.primaryCategoryId).toBe(C1);
    expect(tables.audit_logs.some((l) => l.action === "category.merge")).toBe(true);
  });
});

describe("POST /api/cms/tags/:id/merge", () => {
  it("merges t2 into t1, deduping shared pages, and deletes the source", async () => {
    const res = await request(app)
      .post(`/api/cms/tags/${T2}/merge`)
      .set("Authorization", bearer("admin"))
      .send({ targetId: T1 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(T1);
    // t1 now covers p1 (already had it) and p2 (moved) — no duplicate p1 row.
    expect(res.body.postCount).toBe(2);
    expect(tables.tags.find((t) => t.id === T2)).toBeUndefined();
    const t1Links = tables.page_tags.filter((l) => l.tagId === T1);
    expect(t1Links.map((l) => l.pageId).sort()).toEqual([P1, P2].sort());
    expect(tables.page_tags.some((l) => l.tagId === T2)).toBe(false);
  });

  it("rejects merging a tag into itself (400)", async () => {
    const res = await request(app)
      .post(`/api/cms/tags/${T1}/merge`)
      .set("Authorization", bearer("admin"))
      .send({ targetId: T1 });
    expect(res.status).toBe(400);
  });
});

describe("taxonomy management — permitted roles", () => {
  for (const role of MANAGE_ROLES) {
    it(`allows ${role} to list authors`, async () => {
      const res = await request(app)
        .get("/api/cms/authors")
        .set("Authorization", bearer(role));
      expect(res.status).toBe(200);
    });
  }
});
