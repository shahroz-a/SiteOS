import { describe, it, expect } from "vitest";
import {
  checkPublishingReadiness,
  REQUIRED_PAGE_STATUS_VALUES,
  type SqlExecutor,
} from "../publishing-shapes";

const ALL_STATUS_VALUES = [...REQUIRED_PAGE_STATUS_VALUES];

/**
 * Build a fake executor that answers the two queries `checkPublishingReadiness`
 * issues in order: first the `pg_enum` lookup, then the
 * `information_schema.columns` lookup for `pages.scheduled_for`.
 */
function fakeExecutor(opts: {
  presentStatusValues: string[];
  scheduledForColumnPresent: boolean;
}): SqlExecutor {
  let call = 0;
  return {
    execute: async () => {
      call += 1;
      if (call === 1) {
        return {
          rows: opts.presentStatusValues.map((enumlabel) => ({ enumlabel })),
        };
      }
      return {
        rows: opts.scheduledForColumnPresent ? [{ "?column?": 1 }] : [],
      };
    },
  };
}

describe("checkPublishingReadiness", () => {
  it("reports ready when every enum value and the column exist", async () => {
    const result = await checkPublishingReadiness(
      fakeExecutor({
        presentStatusValues: ALL_STATUS_VALUES,
        scheduledForColumnPresent: true,
      }),
    );

    expect(result.ready).toBe(true);
    expect(result.missingStatusValues).toEqual([]);
    expect(result.presentStatusValues).toEqual(ALL_STATUS_VALUES);
    expect(result.scheduledForColumnPresent).toBe(true);
  });

  it("flags a missing scheduled_for column", async () => {
    const result = await checkPublishingReadiness(
      fakeExecutor({
        presentStatusValues: ALL_STATUS_VALUES,
        scheduledForColumnPresent: false,
      }),
    );

    expect(result.ready).toBe(false);
    expect(result.scheduledForColumnPresent).toBe(false);
    expect(result.missingStatusValues).toEqual([]);
  });

  it("lists missing enum values", async () => {
    const result = await checkPublishingReadiness(
      fakeExecutor({
        presentStatusValues: ["review"],
        scheduledForColumnPresent: true,
      }),
    );

    expect(result.ready).toBe(false);
    expect(result.presentStatusValues).toEqual(["review"]);
    expect(result.missingStatusValues).toEqual(["scheduled"]);
  });

  it("treats a freshly-wiped DB (no enum values, no column) as not ready", async () => {
    const result = await checkPublishingReadiness(
      fakeExecutor({
        presentStatusValues: [],
        scheduledForColumnPresent: false,
      }),
    );

    expect(result.ready).toBe(false);
    expect(result.scheduledForColumnPresent).toBe(false);
    expect(result.missingStatusValues).toEqual(ALL_STATUS_VALUES);
  });

  it("requires the review and scheduled enum values", () => {
    expect(REQUIRED_PAGE_STATUS_VALUES).toEqual(["review", "scheduled"]);
  });
});
