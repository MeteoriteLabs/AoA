// -----------------------------------------------------------------------------
// DEP-019 — the reference provider on the AUTHORITATIVE per-op port.
//
// `FakeSandboxProvider` implements the CONTRACT driver (`invoke(op, args)`), which is what the
// conformance harness and the D1 `/invoke` endpoint speak. A DEPLOYED worker speaks the other
// port: the per-op `SandboxProvider` that `packages/worker-daemon/src/supervisor/provider.ts`
// defines and that `adapter-manager`'s `createProviderServer` serves over the wire. This is that
// face of the same fake, so the D1 reference provider can be reached by a worker's
// `NetworkedProviderDriver` exactly as the E2B provider is.
//
// ★ A STRUCTURAL MIRROR, not an import — the same choice, for the same reason, as
// `fake-driver.ts`'s mirror of the contract driver. This package's runtime closure is
// worker-protocol + zod + node built-ins, and the D1 fake-provider image is built on exactly that;
// importing `@armyofagents/worker-daemon` for TYPES would still add it to the workspace graph and
// to that image's build. `provider.ts`'s own header anticipates the opposite direction ("a future
// `@armyofagents/sandbox-fake-provider` can `implements SandboxProvider`"); this keeps the
// structural form so the closure stays closed, and pins the shape with a drift test
// (`__tests__/per-op-port-mirror.test.ts`) that reads the daemon's source rather than trusting it.
//
// ★ WHAT IT ADVERTISES, and why that is the whole set. The 8 CORE ops only. Every optional mode is
// `"none"` and every optional op throws `UnsupportedProviderOperation`: the `m1-spine` journey is a
// `batch` `task_run` with no staged input, no artifact export and no process supervision, so an
// advertised-but-unexercised op would be a capability nobody drives. `stageFiles` in particular is
// left unsupported DELIBERATELY — the supervisor skips the whole stage-in half when the envelope
// carries no pointer, and advertising a staging mode the lane never exercises would let a future
// envelope reach an unimplemented path and read the throw as a provider fault.
// -----------------------------------------------------------------------------

import { randomUUID } from "node:crypto";

import { UnsupportedProviderOperation, type FakeProviderUsageV1 } from "./fake-driver.js";
import { executeScriptedCommand, type ScriptedExecuteResult } from "./scripted-command.js";
import type { NodeEvalRunner } from "./node-eval.js";

/** Mirrors `ResourceLabels` (worker-daemon `supervisor/provider.ts`). */
export interface PortResourceLabels {
  readonly organizationId: string;
  readonly targetId: string;
  readonly workerId: string;
  readonly jobId: string;
  readonly attempt: number;
  readonly leaseId: string;
  readonly deviceGeneration: number;
}

/** Mirrors `OwnershipSelector`. */
export interface PortOwnershipSelector {
  readonly organizationId: string;
  readonly targetId: string;
  readonly workerId: string;
}

/** Mirrors `ProviderOpContext`. */
export interface PortOpContext {
  readonly deadlineMs: number;
  readonly idempotencyKey: string;
}

/** Mirrors `CreateSandboxSpec`. */
export interface PortCreateSpec {
  readonly resourceLabels: PortResourceLabels;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly workloadType: string;
}

/** Mirrors `ExecuteInput`. */
export interface PortExecuteInput {
  readonly sandboxId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly onStdout?: (chunk: string) => void;
}

export type PortSandboxState = "creating" | "running" | "cancelling" | "stopped" | "destroyed" | "failed";

