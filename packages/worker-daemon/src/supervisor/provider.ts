/**
 * `SandboxProvider` driver port + result/label/authority types (WRK-004).
 *
 * This is the provider-neutral driver interface the supervisor programs against.
 * It is deliberately the SECURITY CORE of the worker: the tenant command runs
 * INSIDE a provider sandbox (`execute`), never as a child of the worker process,
 * and every op is mediated by an effect- or cleanup-authority (see
 * `effect-authority.ts` / `cleanup-authority.ts`).
 *
 * E4-F003 (choice): the port TYPES are EXPORTED from `@armyofagents/worker-daemon`
 * (via `index.ts`) so a future `@armyofagents/sandbox-fake-provider` (DEP-000)
 * can `implements SandboxProvider` without copying the shape. The port stays
 * authoritative HERE in worker-daemon (it is not relocated to a shared leaf) —
 * DEP-000 depends on worker-daemon for it. Mirror in E6-F004.
 *
 * E4-F002 (choice): the interface is TRANSPORT-AGNOSTIC. CORE binds ONLY the
 * in-process `createFakeSandboxProvider` double. A `SandboxProvider` is a plain
 * async method surface with no wire/serialization assumptions, so a networked
 * worker→provider driver can bind it later WITHOUT changing this port. That
 * networked driver + its wire is a NON-GOAL of WRK-004 CORE; it is the
 * containerized half of E6-F003, deferred by DEP-010 and owned by DEP-011.
 *
 * DEP-010 (Sprint 2, decision D1): this per-op `SandboxProvider` is THE
 * authoritative provider port of record — the port the security core speaks and
 * the only one the sole real implementation (`E2bSandboxProvider`) implements —
 * enforced in the findings register (E6-F008 resolved). The contract package's
 * `SandboxProviderDriver` is NOT authoritative and NOT retired: it is a
 * conformance-harness surface only (D2), reached FROM this port through the
 * shipped `perOpToInvokeDriver` adapter
 * (`packages/sandbox-e2b-provider/src/per-op-adapter.ts`), never the reverse.
 *
 * Runtime imports: `@armyofagents/worker-protocol` (the frozen op vocabulary) +
 * `node:crypto` (label hashing) only — the E4-D01 boundary.
 */

import { createHash } from "node:crypto";

import {
  CHECKPOINT_MODES,
  HEALTH_MODES,
  PROVIDER_OPERATIONS,
  type ProviderOperation,
  // DAT-009 slice 1 — the grant the provider redeems. From the FROZEN package, which E4-D01
  // permits worker-daemon to import; no new dependency is introduced.
  type ArtifactUploadGrantV1,
  // CLI-008 Unit B — the INBOUND counterpart. Same frozen package, same permission; the
  // download grant is a bearer capability exactly as the upload grant is.
  type ArtifactDownloadGrantV1,
} from "@armyofagents/worker-protocol";

export type { ProviderOperation };
export { PROVIDER_OPERATIONS };

/** Optional-op modes negotiated with the provider (frozen vocabulary). */
export type CheckpointMode = (typeof CHECKPOINT_MODES)[number];
export type HealthMode = (typeof HEALTH_MODES)[number];

/**
 * DAT-009 slice 1 — whether this provider can export an in-sandbox file to object storage
 * under a worker-minted grant.
 *
 * ★ DEFINED LOCALLY ON PURPOSE. `CHECKPOINT_MODES`/`HEALTH_MODES` come from the FROZEN
 * worker-protocol, and this mode deliberately does NOT join them: it must not enter the frozen
 * `registeredTargetProfileV1Schema`, because adding a value there would be an E4-D02 STOP that
 * the byte-egress decision established is unnecessary.
 *
 * It answers a purely LOCAL question — "can THIS provider export?". The separate, server-side
 * question — "should placement route this job here?" — is answered by the frozen
 * `artifact.direct_upload` capability in the target's `capabilityCeiling`. Two layers, two
 * mechanisms; do not collapse them.
 */
export type ArtifactExportMode = "none" | "grant_upload";

/** Metadata ONLY. There is deliberately no content field: the digest step DESCRIBES the file,
 * the export step MOVES it provider -> object storage, and neither hands bytes to the daemon.
 * That is what keeps this port's no-bytes property true. */
export interface ArtifactDigestResult {
  readonly sha256: string;
  readonly sizeBytes: number;
}

/** A REFERENCE to what was exported — never the bytes. */
export interface ArtifactExportResult {
  readonly objectKey: string;
}

