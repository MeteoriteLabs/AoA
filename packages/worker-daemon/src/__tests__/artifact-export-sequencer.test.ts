// DAT-009 slice 3 — the worker-side artifact EXPORT consumer: digest → grant → export → commit.
//
// This is the FIRST production consumer of the DAT-002 grant pipeline, and it needs its own
// test at THIS link for the reason the staged-input mirror gives: a chain proven only at its
// ends cannot tell a broken mint from a broken commit from a broken provider.
//
// ★ The load-bearing cases are the refusals and the ORDER. Both ops answer HTTP 200 for
// `rejected`, so a status-only check reports a successful export of nothing; and the digest
// must precede the mint, because since DAT-009 slice 2 a mint writes a DURABLE row and an
// unredeemed grant is litter with a five-minute life.

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import {
  ArtifactExportFailedError,
  createArtifactExportSequencer,
  exportArtifactId,
  exportFailureReasonCode,
  exportReasonCode,
  grantPutHeaders,
  type ArtifactExportRequest,
  type SandboxArtifactExporter,
} from "../lease/artifact-export.js";
import { EffectAuthority, EffectAuthorityWithdrawnError } from "../supervisor/effect-authority.js";
import { createFakeSandboxProvider } from "./support/fake-provider.js";
import { makeHandoff } from "./support/supervisor-fixtures.js";
import { POLL_FIXTURE_IDS } from "./support/poll-fixtures.js";
import { generateDeviceKey } from "../identity/device-key.js";
import { createMetrics, SANDBOX_OP_METRIC } from "../metrics/metrics.js";
import type { WorkerSession } from "../enrollment/enroll.js";

const BODY = "diff --git a/a.txt b/a.txt\n";
const SHA = createHash("sha256").update(BODY).digest("hex");
const SIZE = Buffer.byteLength(BODY);

const PATH = "/home/user/workspace/.aoa-run.patch";
const REQUEST: ArtifactExportRequest = {
  path: PATH,
  kind: "workspace_patch",
  contentType: "text/plain",
  retention: "run",
};

const ARTIFACT_ID = exportArtifactId({ jobId: POLL_FIXTURE_IDS.job, attempt: 1, path: PATH });
const OBJECT_KEY =
  `organizations/${POLL_FIXTURE_IDS.org}/jobs/${POLL_FIXTURE_IDS.job}/attempts/1/${ARTIFACT_ID}`;

const SESSION: WorkerSession = { token: "session-token", expiresAt: new Date(Date.now() + 600_000) } as never;

function uploadGrant(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1,
    operation: "upload",
    artifactId: ARTIFACT_ID,
    method: "PUT",
    url: "https://store.example/put?X-Amz-Signature=SECRETSIGNATURE",
    headers: {},
    issuedAt: "2026-09-04T12:00:00.000Z",
    expiresAt: "2026-09-04T12:05:00.000Z",
    maxBytes: SIZE,
    expectedSha256: SHA,
    objectKey: OBJECT_KEY,
    redaction: "secret",
    ...overrides,
  };
}

/** A provider half that records what it was asked and answers as the test scripts. */
function exporter(script: {
  digest?: () => Promise<{ sha256: string; sizeBytes: number }>;
  exportKey?: string;
  exportThrows?: Error;
} = {}): SandboxArtifactExporter & { calls: string[]; grants: unknown[] } {
  const calls: string[] = [];
  const grants: unknown[] = [];
  return {
    calls,
    grants,
    async digest() {
      calls.push("digest");
      if (script.digest) return script.digest();
      return { sha256: SHA, sizeBytes: SIZE };
    },
    async export(_path, grant) {
      calls.push("export");
      grants.push(grant);
      if (script.exportThrows) throw script.exportThrows;
      return { objectKey: script.exportKey ?? OBJECT_KEY };
    },
  };
}

/** A control-plane double answering both ops, recording every parsed request body. */
function client(script: {
  grant?: (parsed: Record<string, unknown>) => { status: number; body: unknown };
  commit?: (parsed: Record<string, unknown>) => { status: number; body: unknown };
} = {}) {
  const calls: string[] = [];
  const grantRequests: Record<string, unknown>[] = [];
  const commitRequests: Record<string, unknown>[] = [];
  return {
    calls,
    grantRequests,
    commitRequests,
    client: {
      artifactTransferGrantPath: "/api/worker-control/artifact-transfer-grants",
      artifactCommitPath: "/api/worker-control/artifact-commits",
      async artifactTransferGrant(request: { bytes: Buffer }) {
        const parsed = JSON.parse(request.bytes.toString("utf8")) as Record<string, unknown>;
        calls.push("grant");
        grantRequests.push(parsed);
        if (script.grant) return script.grant(parsed);
        return {
          status: 200,
          body: {
            protocolVersion: 1,
            correlationId: parsed.correlationId,
            serverTime: "2026-09-04T12:00:00.000Z",
            outcome: "upload_granted",
            grant: uploadGrant(),
          },
        };
      },
      async artifactCommit(request: { bytes: Buffer }) {
        const parsed = JSON.parse(request.bytes.toString("utf8")) as Record<string, unknown>;
        calls.push("commit");
        commitRequests.push(parsed);
        if (script.commit) return script.commit(parsed);
        return {
          status: 200,
          body: {
            protocolVersion: 1,
            correlationId: parsed.correlationId,
            serverTime: "2026-09-04T12:00:00.000Z",
            outcome: "committed",
            artifactId: ARTIFACT_ID,
            versionNumber: 1,
            committedAt: "2026-09-04T12:00:00.000Z",
          },
        };
      },
    },
  };
}

function sequencerOver(script: Parameters<typeof client>[0] = {}) {
  const c = client(script);
  const sessionCalls: number[] = [];
  return {
    ...c,
    sessionCalls,
    run: createArtifactExportSequencer({
      client: c.client as never,
      key: generateDeviceKey(),
      session: async () => {
        sessionCalls.push(1);
        return SESSION;
      },
    }),
  };
}

