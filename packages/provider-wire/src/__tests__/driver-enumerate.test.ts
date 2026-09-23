// -----------------------------------------------------------------------------
// CLI-012 — `NetworkedProviderDriver.enumerateOutputs` over the wire.
//
// ★ WHY THIS LANE NEEDED A NEW ROUTE AT ALL. The driver had no enumeration of any kind: on the
// networked lane `listDir` lives behind the far provider's private `#transport`, so without this
// binding a containerized worker could run the producer and learn nothing.
//
// What these cases pin (the network hop is an injected `fetch`, so every call is counted):
//   - ONE POST to `/op/enumerate_outputs` carrying `{sandboxId, root}` + ctx + the owned-labels
//     CAPABILITY (it is a gated owned op on the server; an ungated server 404s it);
//   - the mode is READ: a driver whose mode is `"none"` refuses before any RPC;
//   - the response is VALIDATED, not trusted — a far side returning bare strings, or entries with
//     no size or no link marker, is REFUSED. That is load-bearing: `undefined` where the producer
//     expects a boolean makes `A-O2-4`'s symlink refusal silently inoperative on this lane, and
//     `undefined` where it expects a number does the same to the `SD-6` admission bounds.
// -----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import type { ProviderOpContext, SandboxEnumerationMode } from "@armyofagents/worker-daemon";
import { UnsupportedProviderOperation } from "@armyofagents/sandbox-e2b-provider/errors.js";

import { NetworkedProviderDriver } from "../driver.js";
import { WireProtocolError, encodeOkResponse } from "../codec.js";
import type { OwnedLabelsCapability } from "../capability.js";

const CTX: ProviderOpContext = { deadlineMs: 30_000, idempotencyKey: "idem-enumerate-1" };
const SANDBOX = "sbx-000001";
const ROOT = "/home/user/aoa-output";

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

interface Seen {
  readonly url: string;
  readonly body: { args: unknown; ctx: unknown; capability?: unknown };
}

function driverWith(text: string, capability: OwnedLabelsCapability | undefined = CAPABILITY) {
  const seen: Seen[] = [];
  const fake = (async (input: unknown, init?: RequestInit) => {
    seen.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return { ok: true, status: 200, text: async () => text } as Response;
  }) as typeof fetch;
  const driver = new NetworkedProviderDriver({ baseUrl: "http://adapter-manager:7400/", fetch: fake, capability });
  return { driver, seen };
}

describe("CLI-012 — the networked driver relays enumerate_outputs", () => {
  it("advertises sandboxEnumerationMode = 'metadata' (it RELAYS; the far provider decides support)", () => {
    const mode: SandboxEnumerationMode = new NetworkedProviderDriver({ baseUrl: "http://am" })
      .sandboxEnumerationMode;
    expect(mode).toBe("metadata");
  });

  it("POSTs /op/enumerate_outputs ONCE with {sandboxId, root} + ctx + the capability", async () => {
    const { driver, seen } = driverWith(
      encodeOkResponse({
        entries: [
          { path: `${ROOT}/a.md`, sizeBytes: 5, symlink: false },
          { path: `${ROOT}/l1`, sizeBytes: 300, symlink: true },
        ],
      }),
    );

    const result = await driver.enumerateOutputs(SANDBOX, ROOT, CTX);

    expect(result.entries).toEqual([
      { path: `${ROOT}/a.md`, sizeBytes: 5, symlink: false },
      { path: `${ROOT}/l1`, sizeBytes: 300, symlink: true },
    ]);
    // ONE call is ONE RPC: no retry, no prefetch.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("http://adapter-manager:7400/op/enumerate_outputs");
    expect(seen[0]!.body.args).toEqual({ sandboxId: SANDBOX, root: ROOT });
    expect(seen[0]!.body.ctx).toEqual(CTX);
    // GATED owned op: the capability rides the envelope exactly as it does for digest/export.
    expect(seen[0]!.body.capability).toEqual(CAPABILITY);
  });

  it("★ a 'none' driver refuses BEFORE any RPC — the mode is read, not decorative", async () => {
    const { driver, seen } = driverWith(encodeOkResponse({ entries: [] }));
    Object.defineProperty(driver, "sandboxEnumerationMode", { value: "none" satisfies SandboxEnumerationMode });
    await expect(driver.enumerateOutputs(SANDBOX, ROOT, CTX)).rejects.toBeInstanceOf(UnsupportedProviderOperation);
    expect(seen).toHaveLength(0);
  });

  it("★★★ REFUSES a malformed listing rather than handing the producer undefined fields", async () => {
    // A far side that answered the pre-CLI-012 `string[]` shape.
    const bare = driverWith(encodeOkResponse({ entries: [`${ROOT}/a.md`] }));
    await expect(bare.driver.enumerateOutputs(SANDBOX, ROOT, CTX)).rejects.toBeInstanceOf(WireProtocolError);

    // ★ An entry with NO LINK MARKER. Accepting it would make `entry.symlink` `undefined` —
    // falsy — so every symlink on this lane would be admitted and exported through its target.
    const noMarker = driverWith(encodeOkResponse({ entries: [{ path: `${ROOT}/a.md`, sizeBytes: 5 }] }));
    await expect(noMarker.driver.enumerateOutputs(SANDBOX, ROOT, CTX)).rejects.toBeInstanceOf(WireProtocolError);

    // ★ An entry with NO SIZE. Accepting it would make every `SD-6` comparison `undefined > n`,
    // i.e. false, so no admission bound would ever refuse anything on this lane.
    const noSize = driverWith(encodeOkResponse({ entries: [{ path: `${ROOT}/a.md`, symlink: false }] }));
    await expect(noSize.driver.enumerateOutputs(SANDBOX, ROOT, CTX)).rejects.toBeInstanceOf(WireProtocolError);

    // A negative size, and a non-array body.
    const negative = driverWith(
      encodeOkResponse({ entries: [{ path: `${ROOT}/a.md`, sizeBytes: -1, symlink: false }] }),
    );
    await expect(negative.driver.enumerateOutputs(SANDBOX, ROOT, CTX)).rejects.toBeInstanceOf(WireProtocolError);
    const notArray = driverWith(encodeOkResponse({ entries: "nope" }));
    await expect(notArray.driver.enumerateOutputs(SANDBOX, ROOT, CTX)).rejects.toBeInstanceOf(WireProtocolError);
  });

  it("an EMPTY listing is a legitimate answer, not a refusal", async () => {
    const { driver } = driverWith(encodeOkResponse({ entries: [] }));
    await expect(driver.enumerateOutputs(SANDBOX, ROOT, CTX)).resolves.toEqual({ entries: [] });
  });
});
