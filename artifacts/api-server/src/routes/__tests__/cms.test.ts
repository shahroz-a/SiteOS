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
 * RBAC API tests for the CMS endpoints. They exercise the REAL middleware chain
 * (`authMiddleware` -> `requireAuth` -> `requirePermission`) over the in-memory
 * fake DB, asserting that gating returns 401 unauthenticated, 403 for
 * under-privileged roles, and 200 for permitted roles. A session is presented
 * via a Bearer token whose `sid` resolves to a seeded `sessions` row.
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

const TARGET_ID = "u-target";
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
  // A separate user whose role gets changed by PATCH tests.
  users.push(makeUser(TARGET_ID, "viewer"));

  // One session per role, keyed by `sid-<role>`.
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

// Fixtures for the held-back review queue. A draft article whose stored
// validation row, re-scored against the CURRENT rules, still fails (empty
// component tree despite source prose) and one whose stored row is now a pass
// (so the live re-score, not the old verdict, is what's returned).
const HELD_BACK = new Date("2025-02-01T00:00:00Z");

function seedHeldBack(): Tables {
  const base = seedAuthTables();
  // A held-back article: real source content, empty parsed tree → fail.
  const failing = {
    id: "p-fail",
    slug: "broken-article",
    title: "Broken Article",
    canonicalUrl: "https://www.headout.com/blog/broken-article/",
    pageType: "post",
    status: "draft",
    crawledAt: new Date("2025-02-02T00:00:00Z"),
  };
  // A draft post that now re-scores to a pass (parsed matches source).
  const passing = {
    id: "p-pass",
    slug: "fine-article",
    title: "Fine Article",
    canonicalUrl: "https://www.headout.com/blog/fine-article/",
    pageType: "post",
    status: "draft",
    crawledAt: new Date("2025-02-01T00:00:00Z"),
  };
  // A published post must never appear in the queue.
  const published = {
    id: "p-pub",
    slug: "live-article",
    title: "Live Article",
    canonicalUrl: "https://www.headout.com/blog/live-article/",
    pageType: "post",
    status: "published",
    crawledAt: new Date("2025-02-03T00:00:00Z"),
  };
  // A draft category page (non-post) must never appear in the queue.
  const draftCategory = {
    id: "p-cat",
    slug: "things-to-do",
    title: "Things To Do",
    canonicalUrl: "https://www.headout.com/blog/category/things-to-do/",
    pageType: "category",
    status: "draft",
    crawledAt: new Date("2025-02-04T00:00:00Z"),
  };
  base.pages = [failing, passing, published, draftCategory];
  base.validation_reports = [
    {
      pageId: "p-fail",
      status: "fail",
      score: 75,
      issues: {
        source: { headings: 5, paragraphs: 20, images: 3, links: 4, tables: 0, lists: 1 },
        parsed: { headings: 0, paragraphs: 0, images: 0, links: 0, tables: 0, lists: 0, components: 0 },
      },
      createdAt: HELD_BACK,
    },
    {
      pageId: "p-pass",
      status: "fail",
      score: 75,
      issues: {
        source: { headings: 5, paragraphs: 20, images: 3, links: 4, tables: 0, lists: 1 },
        parsed: { headings: 5, paragraphs: 20, images: 3, links: 4, tables: 0, lists: 1, components: 25 },
      },
      createdAt: HELD_BACK,
    },
  ];
  return base;
}

// Mutated in place by `beforeEach` so the FakeDb (which holds a reference to
// this object) sees fresh data between tests without re-mocking the module.
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

describe("GET /api/cms/me", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/cms/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 for an unknown session token", async () => {
    const res = await request(app)
      .get("/api/cms/me")
      .set("Authorization", "Bearer sid-does-not-exist");
    expect(res.status).toBe(401);
  });

  for (const role of ROLES) {
    it(`returns 200 with role + effective permissions for ${role}`, async () => {
      const res = await request(app)
        .get("/api/cms/me")
        .set("Authorization", bearer(role));
      expect(res.status).toBe(200);
      expect(res.body.role).toBe(role);
      expect(res.body.user.id).toBe(USER_IDS[role]);
      expect(res.body.permissions.sort()).toEqual(
        [...getPermissionsForRole(role)].sort(),
      );
    });
  }
});