export interface PortCreateResult {
  readonly sandboxId: string;
  readonly providerOpId: string;
  readonly resourceLabels: PortResourceLabels;
}
export interface PortStopResult {
  readonly providerOpId: string;
  readonly outcome: "stopped" | "ignored";
}
export interface PortCleanupResult {
  readonly providerOpId: string;
  readonly cleanupStatus: "success" | "failed";
}
export interface PortResourceSummary {
  readonly sandboxId: string;
  readonly resourceLabels: PortResourceLabels;
  readonly generation: number;
  readonly state: PortSandboxState;
  readonly hasLiveLease: boolean;
}
export interface PortListInput {
  readonly ownershipSelector: PortOwnershipSelector;
  readonly pageSize: number;
  readonly pageToken?: string | null;
}
export interface PortListResult {
  readonly providerOpId: string;
  readonly resources: readonly PortResourceSummary[];
  readonly nextPageToken: string | null;
}
export interface PortInspectResult {
  readonly providerOpId: string;
  readonly sandboxId: string;
  readonly resourceLabels: PortResourceLabels;
  readonly generation: number;
  readonly state: PortSandboxState;
  readonly command: string;
  readonly env: Readonly<Record<string, string>>;
  readonly logs: readonly string[];
  readonly workspaceBytes: number;
  readonly objectGrants: readonly string[];
  readonly secrets: Readonly<Record<string, string>>;
}

/** The 8 CORE ops, in the frozen vocabulary's spelling. */
export const PER_OP_CORE_OPERATIONS = Object.freeze([
  "create",
  "execute",
  "cancel",
  "kill",
  "destroy",
  "list",
  "inspect",
  "reconcile_cleanup",
] as const);

/**
 * Raised when an op names a sandbox this provider does not hold.
 *
 * ★★★ DUCK-TYPING IS NOT ENOUGH AT THE GATE (Codex P2, PR #572, verified at source). The
 * adapter-manager converts a vanished sandbox with
 * `if (err instanceof SandboxNotFoundError) throw new ResourceNotAvailableError()`
 * (`packages/adapter-manager/src/owned-op-gate.ts`), and that class is imported from
 * `@armyofagents/worker-daemon`. `instanceof` is an IDENTITY test, so this same-named local class
 * fails it: the error would skip the uniform conversion and escape the modelled-error fence as a
 * generic wire failure instead of "already gone", which is the idempotent cleanup/reconcile path.
 *
 * So the constructor is INJECTABLE (`FakeSandboxProviderPortOptions.notFound`). A host that serves
 * this provider over the gated wire passes the CANONICAL class from its own worker-daemon build —
 * the same no-second-copy pattern as the probe-script digest and the metadata URL — and this local
 * class remains the default for in-process callers, which have no gate to satisfy.
 */
export class SandboxNotFoundError extends Error {
  constructor() {
    super("sandbox not found");
    this.name = "SandboxNotFoundError";
  }
}

interface SandboxRecord {
  labels: PortResourceLabels;
  state: PortSandboxState;
  generation: number;
  command: string;
  args: readonly string[];
  env: Record<string, string>;
  executed: number;
}

export interface FakeSandboxProviderPortOptions {
  /** DEP-017 — the runner the probe is executed with. Omitted, a probe invocation THROWS rather
   * than being answered with the scripted transcript (`scripted-command.ts`). */
  readonly runNodeEval?: NodeEvalRunner;
  /** DEP-019 (Codex P1) — the pinned probe-script digests. Absent ⇒ every shell invocation is
   * refused; the D1 host builds the set from the daemon's own `ENV_PROBE_SCRIPT`. */
  readonly allowedProbeScriptDigests?: ReadonlySet<string>;
  /** DEP-019 (Codex P2) — the pinned metadata endpoint; the pinned script fetches `argv[2]`. */
  readonly allowedProbeMetadataUrl?: string;
  /** Overrides the canned units the scripted transcript reports. The D1 lane never does. */
  readonly usage?: FakeProviderUsageV1;
  /**
   * DEP-019 (Codex P2) — the not-found error this provider throws. A host serving the GATED wire
   * MUST pass the canonical `SandboxNotFoundError` from `@armyofagents/worker-daemon`, because the
   * adapter-manager's conversion is an `instanceof` IDENTITY test. Default: the local class.
   */
  readonly notFound?: () => Error;
  /** Injectable id source, so a test can pin every id. Default: `randomUUID`. */
  readonly newId?: () => string;
}

