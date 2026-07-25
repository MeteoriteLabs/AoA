import mammoth from "mammoth";
import DOMPurify from "isomorphic-dompurify";

/** OOXML Word document MIME. The only type the DOCX render path converts. */
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/**
 * Convert a DOCX buffer to sanitized, embeddable HTML (`<article
 * class="docx-rendered">…</article>`). This is the SINGLE source of the DOCX
 * render+sanitize used by BOTH server render routes — the generic
 * `/assets/:id/render` and the memory-scoped `/memory/assets/:id/render`. Keep
 * it that way: the routes differ only in asset lookup + authorization; the
 * convert+sanitize+wrap must not be duplicated, or the two surfaces can silently
 * drift in security posture.
 *
 * SECURITY — read this before touching the DOMPurify config:
 *
 * The safety of this output comes from DOMPurify's DEFAULT allow-list, NOT from
 * the FORBID_* lists below. DOMPurify v3 is allow-list-by-default: when no
 * `ALLOWED_TAGS`/`ALLOWED_ATTR` are passed, only a known-safe set of tags and
 * attributes survives and everything else is dropped — scripts, ALL event
 * handlers (not just the five named below), `javascript:` URLs, `<base>`,
 * `<meta>`, `<svg onload>`, unknown/custom elements, and so on. The
 * `FORBID_TAGS`/`FORBID_ATTR` lists only SUBTRACT from that default; they are
 * cosmetic defense-in-depth, NOT the security boundary — removing them would not
 * meaningfully change what gets through.
 *
 * Therefore:
 *  - Do NOT add `ADD_TAGS` / `ADD_ATTR` here. That REOPENS the allow-list and can
 *    let active content through. This is the one change that can turn a safe
 *    render into an XSS sink.
 *  - Do NOT treat "add one more entry to FORBID_*" as how you close a hole — the
 *    default allow-list already closes it; a new tag/attr is denied unless you
 *    explicitly allow it.
 *
 * The XSS suites (`docx-render.test.ts`, plus the route-level
 * `asset-render-xss` / `memory-asset-render-xss`) pin this by feeding payloads
 * that are NOT in the FORBID_* lists and asserting they are still neutralized.
 */
export async function renderDocxBufferToSafeHtml(buffer: Buffer): Promise<string> {
  const result = await mammoth.convertToHtml({ buffer });
  const sanitized = DOMPurify.sanitize(result.value, {
    ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel|#)/i,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus"],
  });
  return `<article class="docx-rendered">${sanitized}</article>`;
}
