import { describe, it, expect } from "vitest";
import {
  isSelfHostedStoragePath,
  isExternalCdnUrl,
  isMigratedImage,
  resolveImageServingUrl,
  assertNoRehostedMigratedImage,
} from "../image-source";

const CDN = "https://cdn-img.headout.com/media/images/abc/photo.jpg";

describe("isSelfHostedStoragePath", () => {
  it("detects the object-storage serving route and raw object paths", () => {
    expect(isSelfHostedStoragePath("/api/storage/objects/uploads/x.png")).toBe(true);
    expect(isSelfHostedStoragePath("/storage/objects/x.png")).toBe(true);
    expect(isSelfHostedStoragePath("/objects/uploads/x.png")).toBe(true);
    expect(
      isSelfHostedStoragePath("https://example.com/api/storage/objects/x.png"),
    ).toBe(true);
  });

  it("does not flag external CDN URLs or empty values", () => {
    expect(isSelfHostedStoragePath(CDN)).toBe(false);
    expect(isSelfHostedStoragePath("https://cdn-img.headout.com/x.jpg")).toBe(false);
    expect(isSelfHostedStoragePath(null)).toBe(false);
    expect(isSelfHostedStoragePath(undefined)).toBe(false);
    expect(isSelfHostedStoragePath("")).toBe(false);
  });
});

describe("isExternalCdnUrl / isMigratedImage", () => {
  it("treats absolute http(s) non-storage URLs as external CDN", () => {
    expect(isExternalCdnUrl(CDN)).toBe(true);
    expect(isExternalCdnUrl("http://cdn-img.headout.com/x.jpg")).toBe(true);
  });

  it("rejects storage paths and relative/empty values", () => {
    expect(isExternalCdnUrl("/api/storage/objects/x.png")).toBe(false);
    expect(isExternalCdnUrl("/blog/foo.jpg")).toBe(false);
    expect(isExternalCdnUrl(null)).toBe(false);
  });

  it("identifies a migrated image by its external CDN originalUrl", () => {
    expect(isMigratedImage({ originalUrl: CDN })).toBe(true);
    expect(isMigratedImage({ originalUrl: "/api/storage/objects/x.png" })).toBe(false);
    expect(isMigratedImage({ originalUrl: null })).toBe(false);
  });
});

describe("resolveImageServingUrl", () => {
  it("serves a migrated image straight from the original CDN URL", () => {
    expect(resolveImageServingUrl({ url: CDN, originalUrl: CDN })).toBe(CDN);
  });

  it("neutralizes a migrated image whose url was rewritten to a self-hosted path", () => {
    const url = resolveImageServingUrl({
      url: "/api/storage/objects/uploads/copy.jpg",
      originalUrl: CDN,
    });
    expect(url).toBe(CDN);
  });

  it("serves a genuine editor-uploaded image from its self-hosted path", () => {
    const upload = {
      url: "/api/storage/objects/uploads/new.png",
      originalUrl: "/api/storage/objects/uploads/new.png",
    };
    expect(resolveImageServingUrl(upload)).toBe(upload.url);
  });

  it("serves an editor-uploaded image with no originalUrl from its url", () => {
    const upload = { url: "/api/storage/objects/uploads/new.png", originalUrl: null };
    expect(resolveImageServingUrl(upload)).toBe(upload.url);
  });
});

describe("assertNoRehostedMigratedImage", () => {
  it("passes for a migrated image served from the CDN", () => {
    expect(() =>
      assertNoRehostedMigratedImage({ url: CDN, originalUrl: CDN }),
    ).not.toThrow();
  });

  it("passes for a genuine editor upload", () => {
    expect(() =>
      assertNoRehostedMigratedImage({
        url: "/api/storage/objects/uploads/new.png",
        originalUrl: null,
      }),
    ).not.toThrow();
  });

  it("FAILS when a migrated image src is rewritten to a self-hosted path", () => {
    expect(() =>
      assertNoRehostedMigratedImage({
        url: "/api/storage/objects/uploads/rehosted.jpg",
        originalUrl: CDN,
      }),
    ).toThrow(/Migrated image must keep its original CDN URL/);
  });
});
