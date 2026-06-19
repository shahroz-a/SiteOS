import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: { completions: { create: (...args: unknown[]) => createMock(...args) } },
  },
}));

import { altIssueMessages, suggestAltTextBatch } from "../media";

/** Build a chat-completion response whose content is `text`. */
function completion(text: string) {
  return { choices: [{ message: { content: text } }] };
}

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

describe("suggestAltTextBatch", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("returns one suggestion per url, in input order", async () => {
    createMock.mockImplementation(
      (args: { messages: Array<{ content: unknown }> }) => {
        // Echo back the image URL so we can assert order independent of timing.
        const content = args.messages[1]?.content as Array<{
          image_url?: { url: string };
        }>;
        const url = content.find((c) => c.image_url)?.image_url?.url ?? "";
        return Promise.resolve(completion(`description for ${url}`));
      },
    );

    const urls = ["https://cdn/a.jpg", "https://cdn/b.jpg", "https://cdn/c.jpg"];
    const results = await suggestAltTextBatch(urls);

    expect(results.map((r) => r.url)).toEqual(urls);
    expect(results.map((r) => r.suggestion)).toEqual([
      "description for https://cdn/a.jpg",
      "description for https://cdn/b.jpg",
      "description for https://cdn/c.jpg",
    ]);
    expect(results.every((r) => r.error === null)).toBe(true);
  });

  it("isolates a per-image failure without aborting the batch", async () => {
    createMock.mockImplementation(
      (args: { messages: Array<{ content: unknown }> }) => {
        const content = args.messages[1]?.content as Array<{
          image_url?: { url: string };
        }>;
        const url = content.find((c) => c.image_url)?.image_url?.url ?? "";
        if (url.includes("bad")) {
          return Promise.reject(new Error("vision model exploded"));
        }
        return Promise.resolve(completion("a fine description"));
      },
    );

    const results = await suggestAltTextBatch([
      "https://cdn/ok.jpg",
      "https://cdn/bad.jpg",
    ]);

    expect(results[0]).toEqual({
      url: "https://cdn/ok.jpg",
      suggestion: "a fine description",
      error: null,
    });
    expect(results[1].suggestion).toBeNull();
    expect(results[1].error).toMatch(/exploded/);
  });

  it("records an error when the model returns an empty description", async () => {
    createMock.mockResolvedValue(completion("   "));
    const results = await suggestAltTextBatch(["https://cdn/empty.jpg"]);
    expect(results[0].suggestion).toBeNull();
    expect(results[0].error).toMatch(/empty/i);
  });

  it("returns an empty array for no urls without calling the model", async () => {
    const results = await suggestAltTextBatch([]);
    expect(results).toEqual([]);
    expect(createMock).not.toHaveBeenCalled();
  });
});
