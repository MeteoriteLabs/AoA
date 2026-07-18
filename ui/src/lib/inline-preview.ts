// Shared inline-preview eligibility for attachment cards. Pure fns, no React.
export function normalizeMime(contentType: string | null): string | null {
  if (!contentType) return null;
  const base = contentType.split(";")[0]!.trim().toLowerCase();
  return base || null;
}
export const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const INLINE_TEXT_MAX_BYTES = 256 * 1024;

/** Raster image safe to render inline as <img> (matches server inline allowlist). */
export function isInlineImage(contentType: string | null): boolean {
  const ct = normalizeMime(contentType);
  return ct != null && INLINE_IMAGE_TYPES.has(ct);
}

/** Small/previewable via SharedContentViewer (Discussions, not under not-prose). */
export function isInlinePreviewable(contentType: string | null, byteSize: number | null): boolean {
  const ct = normalizeMime(contentType);
  if (!ct) return false;
  if (INLINE_IMAGE_TYPES.has(ct)) return true;
  const isText = (ct.startsWith("text/") && ct !== "text/html") || ct === "application/json";
  if (isText) return byteSize != null && byteSize <= INLINE_TEXT_MAX_BYTES;
  return false;
}
