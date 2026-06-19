import { describe, it, expect } from "vitest";
import { resolveConnectionString, needsSupabaseSsl } from "../connection";

const HELIUM = "postgresql://u:p@helium.internal:5432/db";
const SUPABASE =
  "postgresql://u:p@aws-0-region.pooler.supabase.com:5432/postgres";

describe("resolveConnectionString", () => {
  it("uses DATABASE_URL by default", () => {
    expect(resolveConnectionString({ DATABASE_URL: HELIUM })).toBe(HELIUM);
  });

  it("ignores SUPABASE_DATABASE_URL when USE_SUPABASE is not set", () => {
    expect(
      resolveConnectionString({
        DATABASE_URL: HELIUM,
        SUPABASE_DATABASE_URL: SUPABASE,
      }),
    ).toBe(HELIUM);
  });

  it("ignores non-truthy USE_SUPABASE values like 'false'", () => {
    expect(
      resolveConnectionString({
        DATABASE_URL: HELIUM,
        SUPABASE_DATABASE_URL: SUPABASE,
        USE_SUPABASE: "false",
      }),
    ).toBe(HELIUM);
  });

  it("does NOT fall back to a stale SUPABASE_DATABASE_URL when DATABASE_URL is missing", () => {
    expect(() =>
      resolveConnectionString({ SUPABASE_DATABASE_URL: SUPABASE }),
    ).toThrow(/DATABASE_URL must be set/);
  });

  it("uses SUPABASE_DATABASE_URL only when explicitly opted in", () => {
    expect(
      resolveConnectionString({
        DATABASE_URL: HELIUM,
        SUPABASE_DATABASE_URL: SUPABASE,
        USE_SUPABASE: "true",
      }),
    ).toBe(SUPABASE);
  });

  it("accepts USE_SUPABASE=1 and is case-insensitive", () => {
    expect(
      resolveConnectionString({
        SUPABASE_DATABASE_URL: SUPABASE,
        USE_SUPABASE: "1",
      }),
    ).toBe(SUPABASE);
    expect(
      resolveConnectionString({
        SUPABASE_DATABASE_URL: SUPABASE,
        USE_SUPABASE: "TRUE",
      }),
    ).toBe(SUPABASE);
  });

  it("throws when opted in but SUPABASE_DATABASE_URL is empty/whitespace", () => {
    expect(() =>
      resolveConnectionString({
        DATABASE_URL: HELIUM,
        SUPABASE_DATABASE_URL: "   ",
        USE_SUPABASE: "true",
      }),
    ).toThrow(/USE_SUPABASE is set but SUPABASE_DATABASE_URL is empty/);
  });

  it("treats a whitespace-only DATABASE_URL as unset", () => {
    expect(() => resolveConnectionString({ DATABASE_URL: "   " })).toThrow(
      /DATABASE_URL must be set/,
    );
  });
});

describe("needsSupabaseSsl", () => {
  it("detects supabase.com (pooler) hosts", () => {
    expect(needsSupabaseSsl(SUPABASE)).toBe(true);
  });

  it("detects supabase.co (direct) hosts", () => {
    expect(
      needsSupabaseSsl("postgresql://u:p@db.abc.supabase.co:5432/postgres"),
    ).toBe(true);
  });

  it("returns false for the Replit-managed host", () => {
    expect(needsSupabaseSsl(HELIUM)).toBe(false);
  });
});