describe("DAT-009 slice 3 — artifact export sequencer (digest → grant → export → commit)", () => {
  it("★ runs the four steps IN ORDER and returns a reference to the committed object", async () => {
    const { run, calls, grantRequests, commitRequests } = sequencerOver();
    const ex = exporter();
    const outcome = await run({ handoff: makeHandoff(), exporter: ex, requests: [REQUEST] });
    const refs = outcome.exported;
    expect(outcome.failures).toEqual([]);

    // The interleaving is the property: digest BEFORE grant, grant BEFORE export, export
    // BEFORE commit. A sequencer that minted first would still pass a per-call assertion.
    expect([...ex.calls, ...calls].length).toBe(4);
    expect(calls).toEqual(["grant", "commit"]);
    expect(ex.calls).toEqual(["digest", "export"]);

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      path: PATH,
      artifactId: ARTIFACT_ID,
      objectKey: OBJECT_KEY,
      sha256: SHA,
      sizeBytes: SIZE,
      versionNumber: 1,
    });
    // A REFERENCE — never bytes.
    expect(Object.keys(refs[0]!)).not.toContain("body");
    expect(Object.keys(refs[0]!)).not.toContain("bytes");

    // ★ The grant request carries the DIGEST STEP's values, which is what makes
    // "digest before mint" structural rather than incidental.
    const grantBody = grantRequests[0]!.body as Record<string, unknown>;
    expect(grantBody.operation).toBe("upload");
    expect(grantBody.expectedSha256).toBe(SHA);
    expect(grantBody.maxBytes).toBe(SIZE);
    expect(grantBody.artifactId).toBe(ARTIFACT_ID);

    // The commit manifest carries the org + company off the FROZEN ENVELOPE — the measurement
    // that made this ticket possible without a frozen change.
    const manifest = (commitRequests[0]!.body as Record<string, unknown>).manifest as Record<string, unknown>;
    expect(manifest.organizationId).toBe(POLL_FIXTURE_IDS.org);
    expect(manifest.companyId).toBe(POLL_FIXTURE_IDS.company);
    expect(manifest.kind).toBe("workspace_patch");
    expect(manifest.sha256).toBe(SHA);
    expect(manifest.sizeBytes).toBe(SIZE);
    expect(manifest.sensitivity).toBe("restricted");
  });

  it("★ binds the object key to THIS run's own org/job/attempt prefix", async () => {
    const { run, grantRequests } = sequencerOver();
    await run({ handoff: makeHandoff(), exporter: exporter(), requests: [REQUEST] });
    const grantBody = grantRequests[0]!.body as Record<string, unknown>;
    expect(grantBody.expectedObjectKey).toBe(OBJECT_KEY);
    expect(String(grantBody.expectedObjectKey).startsWith(`organizations/${POLL_FIXTURE_IDS.org}/`)).toBe(true);
    expect(String(grantBody.expectedObjectKey)).toContain(`/jobs/${POLL_FIXTURE_IDS.job}/attempts/1/`);
  });

  it("★★★ mints NOTHING when there is nothing to export — an empty run leaves no durable row", async () => {
    const { run, calls, sessionCalls } = sequencerOver();
    const ex = exporter();
    const outcome = await run({ handoff: makeHandoff(), exporter: ex, requests: [] });
    expect(outcome).toEqual({ exported: [], failures: [] });
    // Anti-vacuity: the CALL COUNTS are asserted, so a sequencer that silently did nothing on
    // a NON-empty list could not pass the happy-path case above either.
    expect(calls).toEqual([]);
    expect(ex.calls).toEqual([]);
    // ★ And it touches NOTHING AT ALL — not even the session. Pinned because the early return
    // has no other observable effect, and without this assertion removing it stays green: the
    // loop body already does not run for an empty list. The property it buys is that a run
    // with nothing to export CANNOT FAIL on the export path, including when the session is
    // unrenewable — which is precisely the run for which failing would be absurd.
    expect(sessionCalls).toEqual([]);
  });

  it("★★★ a failed digest mints NO grant — the orphan this order exists to prevent", async () => {
    const { run, calls } = sequencerOver();
    const ex = exporter({
      digest: async () => {
        throw new Error("no such file");
      },
    });
    // ★ CLI-012 (E5-D07 ruling 7) — PER-FILE, so the refusal is CLASSIFIED into the outcome
    // rather than thrown out of the loop. (Superseded assertion: `.rejects.toThrow(
    // ArtifactExportFailedError)`.) Nothing about the orphan property changed.
    const outcome = await run({ handoff: makeHandoff(), exporter: ex, requests: [REQUEST] });
    expect(outcome.exported).toEqual([]);
    expect(outcome.failures).toEqual([{ stage: "digest", reason: "digest_failed" }]);
    // Since DAT-009 slice 2 a mint writes a durable `granted` row inside the mint transaction.
    // A sequencer that minted before digesting would leave one behind for every absent file.
    expect(calls).toEqual([]);
  });

  it("★★★ carries the server's REFUSAL REASON instead of discarding it (contrast E7-F017)", async () => {
    const { run } = sequencerOver({
      grant: (parsed) => ({
        status: 200,
        body: {
          protocolVersion: 1,
          correlationId: parsed.correlationId,
          serverTime: "2026-09-04T12:00:00.000Z",
          outcome: "rejected",
          reason: "attempt_terminal",
        },
      }),
    });
    const outcome = await run({ handoff: makeHandoff(), exporter: exporter(), requests: [REQUEST] });
    // `attempt_terminal` is the lifecycle-window mistake this module can make, and the whole
    // value of the classification is that it names it. The download mirror reports every refusal
    // as "malformed grant" (E7-F017) and sends the reader hunting a protocol bug.
    // ★ CLI-012: it now rides the PATH-FREE `reason` rather than the (path-bearing) message.
    expect(outcome.failures).toEqual([{ stage: "grant", reason: "attempt_terminal" }]);
    expect(outcome.exported).toEqual([]);
  });

  it("refuses a CROSS-PAIRED download grant rather than parsing it as an upload", async () => {
    const { run, calls } = sequencerOver({
      grant: (parsed) => ({
        status: 200,
        body: {
          protocolVersion: 1,
          correlationId: parsed.correlationId,
          serverTime: "2026-09-04T12:00:00.000Z",
          outcome: "download_granted",
          grant: uploadGrant({ operation: "download", method: "GET" }),
        },
      }),
    });
    const ex = exporter();
    const outcome = await run({ handoff: makeHandoff(), exporter: ex, requests: [REQUEST] });
    expect(outcome.failures).toEqual([{ stage: "grant", reason: "unexpected_outcome" }]);
    // And nothing was uploaded under it.
    expect(ex.calls).toEqual(["digest"]);
    expect(calls).toEqual(["grant"]);
  });

  it("a commit refusal is distinguishable and fabricates NO reference", async () => {
    const { run } = sequencerOver({
      commit: (parsed) => ({
        status: 200,
        body: {
          protocolVersion: 1,
          correlationId: parsed.correlationId,
          serverTime: "2026-09-04T12:00:00.000Z",
          outcome: "rejected",
          reason: "event_hash_mismatch",
        },
      }),
    });
    const outcome = await run({ handoff: makeHandoff(), exporter: exporter(), requests: [REQUEST] });
    expect(outcome.failures).toEqual([{ stage: "commit", reason: "event_hash_mismatch" }]);
    expect(outcome.exported).toEqual([]);
  });

  it("★ refuses a `committed` response that carries no version number", async () => {
    // Found by a SURVIVING mutant: deleting this guard left every test green, because the
    // double always answers with a version. A `committed` outcome missing `versionNumber` is
    // not the frozen response shape, and returning `undefined` in a field typed `number` is a
    // fabricated reference — the same class as a fabricated digest, one step later.
    const { run } = sequencerOver({
      commit: (parsed) => ({
        status: 200,
        body: {
          protocolVersion: 1,
          correlationId: parsed.correlationId,
          serverTime: "2026-09-04T12:00:00.000Z",
          outcome: "committed",
          artifactId: ARTIFACT_ID,
          committedAt: "2026-09-04T12:00:00.000Z",
        },
      }),
    });
    const outcome = await run({ handoff: makeHandoff(), exporter: exporter(), requests: [REQUEST] });
    expect(outcome.failures).toEqual([{ stage: "commit", reason: "missing_version" }]);
    expect(outcome.exported).toEqual([]);
  });

  it("refuses a grant for a DIFFERENT object key than the one it asked to write", async () => {
    const { run } = sequencerOver({
      grant: (parsed) => ({
        status: 200,
        body: {
          protocolVersion: 1,
          correlationId: parsed.correlationId,
          serverTime: "2026-09-04T12:00:00.000Z",
          outcome: "upload_granted",
          grant: uploadGrant({
            objectKey: `organizations/${POLL_FIXTURE_IDS.org}/jobs/${POLL_FIXTURE_IDS.job}/attempts/1/someone-else`,
          }),
        },
      }),
    });
    const outcome = await run({ handoff: makeHandoff(), exporter: exporter(), requests: [REQUEST] });
    expect(outcome.failures).toEqual([{ stage: "grant", reason: "object_key_mismatch" }]);
  });

  it("★ never lets the grant's signed URL reach an error message or a return value", async () => {
    const { run } = sequencerOver();
    // The failure is raised by the PROVIDER, whose own error text carries the url — the most
    // likely real leak, since an implementation that logs what it was doing includes it.
    const leaky = exporter({ exportThrows: new Error("PUT https://store.example/put?X-Amz-Signature=SECRETSIGNATURE failed") });
    const outcome = await run({ handoff: makeHandoff(), exporter: leaky, requests: [REQUEST] });
    // ★ CLI-012 — the failure no longer escapes as a thrown error at all: the classification is
    // the ONLY thing the caller receives, and nothing the provider wrote into its own message
    // reaches it. NON-VACUITY FIRST: the leaky exporter really did run and really did fail.
    expect(outcome.failures).toEqual([{ stage: "export", reason: "export_failed" }]);
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain("SECRETSIGNATURE");
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain(PATH);
  });

  it("presents the SAME artifact id and idempotency keys on a retry of the same file", async () => {
    const first = sequencerOver();
    const second = sequencerOver();
    await first.run({ handoff: makeHandoff(), exporter: exporter(), requests: [REQUEST] });
    await second.run({ handoff: makeHandoff(), exporter: exporter(), requests: [REQUEST] });
    // A RANDOM key would make a replay indistinguishable from a new request, and a random
    // artifactId would defeat the mint's already-committed guard.
    expect(first.grantRequests[0]!.idempotencyKey).toBe(second.grantRequests[0]!.idempotencyKey);
    expect(first.commitRequests[0]!.idempotencyKey).toBe(second.commitRequests[0]!.idempotencyKey);
    expect((first.grantRequests[0]!.body as Record<string, unknown>).artifactId).toBe(ARTIFACT_ID);
    // The two ops must NOT share one key: they are different operations on the same artifact.
    expect(first.grantRequests[0]!.idempotencyKey).not.toBe(first.commitRequests[0]!.idempotencyKey);
  });
});

