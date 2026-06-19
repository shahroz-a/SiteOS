import { describe, it, expect } from "vitest";
import { sniffImageType, MAX_IMAGE_BYTES } from "../objectStorage";

/** Build a buffer from a leading byte sequence padded out to `length`. */
function withHeader(bytes: Array<number>, length = 64): Buffer {
  const buf = Buffer.alloc(length, 0x20);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes[i];
  return buf;
}

describe("sniffImageType", () => {
  it("detects JPEG", () => {
    expect(sniffImageType(withHeader([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
  });

  it("detects PNG", () => {
    expect(
      sniffImageType(withHeader([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe("image/png");
  });

  it("detects GIF87a and GIF89a", () => {
    expect(sniffImageType(Buffer.from("GIF87a", "ascii"))).toBe("image/gif");
    expect(sniffImageType(Buffer.from("GIF89a", "ascii"))).toBe("image/gif");
  });

  it("detects WebP (RIFF....WEBP)", () => {
    const buf = Buffer.alloc(16, 0);
    buf.write("RIFF", 0, "ascii");
    buf.write("WEBP", 8, "ascii");
    expect(sniffImageType(buf)).toBe("image/webp");
  });

  it("detects AVIF (ftyp avif brand)", () => {
    const buf = Buffer.alloc(16, 0);
    buf.write("ftyp", 4, "ascii");
    buf.write("avif", 8, "ascii");
    expect(sniffImageType(buf)).toBe("image/avif");
  });

  it("detects BMP", () => {
    expect(sniffImageType(withHeader([0x42, 0x4d]))).toBe("image/bmp");
  });

  it("detects little- and big-endian TIFF", () => {
    expect(sniffImageType(withHeader([0x49, 0x49, 0x2a, 0x00]))).toBe("image/tiff");
    expect(sniffImageType(withHeader([0x4d, 0x4d, 0x00, 0x2a]))).toBe("image/tiff");
  });

  it("detects ICO", () => {
    expect(sniffImageType(withHeader([0x00, 0x00, 0x01, 0x00]))).toBe("image/x-icon");
  });

  it("rejects SVG (XML, not a raster image)", () => {
    expect(sniffImageType(Buffer.from('<?xml version="1.0"?><svg/>', "ascii"))).toBeNull();
    expect(sniffImageType(Buffer.from('<svg xmlns="...">', "ascii"))).toBeNull();
  });

  it("rejects HTML / arbitrary text masquerading as an image", () => {
    expect(sniffImageType(Buffer.from("<!doctype html><html></html>", "ascii"))).toBeNull();
    expect(sniffImageType(Buffer.from("just some text", "ascii"))).toBeNull();
  });

  it("rejects an empty buffer", () => {
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });

  it("does not misfire on a truncated magic prefix", () => {
    // PNG signature truncated to the first two bytes should not match.
    expect(sniffImageType(Buffer.from([0x89, 0x50]))).toBeNull();
  });

  it("exposes a 10 MB size cap", () => {
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
  });
});
