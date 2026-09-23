// DAT-009 slice 3d — the dispatch runtime composes the artifact-export SEQUENCER (E5-D07).
//
// `composeDispatchRuntime` owns the control-plane client, the device key and the live session.
// The sequencer needs exactly those three, so it is built here and handed to the supervisor as
// `exportArtifacts`, the same way `createStagedInputResolver` is handed over as
// `resolveStagedFiles`.
//
// ★★★ CLI-012 COMPOSES THE PRODUCER, and that is what these cases now pin.
// (Superseded text: "The PRODUCER (`resolveExportArtifacts`) is NOT composed here: it is
// CLI-012's, and until it lands the supervisor opens no export window on any run (E5-D07 (a) 1).")
// `createExportRequestProducer` is handed over as `resolveExportArtifacts`, so the supervisor
// opens an export window on every normal terminal and `E5-2-fenced-object-commit-worker-half`
// is promoted to `wired` in the same commit (E5-D07 ruling 4).
//
// ★ What these cases pin:
//   1. both lanes — desktop `provider` and container `makeRunProvider` — receive BOTH the
//      sequencer and the producer;
//   2. the composed sequencer is bound to THIS runtime's client, device key and live session;
//   3. a real run drives the WHOLE sequence through the composed pair — enumerate → digest →
//      mint → export → commit — on both lanes, with a provider that enumerates NOTHING as the
//      anti-vacuity control (a run that wrote no output mints no grant and leaves no row);
//   4. F10 — two concurrent runs from two Organizations, through the COMPOSED sequencer: each
//      exports only under its own attempt prefix and its own sandbox (both lanes).
//
// ★ The only thing these tests add to the composition is a TEST producer (cases 4), through the
//   `makeSupervisor` seam, because production has none yet. Everything else — the sequencer,
//   `materializeRunSecrets`, the canary coordinator, the run deadline — is what
//   `composeDispatchRuntime` built.

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  expectedAttemptObjectPrefix,
  leaseOfferV1Schema,
  type LeaseOfferV1,
  type WorkerEventV1,
} from "@armyofagents/worker-protocol";

import { composeDispatchRuntime, type ComposeDispatchRuntimeDeps } from "../lifecycle/dispatch-runtime.js";
import type { ArtifactExportRequest, ArtifactExportSequencer, SandboxArtifactExporter } from "../lease/artifact-export.js";
import type { OwnedLabelsCapabilityLike } from "../lease/owned-labels-capability.js";
import { createSupervisor, type SupervisorDeps } from "../supervisor/supervisor.js";
import type { SandboxProvider } from "../supervisor/provider.js";
import type { LeaseHandoff } from "../poll/poll-loop.js";
import type { WorkerSelfModel } from "../poll/capacity.js";
import type { WorkerSession } from "../enrollment/enroll.js";
import type { Metrics } from "../metrics/metrics.js";
import { generateDeviceKey, type DeviceKey } from "../identity/device-key.js";
import { createFakeSandboxProvider } from "./support/fake-provider.js";
import { compatibleOffer, POLL_FIXTURE_IDS } from "./support/poll-fixtures.js";
import { collectingSink } from "./support/supervisor-fixtures.js";

const PATH = "/home/user/aoa-output/change.patch";
const BODY = "diff --git a/a.txt b/a.txt\n";
const REQUEST: ArtifactExportRequest = { path: PATH, kind: "workspace_patch", contentType: "text/plain", retention: "run" };
const SESSION: WorkerSession = { token: "runtime-session-token", expiresAt: new Date(Date.now() + 600_000) } as never;
const GRANT_URL = "https://store.example/put?X-Amz-Signature=SIG";
const REDEEMED_VALUE = "sk-ant-fixture-dat-009-3d-000";

type Lane = "desktop" | "container";

// --- tenants ---------------------------------------------------------------------------------

interface Tenant {
  readonly org: string;
  readonly company: string;
  readonly job: string;
  readonly lease: string;
}