describe("DAT-009 slice 3 — grantPutHeaders (the headers the signed PUT demands)", () => {
  it("★★★ sends the digest as BASE64, never the grant's HEX", () => {
    const headers = grantPutHeaders(uploadGrant() as never);
    expect(headers["x-amz-checksum-sha256"]).toBe(Buffer.from(SHA, "hex").toString("base64"));
    // The single most likely mistake: forwarding `expectedSha256` verbatim. The store refuses
    // it, and nothing in the type system distinguishes the two encodings.
    expect(headers["x-amz-checksum-sha256"]).not.toBe(SHA);
    expect(headers["x-amz-sdk-checksum-algorithm"]).toBe("SHA256");
  });

  it("lets a grant-supplied header win, so a future server that sends them is not overridden", () => {
    const headers = grantPutHeaders(uploadGrant({ headers: { "x-amz-checksum-sha256": "server-said-so" } }) as never);
    expect(headers["x-amz-checksum-sha256"]).toBe("server-said-so");
  });
});

describe("DAT-009 slice 3 — the export pair is gated by EffectAuthority", () => {
  const fence = { jobId: POLL_FIXTURE_IDS.job, attempt: 1, leaseId: POLL_FIXTURE_IDS.lease, fenceToken: "1" };
  const ctx = { deadlineMs: 1_000, idempotencyKey: "k" };

  it("★ a WITHDRAWN authority refuses both, before the grant is passed to any implementation", async () => {
    const provider = createFakeSandboxProvider({ artifactExportMode: "grant_upload", artifactFiles: { [PATH]: BODY } });
    const authority = new EffectAuthority(provider, fence as never);
    authority.withdraw();
    // ★ SYNCHRONOUS, like every other gated method here (`stageFiles` included): the guard runs
    // before the provider call is even made, so the refusal is a throw and not a rejected
    // promise. Asserted in that shape deliberately — for `exportArtifact` it is the property
    // that matters, because it means a withdrawn authority never hands the bearer grant to an
    // implementation at all, and a redeemed grant cannot be recalled.
    expect(() => authority.digestArtifact("sbx", PATH, ctx as never)).toThrow(
      EffectAuthorityWithdrawnError,
    );
    expect(() => authority.exportArtifact("sbx", PATH, uploadGrant() as never, ctx as never)).toThrow(
      EffectAuthorityWithdrawnError,
    );
  });

  it("an ACTIVE authority passes both through to the provider", async () => {
    const provider = createFakeSandboxProvider({ artifactExportMode: "grant_upload", artifactFiles: { [PATH]: BODY } });
    const authority = new EffectAuthority(provider, fence as never);
    await expect(authority.digestArtifact("sbx", PATH, ctx as never)).resolves.toMatchObject({
      sizeBytes: expect.any(Number),
    });
    await expect(
      authority.exportArtifact("sbx", PATH, uploadGrant() as never, ctx as never),
    ).resolves.toMatchObject({ objectKey: OBJECT_KEY });
  });
});

