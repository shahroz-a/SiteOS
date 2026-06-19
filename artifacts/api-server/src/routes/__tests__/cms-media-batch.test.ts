process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = "silent";

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { makeDbMock, makeDrizzleMock, type Tables } from "../../__tests__/fakeDb";
import { ROLES, hasPermission, type Role } from "@workspace/cms-auth";

/**
 * Route tests for POST /cms/media/suggest-alt-batch. Unlike GET /cms/media, the
 * batch handler never touches the database — it only calls suggestAltTextBatch,
 * which talks to OpenAI. We mock the OpenAI integration so the real lib logic
 * (concurrency, per-image error isolation, input-order results) runs through the
 * route, while the auth/RBAC chain is exercised against the fake DB.
 */

const createMock = vi.fn();
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: { completions: { create: (...args: unknown[]) => createMock(...args) } },
  },
}));

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

/** Build a chat-completion response whose content is `text`. */
function completion(text: string) {
  return { choices: [{ message: { content: text } }] };
}

beforeEach(() => {
  const fresh = seedAuthTables();
  for (const k of Object.keys(tables)) delete tables[k];
  for (const [k, v] of Object.entries(fresh)) tables[k] = v;
  createMock.mockReset();
});

const bearer = (role: Role) => `Bearer sid-${role}`;
const ENDPOINT = "/api/cms/media/suggest-alt-batch";
const permittedRole = ROLES.find((r) => hasPermission(r, "media.manage"))!;

describe("POST /api/cms/media/suggest-alt-batch (RBAC)", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .send({ urls: ["https://img/a.jpg"] });
    expect(res.status).toBe(401);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown session token", async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set("Authorization", "Bearer sid-nope")
      .send({ urls: ["https://img/a.jpg"] });
    expect(res.status).toBe(401);
  });

  for (const role of ROLES.filter((r) => !hasPermission(r, "media.manage"))) {
    it(`returns 403 for ${role} (lacks media.manage)`, async () => {
      const res = await request(app)
        .post(ENDPOINT)
        .set("Authorization", bearer(role))
        .send({ urls: ["https://img/a.jpg"] });
      expect(res.status).toBe(403);
      expect(createMock).not.toHaveBeenCalled();
    });
  }
});

describe("POST /api/cms/media/suggest-alt-batch (validation)", () => {
  it("returns 400 when urls is empty", async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set("Authorization", bearer(permittedRole))
      .send({ urls: [] });
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns 400 when urls is missing", async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set("Authorization", bearer(permittedRole))
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when more than 50 urls are sent", async () => {
    const urls = Array.from({ length: 51 }, (_, i) => `https://img/${i}.jpg`);
    const res = await request(app)
      .post(ENDPOINT)
      .set("Authorization", bearer(permittedRole))
      .send({ urls });
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/cms/media/suggest-alt-batch (suggestions)", () => {
  it("returns one suggestion per requested URL, in input order", async () => {
    createMock.mockImplementation(() =>
      Promise.resolve(completion("A scenic alt description for the image")),
    );
    const urls = ["https://img/a.jpg", "https://img/b.jpg", "https://img/c.jpg"];

    const res = await request(app)
      .post(ENDPOINT)
      .set("Authorization", bearer(permittedRole))
      .send({ urls });

    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { url: string }) => r.url)).toEqual(urls);
    for (const r of res.body.results) {
      expect(r.suggestion).toBe("A scenic alt description for the image");
      expect(r.error).toBeNull();
    }
    expect(createMock).toHaveBeenCalledTimes(3);
  });

  it("does not de-duplicate repeated URLs (one result per request entry)", async () => {
    createMock.mockImplementation(() =>
      Promise.resolve(completion("A scenic alt description for the image")),
    );
    const urls = ["https://img/dup.jpg", "https://img/dup.jpg"];

    const res = await request(app)
      .post(ENDPOINT)
      .set("Authorization", bearer(permittedRole))
      .send({ urls });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results.map((r: { url: string }) => r.url)).toEqual(urls);
  });

  it("isolates per-image failures without failing the whole batch", async () => {
    createMock.mockImplementation((args: { messages: unknown }) => {
      const text = JSON.stringify(args);
      if (text.includes("bad.jpg")) {
        return Promise.reject(new Error("upstream boom"));
      }
      return Promise.resolve(completion("A scenic alt description for the image"));
    });
    const urls = ["https://img/good.jpg", "https://img/bad.jpg"];

    const res = await request(app)
      .post(ENDPOINT)
      .set("Authorization", bearer(permittedRole))
      .send({ urls });

    expect(res.status).toBe(200);
    const byUrl = Object.fromEntries(
      res.body.results.map((r: { url: string }) => [r.url, r]),
    );
    expect(byUrl["https://img/good.jpg"].suggestion).toBeTruthy();
    expect(byUrl["https://img/good.jpg"].error).toBeNull();
    expect(byUrl["https://img/bad.jpg"].suggestion).toBeNull();
    expect(byUrl["https://img/bad.jpg"].error).toBeTruthy();
  });
});
