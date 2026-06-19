process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = "silent";

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { makeDbMock, makeDrizzleMock, type Tables } from "../../__tests__/fakeDb";
import { ROLES, type Role } from "@workspace/cms-auth";

/**
 * RBAC + invariant tests for the publishing endpoints (transition / preview-link
 * / url). They run the REAL middleware chain over the in-memory fake DB and
 * assert: 401 unauthenticated, 403 for under-privileged roles (including the
 * DYNAMIC publish gate — a writer with content.edit but not content.publish may
 * not push content live), and that URL changes demand an explicit `confirm`.
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
const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const MISSING_ID = "22222222-2222-4222-8222-222222222222";

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

  // A single draft page so transitions can resolve a `before` status.
  const pages = [
    {
      id: DRAFT_ID,
      slug: "draft-article",
      title: "Draft Article",
      pathname: "/blog/draft-article/",
      canonicalUrl: "https://www.headout.com/blog/draft-article/",
      originalUrl: null,
      pageType: "post",
      status: "draft",
      scheduledFor: null,
      authorId: null,
      primaryCategoryId: null,
      crawledAt: CREATED,
    },
  ];

  return { users, sessions, audit_logs: [], pages };
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

describe("POST /api/cms/posts/:id/transition", () => {
  it("401 when unauthenticated", async () => {
    const res = await request(app)
      .post(`/api/cms/posts/${DRAFT_ID}/transition`)
      .send({ to: "review" });
    expect(res.status).toBe(401);
  });

  it("403 when a writer (no content.publish) tries to publish", async () => {
    const res = await request(app)
      .post(`/api/cms/posts/${DRAFT_ID}/transition`)
      .set("Authorization", bearer("writer"))
      .send({ to: "published" });
    expect(res.status).toBe(403);
  });

  it("403 when a writer (no content.publish) tries to schedule", async () => {
    const res = await request(app)
      .post(`/api/cms/posts/${DRAFT_ID}/transition`)
      .set("Authorization", bearer("writer"))
      .send({ to: "scheduled", scheduledFor: FUTURE.toISOString() });
    expect(res.status).toBe(403);
  });

  it("404 for a missing post (writer may perform editorial moves)", async () => {
    const res = await request(app)
      .post(`/api/cms/posts/${MISSING_ID}/transition`)
      .set("Authorization", bearer("writer"))
      .send({ to: "review" });
    expect(res.status).toBe(404);
  });

  it("400 when scheduling without a date", async () => {
    const res = await request(app)
      .post(`/api/cms/posts/${DRAFT_ID}/transition`)
      .set("Authorization", bearer("editor"))
      .send({ to: "scheduled" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/cms/posts/:id/preview-link", () => {
  it("401 when unauthenticated", async () => {
    const res = await request(app)
      .post(`/api/cms/posts/${DRAFT_ID}/preview-link`)
      .send({});
    expect(res.status).toBe(401);
  });

  it("201 with an expiring token for an authorized viewer", async () => {
    const res = await request(app)
      .post(`/api/cms/posts/${DRAFT_ID}/preview-link`)
      .set("Authorization", bearer("viewer"))
      .send({ expiresInHours: 24 });
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.token.length).toBeGreaterThan(20);
    expect(res.body.url).toContain(res.body.token);
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("404 for a missing post", async () => {
    const res = await request(app)
      .post(`/api/cms/posts/${MISSING_ID}/preview-link`)
      .set("Authorization", bearer("viewer"))
      .send({});
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/cms/posts/:id/url", () => {
  it("401 when unauthenticated", async () => {
    const res = await request(app)
      .patch(`/api/cms/posts/${DRAFT_ID}/url`)
      .send({ slug: "new-slug", confirm: true });
    expect(res.status).toBe(401);
  });

  for (const role of ["writer", "reviewer", "translator", "viewer"] as Role[]) {
    it(`403 for ${role} (no url.manage)`, async () => {
      const res = await request(app)
        .patch(`/api/cms/posts/${DRAFT_ID}/url`)
        .set("Authorization", bearer(role))
        .send({ slug: "new-slug", confirm: true });
      expect(res.status).toBe(403);
    });
  }

  it("400 when a url.manage holder omits explicit confirmation", async () => {
    const res = await request(app)
      .patch(`/api/cms/posts/${DRAFT_ID}/url`)
      .set("Authorization", bearer("seo"))
      .send({ slug: "new-slug", confirm: false });
    expect(res.status).toBe(400);
  });
});