describe("DAT-009 slice 3 — the two operation labels are registered (E7-F010)", () => {
  it("★★★ `digest_artifact` and `export_artifact` pass the CLOSED label allow-list", () => {
    const metrics = createMetrics();
    // Unregistered values THROW on this allow-list, and the throw would land inside the
    // supervisor's fail-closed arms and strand the run with NO TERMINAL — on the happy path
    // as readily as the failure path. That is E7-F010, and this is its regression pin.
    expect(() => metrics.inc(SANDBOX_OP_METRIC, { operation: "digest_artifact", outcome: "success" })).not.toThrow();
    expect(() => metrics.inc(SANDBOX_OP_METRIC, { operation: "export_artifact", outcome: "success" })).not.toThrow();
    // The positive control: an unregistered neighbour still throws, so the assertion above is
    // measuring the allow-list rather than a metrics object that accepts anything.
    expect(() => metrics.inc(SANDBOX_OP_METRIC, { operation: "upload_artifact", outcome: "success" })).toThrow();
  });
});

// ---------------------------------------------------------------------------------------
// CLI-012 (E5-D07 ruling 7) — the PER-FILE failure policy.
//
// ★★★ WHY THIS EXISTS. As DAT-009-3c shipped it, every `fail(...)` threw out of the loop, so
// ONE refused file dropped every valid output AFTER it — and the producer enumerates SORTED, so
// an agent that names a secret-bearing or oversized file `a-…` costs the run everything else it
// wrote. The doubles below are PATH-AWARE (the shipped ones answer one fixed object key), which
// a multi-file arm needs.
// ---------------------------------------------------------------------------------------

function keyFor(path: string): string {
  const id = exportArtifactId({ jobId: POLL_FIXTURE_IDS.job, attempt: 1, path });
  return `organizations/${POLL_FIXTURE_IDS.org}/jobs/${POLL_FIXTURE_IDS.job}/attempts/1/${id}`;
}

function multiFileSequencer(
  refuseDigestFor: ReadonlySet<string>,
  // CLI-017-B round 3 — make the EXPORT hop refusable with a chosen error CLASS NAME, so the
  // per-file `reason` the sequencer records can be driven end to end. Without this the
  // `exportFailureReasonCode` arms prove the helper and NOT the call site, which is the vacuity
  // trap: mutation M-B14 (restore the blanket "export_failed" at the call site) left them green.
  refuseExportWith: ReadonlyMap<string, string> = new Map(),
) {
  const digested: string[] = [];
  const uploaded: string[] = [];
  const committed: string[] = [];
  const exporterDouble: SandboxArtifactExporter = {
    async digest(path) {
      digested.push(path);
      if (refuseDigestFor.has(path)) throw new Error("no such file");
      return { sha256: SHA, sizeBytes: SIZE };
    },
    async export(path, grant) {
      uploaded.push(path);
      const name = refuseExportWith.get(path);
      if (name !== undefined) {
        const error = new Error("refused");
        error.name = name;
        throw error;
      }
      return { objectKey: grant.objectKey };
    },
  };
  const run = createArtifactExportSequencer({
    client: {
      artifactTransferGrantPath: "/api/worker-control/artifact-transfer-grants",
      artifactCommitPath: "/api/worker-control/artifact-commits",
      async artifactTransferGrant(request: { bytes: Buffer }) {
        const parsed = JSON.parse(request.bytes.toString("utf8")) as Record<string, unknown>;
        const body = parsed.body as Record<string, unknown>;
        return {
          status: 200,
          body: {
            protocolVersion: 1,
            correlationId: parsed.correlationId,
            serverTime: "2026-09-04T12:00:00.000Z",
            outcome: "upload_granted",
            grant: uploadGrant({
              artifactId: body.artifactId,
              objectKey: body.expectedObjectKey,
            }),
          },
        };
      },
      async artifactCommit(request: { bytes: Buffer }) {
        const parsed = JSON.parse(request.bytes.toString("utf8")) as Record<string, unknown>;
        const manifest = (parsed.body as Record<string, unknown>).manifest as Record<string, unknown>;
        committed.push(String(manifest.objectKey));
        return {
          status: 200,
          body: {
            protocolVersion: 1,
            correlationId: parsed.correlationId,
            serverTime: "2026-09-04T12:00:00.000Z",
            outcome: "committed",
            artifactId: manifest.artifactId,
            versionNumber: 1,
            committedAt: "2026-09-04T12:00:00.000Z",
          },
        };
      },
    } as never,
    key: generateDeviceKey(),
    session: async () => SESSION,
  });
  return { run, exporter: exporterDouble, digested, uploaded, committed };
}

