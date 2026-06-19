import { describe, it, expect } from "vitest";
import { altIssueMessages } from "../media";

describe("altIssueMessages", () => {
  it("returns no issues for descriptive alt text", () => {
    expect(altIssueMessages("ok", "A red double-decker bus on Tower Bridge")).toEqual(
      [],
    );
  });

  it("flags missing alt text", () => {
    const issues = altIssueMessages("missing", null);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/missing/i);
  });

  it("flags too-short alt as poor", () => {
    const issues = altIssueMessages("poor", "bus");
    expect(issues.some((m) => /too short/i.test(m))).toBe(true);
  });

  it("flags generic placeholder words as poor", () => {
    const issues = altIssueMessages("poor", "image");
    expect(issues.some((m) => /generic placeholder/i.test(m))).toBe(true);
  });

  it("flags filename-like alt as poor", () => {
    const issues = altIssueMessages("poor", "DSC_00012.jpg");
    expect(issues.some((m) => /filename/i.test(m))).toBe(true);
  });

  it("always returns at least one message for a poor status", () => {
    // A value that is long and non-generic but still classified poor upstream
    // should still surface a fallback warning.
    const issues = altIssueMessages("poor", "a perfectly fine description");
    expect(issues.length).toBeGreaterThan(0);
  });
});