/**
 * CLI-008 Unit B — whether this provider can stage control-plane-authored files INTO a
 * sandbox by redeeming a worker-minted download grant.
 *
 * ★ DEFINED LOCALLY, for the same reason `ArtifactExportMode` is (see above): it must not
 * enter the FROZEN `PROVIDER_OPERATIONS` vocabulary, which `advertisedOperations` is typed
 * to. It answers the LOCAL question "can THIS provider stage?"; whether a job should be
 * routed somewhere that can is a separate, server-side question.
 *
 * Measured cost of doing it the other way instead: adding a `stage_files` operation to
 * `OPTIONAL_PROVIDER_OPERATIONS` reds 1 of 289 worker-protocol tests and to
 * `CORE_PROVIDER_OPERATIONS` reds 27 — but the cheap number is the misleading one, because
 * the conformance suite iterates the optional set exhaustively and the fake driver defaults
 * its advertised optional set to ALL of them, so a fourth optional op is auto-advertised by
 * a driver that cannot serve it.
 */
export type FileStagingMode = "none" | "grant_download";

/**
 * One file to stage: WHERE it goes inside the sandbox, and a GRANT that redeems to its bytes.
 *
 * ★ A GRANT, NOT BYTES. A bytes-shaped signature would route payloads through a daemon that
 * is dependency-pinned (E4-D01) precisely so it does not handle them — the exact inversion of
 * `exportArtifact`, which takes an upload grant and returns a reference. `sha256` and
 * `sizeBytes` ride on the grant itself (`expectedSha256`, `maxBytes`), so the provider can
 * verify what it fetched before it writes it.
 */
export interface StagedFileRequest {
  /** The ABSOLUTE in-sandbox path to write. */
  readonly path: string;
  /**
   * ★ THIS IS A BEARER CAPABILITY — anyone holding it can read that object key until it
   * expires. The same rule `exportArtifact`'s grant carries applies here: an implementation
   * must never let it reach a projection, a log line, or an error.
   */
  readonly grant: ArtifactDownloadGrantV1;
}

/** What was staged — paths only. No bytes, and never the grants. */
export interface StageFilesResult {
  readonly stagedPaths: readonly string[];
}

/** Lifecycle state of a provider sandbox resource. */
export const SANDBOX_STATES = [
  "creating",
  "running",
  "cancelling",
  "stopped",
  "destroyed",
  "failed",
] as const;
export type SandboxState = (typeof SANDBOX_STATES)[number];

/** `destroy`/`reconcile_cleanup` terminal disposition. */
export type CleanupStatus = "success" | "failed";

/** `cancel`/`kill` disposition: `stopped` ends the process tree; `ignored`
 * means the sandbox did not comply and the supervisor must escalate. */
export type StopOutcome = "stopped" | "ignored";

// -----------------------------------------------------------------------------
// Ownership labels + selectors
// -----------------------------------------------------------------------------

/**
 * The ownership/identity labels stamped on every provider resource. The cleanup
 * authority binds to the FULL tuple + `deviceGeneration` (its `targetGeneration`);
 * reconcile scopes by the coarser `OwnershipSelector`. These are management
 * metadata (never customer data) — but they are HASHED before entering any log,
 * cleanup record, or metric (`hashResourceLabels`).
 */
export interface ResourceLabels {
  readonly organizationId: string;
  readonly targetId: string;
  readonly workerId: string;
  readonly jobId: string;
  readonly attempt: number;
  readonly leaseId: string;
  readonly deviceGeneration: number;
}

/** The coarse (org, target, worker) scope reconcile lists resources under. */
export interface OwnershipSelector {
  readonly organizationId: string;
  readonly targetId: string;
  readonly workerId: string;
}

/** Structural, order-independent equality of two label tuples. */
export function labelsEqual(a: ResourceLabels, b: ResourceLabels): boolean {
  return (
    a.organizationId === b.organizationId &&
    a.targetId === b.targetId &&
    a.workerId === b.workerId &&
    a.jobId === b.jobId &&
    a.attempt === b.attempt &&
    a.leaseId === b.leaseId &&
    a.deviceGeneration === b.deviceGeneration
  );
}

/** True iff `labels` fall under the coarse ownership `selector`. */
export function labelsMatchSelector(labels: ResourceLabels, selector: OwnershipSelector): boolean {
  return (
    labels.organizationId === selector.organizationId &&
    labels.targetId === selector.targetId &&
    labels.workerId === selector.workerId
  );
}

/**
 * A stable lowercase-hex SHA-256 over the canonical ordering of the ownership
 * labels — the ONLY form of the labels that may appear in a log line, cleanup
 * record, or (were it ever labeled) a metric. Raw label VALUES never leave the
 * supervisor.
 */
