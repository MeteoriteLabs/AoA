// -----------------------------------------------------------------------------
// DAT-009-3e / E5-F002 — the default uploader's signed-PUT headers come from ONE home.
//
// `grantPutHeaders` (worker-daemon `lease/artifact-export.ts`) exists, by its own docstring,
// "because two providers re-deriving it independently is how the second one gets it wrong
// silently". Before this slice it had zero production callers, and the shipped default uploader
// `putGrantBytes` re-derived the headers differently on two axes (E5-F002):
//   1. it OMITTED `x-amz-sdk-checksum-algorithm`, which every other derivation sends; and
//   2. it sent the checksum of the BYTES BEING UPLOADED, not of the grant's `expectedSha256`.
//
// ★ THE DIGEST-SOURCE DECISION, pinned here: the checksum header is the GRANT's expectedSha256.
// The signer binds the checksum ALGORITHM, never the value, so the store verifies the body against
// whatever this header says. Carrying the grant's expectation makes the STORE refuse bytes that
// are not the ones the grant was minted for — at the PUT, at the cause — instead of storing them
// and leaving the fenced commit's `headObject` re-verification to refuse `hash_mismatch` later, in
// another process. On the provider's own path the two are equal (`exportArtifact` re-hashes and
// refuses a mismatch before calling the uploader), so the decision is visible only when the
// uploader is handed bytes that disagree with the grant, which is exactly the case pinned below.
// -----------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { ArtifactUploadGrantV1 } from "@armyofagents/worker-protocol";
import { grantPutHeaders } from "@armyofagents/worker-daemon";

import { putGrantBytes } from "../e2b-provider.js";

const enc = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const b64 = (b: Uint8Array) => createHash("sha256").update(b).digest("base64");

const GRANTED = enc("the bytes the grant was minted for ✓\n");
const OTHER = enc("different bytes");
const GRANT_URL = "https://store.example/put/out.txt?X-Amz-Signature=deadbeefsecret";

function grant(overrides: Partial<ArtifactUploadGrantV1> = {}): ArtifactUploadGrantV1 {
  return {
    protocolVersion: 1,
    operation: "upload",
    artifactId: "00000000-0000-4000-8000-0000000000b1",
    method: "PUT",
    url: GRANT_URL,
    headers: {},
    issuedAt: "2026-09-21T12:00:00.000Z",
    expiresAt: "2126-09-21T12:05:00.000Z",
    maxBytes: GRANTED.byteLength,
    expectedSha256: hex(GRANTED),
    objectKey: "organizations/org-1/jobs/job-1/attempts/1/00000000-0000-4000-8000-0000000000b1",
    redaction: "secret",
    ...overrides,
  } as ArtifactUploadGrantV1;
}

interface Seen {
  url: string;
  init: RequestInit;
}
function stubFetch(respond: () => Promise<Response> | Response = () => ({ ok: true, status: 200 }) as Response): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: unknown) => {
      seen.push({ url: String(url), init: (init ?? {}) as RequestInit });
      return respond();
    }),
  );
  return seen;
}
const headersOf = (s: Seen) => s.init.headers as Record<string, string>;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DAT-009-3e / E5-F002 — putGrantBytes derives its signed-PUT headers from grantPutHeaders", () => {
  it("★ sends BOTH header names — the checksum AND the algorithm the signed query demands", async () => {
    const seen = stubFetch();
    await putGrantBytes(grant(), GRANTED);
    expect(seen).toHaveLength(1);
    const h = headersOf(seen[0]!);
    expect(h["x-amz-checksum-sha256"]).toBe(b64(GRANTED));
    expect(h["x-amz-sdk-checksum-algorithm"]).toBe("SHA256");
    expect(seen[0]!.init.method).toBe("PUT");
    expect(seen[0]!.url).toBe(GRANT_URL);
  });

  it("★ the checksum is BASE64 of the raw digest — a hex-forwarding mutant dies here", async () => {
    const seen = stubFetch();
    await putGrantBytes(grant(), GRANTED);
    const value = headersOf(seen[0]!)["x-amz-checksum-sha256"];
    expect(value).not.toBe(hex(GRANTED));
    expect(Buffer.from(value!, "base64").toString("hex")).toBe(hex(GRANTED));
  });

  it("★ DIGEST SOURCE = the GRANT's expectedSha256, NOT the bytes handed to the uploader", async () => {
    // The opposite decision (hash what is being uploaded) would put b64(OTHER) here, and the store
    // would accept bytes the grant was never minted for.
    const seen = stubFetch();
    await putGrantBytes(grant(), OTHER);
    const value = headersOf(seen[0]!)["x-amz-checksum-sha256"];
    expect(value).toBe(b64(GRANTED));
    expect(value).not.toBe(b64(OTHER));
  });

  it("★ ONE HOME: every header grantPutHeaders derives is sent, verbatim", async () => {
    const g = grant({ headers: { "x-amz-meta-origin": "aoa" } });
    const seen = stubFetch();
    await putGrantBytes(g, GRANTED);
    expect(headersOf(seen[0]!)).toMatchObject(grantPutHeaders(g));
  });

  it("keeps its content-type default, and the GRANT's own headers still win over everything", async () => {
    const seen = stubFetch();
    await putGrantBytes(grant(), GRANTED);
    expect(headersOf(seen[0]!)["content-type"]).toBe("application/octet-stream");

    const seen2 = stubFetch();
    await putGrantBytes(grant({ headers: { "content-type": "text/plain", "x-amz-checksum-sha256": "server-said-so" } }), GRANTED);
    expect(headersOf(seen2[0]!)["content-type"]).toBe("text/plain");
    expect(headersOf(seen2[0]!)["x-amz-checksum-sha256"]).toBe("server-said-so");
  });

  it("sends the bytes it was given as the body (the header describes the expectation, not the body)", async () => {
    const seen = stubFetch();
    await putGrantBytes(grant(), GRANTED);
    expect(new Uint8Array(seen[0]!.init.body as Uint8Array)).toEqual(GRANTED);
  });

  it("★ H-04: a non-2xx store response throws with the STATUS only — never the url", async () => {
    stubFetch(() => ({ ok: false, status: 400 }) as Response);
    const err = (await putGrantBytes(grant(), GRANTED).catch((e: unknown) => e)) as Error;
    expect(err.message).toContain("400");
    expect(`${err.message}\n${err.stack ?? ""}`).not.toContain("deadbeefsecret");
    expect(`${err.message}\n${err.stack ?? ""}`).not.toContain("store.example");
  });

  it("★ a SEVERED PUT is a distinguishable failure that carries neither the url nor the transport's own error", async () => {
    // A transport error can name the host and query it was reaching; it must not ride out.
    stubFetch(() => {
      throw new TypeError(`fetch failed: socket closed while writing ${GRANT_URL}`);
    });
    const err = (await putGrantBytes(grant(), GRANTED).catch((e: unknown) => e)) as Error & { cause?: unknown };
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/severed|did not complete/);
    // Distinguishable from a store refusal, which reports a status.
    expect(err.message).not.toMatch(/status \d+/);
    expect(`${err.message}\n${err.stack ?? ""}\n${String(err.cause ?? "")}`).not.toContain("deadbeefsecret");
    expect(err.cause).toBeUndefined();
  });
});
