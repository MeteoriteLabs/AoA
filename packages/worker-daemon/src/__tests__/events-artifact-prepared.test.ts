// CLI-013 — the ANNOUNCEMENT: `EventSequencer.artifactPrepared`, and its placement on the
// sequencer-completion / supervisor path.
//
// ★★★ WHAT THIS IS NOT. It is not a supply mechanism and it is not proof that output landed.
// `countProducedOutputs` reads `job_artifacts` directly and joins no events, so a committed
// artifact counts whether or not anything announced it. Nothing here moves `capabilityProven`.
//
// What these cases pin:
//   1. the emitter exists and obeys the SAME contract as every sibling — contiguous `seq`,
//      per-event `eventDigest`, a parse against the FROZEN `workerEventV1Schema`;
//   2. E7-D12 (FATAL) — a sink failure on `artifact_prepared` propagates and fails the attempt.
//      It may NOT be swallowed: `#emit` allocates `seq` BEFORE awaiting the sink, so a swallowed
//      failure leaves a HOLE and the control plane's ingest (`createJobEventIngestService`)
//      accepts nothing past it — the terminal included;
//   3. placement — one announcement per COMMITTED reference, after the export window and BEFORE
//      the terminal, carrying the `kind` the request declared (E7-D08: `other` in production);
//   4. a PARTIAL window still announces what committed — an export that committed some files and
//      refused others must not lose the committed ones;
//   5. F10 — two Organizations through ONE supervisor: each announcement carries its own tenant
//      identity, with a same-tenant positive control.

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalEventDigestInputV1, workerEventV1Schema, type WorkerEventV1 } from "@armyofagents/worker-protocol";

import {
  createArtifactExportSequencer,
  type ArtifactExportRequest,
  type ArtifactExportSequencer,
  type ExportedArtifactRef,
} from "../lease/artifact-export.js";
import { EventSequencer, type WorkerEventSink } from "../supervisor/events.js";
import { createSupervisor, type SupervisorDeps } from "../supervisor/supervisor.js";
import type { SandboxProvider } from "../supervisor/provider.js";
import type { LeaseHandoff } from "../poll/poll-loop.js";
import { generateDeviceKey } from "../identity/device-key.js";
import type { WorkerSession } from "../enrollment/enroll.js";
import { createFakeSandboxProvider } from "./support/fake-provider.js";
import { compatibleOffer } from "./support/poll-fixtures.js";
import { collectingSink, makeHandoff, SUPERVISOR_IDENTITY } from "./support/supervisor-fixtures.js";

const ARTIFACT_ID = "66666666-6666-4666-8666-666666666666";
const SESSION: WorkerSession = { token: "session-token", expiresAt: new Date(Date.now() + 600_000) } as never;

const PATH_A = "/home/user/aoa-output/report.md";
const PATH_B = "/home/user/aoa-output/notes.md";
const BODY_A = "# report\n";
const BODY_B = "# notes\n";
const REQ_A: ArtifactExportRequest = { path: PATH_A, kind: "other", contentType: "text/markdown", retention: "run" };
const REQ_B: ArtifactExportRequest = { path: PATH_B, kind: "other", contentType: "text/markdown", retention: "run" };