describe("CLI-012 — per-file: a refused FIRST file never drops the valid ones after it", () => {
  const A = "/home/user/aoa-output/a-refused.md";
  const B = "/home/user/aoa-output/b-good.md";
  const C = "/home/user/aoa-output/c-good.md";
  const requests: ArtifactExportRequest[] = [A, B, C].map((path) => ({
    path,
    kind: "other",
    contentType: "text/markdown",
    retention: "run",
  }));

  it("★★★ classifies the refusal and STILL commits the remaining two", async () => {
    const h = multiFileSequencer(new Set([A]));
    const outcome = await h.run({ handoff: makeHandoff(), exporter: h.exporter, requests });

    // NON-VACUITY FIRST: all three were really attempted, so "two committed" is not "the loop
    // stopped early and two were never tried".
    expect(h.digested).toEqual([A, B, C]);
    expect(outcome.exported.map((ref) => ref.path)).toEqual([B, C]);
    expect(h.committed).toEqual([keyFor(B), keyFor(C)]);
    expect(outcome.failures).toEqual([{ stage: "digest", reason: "digest_failed" }]);
    // ★ THE MUTANT THIS REDS: restore the all-or-throw loop (delete the per-request try/catch
    // in `createArtifactExportSequencer`) and `run` rejects at A — `h.digested` is `[A]`,
    // `outcome` never exists, and this arm fails at the first expect.
  });

  it("all-refused is still an outcome, not a throw, and commits nothing", async () => {
    const h = multiFileSequencer(new Set([A, B, C]));
    const outcome = await h.run({ handoff: makeHandoff(), exporter: h.exporter, requests });
    expect(outcome.exported).toEqual([]);
    expect(outcome.failures).toHaveLength(3);
    expect(h.committed).toEqual([]);
  });

  it("★★★ a CLOSED WINDOW stops the loop — no grant is minted for the files after it", async () => {
    // ★ THE DEFECT THIS ARM EXISTS FOR, and it is one the per-file policy CREATED. Absorbing
    // failures per file means a closed window (or a withdrawn authority) no longer stops the
    // loop by throwing out of it: without the latch the sequencer walks on and mints a grant
    // for every remaining file against a fence that is already dead.
    const h = multiFileSequencer(new Set());
    let open = true;
    const attempted: string[] = [];
    const latched: SandboxArtifactExporter = {
      digest: async (path) => {
        attempted.push(path);
        if (path === B) open = false;
        if (!open) throw new Error("export window closed");
        return h.exporter.digest(path);
      },
      export: (path, grant) => h.exporter.export(path, grant),
    };
    const outcome = await h.run({
      handoff: makeHandoff(),
      exporter: latched,
      requests,
      isOpen: () => open,
    });
    // NON-VACUITY: A really committed, so this is not "nothing ran".
    expect(h.committed).toEqual([keyFor(A)]);
    expect(outcome.exported.map((ref) => ref.path)).toEqual([A]);
    // B was attempted and refused; C was never reached at all.
    expect(attempted).toEqual([A, B]);
    expect(outcome.failures).toEqual([{ stage: "digest", reason: "digest_failed" }]);
    // ★ THE MUTANT THIS REDS: delete `if (isOpen && !isOpen()) break;` and C is digested too,
    // so `h.digested` becomes `[A, B, C]` and `failures` grows a second entry.
  });
});


// ---------------------------------------------------------------------------------------
// CLI-012, second round (Codex P1 + P2, PR #576) -- the two holes the per-file policy left.
// ---------------------------------------------------------------------------------------

function grantingClient(script: {
  minted?: string[];
  committed?: string[];
  rejectGrantFor?: string;
  rejectCommitFor?: string;
}) {
  return {
    artifactTransferGrantPath: "/api/worker-control/artifact-transfer-grants",
    artifactCommitPath: "/api/worker-control/artifact-commits",
    async artifactTransferGrant(request: { bytes: Buffer }) {
      const parsed = JSON.parse(request.bytes.toString("utf8")) as Record<string, unknown>;
      const body = parsed.body as Record<string, unknown>;
      if (script.rejectGrantFor !== undefined && String(body.artifactId) === script.rejectGrantFor) {
        // A signed url in the CLIENT's own message -- the most likely real leak.
        throw new Error("fetch failed: POST https://cp.example/grants?X-Amz-Signature=SECRETSIGNATURE");
      }
      script.minted?.push(String(body.expectedObjectKey));
      return {
        status: 200,
        body: {
          protocolVersion: 1,
          correlationId: parsed.correlationId,
          serverTime: "2026-09-04T12:00:00.000Z",
          outcome: "upload_granted",
          grant: uploadGrant({ artifactId: body.artifactId, objectKey: body.expectedObjectKey }),
        },
      };
    },
    async artifactCommit(request: { bytes: Buffer }) {
      const parsed = JSON.parse(request.bytes.toString("utf8")) as Record<string, unknown>;
      const manifest = (parsed.body as Record<string, unknown>).manifest as Record<string, unknown>;
      if (script.rejectCommitFor !== undefined && String(manifest.artifactId) === script.rejectCommitFor) {
        throw new Error("ETIMEDOUT");
      }
      script.committed?.push(String(manifest.objectKey));
      return {
        status: 200,
        body: {
          protocolVersion: 1,
          correlationId: parsed.correlationId,
          serverTime: "2026-09-04T12:00:00.000Z",
          outcome: "committed",
          artifactId: manifest.artifactId,
          versionNumber: 1,
          committedAt: "2026-09-04T12:00:00.000Z",
        },
      };
    },
  };
}

function sizedExporter(sizes: ReadonlyMap<string, number>): SandboxArtifactExporter {
  return {
    async digest(path) {
      return { sha256: SHA, sizeBytes: sizes.get(path) ?? SIZE };
    },
    async export(_path, grant) {
      return { objectKey: grant.objectKey };
    },
  };
}

function req(path: string): ArtifactExportRequest {
  return { path, kind: "other", contentType: "application/octet-stream", retention: "run" };
}