export function hashResourceLabels(labels: ResourceLabels): string {
  const canonical = [
    labels.organizationId,
    labels.targetId,
    labels.workerId,
    labels.jobId,
    String(labels.attempt),
    labels.leaseId,
    String(labels.deviceGeneration),
  ].join("\0");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// -----------------------------------------------------------------------------
// Per-op context + typed results
// -----------------------------------------------------------------------------

/**
 * Every provider op carries a wall-clock `deadlineMs` budget and a STABLE
 * `idempotencyKey`. A repeated key returns the recorded result and does not
 * double-apply (lost-response replay).
 */
export interface ProviderOpContext {
  readonly deadlineMs: number;
  readonly idempotencyKey: string;
}

export interface CreateSandboxSpec {
  readonly resourceLabels: ResourceLabels;
  /** The TENANT command — it runs INSIDE the sandbox, never in the worker. */
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly workloadType: string;
}

export interface CreateResult {
  readonly sandboxId: string;
  readonly providerOpId: string;
  readonly resourceLabels: ResourceLabels;
}

export interface ExecuteInput {
  readonly sandboxId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/**
 * The result of running the tenant command INSIDE the sandbox. `stdoutRef`/
 * `stderrRef` are OPAQUE references — never inline customer bytes (object-byte
 * capture/upload is E5). No stdout/stderr content crosses this boundary.
 */
export interface ExecuteResult {
  readonly providerOpId: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly stdoutRef: string;
  readonly stderrRef: string;
}

export interface StopResult {
  readonly providerOpId: string;
  readonly outcome: StopOutcome;
}

export interface CleanupResult {
  readonly providerOpId: string;
  readonly cleanupStatus: CleanupStatus;
}

/** A management-safe list row (never customer bytes). `hasLiveLease` lets
 * reconcile spot orphans. */
export interface ResourceSummary {
  readonly sandboxId: string;
  readonly resourceLabels: ResourceLabels;
  readonly generation: number;
  readonly state: SandboxState;
  readonly hasLiveLease: boolean;
}

export interface ListInput {
  readonly ownershipSelector: OwnershipSelector;
  readonly pageSize: number;
  readonly pageToken?: string | null;
}

export interface ListResult {
  readonly providerOpId: string;
  readonly resources: readonly ResourceSummary[];
  readonly nextPageToken: string | null;
}

/**
 * The FULL provider-level inspection. It intentionally carries SENSITIVE fields
 * (`command`/`env`/`logs`/`workspaceBytes`/`objectGrants`/`secrets`) so the
 * cleanup authority's redaction is a real (non-vacuous) projection: cleanup
 * NEVER returns this object — only `RedactedResourceProjection`.
 */
export interface InspectResult {
  readonly providerOpId: string;
  readonly sandboxId: string;
  readonly resourceLabels: ResourceLabels;
  readonly generation: number;
  readonly state: SandboxState;
  readonly command: string;
  readonly env: Readonly<Record<string, string>>;
  readonly logs: readonly string[];
  readonly workspaceBytes: number;
  readonly objectGrants: readonly string[];
  readonly secrets: Readonly<Record<string, string>>;
}

export interface CheckpointResult {
  readonly providerOpId: string;
  readonly mode: CheckpointMode;
  readonly checkpointRef: string;
}

export interface RestoreResult {
  readonly providerOpId: string;
  readonly restored: boolean;
}

export interface HealthResult {
  readonly providerOpId: string;
  readonly mode: HealthMode;
  readonly status: "healthy" | "unhealthy";
}

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

/**
 * Thrown when an OPTIONAL op (`checkpoint`/`restore`/`health`, or the DAT-009 artifact-export
 * pair) is invoked on a provider that did not advertise it. Failing EXPLICITLY (never guessing)
 * is the point: an unsupported capability is a hard, named error.
 *
 * ★ The parameter is WIDENED beyond the frozen `ProviderOperation` union. `digest_artifact` and
 * `export_artifact` are NOT frozen operations — deliberately, per the byte-egress decision — so
 * a decline for them could not otherwise be expressed. Widening here is additive and local:
 * every existing caller passes a `ProviderOperation`, which still typechecks.
 */
export type DeclinableOperation = ProviderOperation | "digest_artifact" | "export_artifact" | "stage_files";

export class UnsupportedProviderOperation extends Error {
  readonly operation: DeclinableOperation;
  constructor(operation: DeclinableOperation) {
    super(`provider operation ${operation} is not advertised`);
    this.name = "UnsupportedProviderOperation";
    this.operation = operation;
  }
}

/**
 * Thrown by a provider when a sandbox id is unknown. Cleanup authority MAPS this
 * (and a label mismatch) to the SAME `ResourceNotAvailableError`, so a caller can
 * never use it as an existence oracle.
 */
export class SandboxNotFoundError extends Error {
  constructor() {
    super("sandbox not found");
    this.name = "SandboxNotFoundError";
  }
}

// -----------------------------------------------------------------------------
// The driver port
// -----------------------------------------------------------------------------

/**
 * The provider-neutral sandbox driver. Eight CORE ops + three OPTIONAL ops. The
 * optional ops throw {@link UnsupportedProviderOperation} unless advertised in
 * `advertisedOperations` (paired with a non-`none` `checkpointMode`/`healthMode`).
 *
 * Transport-agnostic (E4-F002): no method assumes a wire — a network binding can
 * implement this port later without changing it.
 */
export interface SandboxProvider {
  /** The advertised op set (always a superset of the 8 core ops). */
  readonly advertisedOperations: ReadonlySet<ProviderOperation>;
  readonly checkpointMode: CheckpointMode;
  readonly healthMode: HealthMode;

  // --- core ---
  create(spec: CreateSandboxSpec, ctx: ProviderOpContext): Promise<CreateResult>;
  execute(input: ExecuteInput, ctx: ProviderOpContext): Promise<ExecuteResult>;
  cancel(sandboxId: string, ctx: ProviderOpContext): Promise<StopResult>;
  kill(sandboxId: string, ctx: ProviderOpContext): Promise<StopResult>;
  destroy(sandboxId: string, ctx: ProviderOpContext): Promise<CleanupResult>;
  list(input: ListInput, ctx: ProviderOpContext): Promise<ListResult>;
  inspect(sandboxId: string, ctx: ProviderOpContext): Promise<InspectResult>;
  reconcileCleanup(sandboxId: string, ctx: ProviderOpContext): Promise<CleanupResult>;

  // --- optional (gated on advertisement) ---
  checkpoint(sandboxId: string, ctx: ProviderOpContext): Promise<CheckpointResult>;
  restore(sandboxId: string, ctx: ProviderOpContext): Promise<RestoreResult>;
  health(sandboxId: string, ctx: ProviderOpContext): Promise<HealthResult>;

  // --- optional artifact export (gated on `artifactExportMode`) -------------------------
  //
  // NOT in `advertisedOperations`: that set is typed to the FROZEN `ProviderOperation` union
  // and these are not frozen operations. Support is declared by the mode above instead. Like
  // the optional trio, the METHODS are present on every implementer and only SUPPORT is
  // optional — "mandatory means no absent path".

  /** Describe an in-sandbox file. Metadata only; never returns content. */
  digestArtifact(sandboxId: string, path: string, ctx: ProviderOpContext): Promise<ArtifactDigestResult>;

  /**
   * Upload an in-sandbox file directly to object storage under `grant`, returning a reference.
   *
   * ★ `grant` IS A BEARER CAPABILITY — anyone holding it can write that object key until it
   * expires. The port already classifies this class of value as sensitive: `InspectResult`
   * carries `objectGrants` among `command`/`env`/`logs`/`secrets`, and
   * `RedactedResourceProjection` — the only shape cleanup authority ever returns — excludes it.
   * An implementation must never let a grant reach a projection, a log line, or an error.
   */
  exportArtifact(
    sandboxId: string,
    path: string,
    grant: ArtifactUploadGrantV1,
    ctx: ProviderOpContext,
  ): Promise<ArtifactExportResult>;

  /** Whether this provider supports the two operations above. */
  readonly artifactExportMode: ArtifactExportMode;

  // --- optional file staging (gated on `fileStagingMode`) -------------------------------
  //
  // NOT in `advertisedOperations`, for the same reason the export pair is not: that set is
  // typed to the FROZEN `ProviderOperation` union and this is not a frozen operation. Support
  // is declared by the mode below. The METHOD is present on every implementer and only
  // SUPPORT is optional — "mandatory means no absent path".

  /**
   * Write `files` into a live sandbox before the tenant command runs, by redeeming each
   * file's download grant.
   *
   * Grant in, reference out: the bytes go store -> provider -> sandbox and never cross this
   * port. An implementation MUST verify what it fetched against the grant's `expectedSha256`
   * before writing — a provider that wrote unverified bytes would be the WRK-009 defect
   * again, where a fabricated success is byte-identical to a real one on every gate.
   *
   * Throws {@link UnsupportedProviderOperation} when `fileStagingMode` is `"none"`.
   */
  stageFiles(
    sandboxId: string,
    files: readonly StagedFileRequest[],
    ctx: ProviderOpContext,
  ): Promise<StageFilesResult>;

  /** Whether this provider supports the operation above. */
  readonly fileStagingMode: FileStagingMode;
}

/** A management-only, REDACTED projection of a sandbox: identity + lifecycle
 * state + a HASH of the ownership labels. It carries NO command, env, logs,
 * secrets, workspace/customer bytes, or object grants — the only shape the
 * cleanup authority ever returns from `inspect`/`list`. */
export interface RedactedResourceProjection {
  readonly sandboxId: string;
  readonly resourceLabelsHash: string;
  readonly generation: number;
  readonly state: SandboxState;
  readonly providerOpId: string;
}