function identity() {
  return {
    organizationId: "11111111-1111-4111-8111-111111111111",
    companyId: "22222222-2222-4222-8222-222222222222",
    workerId: "33333333-3333-4333-8333-333333333333",
    jobId: "44444444-4444-4444-8444-444444444444",
    attempt: 1,
    leaseId: "55555555-5555-4555-8555-555555555555",
    fenceToken: "f".repeat(40),
  };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function localSink(): WorkerEventSink & { events: WorkerEventV1[] } {
  const events: WorkerEventV1[] = [];
  return { events, emit(event) { events.push(event); } };
}

// --- 1. the emitter's own contract -----------------------------------------------------------

describe("CLI-013 — EventSequencer.artifactPrepared", () => {
  it("★ emits a contiguous, digest-valid, schema-valid artifact_prepared event", async () => {
    const sink = localSink();
    const seq = new EventSequencer({ identity: identity(), sink, redactionCanaries: [] });

    const started = await seq.attemptStarted("sbx-1");
    const prepared = await seq.artifactPrepared({ artifactId: ARTIFACT_ID, kind: "other" });

    expect(prepared.eventType).toBe("artifact_prepared");
    // Contiguity is UNCONDITIONAL — no E7-D12 option is allowed to leave a hole.
    expect([started.seq, prepared.seq]).toEqual([1, 2]);
    const { eventDigest, ...withoutDigest } = prepared;
    expect(sha256Hex(canonicalEventDigestInputV1(withoutDigest))).toBe(eventDigest);
    expect(() => workerEventV1Schema.parse(prepared)).not.toThrow();
    if (prepared.eventType === "artifact_prepared") {
      expect(prepared.payload).toEqual({ artifactId: ARTIFACT_ID, kind: "other" });
    }
    // Anti-vacuity: the sink actually received it, not just the return value.
    expect(sink.events.map((e) => e.eventType)).toEqual(["attempt_started", "artifact_prepared"]);
  });

  it("★ E7-D12 (FATAL) — a sink failure PROPAGATES out of artifactPrepared; it is not swallowed", async () => {
    const boom = new Error("sink down");
    const sink: WorkerEventSink = {
      emit(event) {
        if (event.eventType === "artifact_prepared") throw boom;
      },
    };
    const seq = new EventSequencer({ identity: identity(), sink, redactionCanaries: [] });
    await expect(seq.artifactPrepared({ artifactId: ARTIFACT_ID, kind: "other" })).rejects.toBe(boom);
  });

  it("★ the payload is a REFERENCE — a path handed to the emitter cannot ride along", async () => {
    const sink = localSink();
    const seq = new EventSequencer({ identity: identity(), sink, redactionCanaries: [] });
    // The emitter projects exactly the two frozen fields, exactly as `usage` does, so a caller
    // that smuggles a path in cannot put it on the wire. (The frozen payload is `.strict()`, so
    // passing the extra field THROUGH would fail the parse in `#emit` instead — either way it
    // never reaches the sink; this pins the projection, which is the behaviour callers rely on.)
    const event = await (
      seq as unknown as { artifactPrepared: (i: unknown) => Promise<WorkerEventV1> }
    ).artifactPrepared({ artifactId: ARTIFACT_ID, kind: "other", path: PATH_A });

    if (event.eventType === "artifact_prepared") {
      expect(event.payload).toEqual({ artifactId: ARTIFACT_ID, kind: "other" });
    }
    expect(JSON.stringify(event)).not.toContain(PATH_A);
    expect(JSON.stringify(sink.events)).not.toContain("aoa-output");
  });
});

// --- 2. placement on the supervisor path -----------------------------------------------------

function echoClient(script: { commitRejectPaths?: readonly string[] } = {}) {
  let n = 0;
  const idByObjectKey = new Map<string, string>();
  return {
    client: {
      artifactTransferGrantPath: "/api/worker-control/artifact-transfer-grants",
      artifactCommitPath: "/api/worker-control/artifact-commits",
      async artifactTransferGrant(request: { bytes: Buffer }) {
        const parsed = JSON.parse(request.bytes.toString("utf8")) as Record<string, unknown>;
        const body = parsed.body as Record<string, unknown>;
        idByObjectKey.set(String(body.expectedObjectKey), String(body.artifactId));
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
              url: "https://store.example/put?X-Amz-Signature=SECRET",
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
        const manifest = body.manifest as Record<string, unknown>;
        n += 1;
        if ((script.commitRejectPaths?.length ?? 0) > 0 && n === 1) {
          return { status: 200, body: { protocolVersion: 1, outcome: "rejected", reason: "policy" } };
        }
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

function baseDeps(extra: Partial<SupervisorDeps> & { provider?: SandboxProvider } = {}): SupervisorDeps {
  return {
    provider:
      extra.provider ??
      createFakeSandboxProvider({ artifactExportMode: "grant_upload", artifactFiles: { [PATH_A]: BODY_A, [PATH_B]: BODY_B } }),
    identity: SUPERVISOR_IDENTITY,
    eventSink: collectingSink(),
    redactionCanaries: [],
    ...extra,
  } as SupervisorDeps;
}

/** A handoff for a SECOND Organization: every tenant identity differs from `makeHandoff()`. */
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

function preparedOf(events: readonly WorkerEventV1[]) {
  return events.filter((e) => e.eventType === "artifact_prepared");
}

describe("CLI-013 — placement on the sequencer-completion / supervisor path", () => {
  it("★ announces ONE artifact_prepared per COMMITTED reference, after the window and BEFORE the terminal", async () => {
    const sink = collectingSink();
    const supervisor = createSupervisor(
      baseDeps({
        eventSink: sink,
        resolveExportArtifacts: async () => [REQ_A, REQ_B],
        exportArtifacts: realSequencer(echoClient()),
      }),
    );

    await supervisor.accept(makeHandoff());

    const kinds = sink.events.map((e) => e.eventType);
    // Anti-vacuity: the window really committed two artifacts.
    expect(kinds.filter((k) => k === "artifact_prepared")).toHaveLength(2);
    // ORDER: both announcements precede the terminal.
    expect(kinds.indexOf("terminal")).toBeGreaterThan(kinds.lastIndexOf("artifact_prepared"));
    expect(kinds[kinds.length - 1]).toBe("terminal");
    // Contiguity across the WHOLE stream is unconditional.
    expect(sink.events.map((e) => e.seq)).toEqual(sink.events.map((_, i) => i + 1));
    for (const e of preparedOf(sink.events)) {
      expect(() => workerEventV1Schema.parse(e)).not.toThrow();
      if (e.eventType === "artifact_prepared") {
        // The `kind` is the one the REQUEST declared (E7-D08) — never invented.
        expect(e.payload.kind).toBe("other");
        expect(e.payload.artifactId).toMatch(/^[0-9a-f-]{36}$/);
      }
      // A REFERENCE, never a path or bytes.
      expect(JSON.stringify(e)).not.toContain("aoa-output");
    }
  });

  it("★ a PARTIAL window still announces what COMMITTED — the refused file loses nothing else", async () => {
    const sink = collectingSink();
    const supervisor = createSupervisor(
      baseDeps({
        eventSink: sink,
        resolveExportArtifacts: async () => [REQ_A, REQ_B],
        // The first commit is rejected; the second commits.
        exportArtifacts: realSequencer(echoClient({ commitRejectPaths: [PATH_A] })),
      }),
    );

    await supervisor.accept(makeHandoff());

    // Anti-vacuity: exactly one committed, so exactly one announcement — not zero, not two.
    expect(preparedOf(sink.events)).toHaveLength(1);
    expect(sink.events.map((e) => e.seq)).toEqual(sink.events.map((_, i) => i + 1));
    expect(sink.events[sink.events.length - 1]!.eventType).toBe("terminal");
  });

  it("★ nothing committed ⇒ NO announcement (the anti-vacuity control)", async () => {
    const sink = collectingSink();
    const supervisor = createSupervisor(
      baseDeps({
        eventSink: sink,
        resolveExportArtifacts: async () => [REQ_A],
        exportArtifacts: async () => ({ exported: [] as readonly ExportedArtifactRef[], failures: [] }),
      }),
    );
    await supervisor.accept(makeHandoff());
    expect(preparedOf(sink.events)).toHaveLength(0);
    expect(sink.events.map((e) => e.eventType)).toEqual(["attempt_started", "terminal"]);
  });

  it("★ E7-D12 (FATAL) — a sink failure on the announcement ABORTS the lifecycle; no terminal follows the hole", async () => {
    // ★★★ VERIFIED AT SOURCE, and the mechanism is NOT a rejection. `createSupervisor().accept`
    // catches everything out of `runLifecycle` by design ("never reject out of `accept`") and
    // escalates to `escalateCleanup(run, "lifecycle_error")`. So E7-D12's "fails the attempt"
    // means: the lifecycle ABORTS at the emit, NO terminal is written after the hole, and the
    // attempt is left non-terminal for the JOB-006 reaper. Asserting `rejects` here would assert
    // a mechanism this daemon does not have.
    const seen: string[] = [];
    const sink: WorkerEventSink = {
      emit(event) {
        seen.push(event.eventType);
        if (event.eventType === "artifact_prepared") throw new Error("sink down");
      },
    };
    const errors: string[] = [];
    const logger = {
      info: () => {},
      warn: () => {},
      error: (...a: unknown[]) => errors.push(JSON.stringify(a)),
      debug: () => {},
      flush: async () => {},
    };
    const supervisor = createSupervisor(
      baseDeps({
        eventSink: sink,
        logger: logger as never,
        resolveExportArtifacts: async () => [REQ_A],
        exportArtifacts: realSequencer(echoClient()),
      }),
    );

    await supervisor.accept(makeHandoff());

    // Anti-vacuity: the announcement was actually attempted — the sink saw it and threw.
    expect(seen).toContain("artifact_prepared");
    // THE PROPERTY: no terminal after the hole. A swallowed failure would emit one, and the
    // ingest (`createJobEventIngestService`) accepts nothing past a gap, so that terminal would
    // never land — the one outcome "log and continue to a truthful terminal" promised.
    expect(seen).not.toContain("terminal");
    // ...and the abort was recorded, not silent.
    expect(errors.join(" ")).toContain("run lifecycle error");
  });

  it("★ the fail-closed join ESCAPES the window's catch — an unmatched committed path aborts, it does not become sequencer_failed", async () => {
    // ★★★ Codex P2 on PR #589, verified at source and fixed. `announcementsFor` sat INSIDE
    // `runExportWindow`'s broad catch, so its fail-closed throw was converted into
    // `report("failed", …, "sequencer_failed")` + an empty list and the terminal was emitted
    // anyway — a refusal short-circuited by an enclosing catch (the E7-F043 class, in this
    // ticket's own diff), silently hiding a committed artifact instead of aborting per E7-D12.
    const seen: string[] = [];
    const sink: WorkerEventSink = {
      emit(event) {
        seen.push(event.eventType);
      },
    };
    const errors: string[] = [];
    const logger = {
      info: () => {}, warn: () => {}, debug: () => {}, flush: async () => {},
      error: (...a: unknown[]) => errors.push(JSON.stringify(a)),
    };
    const supervisor = createSupervisor(
      baseDeps({
        eventSink: sink,
        logger: logger as never,
        resolveExportArtifacts: async () => [REQ_A],
        // A committed reference whose path NO request named — the join cannot know its `kind`.
        exportArtifacts: async () => ({
          exported: [
            {
              path: "/home/user/aoa-output/never-requested.md",
              artifactId: ARTIFACT_ID,
              objectKey: "k",
              sha256: "0".repeat(64),
              sizeBytes: 1,
              versionNumber: 1,
            },
          ] as readonly ExportedArtifactRef[],
          failures: [],
        }),
      }),
    );

    await supervisor.accept(makeHandoff());

    // Anti-vacuity: the run really got as far as the export window.
    expect(seen).toContain("attempt_started");
    // THE PROPERTY: the refusal aborted the lifecycle. No announcement, and NO terminal.
    expect(seen.filter((t) => t === "artifact_prepared")).toHaveLength(0);
    expect(seen).not.toContain("terminal");
    expect(errors.join(" ")).toContain("run lifecycle error");
  });

  it("★ F10 — two Organizations through ONE supervisor: each announcement carries its OWN tenant", async () => {
    const sink = collectingSink();
    const supervisor = createSupervisor(
      baseDeps({
        eventSink: sink,
        resolveExportArtifacts: async () => [REQ_A],
        exportArtifacts: realSequencer(echoClient()),
      }),
    );

    const a = makeHandoff();
    const b = makeTenantBHandoff();
    await supervisor.accept(a);
    await supervisor.accept(b);

    const prepared = preparedOf(sink.events);
    // Anti-vacuity: one announcement per tenant actually happened.
    expect(prepared).toHaveLength(2);

    const orgA = a.offer.job.organizationId;
    const orgB = b.offer.job.organizationId;
    expect(orgA).not.toBe(orgB);

    // POSITIVE CONTROL (same tenant): tenant A's announcement carries tenant A's identity.
    expect(prepared[0]!.organizationId).toBe(orgA);
    expect(prepared[0]!.companyId).toBe(a.offer.job.companyId);
    expect(prepared[0]!.jobId).toBe(a.offer.job.jobId);

    // CROSS-TENANT: tenant B's announcement is bound to B, and carries NOTHING of A's.
    expect(prepared[1]!.organizationId).toBe(orgB);
    expect(prepared[1]!.companyId).toBe(b.offer.job.companyId);
    expect(prepared[1]!.jobId).toBe(b.offer.job.jobId);
    expect(JSON.stringify(prepared[1])).not.toContain(String(orgA));
    expect(JSON.stringify(prepared[1])).not.toContain(String(a.offer.job.companyId));
    expect(JSON.stringify(prepared[1])).not.toContain(String(a.leaseId));

    // Each attempt's stream is contiguous FROM 1 — one sequencer per lease/attempt.
    expect(prepared[0]!.leaseId).toBe(a.leaseId);
    expect(prepared[1]!.leaseId).toBe(b.leaseId);
  });
});
