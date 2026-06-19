process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = "silent";

import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { makeDbMock, makeDrizzleMock, type Tables } from "../../__tests__/fakeDb";
import { ROLES, type Role } from "@workspace/cms-auth";

/**
 * End-to-end wire-contract test for the streaming re-extract endpoint
 * `POST /api/cms/held-back-articles/:id/reextract`.
 *
 * Existing unit tests cover the worker core (`reextractPage`), the drawer's
 * failure DISPLAY, and the client's stream parser in isolation. What was
 * untested is the SEAM where they meet: the real route + the NDJSON bridge
 * (`lib/reextract.ts`) that spawns the worker child process and relays its
 * stderr (progress) / stdout (result|error) as one newline-delimited JSON event
 * per line. A regression in that wire format (events no longer newline-split, an
 * error line changing shape) passes every existing unit test yet breaks the
 * editor's retry button in production.
 *
 * The test drives the REAL express app over the in-memory fake DB (so auth +
 * queue gating + audit are genuine) and spawns a deterministic worker fixture
 * via the bridge's supported `REEXTRACT_ENTRY`/`REEXTRACT_COMMAND` overrides —
 * the fixture mirrors the real worker's wire contract but yields a fixed outcome
 * chosen by `REEXTRACT_FIXTURE_MODE`. The streamed body is then parsed exactly
 * the way the browser client (`artifacts/cms/src/lib/reextract-client.ts`) parses
 * it, and we assert the event sequence the client depends on.
 */

const FIXTURE = fileURLToPath(
  new URL("./fixtures/reextract-fixture.mjs", import.meta.url),
);

const CREATED = new Date("2025-01-01T00:00:00Z");
const FUTURE = new Date(Date.now() + 60 * 60 * 1000);

const USER_IDS: Record<Role, string> = {
  admin: "u-admin",
  editor: "u-editor",
  writer: "u-writer",
  seo: "u-seo",
  reviewer: "u-reviewer",
  translator: "u-translator",
  viewer: "u-viewer",
};

// A held-back article (draft post) that is eligible for re-extraction, plus a
// published post and a draft non-post that the queue must reject with 404.
function seed(): Tables {
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
  const pages = [
    {
      id: "p-fail",
      slug: "broken-article",
      title: "Broken Article",
      canonicalUrl: "https://www.headout.com/blog/broken-article/",
      pageType: "post",
      status: "draft",
    },
    {
      id: "p-pub",
      slug: "live-article",
      title: "Live Article",
      canonicalUrl: "https://www.headout.com/blog/live-article/",
      pageType: "post",
      status: "published",
    },
    {
      id: "p-cat",
      slug: "things-to-do",
      title: "Things To Do",
      canonicalUrl: "https://www.headout.com/blog/category/things-to-do/",
      pageType: "category",
      status: "draft",
    },
  ];
  return { users, sessions, pages, audit_logs: [] };
}

const tables: Tables = seed();

vi.mock("@workspace/db", () => makeDbMock(tables));
vi.mock("drizzle-orm", () => makeDrizzleMock());

const app = (await import("../../app")).default;

const bearer = (role: Role) => `Bearer sid-${role}`;

beforeEach(() => {
  const fresh = seed();
  for (const k of Object.keys(tables)) delete tables[k];
  for (const [k, v] of Object.entries(fresh)) tables[k] = v;
  // Route the bridge's spawn at the deterministic fixture worker.
  process.env.REEXTRACT_COMMAND = "node";
  process.env.REEXTRACT_ENTRY = FIXTURE;
});

afterEach(() => {
  delete process.env.REEXTRACT_COMMAND;
  delete process.env.REEXTRACT_ENTRY;
  delete process.env.REEXTRACT_FIXTURE_MODE;
});

/**
 * Parse an NDJSON response body EXACTLY the way the browser client does
 * (`reextract-client.ts`): split on newlines, trim, skip blanks, JSON.parse each
 * line, keep only objects carrying a `type`. Mirroring the client here is the
 * point — it is the contract the route must keep satisfying.
 */
interface WireEvent {
  type: string;
  [key: string]: unknown;
}
function parseClientStream(body: string): WireEvent[] {
  const events: WireEvent[] = [];
  for (const raw of body.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && "type" in parsed) {
        events.push(parsed as WireEvent);
      }
    } catch {
      // ignore malformed line, exactly as the client does
    }
  }
  return events;
}

const PROGRESS_STAGES = ["loading", "fetching", "parsing", "validating", "storing"];

