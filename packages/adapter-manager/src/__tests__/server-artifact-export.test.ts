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
import { ResourceNotAvailableError, UnsupportedProviderOperation } from "@armyofagents/worker-daemon";
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
const GRANT_URL = "https://store.example/put/out.txt?X-Amz-Signature=deadbeefsecret";

function objectKeyFor(labels: ResourceLabels): string {
  return `organizations/${labels.organizationId}/jobs/${labels.jobId}/attempts/${labels.attempt}/00000000-0000-4000-8000-0000000000b1`;
}

function grant(labels: ResourceLabels, overrides: Partial<ArtifactUploadGrantV1> = {}): ArtifactUploadGrantV1 {
  return {
    protocolVersion: 1,
    operation: "upload",
    artifactId: "00000000-0000-4000-8000-0000000000b1",
    method: "PUT",
    url: GRANT_URL,
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

/** Counts every sandbox read, so "NOT dispatched" means the provider never touched the bytes. */
class RecordingMockTransport extends MockE2bTransport {
  readFileCalls = 0;
  override async readFile(...args: Parameters<MockE2bTransport["readFile"]>): ReturnType<MockE2bTransport["readFile"]> {
    this.readFileCalls += 1;
    return super.readFile(...args);
  }
}

let transport: RecordingMockTransport;
let uploads: { objectKey: string; bytes: Uint8Array }[];
let server: ReturnType<typeof createProviderServer>;
let baseUrl: string;

async function startServer(opts: { gated?: boolean; exportMode?: "grant_upload" | "none" } = {}): Promise<void> {
  const gated = opts.gated ?? true;
  transport = new RecordingMockTransport();
  uploads = [];
  const performUploadGrant = async (g: ArtifactUploadGrantV1, bytes: Uint8Array): Promise<void> => {
    uploads.push({ objectKey: g.objectKey, bytes: Uint8Array.from(bytes) });
  };
  const provider =
    opts.exportMode === "none"
      ? new (class extends E2bSandboxProvider {
          override readonly artifactExportMode = "none" as const;
        })({ transport, performUploadGrant })
      : new E2bSandboxProvider({ transport, performUploadGrant });
  server = createProviderServer({ provider, controlPlanePublicKey: gated ? controlPlane.publicKey : undefined, now: () => NOW });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function stopServer(): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

beforeEach(() => startServer());
afterEach(() => stopServer());

function ctx(idempotencyKey: string): ProviderOpContext {
  return { deadlineMs: 5_000, idempotencyKey };
}
function mint(labels: ResourceLabels): OwnedLabelsCapability {
  return signOwnedLabelsCapability(
    { v: OWNED_LABELS_CAPABILITY_VERSION, audience: OWNED_LABELS_CAPABILITY_AUDIENCE, ownedLabels: labels, expiresAt: NOW + 60_000 },
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
