// DAT-009 slice 3c — the supervisor's artifact-export hook (E5-D07).
//
// The hook composes two things that live on opposite sides of a boundary:
//   * `exportArtifacts` — the sequencer, built by the DISPATCH RUNTIME from the control-plane
//     client, device key and session (slice 3d composes it); and
//   * `resolveExportArtifacts` — the producer (CLI-012), which names what to export;
// and supplies the third input itself: a per-run exporter bound to THIS run's sandbox through
// THIS run's `EffectAuthority`, so the fence gate stays at the boundary.
//
// ★ What these cases pin (docs/replatform/epics/E5-workspaces-secrets/decisions.md, E5-D07):
//   1. the window runs once, after `observeRun` and before the normal terminal;
//   2. hook absent ⇒ nothing runs and the lifecycle is byte-identical (the anti-vacuity control);
//   3. a failed or timed-out export does NOT fail the attempt — the terminal is the command's;
//   4. a withdrawn authority refuses before the grant reaches any provider;
//   5. no log line or metric label carries a path, a grant url, or bytes;
//   6. F10 — two tenants in one supervisor: each window is bound to its own lease and sandbox;
//   7. the networked lane clamps the budget so destroy keeps its teardown headroom.

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { ArtifactUploadGrantV1, WorkerEventV1 } from "@armyofagents/worker-protocol";

import {
  ArtifactExportFailedError,
  createArtifactExportSequencer,
  type ArtifactExportRequest,
  type ArtifactExportSequencer,
  type SandboxArtifactExporter,
} from "../lease/artifact-export.js";
import { EffectAuthorityWithdrawnError } from "../supervisor/effect-authority.js";
import { createSupervisor, type SupervisorDeps } from "../supervisor/supervisor.js";
import type { SandboxProvider } from "../supervisor/provider.js";
import type { Logger } from "../logging/logger.js";
import type { Metrics } from "../metrics/metrics.js";
import type { LeaseHandoff } from "../poll/poll-loop.js";
import type { OwnedLabelsCapabilityLike } from "../lease/owned-labels-capability.js";
import { generateDeviceKey } from "../identity/device-key.js";
import type { WorkerSession } from "../enrollment/enroll.js";
import { createFakeSandboxProvider, type FakeSandboxProvider } from "./support/fake-provider.js";
import { compatibleOffer, POLL_FIXTURE_IDS } from "./support/poll-fixtures.js";
import { collectingSink, handoffLabels, makeGate, makeHandoff, SUPERVISOR_IDENTITY, waitFor } from "./support/supervisor-fixtures.js";

const PATH = "/home/user/aoa-output/secret-project-name.patch";
const BODY = "diff --git a/a.txt b/a.txt\n";
const SHA = createHash("sha256").update(BODY).digest("hex");
const GRANT_URL = "https://store.example/put?X-Amz-Signature=SECRETSIGNATURE";
const REQUEST: ArtifactExportRequest = { path: PATH, kind: "workspace_patch", contentType: "text/plain", retention: "run" };
const SESSION: WorkerSession = { token: "session-token", expiresAt: new Date(Date.now() + 600_000) } as never;

// --- doubles -------------------------------------------------------------------------------

function spyLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const rec = (...args: unknown[]): void => {
    lines.push(JSON.stringify(args));
  };
  const logger = {
    info: (...a: unknown[]) => rec("info", ...a),
    warn: (...a: unknown[]) => rec("warn", ...a),
    error: (...a: unknown[]) => rec("error", ...a),
    debug: (...a: unknown[]) => rec("debug", ...a),
    flush: async () => {},
  } as unknown as Logger;
  return { logger, lines };
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

function opOutcomes(incs: Array<{ labels: Record<string, string> }>, operation: string): string[] {
  return incs.filter((i) => i.labels.operation === operation).map((i) => i.labels.outcome!);
}

function exportingProvider(files: Record<string, string> = { [PATH]: BODY }): FakeSandboxProvider {
  return createFakeSandboxProvider({ artifactExportMode: "grant_upload", artifactFiles: files });
}