describe("POST /api/cms/held-back-articles/:id/reextract (streaming wire contract)", () => {
  it("returns 401 when unauthenticated (before streaming)", async () => {
    const res = await request(app).post(
      "/api/cms/held-back-articles/p-fail/reextract",
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for a role without review.approve", async () => {
    const res = await request(app)
      .post("/api/cms/held-back-articles/p-fail/reextract")
      .set("Authorization", bearer("viewer"));
    expect(res.status).toBe(403);
  });

  it("returns a JSON 404 (not a stream) for a published post", async () => {
    const res = await request(app)
      .post("/api/cms/held-back-articles/p-pub/reextract")
      .set("Authorization", bearer("reviewer"));
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  it("returns a JSON 404 (not a stream) for a draft non-post page", async () => {
    const res = await request(app)
      .post("/api/cms/held-back-articles/p-cat/reextract")
      .set("Authorization", bearer("reviewer"));
    expect(res.status).toBe(404);
  });

  it("PASS: streams NDJSON progress then a terminal result that flips the page to published", async () => {
    process.env.REEXTRACT_FIXTURE_MODE = "pass";

    const res = await request(app)
      .post("/api/cms/held-back-articles/p-fail/reextract")
      .set("Authorization", bearer("reviewer"));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-ndjson");

    const events = parseClientStream(res.text);

    // Five progress events (in order) followed by a single terminal result —
    // even though the fixture emitted all progress in ONE stderr chunk, the
    // bridge's newline buffering must have split them.
    expect(events.map((e) => e.type)).toEqual([
      ...PROGRESS_STAGES.map(() => "progress"),
      "result",
    ]);
    expect(events.slice(0, 5).map((e) => e.stage)).toEqual(PROGRESS_STAGES);

    const result = events.at(-1)!;
    expect(result).toMatchObject({
      type: "result",
      pageId: "p-fail",
      validationStatus: "pass",
      pageStatus: "published",
      heldBack: false,
    });

    // The route audits a successful re-extract, reading fields off the result
    // event it relayed (proves the wire fields the route depends on arrived).
    const audit = await waitFor(() =>
      tables.audit_logs.find((a) => a.action === "article.reextract"),
    );
    expect(audit).toMatchObject({
      entityId: "p-fail",
      after: { validationStatus: "pass", status: "published" },
    });
  });

  it("FAIL: streams progress then a terminal result that keeps the page held back", async () => {
    process.env.REEXTRACT_FIXTURE_MODE = "fail";

    const res = await request(app)
      .post("/api/cms/held-back-articles/p-fail/reextract")
      .set("Authorization", bearer("editor"));

    expect(res.status).toBe(200);
    const events = parseClientStream(res.text);

    expect(events.map((e) => e.type)).toEqual([
      ...PROGRESS_STAGES.map(() => "progress"),
      "result",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "result",
      validationStatus: "fail",
      pageStatus: "draft",
      heldBack: true,
    });

    const audit = await waitFor(() =>
      tables.audit_logs.find((a) => a.action === "article.reextract"),
    );
    expect(audit).toMatchObject({
      after: { validationStatus: "fail", status: "draft" },
    });
  });

  it("UNREACHABLE: a transient source failure surfaces as a well-formed error event", async () => {
    process.env.REEXTRACT_FIXTURE_MODE = "unreachable";

    const res = await request(app)
      .post("/api/cms/held-back-articles/p-fail/reextract")
      .set("Authorization", bearer("admin"));

    expect(res.status).toBe(200);
    const events = parseClientStream(res.text);

    // Progress still streamed, then a terminal error (no result) with the
    // {type,code,message} shape the client renders.
    expect(events.map((e) => e.type)).toEqual([
      ...PROGRESS_STAGES.map(() => "progress"),
      "error",
    ]);
    const error = events.at(-1)!;
    expect(error).toMatchObject({ type: "error", code: "unreachable" });
    expect(typeof error.message).toBe("string");
    expect((error.message as string).length).toBeGreaterThan(0);

    // No result → the route must NOT audit a re-extract for a failed run.
    await new Promise((r) => setTimeout(r, 50));
    expect(
      tables.audit_logs.some((a) => a.action === "article.reextract"),
    ).toBe(false);
  });

  it("ignores non-JSON noise on the worker streams (only typed events reach the client)", async () => {
    process.env.REEXTRACT_FIXTURE_MODE = "pass";

    const res = await request(app)
      .post("/api/cms/held-back-articles/p-fail/reextract")
      .set("Authorization", bearer("reviewer"));

    const events = parseClientStream(res.text);
    // The fixture writes a stray "this is not json" line on stderr; the bridge
    // must drop it (parseEvent yields null) so it never reaches the wire — every
    // relayed line is a well-formed typed event.
    expect(events.every((e) => typeof e.type === "string")).toBe(true);
    expect(res.text).not.toContain("this is not json");
    expect(events.map((e) => e.type)).toEqual([
      ...PROGRESS_STAGES.map(() => "progress"),
      "result",
    ]);
  });
});

/** Poll a synchronous getter until it returns a truthy value (or time out). */
async function waitFor<T>(get: () => T, timeoutMs = 1000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = get();
    if (v) return v;
    if (Date.now() - start > timeoutMs) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
}