const TENANT_A: Tenant = {
  org: POLL_FIXTURE_IDS.org,
  company: POLL_FIXTURE_IDS.company,
  job: POLL_FIXTURE_IDS.job,
  lease: POLL_FIXTURE_IDS.lease,
};
/** A SECOND Organization: every tenant/attempt identity differs from A's. */
const TENANT_B: Tenant = {
  org: "00000000-0000-4000-8000-0000000000b2",
  company: "00000000-0000-4000-8000-0000000000b4",
  job: "00000000-0000-4000-8000-0000000000b3",
  lease: "00000000-0000-4000-8000-0000000000b5",
};

/**
 * A schema-valid handoff for `tenant`. The container lane's offer carries a CLI-007-shaped
 * provider-key handle, because the composed `materializeRunSecrets` is what mints the run's
 * owned-labels capability, and the networked branch fails closed without one.
 */
function handoffFor(tenant: Tenant, lane: Lane): LeaseHandoff {
  const base = compatibleOffer({ leaseId: tenant.lease });
  const job: Record<string, unknown> = {
    ...(base.job as Record<string, unknown>),
    jobId: tenant.job,
    organizationId: tenant.org,
    companyId: tenant.company,
  };
  if (lane === "container") {
    job.secretHandles = [
      {
        handleId: POLL_FIXTURE_IDS.secretHandle,
        materialization: { kind: "env", target: "ANTHROPIC_API_KEY" },
        usePolicy: "sandbox_local_only",
      },
    ];
  }
  const offer: LeaseOfferV1 = leaseOfferV1Schema.parse({ ...base, job });
  return { offer, leaseId: String(offer.leaseId), fenceToken: String(offer.fenceToken), workloadClass: "batch" };
}

// --- doubles ---------------------------------------------------------------------------------

interface RecordedRequest {
  readonly body: Record<string, unknown>;
  readonly sessionToken: string;
  readonly proofHeaders: Readonly<Record<string, string>>;
}

/**
 * A control-plane double covering the three routes a run reaches through this composition:
 * the secret resolve (container lane), the upload grant and the commit. Grants what it is asked
 * and records every request, so a test can read what each run presented.
 */
function recordingClient() {
  const grants: RecordedRequest[] = [];
  const commits: RecordedRequest[] = [];
  const resolves: Array<Record<string, unknown>> = [];
  const read = (request: { bytes: Buffer; sessionToken: string; proofHeaders: Readonly<Record<string, string>> }) => {
    const parsed = JSON.parse(request.bytes.toString("utf8")) as Record<string, unknown>;
    return { parsed, recorded: { body: parsed.body as Record<string, unknown>, sessionToken: request.sessionToken, proofHeaders: request.proofHeaders } };
  };
  const client = {
    executionSecretResolvePath: "/api/worker-control/execution-secrets/resolve",
    artifactTransferGrantPath: "/api/worker-control/artifact-transfer-grants",
    artifactCommitPath: "/api/worker-control/artifact-commits",
    async resolveExecutionSecret(request: { bytes: Buffer }) {
      const body = JSON.parse(request.bytes.toString("utf8")) as Record<string, unknown>;
      resolves.push(body);
      // The capability's labels are the resolving run's OWN — the server mints it per fence.
      const capability: OwnedLabelsCapabilityLike = {
        v: 1,
        audience: "adapter-manager",
        ownedLabels: {
          organizationId: String(body.leaseId) === TENANT_B.lease ? TENANT_B.org : TENANT_A.org,
          targetId: POLL_FIXTURE_IDS.target,
          workerId: String(body.workerId),
          jobId: String(body.jobId),
          attempt: Number(body.attempt),
          leaseId: String(body.leaseId),
          deviceGeneration: 1,
        },
        expiresAt: Date.now() + 300_000,
        sig: "sig",
      };
      return {
        status: 200,
        body: { outcome: "resolved", envTarget: "ANTHROPIC_API_KEY", value: REDEEMED_VALUE, ownedLabelsCapability: capability },
      };
    },
    async artifactTransferGrant(request: { bytes: Buffer; sessionToken: string; proofHeaders: Readonly<Record<string, string>> }) {
      const { parsed, recorded } = read(request);
      grants.push(recorded);
      const body = recorded.body;
      return {
        status: 200,
        body: {
          protocolVersion: 1,
          correlationId: parsed.correlationId,
          serverTime: "2026-09-21T12:00:00.000Z",
          outcome: "upload_granted",
          grant: {
            protocolVersion: 1,
            operation: "upload",
            artifactId: body.artifactId,
            method: "PUT",
            url: GRANT_URL,
            headers: {},
            issuedAt: "2026-09-21T12:00:00.000Z",
            expiresAt: "2026-09-21T12:05:00.000Z",
            maxBytes: body.maxBytes,
            expectedSha256: body.expectedSha256,
            objectKey: body.expectedObjectKey,
            redaction: "secret",
          },
        },
      };
    },
    async artifactCommit(request: { bytes: Buffer; sessionToken: string; proofHeaders: Readonly<Record<string, string>> }) {
      const { parsed, recorded } = read(request);
      commits.push(recorded);
      const manifest = recorded.body.manifest as Record<string, unknown>;
      return {
        status: 200,
        body: {
          protocolVersion: 1,
          correlationId: parsed.correlationId,
          serverTime: "2026-09-21T12:00:00.000Z",
          outcome: "committed",
          artifactId: manifest.artifactId,
          versionNumber: 1,
          committedAt: "2026-09-21T12:00:00.000Z",
        },
      };
    },
  };
  return { client, grants, commits, resolves };
}

