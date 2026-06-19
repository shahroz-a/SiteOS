import { describe, it, expect } from "vitest";
import {
  TRANSITIONS,
  canTransition,
  requiredPermissionForTransition,
  type PageStatusValue,
} from "../cms-publishing";

const ALL_STATUSES: PageStatusValue[] = [
  "draft",
  "review",
  "scheduled",
  "published",
  "archived",
];

describe("publish lifecycle state machine", () => {
  it("never lists a status as a transition target of itself (no-op moves excluded)", () => {
    for (const from of ALL_STATUSES) {
      expect(TRANSITIONS[from]).not.toContain(from);
    }
  });

  it("only references known statuses", () => {
    for (const from of ALL_STATUSES) {
      for (const to of TRANSITIONS[from]) {
        expect(ALL_STATUSES).toContain(to);
      }
    }
  });

  it("allows a draft to advance to review, scheduled, published or archived", () => {
    expect(canTransition("draft", "review")).toBe(true);
    expect(canTransition("draft", "scheduled")).toBe(true);
    expect(canTransition("draft", "published")).toBe(true);
    expect(canTransition("draft", "archived")).toBe(true);
  });

  it("allows published content to be pulled back to draft/review or archived", () => {
    expect(canTransition("published", "draft")).toBe(true);
    expect(canTransition("published", "review")).toBe(true);
    expect(canTransition("published", "archived")).toBe(true);
  });

  it("allows archived content to be revived to any active state", () => {
    expect(canTransition("archived", "draft")).toBe(true);
    expect(canTransition("archived", "review")).toBe(true);
    expect(canTransition("archived", "scheduled")).toBe(true);
    expect(canTransition("archived", "published")).toBe(true);
  });

  it("rejects same-status (no-op) moves", () => {
    for (const s of ALL_STATUSES) {
      expect(canTransition(s, s)).toBe(false);
    }
  });
});

describe("requiredPermissionForTransition", () => {
  it("requires content.publish to publish or schedule", () => {
    expect(requiredPermissionForTransition("draft", "published")).toBe(
      "content.publish",
    );
    expect(requiredPermissionForTransition("review", "published")).toBe(
      "content.publish",
    );
    expect(requiredPermissionForTransition("draft", "scheduled")).toBe(
      "content.publish",
    );
    expect(requiredPermissionForTransition("archived", "published")).toBe(
      "content.publish",
    );
  });

  it("requires content.publish to leave the published state (unpublish)", () => {
    expect(requiredPermissionForTransition("published", "draft")).toBe(
      "content.publish",
    );
    expect(requiredPermissionForTransition("published", "review")).toBe(
      "content.publish",
    );
    expect(requiredPermissionForTransition("published", "archived")).toBe(
      "content.publish",
    );
  });

  it("requires only content.edit for ordinary editorial moves", () => {
    expect(requiredPermissionForTransition("draft", "review")).toBe(
      "content.edit",
    );
    expect(requiredPermissionForTransition("review", "draft")).toBe(
      "content.edit",
    );
    expect(requiredPermissionForTransition("draft", "archived")).toBe(
      "content.edit",
    );
    expect(requiredPermissionForTransition("archived", "draft")).toBe(
      "content.edit",
    );
    expect(requiredPermissionForTransition("scheduled", "draft")).toBe(
      "content.edit",
    );
  });
});