describe("GET /api/cms/users", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/cms/users");
    expect(res.status).toBe(401);
  });

  it("returns 200 for admin (users.manage)", async () => {
    const res = await request(app)
      .get("/api/cms/users")
      .set("Authorization", bearer("admin"));
    expect(res.status).toBe(200);
    // All seeded users (one per role + the target) come back.
    expect(res.body).toHaveLength(ROLES.length + 1);
  });

  for (const role of ROLES.filter((r) => r !== "admin")) {
    it(`returns 403 for ${role} (lacks users.manage)`, async () => {
      const res = await request(app)
        .get("/api/cms/users")
        .set("Authorization", bearer(role));
      expect(res.status).toBe(403);
    });
  }
});

describe("PATCH /api/cms/users/:userId/role", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .patch(`/api/cms/users/${TARGET_ID}/role`)
      .send({ role: "editor" });
    expect(res.status).toBe(401);
  });

  for (const role of ROLES.filter((r) => r !== "admin")) {
    it(`returns 403 for ${role} (lacks users.manage)`, async () => {
      const res = await request(app)
        .patch(`/api/cms/users/${TARGET_ID}/role`)
        .set("Authorization", bearer(role))
        .send({ role: "editor" });
      expect(res.status).toBe(403);
    });
  }

  it("returns 200 for admin and updates the role", async () => {
    const res = await request(app)
      .patch(`/api/cms/users/${TARGET_ID}/role`)
      .set("Authorization", bearer("admin"))
      .send({ role: "editor" });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(TARGET_ID);
    expect(res.body.role).toBe("editor");
    // The change is persisted and audited.
    expect(tables.users.find((u) => u.id === TARGET_ID)?.role).toBe("editor");
    expect(tables.audit_logs).toHaveLength(1);
    expect(tables.audit_logs[0].action).toBe("user.role.update");
  });

  it("returns 400 for an invalid role (admin)", async () => {
    const res = await request(app)
      .patch(`/api/cms/users/${TARGET_ID}/role`)
      .set("Authorization", bearer("admin"))
      .send({ role: "superuser" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the target user does not exist (admin)", async () => {
    const res = await request(app)
      .patch("/api/cms/users/u-missing/role")
      .set("Authorization", bearer("admin"))
      .send({ role: "editor" });
    expect(res.status).toBe(404);
  });

  it("checks authorization before validating the body (403 beats 400)", async () => {
    const res = await request(app)
      .patch(`/api/cms/users/${TARGET_ID}/role`)
      .set("Authorization", bearer("viewer"))
      .send({ role: "superuser" });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/cms/held-back-articles", () => {
  const PERMITTED: Role[] = ["admin", "editor", "reviewer"];

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/cms/held-back-articles");
    expect(res.status).toBe(401);
  });

  for (const role of ROLES.filter((r) => !PERMITTED.includes(r))) {
    it(`returns 403 for ${role} (lacks review.approve)`, async () => {
      const res = await request(app)
        .get("/api/cms/held-back-articles")
        .set("Authorization", bearer(role));
      expect(res.status).toBe(403);
    });
  }

  for (const role of PERMITTED) {
    it(`returns 200 for ${role} (has review.approve)`, async () => {
      const res = await request(app)
        .get("/api/cms/held-back-articles")
        .set("Authorization", bearer(role));
      expect(res.status).toBe(200);
    });
  }

  describe("with seeded draft articles", () => {
    beforeEach(() => {
      const fresh = seedHeldBack();
      for (const k of Object.keys(tables)) delete tables[k];
      for (const [k, v] of Object.entries(fresh)) tables[k] = v;
    });

    it("lists only draft posts, newest crawl first", async () => {
      const res = await request(app)
        .get("/api/cms/held-back-articles")
        .set("Authorization", bearer("reviewer"));
      expect(res.status).toBe(200);
      // Published post and draft category are excluded.
      expect(res.body.total).toBe(2);
      expect(res.body.articles.map((a: { slug: string }) => a.slug)).toEqual([
        "broken-article",
        "fine-article",
      ]);
    });

    it("re-scores stored rows against current rules (live verdict, not stored)", async () => {
      const res = await request(app)
        .get("/api/cms/held-back-articles")
        .set("Authorization", bearer("reviewer"));
      const bySlug = Object.fromEntries(
        res.body.articles.map((a: { slug: string }) => [a.slug, a]),
      );
      // Empty parsed tree despite source prose → still a live fail.
      expect(bySlug["broken-article"].validationStatus).toBe("fail");
      const failIssues = bySlug["broken-article"].issues.filter(
        (i: { severity: string }) => i.severity === "fail",
      );
      expect(failIssues.length).toBeGreaterThan(0);
      expect(failIssues[0].field).toBe("components");
      // Stored row said fail, but a current re-score is a pass.
      expect(bySlug["fine-article"].validationStatus).toBe("pass");
    });
  });
});
