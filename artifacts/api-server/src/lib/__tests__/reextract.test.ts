import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the production-safe spawn resolver used by the re-extract
 * bridge (`resolveReextractSpawn`). The resolver decides HOW to launch the
 * background re-extract worker without ever importing the leaf `@workspace/scripts`
 * package: env override first, then the prebuilt esbuild bundle run with `node`,
 * then a DEV-ONLY `tsx`-on-source fallback. In production a missing bundle (and
 * no override) is a deploy misconfiguration and must throw a clear error rather
 * than silently depending on `tsx`/pnpm at runtime.
 *
 * We stub `node:fs`'s `existsSync` so the test controls whether the bundle is
 * "present" without touching the real filesystem or running a build.
 */
const h = vi.hoisted(() => ({ existsSync: vi.fn() }));
vi.mock("node:fs", () => ({ existsSync: (p: string) => h.existsSync(p) }));

import { resolveReextractSpawn } from "../reextract";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  h.existsSync.mockReset();
  delete process.env.REEXTRACT_ENTRY;
  delete process.env.REEXTRACT_COMMAND;
  delete process.env.NODE_ENV;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("resolveReextractSpawn", () => {
  it("honors REEXTRACT_ENTRY override (default command node) above everything", () => {
    h.existsSync.mockReturnValue(true); // bundle present, but override wins
    process.env.NODE_ENV = "production";
    process.env.REEXTRACT_ENTRY = "/custom/worker.mjs";
    expect(resolveReextractSpawn()).toEqual({
      command: "node",
      entry: "/custom/worker.mjs",
    });
  });

  it("honors REEXTRACT_COMMAND together with the entry override", () => {
    process.env.REEXTRACT_ENTRY = "/custom/worker.ts";
    process.env.REEXTRACT_COMMAND = "bun";
    expect(resolveReextractSpawn()).toEqual({
      command: "bun",
      entry: "/custom/worker.ts",
    });
  });

  it("prefers the prebuilt bundle (run with node) when it exists", () => {
    h.existsSync.mockReturnValue(true);
    const { command, entry } = resolveReextractSpawn();
    expect(command).toBe("node");
    expect(entry).toMatch(/scripts[/\\]dist[/\\]reextract\.mjs$/);
  });

  it("falls back to tsx-on-source in dev when the bundle is absent", () => {
    h.existsSync.mockReturnValue(false);
    process.env.NODE_ENV = "development";
    const { command, entry } = resolveReextractSpawn();
    expect(command).toMatch(/node_modules[/\\]\.bin[/\\]tsx$/);
    expect(entry).toMatch(/scripts[/\\]src[/\\]reextract\.ts$/);
  });

  it("throws in production when neither bundle nor override is available", () => {
    h.existsSync.mockReturnValue(false);
    process.env.NODE_ENV = "production";
    expect(() => resolveReextractSpawn()).toThrow(/build:jobs|REEXTRACT_ENTRY/);
  });
});
