import { describe, expect, it } from "vitest";
import { parseArgs } from "../rollup-page-views";

describe("rollup-page-views parseArgs", () => {
  it("defaults to apply mode rolling up every completed day", () => {
    expect(parseArgs([])).toEqual({ dryRun: false, retentionDays: 0 });
  });

  it("recognizes --dry-run", () => {
    expect(parseArgs(["--dry-run"])).toEqual({ dryRun: true, retentionDays: 0 });
  });

  it("parses a positive --retention-days window", () => {
    expect(parseArgs(["--retention-days=7"])).toEqual({
      dryRun: false,
      retentionDays: 7,
    });
  });

  it("floors fractional retention and clamps negatives/garbage to 0", () => {
    expect(parseArgs(["--retention-days=3.9"]).retentionDays).toBe(3);
    expect(parseArgs(["--retention-days=-5"]).retentionDays).toBe(0);
    expect(parseArgs(["--retention-days=nope"]).retentionDays).toBe(0);
  });

  it("combines flags", () => {
    expect(parseArgs(["--dry-run", "--retention-days=2"])).toEqual({
      dryRun: true,
      retentionDays: 2,
    });
  });
});
