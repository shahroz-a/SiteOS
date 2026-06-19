import { describe, expect, it } from "vitest";
import {
  DEAD_HTTP_STATUSES,
  OFF_BLOG_DEAD_THRESHOLD,
  decideHealth,
  normalizeTargetPath,
  readingVerdict,
  targetKind,
} from "../redirect-target-health";

describe("targetKind", () => {
  it("treats /blog/... targets as on-blog and everything else as off-blog", () => {
    expect(targetKind("/blog/new-name/")).toBe("on-blog");
    expect(targetKind("/london-theatre-tickets/six-e-9858/")).toBe("off-blog");
    expect(targetKind("/blog/category/things-to-do")).toBe("on-blog");
  });
});

describe("normalizeTargetPath", () => {
  it("is trailing-slash insensitive", () => {
    expect(normalizeTargetPath("/blog/x/")).toBe("/blog/x");
    expect(normalizeTargetPath("/blog/x")).toBe("/blog/x");
  });

  it("strips query strings and fragments", () => {
    expect(normalizeTargetPath("/blog/x/?utm=1")).toBe("/blog/x");
    expect(normalizeTargetPath("/blog/x/#section")).toBe("/blog/x");
  });

  it("collapses the bare root to /", () => {
    expect(normalizeTargetPath("/blog/")).toBe("/blog");
    expect(normalizeTargetPath("/")).toBe("/");
    expect(normalizeTargetPath("")).toBe("/");
  });
});

describe("readingVerdict", () => {
  it("on-blog: exists => alive, missing => dead", () => {
    expect(readingVerdict({ kind: "on-blog", exists: true })).toBe("alive");
    expect(readingVerdict({ kind: "on-blog", exists: false })).toBe("dead");
  });

  it("off-blog: only 404/410 are dead", () => {
    for (const s of DEAD_HTTP_STATUSES) {
      expect(readingVerdict({ kind: "off-blog", status: s })).toBe("dead");
    }
    expect(readingVerdict({ kind: "off-blog", status: 200 })).toBe("alive");
    expect(readingVerdict({ kind: "off-blog", status: 301 })).toBe("alive");
  });

  it("off-blog: transient/server statuses are alive, not dead", () => {
    expect(readingVerdict({ kind: "off-blog", status: 403 })).toBe("alive");
    expect(readingVerdict({ kind: "off-blog", status: 429 })).toBe("alive");
    expect(readingVerdict({ kind: "off-blog", status: 500 })).toBe("alive");
    expect(readingVerdict({ kind: "off-blog", status: 503 })).toBe("alive");
  });

  it("off-blog: a failed probe (null status) is unknown, never dead", () => {
    expect(readingVerdict({ kind: "off-blog", status: null })).toBe("unknown");
  });
});

describe("decideHealth", () => {
  it("on-blog dead deactivates immediately (deterministic)", () => {
    expect(decideHealth("on-blog", "dead", 0)).toEqual({
      failures: 1,
      deactivate: true,
      reason: "on-blog-target-missing",
    });
  });

  it("on-blog alive keeps the redirect and resets the counter", () => {
    expect(decideHealth("on-blog", "alive", 3)).toEqual({
      failures: 0,
      deactivate: false,
      reason: null,
    });
  });

  it("off-blog requires repeated dead readings before acting", () => {
    // First confirmed-dead reading: counted, but not yet retired.
    const first = decideHealth("off-blog", "dead", 0);
    expect(first).toEqual({ failures: 1, deactivate: false, reason: null });
    // Second confirmed-dead reading reaches the threshold and deactivates.
    const second = decideHealth("off-blog", "dead", 1);
    expect(second).toEqual({
      failures: 2,
      deactivate: true,
      reason: "off-blog-target-dead",
    });
  });

  it("off-blog: a healthy reading resets a pending counter (flaky-reading guard)", () => {
    expect(decideHealth("off-blog", "alive", 1)).toEqual({
      failures: 0,
      deactivate: false,
      reason: null,
    });
  });

  it("off-blog: an unknown reading preserves the counter and takes no action", () => {
    expect(decideHealth("off-blog", "unknown", 1)).toEqual({
      failures: 1,
      deactivate: false,
      reason: null,
    });
  });

  it("honours a custom threshold", () => {
    // prevFailures 1 -> 2, still below a threshold of 3: no action yet.
    expect(decideHealth("off-blog", "dead", 1, 3)).toEqual({
      failures: 2,
      deactivate: false,
      reason: null,
    });
    // prevFailures 2 -> 3 reaches the custom threshold and deactivates.
    expect(decideHealth("off-blog", "dead", 2, 3)).toEqual({
      failures: 3,
      deactivate: true,
      reason: "off-blog-target-dead",
    });
    // Default threshold is the documented constant.
    expect(OFF_BLOG_DEAD_THRESHOLD).toBe(2);
  });
});