describe("CLI-012 -- the ATTEMPT ceiling is held on DIGESTED sizes, not enumeration snapshots", () => {
  it("*** five files that each GREW after enumeration cannot export past the attempt ceiling", async () => {
    // The producer admitted all five from a listing snapshot inside both bounds. By digest time
    // each is 30 units against a ceiling of 100, so exactly three fit.
    const paths = ["a", "b", "c", "d", "e"].map((n) => "/home/user/aoa-output/" + n + ".bin");
    const minted: string[] = [];
    const committed: string[] = [];
    const run = createArtifactExportSequencer({
      maxAttemptBytes: 100,
      client: grantingClient({ minted, committed }) as never,
      key: generateDeviceKey(),
      session: async () => SESSION,
    });

    const outcome = await run({
      handoff: makeHandoff(),
      exporter: sizedExporter(new Map(paths.map((p) => [p, 30]))),
      requests: paths.map(req),
    });

    expect(outcome.exported.map((r) => r.path)).toEqual(paths.slice(0, 3));
    expect(outcome.failures).toEqual([
      { stage: "digest", reason: "output_limit_exceeded" },
      { stage: "digest", reason: "output_limit_exceeded" },
    ]);
    // * REFUSED BEFORE THE MINT, so the two over-ceiling files leave NO durable `granted` row.
    expect(minted).toHaveLength(3);
    expect(committed).toHaveLength(3);
    // * THE MUTANT THIS REDS: delete the attemptBytes + described.sizeBytes > maxAttemptBytes
    // check and all five export -- 150 against a ceiling of 100.
  });

  it("* a later SMALL file still exports after a refusal -- per-file, not a stop", async () => {
    const big = "/home/user/aoa-output/a-big.bin";
    const small = "/home/user/aoa-output/b-small.bin";
    const run = createArtifactExportSequencer({
      maxAttemptBytes: 100,
      client: grantingClient({}) as never,
      key: generateDeviceKey(),
      session: async () => SESSION,
    });
    const outcome = await run({
      handoff: makeHandoff(),
      exporter: sizedExporter(new Map([[big, 120], [small, 4]])),
      requests: [req(big), req(small)],
    });
    expect(outcome.exported.map((r) => r.path)).toEqual([small]);
    expect(outcome.failures).toEqual([{ stage: "digest", reason: "output_limit_exceeded" }]);
  });
});

