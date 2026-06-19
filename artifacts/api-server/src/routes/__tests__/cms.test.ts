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
    cleanedHtml: "<p>The real article body the importer dropped.</p>",
    componentTree: [],
    richText: null,
    originalHtml: "<html><body><p>raw</p></body></html>",
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
    cleanedHtml: null,
    componentTree: [{ blockType: "paragraph", text: "Parsed body" }],
    richText: null,
    originalHtml: "<html><body><p>raw original fallback</p></body></html>",
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

describe("GET /api/cms/audit-logs", () => {
  const PERMITTED: Role[] = ["admin", "editor"];

  function seedAuditEntries(): Tables {
    const base = seedAuthTables();
    base.audit_logs = [
      {
        id: "a-role",
        action: "user.role.update",
        entityType: "user",
        entityId: "u-target",
        before: { role: "viewer" },
        after: { role: "editor" },
        metadata: null,
        actorId: "u-admin",
        actorEmail: "admin@example.com",
        actorRole: "admin",
        ipAddress: null,
        createdAt: new Date("2025-03-01T00:00:00Z"),
      },
      {
        id: "a-media",
        action: "media.metadata.update",
        entityType: "media",
        entityId: "https://cdn.example.com/img.jpg",
        before: { alt: "", altStatus: "missing" },
        after: { alt: "A sunny beach", altStatus: "ok" },
        metadata: null,
        actorId: "u-editor",
        actorEmail: "editor@example.com",
        actorRole: "editor",
        ipAddress: null,
        createdAt: new Date("2025-03-02T00:00:00Z"),
      },
    ];
    return base;
  }

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/cms/audit-logs");
    expect(res.status).toBe(401);
  });

  for (const role of ROLES.filter((r) => !PERMITTED.includes(r))) {
    it(`returns 403 for ${role} (lacks audit.view)`, async () => {
      const res = await request(app)
        .get("/api/cms/audit-logs")
        .set("Authorization", bearer(role));
      expect(res.status).toBe(403);
    });
  }

  describe("with seeded audit entries", () => {
    beforeEach(() => {
      const fresh = seedAuditEntries();
      for (const k of Object.keys(tables)) delete tables[k];
      for (const [k, v] of Object.entries(fresh)) tables[k] = v;
    });

    it("returns all entries, newest first, without a filter", async () => {
      const res = await request(app)
        .get("/api/cms/audit-logs")
        .set("Authorization", bearer("admin"));
      expect(res.status).toBe(200);
      expect(res.body.pagination.total).toBe(2);
      expect(res.body.items.map((e: { id: string }) => e.id)).toEqual([
        "a-media",
        "a-role",
      ]);
    });

    it("filters to a single action and counts only matches", async () => {
      const res = await request(app)
        .get("/api/cms/audit-logs?action=media.metadata.update")
        .set("Authorization", bearer("admin"));
      expect(res.status).toBe(200);
      expect(res.body.pagination.total).toBe(1);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].action).toBe("media.metadata.update");
      expect(res.body.items[0].after.alt).toBe("A sunny beach");
    });
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