/** Wraps a provider and records which SANDBOX each export-side op was pointed at. */
function sandboxRecorder(inner: SandboxProvider): {
  provider: SandboxProvider;
  digests: string[];
  exports: string[];
  created: string[];
} {
  const digests: string[] = [];
  const exports: string[] = [];
  const created: string[] = [];
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
          return (target.digestArtifact as (...a: unknown[]) => unknown)(sandboxId, ...rest);
        };
      }
      if (prop === "exportArtifact") {
        return (sandboxId: string, ...rest: unknown[]) => {
          exports.push(sandboxId);
          return (target.exportArtifact as (...a: unknown[]) => unknown)(sandboxId, ...rest);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return { provider, digests, exports, created };
}

/** A control-plane double for the REAL sequencer: grants what it is asked, records bodies. */
function echoClient(script: { grantRejectReason?: string } = {}) {
  const grantBodies: Array<Record<string, unknown>> = [];
  const commitBodies: Array<Record<string, unknown>> = [];
  return {
    grantBodies,
    commitBodies,
    client: {
      artifactTransferGrantPath: "/api/worker-control/artifact-transfer-grants",
      artifactCommitPath: "/api/worker-control/artifact-commits",
      async artifactTransferGrant(request: { bytes: Buffer }) {
        const parsed = JSON.parse(request.bytes.toString("utf8")) as Record<string, unknown>;
        const body = parsed.body as Record<string, unknown>;
        grantBodies.push(body);
        if (script.grantRejectReason) {
          return { status: 200, body: { protocolVersion: 1, outcome: "rejected", reason: script.grantRejectReason } };
        }
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
      async artifactCommit(request: { bytes: Buffer }) {
        const parsed = JSON.parse(request.bytes.toString("utf8")) as Record<string, unknown>;
        const body = parsed.body as Record<string, unknown>;
        commitBodies.push(body);
        const manifest = body.manifest as Record<string, unknown>;
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
    },
  };
}

function realSequencer(c: ReturnType<typeof echoClient>): ArtifactExportSequencer {
  return createArtifactExportSequencer({ client: c.client as never, key: generateDeviceKey(), session: async () => SESSION });
}

/** A handoff for a SECOND Organization: every tenant/attempt identity differs from `makeHandoff()`. */
function makeTenantBHandoff(): LeaseHandoff {
  const base = compatibleOffer();
  const job = base.job as Record<string, unknown>;
  return makeHandoff({
    leaseId: "00000000-0000-4000-8000-0000000000b5",
    job: {
      ...job,
      jobId: "00000000-0000-4000-8000-0000000000b3",
      organizationId: "00000000-0000-4000-8000-0000000000b2",
      companyId: "00000000-0000-4000-8000-0000000000b4",
    },
  });
}

function baseDeps(extra: Partial<SupervisorDeps> & { provider?: SandboxProvider } = {}): SupervisorDeps {
  return {
    provider: extra.provider ?? exportingProvider(),
    identity: SUPERVISOR_IDENTITY,
    eventSink: collectingSink(),
    redactionCanaries: [],
    ...extra,
  } as SupervisorDeps;
}

function terminalOf(events: readonly WorkerEventV1[]) {
  const t = events.find((e) => e.eventType === "terminal");
  if (!t || t.eventType !== "terminal") throw new Error("no terminal event");
  return t.payload;
}

// --- 1. placement ------------------------------------------------------------------------

describe("DAT-009-3c — the export window's placement", () => {
  it("★ hook present ⇒ the producer and the sequencer each run ONCE, after observeRun and before terminal", async () => {
    const sink = collectingSink();
    const order: string[] = [];
    const handoff = makeHandoff();
    let seenHandoff: LeaseHandoff | null = null;
    let eventsAtSequencer: string[] = [];
    const producerCalls: unknown[] = [];
    const sequencer: ArtifactExportSequencer = async (input) => {
      order.push("sequencer");
      seenHandoff = input.handoff;
      eventsAtSequencer = sink.events.map((e) => e.eventType);
      expect(input.requests).toEqual([REQUEST]);
      return [];
    };
    const { metrics, incs } = spyMetrics();
    const supervisor = createSupervisor(
      baseDeps({
        eventSink: sink,
        metrics,
        observeRun: () => {
          order.push("observeRun");
          return { usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, runtimeMillis: 1 } };
        },
        resolveExportArtifacts: async (input) => {
          order.push("producer");
          producerCalls.push(input);
          expect(input.exec.exitCode).toBe(0);
          return [REQUEST];
        },
        exportArtifacts: sequencer,
      }),
    );

    await supervisor.accept(handoff);

    expect(order).toEqual(["observeRun", "producer", "sequencer"]);
    expect(producerCalls).toHaveLength(1);
    expect(seenHandoff).toBe(handoff);
    // usage is already in the outbox when export starts; the terminal is not.
    expect(eventsAtSequencer).toEqual(["attempt_started", "usage"]);
    expect(sink.events.map((e) => e.eventType)).toEqual(["attempt_started", "usage", "terminal"]);
    expect(opOutcomes(incs, "export_artifact")).toEqual(["success"]);
  });

  it("★ runs BEFORE destroy — the sandbox is still alive while the window is open", async () => {
    const fake = exportingProvider();
    let destroysAtSequencer = -1;
    const supervisor = createSupervisor(
      baseDeps({
        provider: fake,
        resolveExportArtifacts: async () => [REQUEST],
        exportArtifacts: async () => {
          destroysAtSequencer = fake.callCount("destroy");
          return [];
        },
      }),
    );
    await supervisor.accept(makeHandoff());
    expect(destroysAtSequencer).toBe(0);
    expect(fake.callCount("destroy")).toBe(1);
  });

  it("the REAL sequencer, end to end through the per-run exporter: digest → grant → export → commit", async () => {
    const fake = exportingProvider();
    const c = echoClient();
    const { metrics, incs } = spyMetrics();
    const sink = collectingSink();
    const supervisor = createSupervisor(
      baseDeps({
        provider: fake,
        eventSink: sink,
        metrics,
        resolveExportArtifacts: async () => [REQUEST],
        exportArtifacts: realSequencer(c),
      }),
    );
    await supervisor.accept(makeHandoff());

    // The digest the grant was minted against came from the SANDBOX (via run.effect), not the producer.
    expect(c.grantBodies).toHaveLength(1);
    expect(c.grantBodies[0]!.expectedSha256).toBe(SHA);
    expect(c.commitBodies).toHaveLength(1);
    expect((fake as unknown as { exportedObjectKeys: string[] }).exportedObjectKeys).toEqual([
      c.grantBodies[0]!.expectedObjectKey,
    ]);
    expect(opOutcomes(incs, "digest_artifact")).toEqual(["success"]);
    expect(opOutcomes(incs, "export_artifact")).toEqual(["success"]);
    expect(terminalOf(sink.events).status).toBe("succeeded");
  });
});

// --- 2. absent ⇒ inert -------------------------------------------------------------------

describe("DAT-009-3c — hook absent is byte-identical (anti-vacuity control)", () => {
  it("neither dep ⇒ no call, no export metric, attempt_started → terminal", async () => {
    const fake = exportingProvider();
    const sink = collectingSink();
    const { metrics, incs } = spyMetrics();
    const supervisor = createSupervisor(baseDeps({ provider: fake, eventSink: sink, metrics }));
    await supervisor.accept(makeHandoff());
    expect(sink.events.map((e) => e.eventType)).toEqual(["attempt_started", "terminal"]);
    expect(opOutcomes(incs, "export_artifact")).toEqual([]);
    expect(opOutcomes(incs, "digest_artifact")).toEqual([]);
    expect((fake as unknown as { exportedObjectKeys: string[] }).exportedObjectKeys).toEqual([]);
  });

  it("a sequencer WITHOUT a producer is inert: the sequencer is never called and nothing is emitted", async () => {
    let calls = 0;
    const { metrics, incs } = spyMetrics();
    const sink = collectingSink();
    const supervisor = createSupervisor(
      baseDeps({
        eventSink: sink,
        metrics,
        exportArtifacts: async () => {
          calls += 1;
          return [];
        },
      }),
    );
    await supervisor.accept(makeHandoff());
    expect(calls).toBe(0);
    expect(opOutcomes(incs, "export_artifact")).toEqual([]);
    expect(sink.events.map((e) => e.eventType)).toEqual(["attempt_started", "terminal"]);
  });

  it("a producer WITHOUT a sequencer fails fast at construction", () => {
    expect(() => createSupervisor(baseDeps({ resolveExportArtifacts: async () => [REQUEST] }))).toThrow(
      /resolveExportArtifacts requires exportArtifacts/,
    );
  });

  it("only the normal terminal exports: cancelled-while-executing never opens the window (Ruling B)", async () => {
    let producerCalls = 0;
    const gate = makeGate();
    const handoff = makeHandoff();
    const sink = collectingSink();
    const { metrics, incs } = spyMetrics();
    const fake = createFakeSandboxProvider({ artifactExportMode: "grant_upload", executeGate: gate.gate });
    const supervisor = createSupervisor(
      baseDeps({
        provider: fake,
        eventSink: sink,
        metrics,
        resolveExportArtifacts: async () => {
          producerCalls += 1;
          return [REQUEST];
        },
        exportArtifacts: async () => [],
      }),
    );
    const running = supervisor.accept(handoff);
    await waitFor(() => fake.callCount("execute") === 1);
    const cancelling = supervisor.cancel(handoff.leaseId);
    gate.release();
    await Promise.all([running, cancelling]);
    expect(producerCalls).toBe(0);
    // No window at all, not merely a refused one: a window opened here would emit `failed`.
    expect(opOutcomes(incs, "export_artifact")).toEqual([]);
    expect(terminalOf(sink.events).status).toBe("cancelled");
  });
});

// --- 3. E5-D07: best-effort ---------------------------------------------------------------

describe("DAT-009-3c — E5-D07: a failed export does NOT fail the attempt", () => {
  it("★ a sequencer refusal: terminal stays succeeded/exit 0, export_artifact failed, reason logged by name", async () => {
    const sink = collectingSink();
    const { metrics, incs } = spyMetrics();
    const { logger, lines } = spyLogger();
    const c = echoClient({ grantRejectReason: "attempt_terminal" });
    const supervisor = createSupervisor(
      baseDeps({
        eventSink: sink,
        metrics,
        logger,
        resolveExportArtifacts: async () => [REQUEST],
        exportArtifacts: realSequencer(c),
      }),
    );
    await supervisor.accept(makeHandoff());

    const terminal = terminalOf(sink.events);
    expect(terminal.status).toBe("succeeded");
    expect(terminal.exitCode).toBe(0);
    expect(terminal.errorCode).toBeNull();
    expect(opOutcomes(incs, "export_artifact")).toEqual(["failed"]);
    const exportLog = lines.find((l) => l.includes("artifact export"));
    expect(exportLog).toBeDefined();
    expect(exportLog).toContain('"stage":"grant"');
    expect(exportLog).toContain('"reason":"attempt_terminal"');
  });

  it("a producer throw is best-effort too", async () => {
    const sink = collectingSink();
    const { metrics, incs } = spyMetrics();
    let sequencerCalls = 0;
    const supervisor = createSupervisor(
      baseDeps({
        eventSink: sink,
        metrics,
        resolveExportArtifacts: async () => {
          throw new Error(`cannot list ${PATH}`);
        },
        exportArtifacts: async () => {
          sequencerCalls += 1;
          return [];
        },
      }),
    );
    await supervisor.accept(makeHandoff());
    expect(sequencerCalls).toBe(0);
    expect(terminalOf(sink.events).status).toBe("succeeded");
    expect(opOutcomes(incs, "export_artifact")).toEqual(["failed"]);
  });

  it("a refusal does not change a FAILED command's terminal either (the terminal is the command's)", async () => {
    const sink = collectingSink();
    const fake = createFakeSandboxProvider({ artifactExportMode: "grant_upload", exitCode: 3 });
    const supervisor = createSupervisor(
      baseDeps({
        provider: fake,
        eventSink: sink,
        resolveExportArtifacts: async () => [REQUEST],
        exportArtifacts: async () => {
          throw new ArtifactExportFailedError("commit", PATH, "a", "rejected: stale_fence", "stale_fence");
        },
      }),
    );
    const noExport = collectingSink();
    await supervisor.accept(makeHandoff());
    await createSupervisor(baseDeps({ provider: createFakeSandboxProvider({ exitCode: 3 }), eventSink: noExport })).accept(
      makeHandoff(),
    );
    const { status, exitCode, errorCode, errorMessage } = terminalOf(sink.events);
    expect({ status, exitCode, errorCode, errorMessage }).toEqual(
      (({ status: s, exitCode: x, errorCode: c, errorMessage: m }) => ({ status: s, exitCode: x, errorCode: c, errorMessage: m }))(
        terminalOf(noExport.events),
      ),
    );
  });

  it("★ the deadline: a hung sequencer is raced out, emits timed_out, and the terminal is still truthful", async () => {
    const sink = collectingSink();
    const { metrics, incs } = spyMetrics();
    const { logger, lines } = spyLogger();
    const fake = exportingProvider();
    let captured: SandboxArtifactExporter | null = null;
    const supervisor = createSupervisor(
      baseDeps({
        provider: fake,
        eventSink: sink,
        metrics,
        logger,
        exportArtifactsDeadlineMs: 20,
        resolveExportArtifacts: async () => [REQUEST],
        exportArtifacts: (input) => {
          captured = input.exporter;
          return new Promise(() => {}); // never settles
        },
      }),
    );
    await supervisor.accept(makeHandoff());
    expect(opOutcomes(incs, "export_artifact")).toEqual(["timed_out"]);
    expect(terminalOf(sink.events).status).toBe("succeeded");
    expect(lines.some((l) => l.includes('"reason":"deadline"'))).toBe(true);

    // ★ The window LATCH: the abandoned sequencer can no longer reach the sandbox.
    expect(captured).not.toBeNull();
    const before = fake.calls().length;
    await expect(captured!.digest(PATH)).rejects.toThrow(/export window closed/);
    expect(fake.calls().length).toBe(before);
    expect(opOutcomes(incs, "digest_artifact")).toEqual([]);
  });
});

// --- 4. the fence gate ------------------------------------------------------------------

describe("DAT-009-3c — a withdrawn authority refuses before the grant reaches any provider", () => {
  it("★ lease lost mid-window ⇒ export rejects with EffectAuthorityWithdrawnError; the provider never sees the grant", async () => {
    const rec = sandboxRecorder(exportingProvider());
    const handoff = makeHandoff();
    let rejection: unknown = null;
    const supervisorRef: { current: ReturnType<typeof createSupervisor> | null } = { current: null };
    const grant = { objectKey: "k", url: GRANT_URL } as unknown as ArtifactUploadGrantV1;
    const supervisor = createSupervisor(
      baseDeps({
        provider: rec.provider,
        resolveExportArtifacts: async () => [REQUEST],
        exportArtifacts: async ({ exporter }) => {
          await supervisorRef.current!.onLeaseLost(handoff.leaseId);
          try {
            await exporter.export(PATH, grant);
          } catch (err) {
            rejection = err;
          }
          return [];
        },
      }),
    );
    supervisorRef.current = supervisor;
    await supervisor.accept(handoff);
    expect(rejection).toBeInstanceOf(EffectAuthorityWithdrawnError);
    expect(rec.exports).toEqual([]);
  });

  it("authority already withdrawn when the window opens ⇒ the producer is not called; failed", async () => {
    const handoff = makeHandoff();
    const { metrics, incs } = spyMetrics();
    let producerCalls = 0;
    const supervisorRef: { current: ReturnType<typeof createSupervisor> | null } = { current: null };
    const supervisor = createSupervisor(
      baseDeps({
        metrics,
        observeRun: async () => {
          await supervisorRef.current!.onLeaseLost(handoff.leaseId);
          return {};
        },
        resolveExportArtifacts: async () => {
          producerCalls += 1;
          return [REQUEST];
        },
        exportArtifacts: async () => [],
      }),
    );
    supervisorRef.current = supervisor;
    await supervisor.accept(handoff);
    expect(producerCalls).toBe(0);
    expect(opOutcomes(incs, "export_artifact")).toEqual(["failed"]);
  });
});

// --- 5. no path / url / bytes -------------------------------------------------------------

describe("DAT-009-3c — no log line or metric label carries a path, a grant url, or bytes", () => {
  it("★ across success, refusal and throw", async () => {
    for (const variant of ["success", "refused", "throws"] as const) {
      const { logger, lines } = spyLogger();
      const { metrics, incs } = spyMetrics();
      const c = echoClient(variant === "refused" ? { grantRejectReason: "stale_fence" } : {});
      const exportArtifacts: ArtifactExportSequencer =
        variant === "throws"
          ? async () => {
              throw new Error(`boom at ${PATH} via ${GRANT_URL} with ${BODY}`);
            }
          : realSequencer(c);
      const supervisor = createSupervisor(
        baseDeps({ logger, metrics, resolveExportArtifacts: async () => [REQUEST], exportArtifacts }),
      );
      await supervisor.accept(makeHandoff());
      const everything = JSON.stringify(lines) + JSON.stringify(incs);
      expect(everything, variant).not.toContain(PATH);
      expect(everything, variant).not.toContain("secret-project-name");
      expect(everything, variant).not.toContain("SECRETSIGNATURE");
      expect(everything, variant).not.toContain(BODY.trim());
    }
  });

  it("ArtifactExportFailedError carries a path-free reason; the message still names the path for its thrower", async () => {
    const c = echoClient({ grantRejectReason: "stale_fence" });
    const seq = realSequencer(c);
    const exporter: SandboxArtifactExporter = {
      digest: async () => ({ sha256: SHA, sizeBytes: Buffer.byteLength(BODY) }),
      export: async () => ({ objectKey: "x" }),
    };
    const err = await seq({ handoff: makeHandoff(), exporter, requests: [REQUEST] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArtifactExportFailedError);
    expect((err as ArtifactExportFailedError).reason).toBe("stale_fence");
    expect((err as ArtifactExportFailedError).stage).toBe("grant");

    const digestErr = await seq({
      handoff: makeHandoff(),
      exporter: { ...exporter, digest: async () => Promise.reject(new Error(`ENOENT ${PATH}`)) },
      requests: [REQUEST],
    }).catch((e: unknown) => e);
    expect((digestErr as ArtifactExportFailedError).reason).toBe("digest_failed");
    expect((digestErr as ArtifactExportFailedError).reason).not.toContain(PATH);
  });
});

// --- 6. F10: attempt-bound across tenants ---------------------------------------------------

describe("DAT-009-3c — F10: each window is bound to its own lease and sandbox", () => {
  it("★ two Organizations, concurrent windows: each exporter reaches only its own sandbox; keys carry its own org", async () => {
    const rec = sandboxRecorder(
      createFakeSandboxProvider({ artifactExportMode: "grant_upload", artifactFiles: { [PATH]: BODY } }),
    );
    const c = echoClient();
    const inner = realSequencer(c);
    const handoffA = makeHandoff();
    const handoffB = makeTenantBHandoff();
    const seen: Array<{ lease: string; org: string }> = [];
    // Hold each window until BOTH sandboxes exist, so a "last created sandbox" binding would
    // cross the runs: A's window then runs after B's sandbox was created.
    let arrived = 0;
    let releaseAll!: () => void;
    const bothArrived = new Promise<void>((r) => {
      releaseAll = r;
    });
    const supervisor = createSupervisor(
      baseDeps({
        provider: rec.provider,
        resolveExportArtifacts: async ({ handoff }) => {
          arrived += 1;
          if (arrived === 2) releaseAll();
          await bothArrived;
          seen.push({ lease: handoff.leaseId, org: String(handoff.offer.job.organizationId) });
          return [REQUEST];
        },
        exportArtifacts: (input) => inner(input),
      }),
    );
    await Promise.all([supervisor.accept(handoffA), supervisor.accept(handoffB)]);

    expect(rec.created).toHaveLength(2);
    const [sbxA, sbxB] = [rec.created.find((s) => s.includes(POLL_FIXTURE_IDS.lease))!, rec.created.find((s) => s.includes(handoffB.leaseId))!];
    expect(sbxA).toBeDefined();
    expect(sbxB).toBeDefined();
    expect(sbxA).not.toBe(sbxB);
    // one digest + one export per run, each on its OWN sandbox
    expect([...rec.digests].sort()).toEqual([sbxA, sbxB].sort());
    expect([...rec.exports].sort()).toEqual([sbxA, sbxB].sort());

    // Same-tenant positive control + cross-tenant: each grant/commit carries its own tenant identity.
    const orgA = POLL_FIXTURE_IDS.org;
    const orgB = String(handoffB.offer.job.organizationId);
    const grantKeys = c.grantBodies.map((b) => String(b.expectedObjectKey));
    expect(grantKeys.filter((k) => k.startsWith(`organizations/${orgA}/jobs/${POLL_FIXTURE_IDS.job}/`))).toHaveLength(1);
    expect(grantKeys.filter((k) => k.startsWith(`organizations/${orgB}/jobs/${String(handoffB.offer.job.jobId)}/`))).toHaveLength(1);
    const byLease = new Map(c.commitBodies.map((b) => [String(b.leaseId), (b.manifest as Record<string, unknown>).organizationId]));
    expect(byLease.get(handoffA.leaseId)).toBe(orgA);
    expect(byLease.get(handoffB.leaseId)).toBe(orgB);
    expect(seen).toHaveLength(2);
  });
});

// --- 7. networked: the budget never eats the teardown headroom -------------------------------

describe("DAT-009-3c — networked lane: the export budget is clamped inside the capability window", () => {
  const T0 = 1_800_000_000_000;
  function capLike(expiresAt: number): OwnedLabelsCapabilityLike {
    return { v: 1, audience: "adapter-manager", ownedLabels: handoffLabels(), expiresAt, sig: "sig" };
  }
  function networkedDeps(capExpiresAt: number, extra: Partial<SupervisorDeps>, scheduled: number[]): SupervisorDeps {
    return {
      makeRunProvider: () => exportingProvider(),
      materializeRunSecrets: async () => ({ env: {}, canaries: [], capability: capLike(capExpiresAt) }),
      identity: SUPERVISOR_IDENTITY,
      eventSink: collectingSink(),
      redactionCanaries: [],
      now: () => T0,
      setTimeoutFn: (fn, ms) => {
        scheduled.push(ms);
        return setTimeout(fn, ms);
      },
      ...extra,
    } as SupervisorDeps;
  }

  it("★ the window's deadline is min(30 s, capExpiresAt − now − 30 s)", async () => {
    const scheduled: number[] = [];
    const supervisor = createSupervisor(
      networkedDeps(T0 + 40_000, { resolveExportArtifacts: async () => [REQUEST], exportArtifacts: async () => [] }, scheduled),
    );
    await supervisor.accept(makeHandoff());
    expect(scheduled[scheduled.length - 1]).toBe(10_000);
  });

  it("★ no room left for destroy ⇒ the window is not opened (failed, export_window_exhausted)", async () => {
    const scheduled: number[] = [];
    const { metrics, incs } = spyMetrics();
    const { logger, lines } = spyLogger();
    let producerCalls = 0;
    const supervisor = createSupervisor(
      networkedDeps(
        T0 + 20_000,
        {
          metrics,
          logger,
          resolveExportArtifacts: async () => {
            producerCalls += 1;
            return [REQUEST];
          },
          exportArtifacts: async () => [],
        },
        scheduled,
      ),
    );
    await supervisor.accept(makeHandoff());
    expect(producerCalls).toBe(0);
    expect(opOutcomes(incs, "export_artifact")).toEqual(["failed"]);
    expect(lines.some((l) => l.includes('"reason":"export_window_exhausted"'))).toBe(true);
  });

  it("the desktop lane is NOT clamped (positive control for the clamp's scope)", async () => {
    const scheduled: number[] = [];
    const supervisor = createSupervisor(
      baseDeps({
        now: () => T0,
        setTimeoutFn: (fn, ms) => {
          scheduled.push(ms);
          return setTimeout(fn, ms);
        },
        resolveExportArtifacts: async () => [REQUEST],
        exportArtifacts: async () => [],
      }),
    );
    await supervisor.accept(makeHandoff());
    expect(scheduled[scheduled.length - 1]).toBe(30_000);
  });
});