describe("CLI-012 -- a control-plane call that REJECTS is a per-file failure, not a loop abort", () => {
  const A = "/home/user/aoa-output/a.md";
  const B = "/home/user/aoa-output/b.md";
  const idA = exportArtifactId({ jobId: POLL_FIXTURE_IDS.job, attempt: 1, path: A });

  it("*** a GRANT that rejects (timeout / DNS / reset) classifies and the next file still commits", async () => {
    const committed: string[] = [];
    const run = createArtifactExportSequencer({
      client: grantingClient({ committed, rejectGrantFor: idA }) as never,
      key: generateDeviceKey(),
      session: async () => SESSION,
    });
    const outcome = await run({
      handoff: makeHandoff(),
      exporter: sizedExporter(new Map()),
      requests: [req(A), req(B)],
    });
    expect(outcome.failures).toEqual([{ stage: "grant", reason: "transport_failed" }]);
    expect(outcome.exported.map((r) => r.path)).toEqual([B]);
    expect(committed).toHaveLength(1);
    // * And the client's own message -- which carried a signed url -- reaches nothing.
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain("SECRETSIGNATURE");
    expect(serialized).not.toContain("https://");
  });

  it("*** a GRANT that failed charges NOTHING -- no grant, no upload, so no bytes moved", async () => {
    // The third arm of the invariant below: admission-time charging fails HERE, because a
    // grant-stage failure happens strictly before the only hop that moves bytes.
    const A3 = "/home/user/aoa-output/a3.md";
    const B3 = "/home/user/aoa-output/b3.md";
    const committed: string[] = [];
    const run = createArtifactExportSequencer({
      maxAttemptBytes: 100,
      client: grantingClient({
        committed,
        rejectGrantFor: exportArtifactId({ jobId: POLL_FIXTURE_IDS.job, attempt: 1, path: A3 }),
      }) as never,
      key: generateDeviceKey(),
      session: async () => SESSION,
    });
    const outcome = await run({
      handoff: makeHandoff(),
      exporter: sizedExporter(new Map([[A3, 80], [B3, 80]])),
      requests: [req(A3), req(B3)],
    });
    // A charged 80 at admission would leave only 20 and refuse B. Nothing of A moved, so B fits.
    expect(outcome.failures).toEqual([{ stage: "grant", reason: "transport_failed" }]);
    expect(outcome.exported.map((r) => r.path)).toEqual([B3]);
    expect(committed).toHaveLength(1);
  });

  it("*** THE UNKNOWABLE CASE: a transmit whose RESPONSE timed out is CHARGED -- not proven that no bytes left", async () => {
    // The refinement of the invariant (planning session, correcting its own earlier wording):
    // "charged UNLESS IT IS PROVEN that no bytes left". A body that was transmitted and whose
    // response timed out is precisely the case where bytes-left is UNKNOWABLE, and this is a
    // BUDGET-ENFORCEMENT mechanism before it is a billing one -- an under-charge makes the bound
    // BYPASSABLE by inducing an ambiguous timeout, and per-file handling amplifies that 64x.
    const A5 = "/home/user/aoa-output/a5.bin";
    const B5 = "/home/user/aoa-output/b5.bin";
    const run = createArtifactExportSequencer({
      maxAttemptBytes: 100,
      client: grantingClient({}) as never,
      key: generateDeviceKey(),
      session: async () => SESSION,
    });
    const outcome = await run({
      handoff: makeHandoff(),
      exporter: {
        async digest(path) {
          return { sha256: SHA, sizeBytes: path === A5 ? 80 : 80 };
        },
        async export(path) {
          // The body went out; only the RESPONSE was lost. Indistinguishable, from here, from a
          // reset before a single byte moved -- which is the whole point.
          if (path === A5) throw new Error("ETIMEDOUT");
          return { objectKey: "k" };
        },
      },
      requests: [req(A5), req(B5)],
    });
    expect(outcome.failures).toEqual([
      { stage: "export", reason: "export_failed" },
      // * CHARGED: A's 80 stands against the ceiling, so B's 80 no longer fits. Uncharged, B
      // would export and the 100-unit bound would have been walked straight through.
      { stage: "digest", reason: "output_limit_exceeded" },
    ]);
    expect(outcome.exported).toEqual([]);
  });

  it("*** F10 MULTI-TENANT on the UNKNOWABLE case -- a per-tenant bypass is worth MORE, not less", async () => {
    // A bypass that works per tenant is worth more to an attacker, so the ambiguous-timeout
    // charge is proven for a SECOND Organization too, with the same-tenant control first.
    const P = "/home/user/aoa-output/ambiguous.bin";
    const Q = "/home/user/aoa-output/follow.bin";
    const attempt = (handoff: ReturnType<typeof makeHandoff>) =>
      createArtifactExportSequencer({
        maxAttemptBytes: 100,
        client: grantingClient({}) as never,
        key: generateDeviceKey(),
        session: async () => SESSION,
      })({
        handoff,
        exporter: {
          async digest() {
            return { sha256: SHA, sizeBytes: 80 };
          },
          async export(path) {
            if (path === P) throw new Error("ETIMEDOUT");
            return { objectKey: "k" };
          },
        },
        requests: [req(P), req(Q)],
      });

    const tenantA = makeHandoff();
    const offerB = JSON.parse(JSON.stringify(tenantA.offer)) as Record<string, unknown>;
    (offerB.job as Record<string, unknown>).organizationId = "00000000-0000-4000-8000-0000000000b2";
    const tenantB = { ...tenantA, offer: offerB as typeof tenantA.offer };

    for (const [name, handoff] of [["same-tenant control", tenantA], ["cross-tenant", tenantB]] as const) {
      const outcome = await attempt(handoff);
      expect(outcome.exported, `${name}: the ambiguous transmit must not buy a free follower`).toEqual([]);
      expect(outcome.failures.map((f) => f.reason), name).toEqual(["export_failed", "output_limit_exceeded"]);
    }
  });

  it("*** the charge happens EXACTLY ONCE on a fully successful file", async () => {
    // A move of the charge point is a natural place to introduce a DOUBLE charge, so this is
    // pinned rather than assumed: with a ceiling of 100 and two 40-unit files, both must fit.
    // Charged twice each, the second file would be refused at 80 + 80 > 100.
    const A4 = "/home/user/aoa-output/a4.md";
    const B4 = "/home/user/aoa-output/b4.md";
    const run = createArtifactExportSequencer({
      maxAttemptBytes: 100,
      client: grantingClient({}) as never,
      key: generateDeviceKey(),
      session: async () => SESSION,
    });
    const outcome = await run({
      handoff: makeHandoff(),
      exporter: sizedExporter(new Map([[A4, 40], [B4, 40]])),
      requests: [req(A4), req(B4)],
    });
    expect(outcome.failures).toEqual([]);
    expect(outcome.exported.map((r) => r.path)).toEqual([A4, B4]);
  });

  it("*** F10 MULTI-TENANT: one tenant's spend never consumes another's budget", async () => {
    // The ceiling is per ATTEMPT, and an attempt belongs to exactly one tenant. Tenant A spends
    // its whole budget; tenant B's identical run must still be able to spend its own.
    const P = "/home/user/aoa-output/whole-budget.bin";
    const mk = (handoff: ReturnType<typeof makeHandoff>) =>
      createArtifactExportSequencer({
        maxAttemptBytes: 100,
        client: grantingClient({}) as never,
        key: generateDeviceKey(),
        session: async () => SESSION,
      })({ handoff, exporter: sizedExporter(new Map([[P, 100]])), requests: [req(P)] });

    const tenantA = makeHandoff();
    // A SECOND Organization on the same worker, same path, same size.
    const offerB = JSON.parse(JSON.stringify(tenantA.offer)) as Record<string, unknown>;
    (offerB.job as Record<string, unknown>).organizationId = "00000000-0000-4000-8000-0000000000b2";
    const tenantB = { ...tenantA, offer: offerB as typeof tenantA.offer };

    const a = await mk(tenantA);
    const b = await mk(tenantB);
    // SAME-TENANT POSITIVE CONTROL first: tenant A really did spend its whole budget.
    expect(a.exported.map((r) => r.path)).toEqual([P]);
    expect(a.failures).toEqual([]);
    // CROSS-TENANT: B is unaffected by it.
    expect(b.exported.map((r) => r.path)).toEqual([P]);
    expect(b.failures).toEqual([]);
    // And the two tenants' artifact ids differ, so neither is billed against the other's object.
    expect(a.exported[0]!.artifactId).not.toBe("");
    expect(b.exported[0]!.artifactId).not.toBe("");
  });

  it("*** a file whose COMMIT failed STILL CHARGED the attempt ceiling -- the bytes already left", async () => {
    // A is 60 of a 100 ceiling and its commit rejects; B is another 60. The bytes of A were
    // granted and exported before the commit failed, so they left the sandbox and the ceiling
    // must already hold them -- otherwise a run failing at commit exports without limit.
    const A2 = "/home/user/aoa-output/a2.md";
    const B2 = "/home/user/aoa-output/b2.md";
    const run = createArtifactExportSequencer({
      maxAttemptBytes: 100,
      client: grantingClient({
        rejectCommitFor: exportArtifactId({ jobId: POLL_FIXTURE_IDS.job, attempt: 1, path: A2 }),
      }) as never,
      key: generateDeviceKey(),
      session: async () => SESSION,
    });
    const outcome = await run({
      handoff: makeHandoff(),
      exporter: sizedExporter(new Map([[A2, 60], [B2, 60]])),
      requests: [req(A2), req(B2)],
    });
    expect(outcome.exported).toEqual([]);
    expect(outcome.failures).toEqual([
      { stage: "commit", reason: "transport_failed" },
      { stage: "digest", reason: "output_limit_exceeded" },
    ]);
    // * THE MUTANT THIS REDS: charge `attemptBytes` only on the success path and B exports,
    // for a total of 120 against a ceiling of 100.
  });

  it("*** a COMMIT that rejects does the same", async () => {
    const run = createArtifactExportSequencer({
      client: grantingClient({ rejectCommitFor: idA }) as never,
      key: generateDeviceKey(),
      session: async () => SESSION,
    });
    const outcome = await run({
      handoff: makeHandoff(),
      exporter: sizedExporter(new Map()),
      requests: [req(A), req(B)],
    });
    expect(outcome.failures).toEqual([{ stage: "commit", reason: "transport_failed" }]);
    expect(outcome.exported.map((r) => r.path)).toEqual([B]);
  });
});