/** The live-session store the runtime reads through `createSessionProvider`. */
function sessionStore() {
  let fetches = 0;
  return {
    store: {
      ensureFresh: async () => {
        fetches += 1;
        return SESSION;
      },
      forceRefresh: async () => SESSION,
      isStopped: () => false,
    },
    fetches: () => fetches,
  };
}

/** Wraps a provider and records which SANDBOX each create / export-side op was pointed at. */
function sandboxRecorder(inner: SandboxProvider) {
  const digests: string[] = [];
  const exports: string[] = [];
  const created: string[] = [];
  // CLI-012 — the PATH too, not only the sandbox id: which file the producer named is the
  // whole point once a producer exists.
  const digestedPaths: string[] = [];
  const exportedPaths: string[] = [];
  const provider = new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "create") {
        return async (...args: Parameters<SandboxProvider["create"]>) => {
          const r = await target.create(...args);
          created.push(r.sandboxId);
          return r;
        };
      }
      if (prop === "digestArtifact") {
        return (sandboxId: string, ...rest: unknown[]) => {
          digests.push(sandboxId);
          digestedPaths.push(String(rest[0]));
          return (target.digestArtifact as (...a: unknown[]) => unknown)(sandboxId, ...rest);
        };
      }
      if (prop === "exportArtifact") {
        return (sandboxId: string, ...rest: unknown[]) => {
          exports.push(sandboxId);
          exportedPaths.push(String(rest[0]));
          return (target.exportArtifact as (...a: unknown[]) => unknown)(sandboxId, ...rest);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return { provider, digests, exports, created, digestedPaths, exportedPaths };
}

function spyMetrics(): { metrics: Metrics; incs: Array<{ name: string; labels: Record<string, string> }> } {
  const incs: Array<{ name: string; labels: Record<string, string> }> = [];
  const metrics = {
    inc: (name: string, labels: Record<string, string> = {}) => {
      incs.push({ name, labels: { ...labels } });
    },
  } as unknown as Metrics;
  return { metrics, incs };
}

const opOutcomes = (incs: Array<{ labels: Record<string, string> }>, operation: string): string[] =>
  incs.filter((i) => i.labels.operation === operation).map((i) => i.labels.outcome!);

function terminalOf(events: readonly WorkerEventV1[], leaseId: string) {
  const t = events.find((e) => e.eventType === "terminal" && String(e.leaseId) === leaseId);
  if (!t || t.eventType !== "terminal") throw new Error(`no terminal event for ${leaseId}`);
  return t.payload;
}

/** Only `report.targetId`/`deviceGeneration` and the resource ceiling are read at composition. */
const SELF = {
  report: { targetId: POLL_FIXTURE_IDS.target, deviceGeneration: 1 },
  verifiedProviderConstraints: { resourceCeiling: { cpuMillis: 2000, memoryMiB: 4096, diskMiB: 8192 } },
} as unknown as WorkerSelfModel;

// --- the composition harness -----------------------------------------------------------------

interface Composed {
  /** The deps `composeDispatchRuntime` handed to the supervisor factory — exactly as composed. */
  readonly composed: SupervisorDeps;
  /** The REAL supervisor built over them (plus `overlay`, if any). */
  readonly supervisor: ReturnType<typeof createSupervisor>;
  /** How many times the COMPOSED sequencer was invoked by a run. */
  readonly sequencerCalls: () => number;
  readonly key: DeviceKey;
}

/**
 * Compose the dispatch runtime for `lane` and build the REAL supervisor over the deps it passes.
 * The outbox, drain, renewal driver and poll loop are inert stand-ins: the supervisor is driven
 * directly with `accept`, so nothing is polled or uploaded.
 *
 * `overlay` is applied on top of the composed deps. Tests use it ONLY to add a producer; the
 * sequencer that runs is always the one the composition built (wrapped only to count calls).
 */
async function composeLane(input: {
  lane: Lane;
  provider: SandboxProvider;
  client: ReturnType<typeof recordingClient>["client"];
  store: ReturnType<typeof sessionStore>["store"];
  sink: ReturnType<typeof collectingSink>;
  metrics?: Metrics;
  overlay?: Partial<SupervisorDeps>;
  makeRunProviderSpy?: (input: { handoff: LeaseHandoff; capability?: OwnedLabelsCapabilityLike }) => void;
  /** CLI-012 — records every line the COMPOSED runtime logs, so the refusal line is inspectable. */
  logLines?: unknown[];
}): Promise<Composed> {
  const key = generateDeviceKey();
  let composed: SupervisorDeps | null = null;
  let supervisor: ReturnType<typeof createSupervisor> | null = null;
  let calls = 0;
  const laneDeps: Partial<ComposeDispatchRuntimeDeps> =
    input.lane === "desktop"
      ? { provider: input.provider }
      : {
          makeRunProvider: (i) => {
            input.makeRunProviderSpy?.(i);
            return input.provider;
          },
        };
  await composeDispatchRuntime({
    ...laneDeps,
    self: SELF,
    key,
    store: input.store as never,
    client: input.client as never,
    eventOutboxPath: "/tmp/outbox.db",
    concurrency: { batch: 2, browser: 0, service: 0 },
    backoff: { baseMs: 1, maxMs: 2, jitter: 0 } as never,
    workDir: "/tmp",
    metrics: input.metrics,
    logger:
      input.logLines === undefined
        ? undefined
        : ({
            info: (fields: unknown) => input.logLines!.push(fields),
            warn: (fields: unknown) => input.logLines!.push(fields),
            error: (fields: unknown) => input.logLines!.push(fields),
            debug: (fields: unknown) => input.logLines!.push(fields),
          } as never),
    probes: { freeCpuMillis: () => 4000, freeMemoryMiB: () => 8192, freeDiskMiB: () => 16384 },
    openStore: (async () => ({ close: () => {} }) as never) as never,
    makeSink: (() => input.sink) as never,
    makeDrain: (() => ({ recover: () => 0, start: () => {}, stop: () => {}, drainOnce: async () => ({}), flush: async () => {} }) as never) as never,
    makeSupervisor: ((d: SupervisorDeps) => {
      composed = d;
      const sequencer = d.exportArtifacts;
      const counted: ArtifactExportSequencer | undefined =
        sequencer === undefined
          ? undefined
          : (i) => {
              calls += 1;
              return sequencer(i);
            };
      supervisor = createSupervisor({ ...d, exportArtifacts: counted, ...input.overlay });
      return supervisor;
    }) as never,
    makeDriver: (() => ({ accept: () => {}, stop: () => {}, activeRenewalCount: () => 0, proxyFor: () => undefined }) as never) as never,
    makePollLoop: (() => ({ run: async () => ({ kind: "stopped" }), stopLeasing: () => {}, drain: async () => {}, activeLeaseCount: () => 0 }) as never) as never,
    makeSchedule: (() => ({}) as never) as never,
  });
  return { composed: composed!, supervisor: supervisor!, sequencerCalls: () => calls, key };
}

function exportingProvider(): SandboxProvider {
  // ★ CLI-012 — it must also ENUMERATE, or the composed producer has nothing to look at.
  return createFakeSandboxProvider({
    artifactExportMode: "grant_upload",
    sandboxEnumerationMode: "metadata",
    artifactFiles: { [PATH]: BODY },
  });
}

/** CLI-012 anti-vacuity control: enumerates, and finds NOTHING under the output root. */
function emptyOutputProvider(): SandboxProvider {
  return createFakeSandboxProvider({ artifactExportMode: "grant_upload", sandboxEnumerationMode: "metadata" });
}

// --- 1. both lanes receive the sequencer AND the producer ---------------------------------------

describe("DAT-009-3d/CLI-012 — composeDispatchRuntime passes BOTH halves to the supervisor", () => {
  it.each<Lane>(["desktop", "container"])("★ %s lane: exportArtifacts AND resolveExportArtifacts are composed", async (lane) => {
    const provider = exportingProvider();
    const { composed } = await composeLane({
      lane,
      provider,
      client: recordingClient().client,
      store: sessionStore().store,
      sink: collectingSink(),
    });
    expect(typeof composed.exportArtifacts).toBe("function");
    // ★ CLI-012 — the producer is composed. (Superseded assertion:
    // `expect(composed.resolveExportArtifacts).toBeUndefined();`, with the comment "The producer
    // is CLI-012's. Composing one here — even a `[]` stub — is what E5-D03 forbids." The E5-D03
    // prohibition was on a `[]` STUB, and this is the real producer.)
    expect(typeof composed.resolveExportArtifacts).toBe("function");
    // The lane's own provider path is passed through, and only that one.
    if (lane === "desktop") {
      expect(composed.provider).toBe(provider);
      expect(composed.makeRunProvider).toBeUndefined();
    } else {
      expect(composed.provider).toBeUndefined();
      expect(typeof composed.makeRunProvider).toBe("function");
      expect(typeof composed.materializeRunSecrets).toBe("function");
    }
  });

  it("★ the composed sequencer is bound to THIS runtime's client, device key and live session", async () => {
    const c = recordingClient();
    const s = sessionStore();
    const { composed, key } = await composeLane({ lane: "desktop", provider: exportingProvider(), client: c.client, store: s.store, sink: collectingSink() });
    const exporter: SandboxArtifactExporter = {
      digest: async () => ({ sha256: createHash("sha256").update(BODY).digest("hex"), sizeBytes: Buffer.byteLength(BODY) }),
      export: async (_path, grant) => ({ objectKey: grant.objectKey }),
    };
    const outcome = await composed.exportArtifacts!({ handoff: handoffFor(TENANT_A, "desktop"), exporter, requests: [REQUEST] });

    expect(outcome.failures).toEqual([]);
    expect(outcome.exported).toHaveLength(1);
    expect(c.grants).toHaveLength(1);
    expect(c.commits).toHaveLength(1);
    // The live session, read at call time through the runtime's session provider.
    expect(s.fetches()).toBeGreaterThan(0);
    for (const r of [...c.grants, ...c.commits]) {
      expect(r.sessionToken).toBe(SESSION.token);
      // Signed with the runtime's DEVICE key: its public key rides the proof headers.
      expect(Object.values(r.proofHeaders)).toContain(key.publicKeyDer);
    }
  });

  it("nothing to export ⇒ the composed sequencer fetches no session and calls no route", async () => {
    const c = recordingClient();
    const s = sessionStore();
    const { composed } = await composeLane({ lane: "desktop", provider: exportingProvider(), client: c.client, store: s.store, sink: collectingSink() });
    const fetchesAtComposition = s.fetches();
    const exporter: SandboxArtifactExporter = {
      digest: async () => {
        throw new Error("must not digest");
      },
      export: async () => {
        throw new Error("must not export");
      },
    };
    await expect(
      composed.exportArtifacts!({ handoff: handoffFor(TENANT_A, "desktop"), exporter, requests: [] }),
    ).resolves.toEqual({ exported: [], failures: [] });
    expect(s.fetches()).toBe(fetchesAtComposition);
    expect(c.grants).toHaveLength(0);
    expect(c.commits).toHaveLength(0);
  });
});

// --- 2. composed with no producer, no run calls the sequencer --------------------------------

describe("CLI-012 — the composed pair drives the WHOLE sequence on a real run (why E5-2 is wired)", () => {
  it.each<Lane>(["desktop", "container"])(
    "★★★ %s lane: a real run enumerates the output root and COMMITS what it finds",
    async (lane) => {
      const c = recordingClient();
      const rec = sandboxRecorder(exportingProvider());
      const sink = collectingSink();
      const { metrics, incs } = spyMetrics();
      const { composed, supervisor, sequencerCalls } = await composeLane({
        lane,
        provider: rec.provider,
        client: c.client,
        store: sessionStore().store,
        sink,
        metrics,
      });
      // ★ Both halves really are composed — this is the wiring `E5-2` records, and everything
      // below is a consequence of it rather than of a test overlay.
      // (Superseded describe + body: "DAT-009-3d — built at boot, run by nothing (why E5-2 stays
      // unwired)", which asserted `sequencerCalls()` was 0 and no grant/commit was made.)
      expect(typeof composed.exportArtifacts).toBe("function");
      expect(typeof composed.resolveExportArtifacts).toBe("function");

      const handoff = handoffFor(TENANT_A, lane);
      await supervisor.accept(handoff);

      // The run really ran to its normal terminal (the window's only site)...
      expect(rec.created).toHaveLength(1);
      expect(terminalOf(sink.events, handoff.leaseId)).toMatchObject({ status: "succeeded", exitCode: 0 });
      if (lane === "container") expect(c.resolves).toHaveLength(1); // the composed redemption ran
      // ...and the export window ran the whole four-step sequence for the one planted file.
      expect(sequencerCalls()).toBe(1);
      expect(rec.digests).toHaveLength(1);
      expect(rec.exports).toHaveLength(1);
      expect(rec.digestedPaths).toEqual([PATH]);
      expect(rec.exportedPaths).toEqual([PATH]);
      expect(c.grants).toHaveLength(1);
      expect(c.commits).toHaveLength(1);
      expect(opOutcomes(incs, "export_artifact")).toEqual(["success"]);
      expect(opOutcomes(incs, "digest_artifact")).toEqual(["success"]);

      // The committed object key is THIS attempt's, derived from the handoff (F10).
      const manifest = (c.commits[0]!.body as Record<string, unknown>).manifest as Record<string, unknown>;
      expect(String(manifest.objectKey)).toContain(
        expectedAttemptObjectPrefix({
          organizationId: TENANT_A.org,
          jobId: TENANT_A.job,
          attempt: 1,
        }),
      );
      // ★ E7-D08 — the kind the production composition declares, asserted at the COMMIT, so a
      // silent change of it reds here and not only at the producer's unit.
      expect(manifest.kind).toBe("other");
    },
  );

  it.each<Lane>(["desktop", "container"])(
    "★ ANTI-VACUITY %s lane: an empty output root mints NOTHING — no grant, no commit, no row",
    async (lane) => {
      const c = recordingClient();
      const rec = sandboxRecorder(emptyOutputProvider());
      const sink = collectingSink();
      const { metrics, incs } = spyMetrics();
      const { supervisor, sequencerCalls } = await composeLane({
        lane,
        provider: rec.provider,
        client: c.client,
        store: sessionStore().store,
        sink,
        metrics,
      });
      const handoff = handoffFor(TENANT_A, lane);
      await supervisor.accept(handoff);

      // NON-VACUITY: the run really ran and the window really opened — the sequencer was called.
      expect(rec.created).toHaveLength(1);
      expect(terminalOf(sink.events, handoff.leaseId)).toMatchObject({ status: "succeeded", exitCode: 0 });
      expect(sequencerCalls()).toBe(1);
      // And it did nothing durable: since DAT-009 slice 2 a mint writes a `granted` row, so a
      // speculative one on every no-output run would be litter on every run in the fleet.
      expect(c.grants).toHaveLength(0);
      expect(c.commits).toHaveLength(0);
      expect(rec.digests).toHaveLength(0);
      expect(rec.exports).toHaveLength(0);
      expect(opOutcomes(incs, "digest_artifact")).toEqual([]);
      expect(opOutcomes(incs, "export_artifact")).toEqual(["success"]);
    },
  );
});

// --- 3. F10: two Organizations, concurrent, through the COMPOSED sequencer -------------------

describe("DAT-009-3d — F10: the composed sequencer is per-run bound", () => {
  it.each<Lane>(["desktop", "container"])(
    "★ %s lane: two Organizations' concurrent runs each export only under their own attempt prefix",
    async (lane) => {
      const c = recordingClient();
      const rec = sandboxRecorder(exportingProvider());
      const sink = collectingSink();
      const providerHandoffs: string[] = [];
      // Hold each window until BOTH runs reach it, so any runtime-scoped binding (a first or last
      // handoff, a shared sandbox) would cross the two Organizations.
      let arrived = 0;
      let releaseAll!: () => void;
      const bothArrived = new Promise<void>((r) => {
        releaseAll = r;
      });
      const { supervisor, sequencerCalls } = await composeLane({
        lane,
        provider: rec.provider,
        client: c.client,
        store: sessionStore().store,
        sink,
        makeRunProviderSpy: ({ handoff, capability }) => {
          // The container lane's per-run driver is built over THIS run's own capability.
          expect(capability?.ownedLabels.leaseId).toBe(handoff.leaseId);
          providerHandoffs.push(handoff.leaseId);
        },
        // ★ The ONLY addition: a test producer. Production has none until CLI-012.
        overlay: {
          resolveExportArtifacts: async () => {
            arrived += 1;
            if (arrived === 2) releaseAll();
            await bothArrived;
            return [REQUEST];
          },
        },
      });

      const handoffA = handoffFor(TENANT_A, lane);
      const handoffB = handoffFor(TENANT_B, lane);
      await Promise.all([supervisor.accept(handoffA), supervisor.accept(handoffB)]);

      expect(sequencerCalls()).toBe(2);
      if (lane === "container") expect([...providerHandoffs].sort()).toEqual([TENANT_A.lease, TENANT_B.lease].sort());

      // Each run's digest and export reached only its OWN sandbox.
      expect(rec.created).toHaveLength(2);
      const sbxA = rec.created.find((s) => s.includes(TENANT_A.lease))!;
      const sbxB = rec.created.find((s) => s.includes(TENANT_B.lease))!;
      expect(sbxA).toBeDefined();
      expect(sbxB).toBeDefined();
      expect(sbxA).not.toBe(sbxB);
      expect([...rec.digests].sort()).toEqual([sbxA, sbxB].sort());
      expect([...rec.exports].sort()).toEqual([sbxA, sbxB].sort());

      // Each grant asks for a key under its OWN Organization/job/attempt prefix — the same-tenant
      // positive control (A under A) and the cross-tenant check (never A under B, or B under A).
      const prefixA = expectedAttemptObjectPrefix({ organizationId: TENANT_A.org, jobId: TENANT_A.job, attempt: handoffA.offer.job.attempt });
      const prefixB = expectedAttemptObjectPrefix({ organizationId: TENANT_B.org, jobId: TENANT_B.job, attempt: handoffB.offer.job.attempt });
      expect(prefixA).not.toBe(prefixB);
      const grantByLease = new Map(c.grants.map((g) => [String(g.body.leaseId), String(g.body.expectedObjectKey)]));
      expect(c.grants).toHaveLength(2);
      expect(grantByLease.get(TENANT_A.lease)!.startsWith(prefixA)).toBe(true);
      expect(grantByLease.get(TENANT_B.lease)!.startsWith(prefixB)).toBe(true);
      expect(grantByLease.get(TENANT_A.lease)!.startsWith(prefixB)).toBe(false);
      expect(grantByLease.get(TENANT_B.lease)!.startsWith(prefixA)).toBe(false);

      // Each commit carries its own Organization and the key its own grant named.
      expect(c.commits).toHaveLength(2);
      for (const commit of c.commits) {
        const lease = String(commit.body.leaseId);
        const manifest = commit.body.manifest as Record<string, unknown>;
        expect(manifest.organizationId).toBe(lease === TENANT_A.lease ? TENANT_A.org : TENANT_B.org);
        expect(String(manifest.objectKey).startsWith(lease === TENANT_A.lease ? prefixA : prefixB)).toBe(true);
      }

      // Export is evidence, not the verdict: both runs still report the command's own result.
      expect(terminalOf(sink.events, handoffA.leaseId)).toMatchObject({ status: "succeeded", exitCode: 0 });
      expect(terminalOf(sink.events, handoffB.leaseId)).toMatchObject({ status: "succeeded", exitCode: 0 });
    },
  );
});

// ---------------------------------------------------------------------------------------
// CLI-012 — the COMPOSED producer's refusals are visible, and PATH-FREE.
//
// ★ WHY IT MATTERS THAT THEY ARE VISIBLE AT ALL. Without a log line, a run whose only deliverable
// was a symlink or an oversized file exports nothing and says nothing — indistinguishable from a
// run that wrote nothing, which is the exact ambiguity `E5-D07`'s per-file classification exists to
// remove. ★ And why it matters that the line is path-free: the paths are tenant-authored, and the
// port's observability rule forbids a path, a byte, a grant url or file content in any log line.
// ---------------------------------------------------------------------------------------

describe("CLI-012 — the composed producer logs each refusal with a closed reason and no path", () => {
  it("★★★ a symlink and an oversized file are refused, logged, and the good file still commits", async () => {
    const CANARY = "/home/user/aoa-output/sk-ant-canary-link.md";
    const HUGE = "/home/user/aoa-output/huge.bin";
    const c = recordingClient();
    const logLines: unknown[] = [];
    const rec = sandboxRecorder(
      createFakeSandboxProvider({
        artifactExportMode: "grant_upload",
        sandboxEnumerationMode: "metadata",
        artifactFiles: {
          [CANARY]: "PROMPT",
          [HUGE]: "x".repeat(26 * 1024 * 1024),
          [PATH]: BODY,
        },
        artifactSymlinks: [CANARY],
      }),
    );
    const { supervisor } = await composeLane({
      lane: "desktop",
      provider: rec.provider,
      client: c.client,
      store: sessionStore().store,
      sink: collectingSink(),
      logLines,
    });
    await supervisor.accept(handoffFor(TENANT_A, "desktop"));

    // NON-VACUITY: the good file really did go all the way through.
    expect(rec.digestedPaths).toEqual([PATH]);
    expect(c.commits).toHaveLength(1);
    // Neither refused file was ever digested — refused BEFORE any read, which is the point.
    expect(rec.digestedPaths).not.toContain(CANARY);
    expect(rec.digestedPaths).not.toContain(HUGE);

    const refusals = logLines.filter(
      (l): l is { reason: string } =>
        typeof l === "object" && l !== null && "reason" in l && typeof (l as { reason: unknown }).reason === "string",
    );
    expect(refusals.map((l) => l.reason)).toEqual(
      expect.arrayContaining(["output_symlink_refused", "output_too_large"]),
    );
    // ★ PATH-FREE, asserted over EVERYTHING the composed runtime logged, not only the refusal lines.
    const everything = JSON.stringify(logLines);
    expect(everything).not.toContain(CANARY);
    expect(everything).not.toContain(HUGE);
    expect(everything).not.toContain("sk-ant-canary");
    expect(everything).not.toContain("aoa-output");
  });
});
