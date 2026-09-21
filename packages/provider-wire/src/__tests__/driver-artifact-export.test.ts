// -----------------------------------------------------------------------------
// DAT-009-3e — NetworkedProviderDriver.digestArtifact / exportArtifact relay over the wire.
//
// Before this slice both methods threw `UnsupportedProviderOperation` UNCONDITIONALLY and never
// read `artifactExportMode` at all, so a containerized worker could not export, and a driver whose
// mode said "none" would have been indistinguishable from one that said anything else.
//
// What these cases pin (the network hop is an injected `fetch`, so every call is counted):
//   - the driver advertises `grant_upload` and RELAYS both ops as one POST each, carrying the
//     owned-labels capability (both are gated owned ops on the server);
//   - the mode property is READ: a driver whose mode is "none" refuses both, before any RPC;
//   - GRANT IN, REFERENCE OUT: the export body carries the grant, the result is `{objectKey}` only,
//     and a reference that is not the grant's own objectKey is refused, never fabricated;
//   - a malformed digest result is refused (a fabricated digest would mint a grant for bytes that
//     do not exist);
//   - one call is one RPC: no retry, no prefetch (the supervisor's export-window latch decides
//     whether a late result is USED; the driver must never issue a call on its own initiative);
//   - `grant.url` is never in a thrown message.
// -----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import type { ArtifactExportMode, ProviderOpContext } from "@armyofagents/worker-daemon";
import type { ArtifactUploadGrantV1 } from "@armyofagents/worker-protocol";
import { UnsupportedProviderOperation } from "@armyofagents/sandbox-e2b-provider/errors.js";

import { NetworkedProviderDriver } from "../driver.js";
import { WireProtocolError, encodeErrResponse, encodeOkResponse } from "../codec.js";
import type { OwnedLabelsCapability } from "../capability.js";

const CTX: ProviderOpContext = { deadlineMs: 30_000, idempotencyKey: "idem-export-1" };
const SANDBOX = "sbx-000001";
const PATH = "/home/user/out.txt";
const SHA = "a".repeat(64);
const GRANT_URL = "https://store.example/put/out.txt?X-Amz-Signature=deadbeefsecret";
const OBJECT_KEY = "organizations/org-1/jobs/job-1/attempts/1/00000000-0000-4000-8000-0000000000b1";

const CAPABILITY: OwnedLabelsCapability = {
  v: 1,
  audience: "adapter-manager",
  ownedLabels: {
    organizationId: "org-1",
    targetId: "tgt-1",
    workerId: "wkr-1",
    jobId: "job-1",
    attempt: 1,
    leaseId: "lease-1",
    deviceGeneration: 7,
  },
  expiresAt: 1_700_000_060_000,
  sig: "c2ln",
};

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
    maxBytes: 42,
    expectedSha256: SHA,
    objectKey: OBJECT_KEY,
    redaction: "secret",
    ...overrides,
  } as ArtifactUploadGrantV1;
}

interface Seen {
  readonly url: string;
  readonly body: { args: unknown; ctx: unknown; capability?: unknown };
}

/** An injected fetch that records every hop and answers with `respond(op)`. */
function recordingFetch(respond: (op: string) => string): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fake = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, body: JSON.parse(String(init?.body)) });
    const op = url.slice(url.lastIndexOf("/") + 1);
    const text = respond(op);
    return { ok: true, status: 200, text: async () => text } as Response;
  }) as typeof fetch;
  return { fetch: fake, seen };
}

function driverWith(respond: (op: string) => string, capability: OwnedLabelsCapability | undefined = CAPABILITY) {
  const hop = recordingFetch(respond);
  const driver = new NetworkedProviderDriver({ baseUrl: "http://adapter-manager:7400/", fetch: hop.fetch, capability });
  return { driver, seen: hop.seen };
}

async function messageOf(p: Promise<unknown>): Promise<string> {
  const err = (await p.then(
    () => null,
    (e: unknown) => e,
  )) as Error | null;
  if (err === null) throw new Error("expected a rejection");
  return `${err.name}: ${err.message}\n${err.stack ?? ""}`;
}