describe("GET /api/cms/held-back-articles/:id/source", () => {
  const PERMITTED: Role[] = ["admin", "editor", "reviewer"];

  beforeEach(() => {
    const fresh = seedHeldBack();
    for (const k of Object.keys(tables)) delete tables[k];
    for (const [k, v] of Object.entries(fresh)) tables[k] = v;
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(
      "/api/cms/held-back-articles/p-fail/source",
    );
    expect(res.status).toBe(401);
  });

  for (const role of ROLES.filter((r) => !PERMITTED.includes(r))) {
    it(`returns 403 for ${role} (lacks review.approve)`, async () => {
      const res = await request(app)
        .get("/api/cms/held-back-articles/p-fail/source")
        .set("Authorization", bearer(role));
      expect(res.status).toBe(403);
    });
  }

  it("returns the cleaned source body alongside the parsed trees", async () => {
    const res = await request(app)
      .get("/api/cms/held-back-articles/p-fail/source")
      .set("Authorization", bearer("reviewer"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "p-fail",
      slug: "broken-article",
      sourceKind: "cleaned",
    });
    expect(res.body.sourceHtml).toContain("the importer dropped");
    // Parsed tree is empty for the broken article — exactly what the editor
    // should see is missing on the right.
    expect(res.body.componentTree).toEqual([]);
  });

  it("falls back to the raw original HTML when there is no cleaned body", async () => {
    const res = await request(app)
      .get("/api/cms/held-back-articles/p-pass/source")
      .set("Authorization", bearer("reviewer"));
    expect(res.status).toBe(200);
    expect(res.body.sourceKind).toBe("original");
    expect(res.body.sourceHtml).toContain("raw original fallback");
    expect(res.body.componentTree).toEqual([
      { blockType: "paragraph", text: "Parsed body" },
    ]);
  });

  it("returns 404 for a published post (not in the queue)", async () => {
    const res = await request(app)
      .get("/api/cms/held-back-articles/p-pub/source")
      .set("Authorization", bearer("admin"));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a draft non-post page (not in the queue)", async () => {
    const res = await request(app)
      .get("/api/cms/held-back-articles/p-cat/source")
      .set("Authorization", bearer("admin"));
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request(app)
      .get("/api/cms/held-back-articles/does-not-exist/source")
      .set("Authorization", bearer("admin"));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/cms/held-back-articles/:id/reparse", () => {
  const PERMITTED: Role[] = ["admin", "editor", "reviewer"];

  // A rich article body that the parser extracts cleanly into a real tree, used
  // to prove a hand-edit / re-parse turns a failing article into a passing one.
  const GOOD_HTML =
    "<article class='entry-content'>" +
    "<h2>Intro</h2><p>First real paragraph.</p>" +
    "<h2>Details</h2><p>Second real paragraph.</p><p>Third paragraph.</p>" +
    "</article>";

  beforeEach(() => {
    const fresh = seedHeldBack();
    for (const k of Object.keys(tables)) delete tables[k];
    for (const [k, v] of Object.entries(fresh)) tables[k] = v;
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).post(
      "/api/cms/held-back-articles/p-fail/reparse",
    );
    expect(res.status).toBe(401);
  });

  for (const role of ROLES.filter((r) => !PERMITTED.includes(r))) {
    it(`returns 403 for ${role} (lacks review.approve)`, async () => {
      const res = await request(app)
        .post("/api/cms/held-back-articles/p-fail/reparse")
        .set("Authorization", bearer(role));
      expect(res.status).toBe(403);
    });
  }

  it("re-parses the stored source HTML and persists the result", async () => {
    // Replace the broken article's stored body with parseable content, then
    // re-parse the stored source (no html in the request).
    tables.pages.find((p) => p.id === "p-fail")!.cleanedHtml = GOOD_HTML;

    const res = await request(app)
      .post("/api/cms/held-back-articles/p-fail/reparse")
      .set("Authorization", bearer("reviewer"))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("reparse");
    expect(res.body.validationStatus).toBe("pass");
    expect(res.body.componentTree).toBeTruthy();

    // The page row now carries the freshly parsed trees.
    const page = tables.pages.find((p) => p.id === "p-fail")!;
    expect(page.componentTree).toBeTruthy();
    expect(page.richText).toBeTruthy();

    // Derived rows were rewritten and a fresh validation report appended.
    expect(tables.blocks.length).toBeGreaterThan(0);
    expect(tables.blocks.every((b) => b.pageId === "p-fail")).toBe(true);
    expect(tables.component_tree).toHaveLength(1);
    const reports = tables.validation_reports.filter(
      (r) => r.pageId === "p-fail",
    );
    expect(reports.length).toBe(2); // seeded + the new one
    expect(reports.some((r) => r.status === "pass")).toBe(true);

    // Audited as a re-parse.
    expect(tables.audit_logs[0].action).toBe("article.reparse");
    expect(tables.audit_logs[0].entityId).toBe("p-fail");
  });

  it("parses hand-edited HTML when supplied (mode=edit)", async () => {
    const res = await request(app)
      .post("/api/cms/held-back-articles/p-fail/reparse")
      .set("Authorization", bearer("editor"))
      .send({ html: GOOD_HTML });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("edit");
    expect(res.body.validationStatus).toBe("pass");
    expect(tables.audit_logs[0].action).toBe("article.edit");
  });

  it("keeps the article a draft (editor publishes separately)", async () => {
    await request(app)
      .post("/api/cms/held-back-articles/p-fail/reparse")
      .set("Authorization", bearer("reviewer"))
      .send({ html: GOOD_HTML });
    expect(tables.pages.find((p) => p.id === "p-fail")?.status).toBe("draft");
  });

  it("returns 422 when the supplied HTML parses to no content", async () => {
    const res = await request(app)
      .post("/api/cms/held-back-articles/p-fail/reparse")
      .set("Authorization", bearer("admin"))
      .send({ html: "<div>   </div>" });
    expect(res.status).toBe(422);
  });

  it("returns 404 for a published post (not in the queue)", async () => {
    const res = await request(app)
      .post("/api/cms/held-back-articles/p-pub/reparse")
      .set("Authorization", bearer("admin"))
      .send({ html: GOOD_HTML });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a draft non-post page (not in the queue)", async () => {
    const res = await request(app)
      .post("/api/cms/held-back-articles/p-cat/reparse")
      .set("Authorization", bearer("admin"))
      .send({ html: GOOD_HTML });
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request(app)
      .post("/api/cms/held-back-articles/does-not-exist/reparse")
      .set("Authorization", bearer("admin"))
      .send({ html: GOOD_HTML });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/cms/posts/:id/source", () => {
  beforeEach(() => {
    const fresh = seedHeldBack();
    for (const k of Object.keys(tables)) delete tables[k];
    for (const [k, v] of Object.entries(fresh)) tables[k] = v;
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/cms/posts/p-fail/source");
    expect(res.status).toBe(401);
  });

  it("returns the source for a DRAFT post (cleaned body)", async () => {
    const res = await request(app)
      .get("/api/cms/posts/p-fail/source")
      .set("Authorization", bearer("viewer"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "p-fail",
      slug: "broken-article",
      sourceKind: "cleaned",
    });
    expect(res.body.sourceHtml).toContain("the importer dropped");
    expect(res.body.componentTree).toEqual([]);
  });

  it("returns the source for a PUBLISHED post (any status, not queue-gated)", async () => {
    const res = await request(app)
      .get("/api/cms/posts/p-pub/source")
      .set("Authorization", bearer("viewer"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "p-pub", slug: "live-article" });
  });

  it("falls back to the raw original HTML when there is no cleaned body", async () => {
    const res = await request(app)
      .get("/api/cms/posts/p-pass/source")
      .set("Authorization", bearer("viewer"));
    expect(res.status).toBe(200);
    expect(res.body.sourceKind).toBe("original");
    expect(res.body.sourceHtml).toContain("raw original fallback");
  });

  it("returns 404 for a non-post page", async () => {
    const res = await request(app)
      .get("/api/cms/posts/p-cat/source")
      .set("Authorization", bearer("admin"));
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request(app)
      .get("/api/cms/posts/does-not-exist/source")
      .set("Authorization", bearer("admin"));
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/cms/held-back-articles/:id", () => {
  const PERMITTED: Role[] = ["admin", "editor", "reviewer"];

  beforeEach(() => {
    const fresh = seedHeldBack();
    for (const k of Object.keys(tables)) delete tables[k];
    for (const [k, v] of Object.entries(fresh)) tables[k] = v;
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .patch("/api/cms/held-back-articles/p-fail")
      .send({ action: "publish" });
    expect(res.status).toBe(401);
  });

  for (const role of ROLES.filter((r) => !PERMITTED.includes(r))) {
    it(`returns 403 for ${role} (lacks review.approve)`, async () => {
      const res = await request(app)
        .patch("/api/cms/held-back-articles/p-fail")
        .set("Authorization", bearer(role))
        .send({ action: "publish" });
      expect(res.status).toBe(403);
    });
  }

  it("publishes a held-back article (draft → published) and audits it", async () => {
    const res = await request(app)
      .patch("/api/cms/held-back-articles/p-fail")
      .set("Authorization", bearer("reviewer"))
      .send({ action: "publish" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "p-fail",
      slug: "broken-article",
      status: "published",
    });
    expect(tables.pages.find((p) => p.id === "p-fail")?.status).toBe(
      "published",
    );
    expect(tables.audit_logs).toHaveLength(1);
    expect(tables.audit_logs[0].action).toBe("article.publish");
    expect(tables.audit_logs[0].entityId).toBe("p-fail");
  });

  it("dismisses a held-back article (draft → archived) and audits it", async () => {
    const res = await request(app)
      .patch("/api/cms/held-back-articles/p-fail")
      .set("Authorization", bearer("editor"))
      .send({ action: "dismiss" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("archived");
    expect(tables.pages.find((p) => p.id === "p-fail")?.status).toBe(
      "archived",
    );
    expect(tables.audit_logs[0].action).toBe("article.dismiss");
  });

  it("returns 400 for an invalid action", async () => {
    const res = await request(app)
      .patch("/api/cms/held-back-articles/p-fail")
      .set("Authorization", bearer("admin"))
      .send({ action: "delete" });
    expect(res.status).toBe(400);
    expect(tables.pages.find((p) => p.id === "p-fail")?.status).toBe("draft");
  });

  it("returns 404 for a published post (not in the queue)", async () => {
    const res = await request(app)
      .patch("/api/cms/held-back-articles/p-pub")
      .set("Authorization", bearer("admin"))
      .send({ action: "publish" });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a draft non-post page (not in the queue)", async () => {
    const res = await request(app)
      .patch("/api/cms/held-back-articles/p-cat")
      .set("Authorization", bearer("admin"))
      .send({ action: "publish" });
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request(app)
      .patch("/api/cms/held-back-articles/does-not-exist")
      .set("Authorization", bearer("admin"))
      .send({ action: "publish" });
    expect(res.status).toBe(404);
  });

  it("checks authorization before validating the body (403 beats 400)", async () => {
    const res = await request(app)
      .patch("/api/cms/held-back-articles/p-fail")
      .set("Authorization", bearer("viewer"))
      .send({ action: "delete" });
    expect(res.status).toBe(403);
  });
});
