import { describe, it, expect } from "vitest";
import { isInlinePreviewable, isInlineImage } from "./inline-preview.js";

describe("isInlinePreviewable", () => {
  it("raster images + small text inline; svg(+params)/pdf/zip/unknown-size-text not", () => {
    expect(isInlinePreviewable("image/png", 9e9)).toBe(true);
    expect(isInlinePreviewable("IMAGE/PNG", 10)).toBe(true);
    expect(isInlinePreviewable("image/svg+xml; charset=utf-8", 10)).toBe(false);
    expect(isInlinePreviewable("text/markdown", 1000)).toBe(true);
    expect(isInlinePreviewable("text/plain", 300 * 1024)).toBe(false);
    expect(isInlinePreviewable("text/plain", null)).toBe(false);
    expect(isInlinePreviewable("application/pdf", 10)).toBe(false);
    expect(isInlinePreviewable("application/zip", 10)).toBe(false);
    expect(isInlinePreviewable("text/html", 1000)).toBe(false);
    expect(isInlinePreviewable("text/html; charset=utf-8", 1000)).toBe(false);
  });
});

describe("isInlineImage", () => {
  it("matches the raster inline allowlist only", () => {
    expect(isInlineImage("image/png")).toBe(true);
    expect(isInlineImage("image/svg+xml")).toBe(false);
    expect(isInlineImage("text/plain")).toBe(false);
  });
});
