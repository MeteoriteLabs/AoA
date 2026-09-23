// -----------------------------------------------------------------------------
// CLI-012 — `enumerate_outputs` over the networked wire, component test.
//
// NetworkedProviderDriver.enumerateOutputs -> POST /op/enumerate_outputs -> the GATED
// adapter-manager server -> gateOwnedOp -> the real `E2bSandboxProvider` over a key-less mock
// transport. It is a GATED OWNED OP on the `stage_files`/`digest_artifact` precedent (E7-F011):
// verify capability -> AM-local inspect -> field-wise owned-check -> dispatch. It does NOT join
// the frozen `ProviderOperation` vocabulary.
//
// ★ MULTI-TENANT (F10). The adapter-manager serves every Organization's workers from one process,
// so the owned-op gate is the only thing between one tenant's worker and another tenant's sandbox.
// The shape of another tenant's output tree is a disclosure about that tenant even with no bytes
// attached — which file names its agent produced, how many, how big. The cases below refuse an
// enumeration aimed at a sandbox owned by ANOTHER ORGANIZATION and by another LEASE of the same
// Organization, beside a SAME-TENANT POSITIVE CONTROL that proves the route works at all.
//
// ★ AND A DRIVER-ONLY BINDING WOULD BE UNREACHABLE. An op outside `GATE_REQUIRED_OPS` and outside
// the raw-handler map is answered `404 operation not available in this slice`, so the route and
// the set must move together; the ungated case below is what proves they did.
// -----------------------------------------------------------------------------

import type { AddressInfo } from "node:net";
import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CreateSandboxSpec, ProviderOpContext, ResourceLabels } from "@armyofagents/worker-daemon";
import { ResourceNotAvailableError } from "@armyofagents/worker-daemon";
import {
  NetworkedProviderDriver,
  OWNED_LABELS_CAPABILITY_AUDIENCE,
  OWNED_LABELS_CAPABILITY_VERSION,
  WireProtocolError,
  signOwnedLabelsCapability,
  type OwnedLabelsCapability,
} from "@armyofagents/provider-wire";
import { E2bSandboxProvider } from "@armyofagents/sandbox-e2b-provider/e2b-provider.js";
import { MockE2bTransport } from "@armyofagents/sandbox-e2b-provider/mock-transport.js";

import { createProviderServer } from "../server.js";

const NOW = 1_700_000_000_000;
const ROOT = "/home/user/aoa-output";

const ORG_A: ResourceLabels = {
  organizationId: "org-a",
  targetId: "tgt-a",
  workerId: "wkr-a",
  jobId: "job-a",
  attempt: 1,
  leaseId: "lease-a",
  deviceGeneration: 7,
};
const ORG_B: ResourceLabels = {
  organizationId: "org-b",
  targetId: "tgt-b",
  workerId: "wkr-b",
  jobId: "job-b",
  attempt: 1,
  leaseId: "lease-b",
  deviceGeneration: 7,
};
const ORG_A_OTHER_LEASE: ResourceLabels = { ...ORG_A, leaseId: "lease-a2", attempt: 2 };

const controlPlane = generateKeyPairSync("ed25519");

/** Counts every listing, so "NOT dispatched" means the provider never looked. */
class CountingMockTransport extends MockE2bTransport {
  listDirCalls = 0;
  override async listDir(...args: Parameters<MockE2bTransport["listDir"]>): ReturnType<MockE2bTransport["listDir"]> {
    this.listDirCalls += 1;
    return super.listDir(...args);
  }
}

let transport: CountingMockTransport;
let server: ReturnType<typeof createProviderServer>;
let baseUrl: string;
let clockNow = NOW;
let clockRealStart = Date.now();
const serverNow = (): number => clockNow + (Date.now() - clockRealStart);

