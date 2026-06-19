import { describe, expect, it, vi } from "vitest";
import type { SeoValidationResult } from "@workspace/seo-validation";
import { parseArgs, run, type Options } from "../generate-seo-reports";
import type { ValidationOutcome } from "../seo-validation";

describe("generate-seo-reports parseArgs", () => {
  it("defaults to published, apply mode, no limit", () => {
    expect(parseArgs([])).toEqual({ dryRun: false, status: "published", limit: 0, offset: 0 });
  });

  it("parses --dry-run, --status, --limit", () => {
    expect(parseArgs(["--dry-run", "--status=draft", "--limit=50", "--offset=10"])).toEqual({
      dryRun: true,
      status: "draft",
      limit: 50,
      offset: 10,
    });
  });

  it("clamps a non-positive or non-numeric limit to 0", () => {
    expect(parseArgs(["--limit=-3"]).limit).toBe(0);
    expect(parseArgs(["--limit=abc"]).limit).toBe(0);
  });

  it("falls back to published when --status is empty", () => {
    expect(parseArgs(["--status="]).status).toBe("published");
  });
});

function outcome(status: SeoValidationResult["status"]): ValidationOutcome {
  return {
    detail: {} as ValidationOutcome["detail"],
    duplicates: {},
    result: {
      status,
      score: status === "pass" ? 100 : 50,
      checks: [],
      blocking: [],
      passedCount: 0,
      totalCount: 0,
    },
  };
}

const applyOpts: Options = { dryRun: false, status: "published", limit: 0, offset: 0 };

describe("generate-seo-reports run", () => {
  it("stores a report per resolvable page and tallies by status", async () => {
    const runValidation = vi
      .fn()
      .mockResolvedValueOnce(outcome("pass"))
      .mockResolvedValueOnce(outcome("warn"))
      .mockResolvedValueOnce(outcome("fail"));
    const storeReport = vi.fn().mockResolvedValue(undefined);

    const result = await run(applyOpts, ["a", "b", "c"], { runValidation, storeReport }, () => {});

    expect(storeReport).toHaveBeenCalledTimes(3);
    expect(result.written).toBe(3);
    expect(result.missing).toBe(0);
    expect(result.byStatus).toEqual({ pass: 1, warn: 1, fail: 1 });
  });

  it("counts pages that no longer resolve as missing and does not store them", async () => {
    const runValidation = vi
      .fn()
      .mockResolvedValueOnce(outcome("pass"))
      .mockResolvedValueOnce(null);
    const storeReport = vi.fn().mockResolvedValue(undefined);

    const result = await run(applyOpts, ["a", "gone"], { runValidation, storeReport }, () => {});

    expect(storeReport).toHaveBeenCalledTimes(1);
    expect(result.written).toBe(1);
    expect(result.missing).toBe(1);
    expect(result.byStatus).toEqual({ pass: 1, warn: 0, fail: 0 });
  });

  it("writes nothing in dry-run but still tallies", async () => {
    const runValidation = vi
      .fn()
      .mockResolvedValueOnce(outcome("fail"))
      .mockResolvedValueOnce(outcome("pass"));
    const storeReport = vi.fn().mockResolvedValue(undefined);

    const result = await run(
      { ...applyOpts, dryRun: true },
      ["a", "b"],
      { runValidation, storeReport },
      () => {},
    );

    expect(storeReport).not.toHaveBeenCalled();
    expect(result.written).toBe(0);
    expect(result.byStatus).toEqual({ pass: 1, warn: 0, fail: 1 });
    expect(result.dryRun).toBe(true);
  });
});