describe("DAT-009-3e — the networked driver relays digest/export", () => {
  it("advertises artifactExportMode = 'grant_upload' (it RELAYS; the far provider decides support)", () => {
    expect(new NetworkedProviderDriver({ baseUrl: "http://am" }).artifactExportMode).toBe("grant_upload");
  });

  it("digestArtifact POSTs /op/digest_artifact ONCE with {sandboxId, path} + ctx + the capability", async () => {
    const { driver, seen } = driverWith(() => encodeOkResponse({ sha256: SHA, sizeBytes: 42 }));

    const result = await driver.digestArtifact(SANDBOX, PATH, CTX);

    expect(result).toEqual({ sha256: SHA, sizeBytes: 42 });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("http://adapter-manager:7400/op/digest_artifact");
    expect(seen[0]!.body.args).toEqual({ sandboxId: SANDBOX, path: PATH });
    expect(seen[0]!.body.ctx).toEqual(CTX);
    // GATED owned op: the capability rides the envelope exactly as it does for execute/stage_files.
    expect(seen[0]!.body.capability).toEqual(CAPABILITY);
  });

  it("exportArtifact POSTs /op/export_artifact ONCE: the GRANT goes in, only {objectKey} comes out", async () => {
    const { driver, seen } = driverWith(() => encodeOkResponse({ objectKey: OBJECT_KEY }));
    const g = grant();

    const result = await driver.exportArtifact(SANDBOX, PATH, g, CTX);

    expect(result).toEqual({ objectKey: OBJECT_KEY });
    expect(Object.keys(result)).toEqual(["objectKey"]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("http://adapter-manager:7400/op/export_artifact");
    expect(seen[0]!.body.args).toEqual({ sandboxId: SANDBOX, path: PATH, grant: g });
    expect(seen[0]!.body.capability).toEqual(CAPABILITY);
  });

  it("★ the mode property is READ: a driver whose mode is 'none' refuses BOTH before any RPC", async () => {
    // The pre-3e code threw unconditionally, so it passed a test like this vacuously: nothing read
    // the property. Now the relay exists, and the ONLY thing stopping it here is the mode.
    class DecliningDriver extends NetworkedProviderDriver {
      override readonly artifactExportMode: ArtifactExportMode = "none";
    }
    const hop = recordingFetch(() => encodeOkResponse({ sha256: SHA, sizeBytes: 42 }));
    const driver = new DecliningDriver({ baseUrl: "http://am", fetch: hop.fetch, capability: CAPABILITY });

    await expect(driver.digestArtifact(SANDBOX, PATH, CTX)).rejects.toBeInstanceOf(UnsupportedProviderOperation);
    await expect(driver.exportArtifact(SANDBOX, PATH, grant(), CTX)).rejects.toMatchObject({
      name: "UnsupportedProviderOperation",
      operation: "export_artifact",
    });
    expect(hop.seen).toHaveLength(0);
  });

  it("★ a reference that is NOT the grant's own objectKey is refused — never a fabricated reference", async () => {
    const { driver } = driverWith(() => encodeOkResponse({ objectKey: "organizations/org-2/jobs/x/attempts/1/y" }));
    await expect(driver.exportArtifact(SANDBOX, PATH, grant(), CTX)).rejects.toBeInstanceOf(WireProtocolError);
  });

  it("★ an export ok-envelope with no objectKey at all is refused", async () => {
    const { driver } = driverWith(() => encodeOkResponse({}));
    await expect(driver.exportArtifact(SANDBOX, PATH, grant(), CTX)).rejects.toBeInstanceOf(WireProtocolError);
  });

  it.each([
    ["an uppercase/short sha256", { sha256: "ABC", sizeBytes: 1 }],
    ["a negative size", { sha256: SHA, sizeBytes: -1 }],
    ["a fractional size", { sha256: SHA, sizeBytes: 1.5 }],
    ["a missing sha256", { sizeBytes: 1 }],
    ["a null result", null],
  ])("★ a malformed digest result (%s) is refused, never handed to the grant mint", async (_label, body) => {
    const { driver } = driverWith(() => encodeOkResponse(body));
    await expect(driver.digestArtifact(SANDBOX, PATH, CTX)).rejects.toBeInstanceOf(WireProtocolError);
  });

  it("the FAR provider's refusal crosses back as its own class (honest decline, not a no-op)", async () => {
    const { driver } = driverWith(() => encodeErrResponse(new UnsupportedProviderOperation("export_artifact")));
    await expect(driver.exportArtifact(SANDBOX, PATH, grant(), CTX)).rejects.toMatchObject({
      name: "UnsupportedProviderOperation",
      operation: "export_artifact",
    });
  });

  it("one call is ONE RPC — a failed export is not retried by the driver", async () => {
    const { driver, seen } = driverWith(() => encodeErrResponse(new WireProtocolError("adapter-manager provider operation failed")));
    await expect(driver.exportArtifact(SANDBOX, PATH, grant(), CTX)).rejects.toBeInstanceOf(WireProtocolError);
    expect(seen).toHaveLength(1);
  });

  it("★ H-04: no thrown message carries grant.url, on any refusal path", async () => {
    const paths: Promise<unknown>[] = [
      driverWith(() => encodeOkResponse({ objectKey: "somewhere-else" })).driver.exportArtifact(SANDBOX, PATH, grant(), CTX),
      driverWith(() => encodeOkResponse({})).driver.exportArtifact(SANDBOX, PATH, grant(), CTX),
      driverWith(() => "}{ not json").driver.exportArtifact(SANDBOX, PATH, grant(), CTX),
      driverWith(() => encodeErrResponse(new Error("far side"))).driver.exportArtifact(SANDBOX, PATH, grant(), CTX),
    ];
    for (const p of paths) {
      const text = await messageOf(p);
      expect(text).not.toContain("deadbeefsecret");
      expect(text).not.toContain("store.example");
    }
  });
});