async function startServer(opts: { gated?: boolean } = {}): Promise<void> {
  const gated = opts.gated ?? true;
  transport = new CountingMockTransport();
  server = createProviderServer({
    provider: new E2bSandboxProvider({ transport }),
    controlPlanePublicKey: gated ? controlPlane.publicKey : undefined,
    now: serverNow,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(() => {
  clockNow = NOW;
  clockRealStart = Date.now();
  return startServer();
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
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

/** A live sandbox owned by `labels` holding one output file, one nested one, and one SYMLINK. */
async function sandboxWithOutput(labels: ResourceLabels): Promise<string> {
  const r = await driverFor(labels).create(specFor(labels), ctx(`c-${labels.organizationId}-${labels.leaseId}`));
  await transport.writeFiles(r.sandboxId, [
    { path: "/home/user/.aoa-run-prompt.md", bytes: new TextEncoder().encode("PROMPT") },
    { path: `${ROOT}/answer.md`, bytes: new TextEncoder().encode("hello") },
    { path: `${ROOT}/sub/notes.txt`, bytes: new TextEncoder().encode("abc") },
  ]);
  transport.plantSymlink(r.sandboxId, `${ROOT}/l1`, "/home/user/.aoa-run-prompt.md");
  return r.sandboxId;
}

describe("CLI-012 — enumerate_outputs over the networked wire (a gated owned op)", () => {
  it("SAME-TENANT POSITIVE CONTROL: Organization A enumerates its OWN sandbox's output root", async () => {
    const sandboxId = await sandboxWithOutput(ORG_A);
    const result = await driverFor(ORG_A).enumerateOutputs(sandboxId, ROOT, ctx("e-own"));
    expect(result.entries).toEqual([
      { path: `${ROOT}/answer.md`, sizeBytes: 5, symlink: false },
      { path: `${ROOT}/l1`, sizeBytes: 6, symlink: true },
      { path: `${ROOT}/sub/notes.txt`, sizeBytes: 3, symlink: false },
    ]);
    // ★ The LINK MARKER survives the whole wire hop. Without this the `A-O2-4` refusal is
    // inoperative on the networked lane specifically, which is the lane production runs on.
    expect(result.entries.filter((e) => e.symlink)).toHaveLength(1);
    // ★ METADATA ONLY: nothing that crossed back carries content.
    expect(JSON.stringify(result)).not.toContain("hello");
    expect(JSON.stringify(result)).not.toContain("PROMPT");
    // And the staged prompt outside the root never entered the listing.
    expect(result.entries.map((e) => e.path)).not.toContain("/home/user/.aoa-run-prompt.md");
  });

  it("★ F10 CROSS-ORGANIZATION: A's capability cannot enumerate B's sandbox — uniform refusal, never dispatched", async () => {
    const bSandbox = await sandboxWithOutput(ORG_B);
    const before = transport.listDirCalls;
    await expect(driverFor(ORG_A).enumerateOutputs(bSandbox, ROOT, ctx("e-cross-org"))).rejects.toBeInstanceOf(
      ResourceNotAvailableError,
    );
    expect(transport.listDirCalls).toBe(before);
  });

  it("★ F10 CROSS-LEASE within one Organization: another lease's capability is refused too", async () => {
    const sandboxId = await sandboxWithOutput(ORG_A);
    const before = transport.listDirCalls;
    await expect(
      driverFor(ORG_A_OTHER_LEASE).enumerateOutputs(sandboxId, ROOT, ctx("e-cross-lease")),
    ).rejects.toBeInstanceOf(ResourceNotAvailableError);
    expect(transport.listDirCalls).toBe(before);
  });

  it("★ NO CAPABILITY at all is refused, and nothing is listed", async () => {
    const sandboxId = await sandboxWithOutput(ORG_A);
    const before = transport.listDirCalls;
    await expect(driverFor(undefined).enumerateOutputs(sandboxId, ROOT, ctx("e-none"))).rejects.toThrow();
    expect(transport.listDirCalls).toBe(before);
  });

  it("★★★ an UNGATED server 404s the op — the route and GATE_REQUIRED_OPS moved together", async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await startServer({ gated: false });
    // Create on the FRESH server so the refusal below is about the OP, not a missing sandbox.
    const fresh = await sandboxWithOutput(ORG_A);
    const before = transport.listDirCalls;
    const err = await driverFor(ORG_A)
      .enumerateOutputs(fresh, ROOT, ctx("e-ungated"))
      .catch((e: unknown) => e);
    expect(transport.listDirCalls).toBe(before);
    expect(err).toBeInstanceOf(WireProtocolError);
    expect((err as Error).message).toContain("operation not available in this slice");
  });

  it("an EMPTY output root is a legitimate answer, not a refusal", async () => {
    const r = await driverFor(ORG_A).create(specFor(ORG_A), ctx("c-empty"));
    await transport.writeFiles(r.sandboxId, [{ path: `${ROOT}/.keep`, bytes: new Uint8Array(0) }]);
    const result = await driverFor(ORG_A).enumerateOutputs(r.sandboxId, `${ROOT}/nothing-here`, ctx("e-empty"));
    expect(result).toEqual({ entries: [] });
  });
});