/**
 * The reference provider on the per-op port.
 *
 * Deliberately its OWN state rather than a wrapper over `FakeSandboxProvider`'s: the two ports
 * address resources differently (`providerId` + `resourceId` there, `sandboxId` + owner labels
 * here), and the ownership labels — which the adapter-manager's gate compares against the run's
 * capability — exist only on this port. Sharing the map would mean inventing a mapping between two
 * identity schemes and would make the labels the gate depends on derivative of something else.
 *
 * ★ EVERY OP IS `async`, deliberately. `mustGet`'s not-found throw must arrive as a REJECTION and
 * not as a synchronous throw: the wire server awaits each op inside its own try, but a caller that
 * attaches `.catch()` to the returned promise — which a synchronous throw skips entirely — would
 * see an uncaught error instead of a classified provider failure. Found by the first run of
 * `per-op-provider.test.ts`, which was RED on exactly that.
 */
export function createFakeSandboxProviderPort(options: FakeSandboxProviderPortOptions = {}) {
  const newId = options.newId ?? (() => randomUUID());
  const sandboxes = new Map<string, SandboxRecord>();
  /** `idempotencyKey -> sandboxId`, so a replayed `create` returns the recorded result. */
  const createdByKey = new Map<string, string>();
  let opCounter = 0;
  const opId = (op: string) => `fake-${op}-${++opCounter}`;

  const notFound = options.notFound ?? (() => new SandboxNotFoundError());
  const mustGet = (sandboxId: string): SandboxRecord => {
    const record = sandboxes.get(sandboxId);
    if (record === undefined) throw notFound();
    return record;
  };

  const unsupported = (op: string) => {
    throw new UnsupportedProviderOperation(op as never);
  };

  return {
    advertisedOperations: new Set<string>(PER_OP_CORE_OPERATIONS),
    checkpointMode: "none" as const,
    healthMode: "none" as const,
    artifactExportMode: "none" as const,
    fileStagingMode: "none" as const,
    processSupervisionMode: "none" as const,
    // CLI-012 — the metadata-only output enumeration. Declined, like the export pair: this
    // façade advertises exactly the frozen CORE ops and the `m1-spine` journey drives none of
    // the optional ones. `DEP-019`'s `per-op-port-mirror` test is what keeps this in step with
    // the daemon's own `SandboxProvider`.
    sandboxEnumerationMode: "none" as const,

    async create(spec: PortCreateSpec, ctx: PortOpContext): Promise<PortCreateResult> {
      // ★ AN EMPTY KEY IS NOT A KEY, and this is not a nicety — it is a live defect this
      // provider had (found on the D1 lane, second worker-driven run, as `create_failed` /
      // `errorClass: "other"`). `gateCreate` (`packages/adapter-manager/src/create-gate.ts`)
      // deliberately calls `provider.create(spec, { ...ctx, idempotencyKey: "" })`: its own
      // header records that stripping the key makes the DURABLE LEDGER the sole idempotency
      // authority. So EVERY gated create arrives with the same empty key, and a provider that
      // keys its replay map on it hands the SECOND run the FIRST run's sandbox — whose ownership
      // labels belong to another lease, which the gate then refuses. Replay is recorded only for
      // a non-empty key.
      const replayKey = ctx.idempotencyKey === "" ? undefined : ctx.idempotencyKey;
      const replay = replayKey === undefined ? undefined : createdByKey.get(replayKey);
      if (replay !== undefined) {
        // Lost-response replay: the SAME sandbox, never a second one.
        return Promise.resolve({
          sandboxId: replay,
          providerOpId: opId("create"),
          resourceLabels: mustGet(replay).labels,
        });
      }
      const sandboxId = `fake-sbx-${newId()}`;
      sandboxes.set(sandboxId, {
        labels: spec.resourceLabels,
        state: "running",
        generation: spec.resourceLabels.deviceGeneration,
        command: spec.command,
        args: [...spec.args],
        env: { ...spec.env },
        executed: 0,
      });
      if (replayKey !== undefined) createdByKey.set(replayKey, sandboxId);
      return Promise.resolve({ sandboxId, providerOpId: opId("create"), resourceLabels: spec.resourceLabels });
    },

    async execute(input: PortExecuteInput, ctx: PortOpContext): Promise<ScriptedExecuteResult> {
      const record = mustGet(input.sandboxId);
      record.executed += 1;
      return Promise.resolve(
        executeScriptedCommand(input, {
          deadlineMs: ctx.deadlineMs,
          providerOpId: opId("execute"),
          usage: options.usage,
          runNodeEval: options.runNodeEval,
          allowedProbeScriptDigests: options.allowedProbeScriptDigests,
          allowedProbeMetadataUrl: options.allowedProbeMetadataUrl,
        }),
      );
    },

    async cancel(sandboxId: string): Promise<PortStopResult> {
      mustGet(sandboxId).state = "stopped";
      return Promise.resolve({ providerOpId: opId("cancel"), outcome: "stopped" });
    },
    async kill(sandboxId: string): Promise<PortStopResult> {
      mustGet(sandboxId).state = "stopped";
      return Promise.resolve({ providerOpId: opId("kill"), outcome: "stopped" });
    },
    async destroy(sandboxId: string): Promise<PortCleanupResult> {
      // Idempotent by contract: destroying an already-gone sandbox is `success`, never a throw —
      // the cleanup ladder re-drives after a lost response and must converge.
      sandboxes.delete(sandboxId);
      return Promise.resolve({ providerOpId: opId("destroy"), cleanupStatus: "success" });
    },
    async reconcileCleanup(sandboxId: string): Promise<PortCleanupResult> {
      sandboxes.delete(sandboxId);
      return Promise.resolve({ providerOpId: opId("reconcile_cleanup"), cleanupStatus: "success" });
    },

    async list(input: PortListInput): Promise<PortListResult> {
      const s = input.ownershipSelector;
      const resources: PortResourceSummary[] = [];
      for (const [sandboxId, record] of sandboxes) {
        if (
          record.labels.organizationId !== s.organizationId ||
          record.labels.targetId !== s.targetId ||
          record.labels.workerId !== s.workerId
        ) {
          continue;
        }
        resources.push({
          sandboxId,
          resourceLabels: record.labels,
          generation: record.generation,
          state: record.state,
          hasLiveLease: record.state === "running",
        });
      }
      // One page: the lane never holds more sandboxes than a page, and a fake cursor would be a
      // second thing to get wrong.
      return Promise.resolve({
        providerOpId: opId("list"),
        resources: resources.slice(0, Math.max(input.pageSize, 0) || resources.length),
        nextPageToken: null,
      });
    },

    async inspect(sandboxId: string): Promise<PortInspectResult> {
      const record = mustGet(sandboxId);
      return Promise.resolve({
        providerOpId: opId("inspect"),
        sandboxId,
        resourceLabels: record.labels,
        generation: record.generation,
        state: record.state,
        command: record.command,
        // The port's `InspectResult` is the SENSITIVE projection by design — the adapter-manager
        // redacts it before it crosses the wire (`redactProjection`), and that redaction is only a
        // real projection if there is something to redact. Returning the sandbox's actual env is
        // what keeps it non-vacuous.
        env: record.env,
        logs: [],
        workspaceBytes: 0,
        objectGrants: [],
        secrets: {},
      });
    },

    checkpoint: () => unsupported("checkpoint"),
    restore: () => unsupported("restore"),
    health: () => unsupported("health"),
    digestArtifact: () => unsupported("digest_artifact"),
    exportArtifact: () => unsupported("export_artifact"),
    enumerateOutputs: () => unsupported("enumerate_outputs"),
    stageFiles: () => unsupported("stage_files"),
    startProcess: () => unsupported("start_process"),
    processStatus: () => unsupported("process_status"),
    signalProcess: () => unsupported("signal_process"),
  };
}

export type FakeSandboxProviderPort = ReturnType<typeof createFakeSandboxProviderPort>;
