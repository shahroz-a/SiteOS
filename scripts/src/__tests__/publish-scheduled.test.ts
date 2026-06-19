import { describe, expect, it } from "vitest";
import { parseArgs } from "../publish-scheduled";

describe("publish-scheduled parseArgs", () => {
  it("defaults to apply mode", () => {
    expect(parseArgs([])).toEqual({ dryRun: false });
  });

  it("recognizes --dry-run", () => {
    expect(parseArgs(["--dry-run"])).toEqual({ dryRun: true });
  });

  it("ignores unknown flags", () => {
    expect(parseArgs(["--nope", "--whatever"])).toEqual({ dryRun: false });
  });
});