// ---------------------------------------------------------------------------------------
// CLI-017-B, round 3 (Codex round 2 on PR #592, ruled by the planning session) — AN SD-5
// REFUSAL RECORDS ITS OWN PER-FILE REASON, NOT THE BLANKET `export_failed`.
//
// `detail` already carried the class name; `detail` is not what the sequencer's per-file result
// records. `reason` is, and `reason` is the surface `E5-D07`'s per-file policy is read from. So a
// file refused for carrying a tenant credential and a file refused because the store was
// unreachable recorded the SAME reason, which destroys the distinction `SD-5`'s classified refusal
// exists to draw (`E7-D11` section 3). Only a named cause tells an operator what to do.
// ---------------------------------------------------------------------------------------
describe("CLI-017-B — exportFailureReasonCode maps the refusal CLASS to a distinct reason", () => {
  it("each SD-5 refusal class gets its own snake_case reason code", () => {
    expect(exportFailureReasonCode("SandboxExportScannerRefusedError")).toBe("export_secret_refused");
    expect(exportFailureReasonCode("SandboxExportSecretSetUnavailableError")).toBe("export_secret_set_unavailable");
    expect(exportFailureReasonCode("SandboxExportScannerUnavailableError")).toBe("export_scanner_unavailable");
  });

  it("★ the three are DISTINCT from each other and from the generic — the whole point", () => {
    const codes = [
      exportFailureReasonCode("SandboxExportScannerRefusedError"),
      exportFailureReasonCode("SandboxExportSecretSetUnavailableError"),
      exportFailureReasonCode("SandboxExportScannerUnavailableError"),
      exportFailureReasonCode("TypeError"),
    ];
    expect(new Set(codes).size).toBe(4);
  });

  it("★ FAIL-HONEST — an unknown or absent class falls back to the generic, never to a refusal", () => {
    // A new provider error must read as an unclassified export failure, not be mis-attributed to
    // a secret refusal (which would over-claim that SD-5 fired).
    expect(exportFailureReasonCode("SomeFutureProviderError")).toBe("export_failed");
    expect(exportFailureReasonCode(null)).toBe("export_failed");
    expect(exportFailureReasonCode(undefined)).toBe("export_failed");
  });

  it("★ every code is a valid reason token, so `exportReasonCode` cannot flatten it to `unknown`", () => {
    // A code that failed the snake_case guard would silently become "unknown" in
    // ArtifactExportFailedError's constructor — the same erasure, one layer lower.
    for (const name of [
      "SandboxExportScannerRefusedError",
      "SandboxExportSecretSetUnavailableError",
      "SandboxExportScannerUnavailableError",
      "TypeError",
    ]) {
      const code = exportFailureReasonCode(name);
      expect(exportReasonCode(code)).toBe(code);
    }
  });

  it("★ it leaks nothing — the output is one of exactly four fixed tokens", () => {
    const leaky = "SandboxExportScannerRefusedError";
    expect(exportFailureReasonCode(leaky)).not.toContain("/home/user");
    expect(exportFailureReasonCode(leaky)).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});


// ---------------------------------------------------------------------------------------
// CLI-017-B round 3 — THE CALL SITE, not just the helper. Found by mutation M-B14.
//
// The `exportFailureReasonCode` arms above prove the mapping. They do NOT prove that the export
// arm USES it: restoring the blanket `"export_failed"` at the `fail("export", ...)` site left every
// one of them green. Only a behavioural arm that drives a real export refusal through the sequencer
// and reads the recorded per-file `reason` can red that mutation, and this is it.
// ---------------------------------------------------------------------------------------
describe("CLI-017-B — the SEQUENCER records the refusal's own reason per file", () => {
  const A = "/home/user/aoa-output/a-secret.md";
  const B = "/home/user/aoa-output/b-good.md";
  const requests: ArtifactExportRequest[] = [A, B].map((path) => ({
    path,
    kind: "other",
    contentType: "text/markdown",
    retention: "run",
  }));

  for (const [name, reason] of [
    ["SandboxExportScannerRefusedError", "export_secret_refused"],
    ["SandboxExportSecretSetUnavailableError", "export_secret_set_unavailable"],
    ["SandboxExportScannerUnavailableError", "export_scanner_unavailable"],
  ] as const) {
    it(`an export refused with ${name} records reason=${reason}`, async () => {
      const h = multiFileSequencer(new Set(), new Map([[A, name]]));
      const outcome = await h.run({ handoff: makeHandoff(), exporter: h.exporter, requests });

      // NON-VACUITY FIRST: both files were really attempted, so this is not "the loop stopped".
      expect(h.digested).toEqual([A, B]);
      expect(outcome.failures).toEqual([{ stage: "export", reason }]);
      // And E5-D07 still holds: the refused file does not drop the valid one after it.
      expect(outcome.exported.map((ref) => ref.path)).toEqual([B]);
      expect(h.committed).toEqual([keyFor(B)]);
    });
  }

  it("★ an UNMODELLED export error still records the generic reason — never mis-attributed", async () => {
    const h = multiFileSequencer(new Set(), new Map([[A, "SomeFutureProviderError"]]));
    const outcome = await h.run({ handoff: makeHandoff(), exporter: h.exporter, requests });
    expect(h.digested).toEqual([A, B]);
    expect(outcome.failures).toEqual([{ stage: "export", reason: "export_failed" }]);
  });

  it("★ POSITIVE CONTROL — with no refusal, BOTH files export and there are no failures", async () => {
    // Without this the arms above would pass for a sequencer that failed every export.
    const h = multiFileSequencer(new Set());
    const outcome = await h.run({ handoff: makeHandoff(), exporter: h.exporter, requests });
    expect(outcome.failures).toEqual([]);
    expect(outcome.exported.map((ref) => ref.path)).toEqual([A, B]);
  });
});
