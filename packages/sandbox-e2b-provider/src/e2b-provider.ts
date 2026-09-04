// -----------------------------------------------------------------------------
// E2bSandboxProvider — the REAL E2B driver logic, implementing worker-daemon's
// authoritative per-op `SandboxProvider` over an INJECTED transport (CLI-001/D1).
//
// The driver logic here is real and identical whether the injected transport is
// the deterministic key-less mock (`mock-transport.ts`, the no-key core proof) or
// the `e2b` SDK binding (`real-transport.ts`, the keyed lane). It:
//   * enforces create idempotency (lost-response replay returns the recorded id);
//   * enforces an explicit TTL on every sandbox (`setTimeout` at create; a
//     zero-deadline op is a deterministic timeout, never a hang);
//   * holds the FULL sensitive detail (command/env/logs/secrets) and returns it
//     ONLY from `inspect` (`InspectResult`) — so the cleanup authority's redaction
//     is a real, non-vacuous projection (management `list` never carries it);
//   * translates transport-level facts into the domain outcomes/denials the
//     conformance suites assert (ignored signal → `StopOutcome.ignored`; transient
//     teardown → a REPORTED `CleanupResult{failed}`, never a throw; a blocked
//     egress → the domain `SandboxEgressDeniedError`; an unknown id → the domain
//     `SandboxNotFoundError`).
//
// It advertises the eight core ops plus the optional ops the transport supports
// AND this provider is configured to expose; unadvertised optional ops throw the
// exact worker-daemon `UnsupportedProviderOperation`. No tenant/E2B field is
// invented into a management projection (CAV-002); the redaction to the neutral
// invoke-port projection is the E6-F008 adapter's job.
// -----------------------------------------------------------------------------

import {
  CORE_PROVIDER_OPERATIONS,
  type ProviderOperation,
  type ArtifactUploadGrantV1,
  type ArtifactDownloadGrantV1,
} from "@armyofagents/worker-protocol";
import { createHash } from "node:crypto";
import type {
  ArtifactDigestResult,
  ArtifactExportMode,
  ArtifactExportResult,
  FileStagingMode,
  StageFilesResult,
  StagedFileRequest,
  CheckpointMode,
  CheckpointResult,
  CleanupResult,
  CreateResult,
  CreateSandboxSpec,
  ExecuteInput,
  ExecuteResult,
  HealthMode,
  HealthResult,
  InspectResult,
  ListInput,
  ListResult,
  ProviderOpContext,
  ResourceLabels,
  ResourceSummary,
  RestoreResult,
  SandboxProvider,
  SandboxState,
  StopResult,
} from "@armyofagents/worker-daemon";

import { METADATA_KEYS } from "./directives.js";
import {
  SandboxEgressDeniedError,
  SandboxNotFoundError,
  UnsupportedProviderOperation,
} from "./errors.js";
import {
  E2bTransportEgressBlockedError,
  E2bTransportNotFoundError,
  E2bTransportTransientError,
  type E2bRecordState,
  type E2bSandboxRecord,
  type E2bStagedFile,
  type E2bTransport,
} from "./transport.js";

const DEFAULT_TTL_MS = 60_000;

/** Which optional ops this provider exposes by default: `health` (an E2B running
 * probe) is supported; `checkpoint`/`restore` are recorded unsupported-with-
 * fallback (see the capability matrix) so the no-key contract suite naturally
 * exercises BOTH negotiation branches. Override for tests. */
export const DEFAULT_ADVERTISED_OPTIONAL_OPS: readonly ProviderOperation[] = ["health"];

export interface E2bSandboxProviderOptions {
  readonly transport: E2bTransport;
  /** The pinned E2B template alias every sandbox is created from. */
  readonly templateId?: string;
  /** The optional ops (`checkpoint`/`restore`/`health`) this provider advertises.
   * Defaults to {@link DEFAULT_ADVERTISED_OPTIONAL_OPS}. A checkpoint/restore
   * advertisement additionally requires the transport to expose `pause`/`resume`. */
  readonly advertisedOptionalOps?: readonly ProviderOperation[];
  /** Default per-op deadline when a caller passes none. */
  readonly defaultTtlMs?: number;
  /**
   * CLI-008 Unit B — how the provider turns a download grant into bytes. Injected so the
   * no-key mock lane can stage without a network, exactly as `transport` is injected.
   * Defaults to the global `fetch` against the grant's presigned URL.
   *
   * ★ The implementation MUST NOT log or re-throw the url or headers: the grant is a bearer
   * capability, and the port already classifies this class of value as sensitive.
   */
  readonly redeemDownloadGrant?: (grant: ArtifactDownloadGrantV1) => Promise<Uint8Array>;
  /**
   * DAT-009 — how the provider turns an upload grant plus bytes into a stored object.
   * Injected for the same reason `redeemDownloadGrant` is: the no-key lane must be able to
   * prove the read -> verify -> reference path with no network, and the keyed lane must be
   * able to prove the SANDBOX half against real E2B without standing up an object store.
   *
   * ★ The implementation MUST NOT log or re-throw the url or headers: the grant is a bearer
   * capability that writes an attempt-scoped object key until it expires.
   */
  readonly performUploadGrant?: (grant: ArtifactUploadGrantV1, bytes: Uint8Array) => Promise<void>;
}

/** The default redemption: a plain GET against the presigned url with the grant's headers. */
async function fetchGrantBytes(grant: ArtifactDownloadGrantV1): Promise<Uint8Array> {
  const response = await fetch(grant.url, { method: "GET", headers: { ...grant.headers } });
  if (!response.ok) {
    // The status, never the url — the url IS the capability.
    throw new Error(`staged-input download failed with status ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * The default upload: a plain PUT of the bytes against the presigned url with the grant's
 * headers, plus the checksum header the fenced commit's re-verification needs.
 *
 * ★★ `x-amz-checksum-sha256` IS NOT OPTIONAL, and this is the one non-obvious line in the
 * export path. DAT-002's live MinIO run measured that the control plane binds
 * `ChecksumAlgorithm: SHA256` when it signs but returns `headers: {}`, so the PUT itself must
 * carry the checksum; `artifact-commit.ts` then fails CLOSED when the store cannot supply one
 * to its `headObject` re-verification. An exporter that omits this header uploads
 * successfully and is rejected at commit, far away from the cause.
 *
 * The value is the BASE64 of the raw digest (S3's encoding), while the grant's
 * `expectedSha256` is hex (`sha256DigestSchema`) — two encodings of the same bytes, and
 * mixing them up produces a store-side rejection that looks like a checksum mismatch.
 */
async function putGrantBytes(grant: ArtifactUploadGrantV1, bytes: Uint8Array): Promise<void> {
  const response = await fetch(grant.url, {
    method: "PUT",
    headers: {
      // Defaults FIRST so `grant.headers` wins. The grant is the authority on what the
      // signature covers, and today it is empty (`s3-provider.ts` `presign` returns
      // `headers: {}`) — but `presign` signs `ContentType` whenever its caller supplies one,
      // and a signed content-type that disagreed with a hard-coded default here would fail
      // the signature at the store. Letting the grant override is the only ordering that
      // survives that change.
      "content-type": "application/octet-stream",
      "x-amz-checksum-sha256": createHash("sha256").update(bytes).digest("base64"),
      ...grant.headers,
    },
    // A Uint8Array is a valid BodyInit at runtime; the cast is only for the lib's
    // ArrayBufferLike variance.
    body: bytes as unknown as BodyInit,
  });
  if (!response.ok) {
    // The status, never the url — the url IS the capability.
    throw new Error(`artifact export upload failed with status ${response.status}`);
  }
}

function mapState(state: E2bRecordState): SandboxState {
  switch (state) {
    case "running":
      return "running";
    case "paused":
      return "stopped";
    case "stopped":
      return "stopped";
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

/** Deterministic parse of the round-tripped management record. */
function parseRecord(record: E2bSandboxRecord): {
  labels: ResourceLabels;
  command: string;
  env: Record<string, string>;
  workloadType: string;
} {
  const rawLabels = record.metadata[METADATA_KEYS.labels];
  const rawEnv = record.metadata[METADATA_KEYS.env];
  let labels: ResourceLabels;
  try {
    labels = JSON.parse(rawLabels ?? "{}") as ResourceLabels;
  } catch {
    labels = {} as ResourceLabels;
  }
  let env: Record<string, string> = {};
  try {
    env = JSON.parse(rawEnv ?? "{}") as Record<string, string>;
  } catch {
    env = {};
  }
  return {
    labels,
    command: record.metadata[METADATA_KEYS.command] ?? "",
    env,
    workloadType: record.metadata[METADATA_KEYS.workload] ?? "",
  };
}

export class E2bSandboxProvider implements SandboxProvider {
  readonly #transport: E2bTransport;
  readonly #templateId: string;
  readonly #defaultTtlMs: number;
  readonly #redeemDownloadGrant: (grant: ArtifactDownloadGrantV1) => Promise<Uint8Array>;
  readonly #performUploadGrant: (grant: ArtifactUploadGrantV1, bytes: Uint8Array) => Promise<void>;
  readonly advertisedOperations: ReadonlySet<ProviderOperation>;
  readonly checkpointMode: CheckpointMode;
  readonly healthMode: HealthMode;
  /**
   * DAT-009 — declared `"grant_upload"`, and this one is REAL.
   *
   * Slice 1 declared `"none"` deliberately and named the reason: the transport already has
   * `readFile`, so a real implementation is "a small, provider-specific piece", explicitly out
   * of scope for that slice (`DAT-009-slice-1-design.md` §7). This is that piece. The mode now
   * says `"grant_upload"` because the two methods below actually read the sandbox, verify what
   * they read against the grant, and move it to object storage — the same standard
   * `fileStagingMode` is held to. A provider that CLAIMED support and then fabricated a
   * reference would be the WRK-009 defect all over again, where a fabricated success is
   * byte-identical to a real one on every gate; the refusal tests below are what keep this
   * declaration honest.
   *
   * ★★ NOTHING IN PRODUCTION READS THIS FIELD — measured by search, not assumed: outside the
   * two declarations (`provider-wire/src/driver.ts`, `supervisor/noop-provider.ts`), the port's
   * own type, and tests, the only reads are the two decline guards in this file. No supervisor,
   * placement or hello builder branches on it. So flipping it from `"none"` changes NO runtime
   * behaviour anywhere today; it becomes consultable when link 3 exists to consult it.
   *
   * ★ WHAT THIS DOES NOT DO. Declaring the mode does not put an artifact on any run.
   * Nothing in production calls `exportArtifact` — the worker-side sequencer
   * (digest → mint grant → export → commit) is DAT-009 slice 3 and is unbuilt — and the
   * kind an exported object is committed under is the COMMITTER's decision, not this
   * provider's. `countProducedOutputs` filters `kind = 'workspace_patch'`
   * (`e7-distributed-run-verifier-store.ts:201-211`), so this file moves no capability
   * counter. See `CLI-008-unit-f-design.md` §1.6 link 2.
   */
  readonly artifactExportMode: ArtifactExportMode = "grant_upload";

  /**
   * CLI-008 Unit B — declared `"grant_download"`, and this one is REAL.
   *
   * Unlike `artifactExportMode` above (honestly `"none"` because slice 1 left the
   * implementation out of scope), staging is implemented here over the transport's existing
   * `writeFiles`, which both drivers already have. Declaring support this provider did not
   * have would be the WRK-009 defect; declaring `"none"` for one it does have would leave the
   * capability unreachable. It has it, so it says so.
   */
  readonly fileStagingMode: FileStagingMode = "grant_download";

  /** Idempotency ledger: a stable create key → the recorded resource. A replayed
   * key returns the SAME sandbox and never provisions a second one. */
  readonly #idempotency = new Map<string, { sandboxId: string; resourceLabels: ResourceLabels }>();
  #opCounter = 0;

  constructor(options: E2bSandboxProviderOptions) {
    this.#transport = options.transport;
    this.#templateId = options.templateId ?? "base";
    this.#defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.#redeemDownloadGrant = options.redeemDownloadGrant ?? fetchGrantBytes;
    this.#performUploadGrant = options.performUploadGrant ?? putGrantBytes;

    const requested = new Set<string>((options.advertisedOptionalOps ?? DEFAULT_ADVERTISED_OPTIONAL_OPS).map(String));
    const advertised = new Set<ProviderOperation>(CORE_PROVIDER_OPERATIONS);
    // checkpoint/restore require BOTH advertisement AND transport pause/resume.
    const canCheckpoint = requested.has("checkpoint") && typeof this.#transport.pause === "function";
    const canRestore = requested.has("restore") && typeof this.#transport.resume === "function";
    if (canCheckpoint) advertised.add("checkpoint");
    if (canRestore) advertised.add("restore");
    if (requested.has("health")) advertised.add("health");
    this.advertisedOperations = advertised;
    this.checkpointMode = canCheckpoint ? "snapshot" : "none";
    this.healthMode = requested.has("health") ? "poll" : "none";
  }

  #nextOpId(op: ProviderOperation): string {
    this.#opCounter += 1;
    return `e2b-${op}-${this.#opCounter}`;
  }

  #ttl(ctx: ProviderOpContext): number {
    return ctx.deadlineMs > 0 ? ctx.deadlineMs : this.#defaultTtlMs;
  }

  async create(spec: CreateSandboxSpec, ctx: ProviderOpContext): Promise<CreateResult> {
    const key = ctx.idempotencyKey;
    if (key) {
      const existing = this.#idempotency.get(key);
      if (existing) {
        return { sandboxId: existing.sandboxId, providerOpId: this.#nextOpId("create"), resourceLabels: existing.resourceLabels };
      }
    }
    // The management record the transport round-trips (labels/command/workload only).
    //
    // ★ [Cred-1] (DEP-012 Slice 4+5) — the tenant `env` is DELIBERATELY NOT written into
    // durable E2B metadata. A real transport persists `metadata` in E2B cloud (returned by
    // Sandbox.list()/getInfo()), so a `[METADATA_KEYS.env]: JSON.stringify(spec.env)` copy
    // would leave the tenant model-provider key AT REST in a shared-account durable store —
    // forbidden by Decision #104 (the credential must not hit a durable store). The copy was
    // REDUNDANT: `env` still reaches the running sandbox via the necessary `envVars` channel
    // below; its only reader was `inspect`, whose gated wire ALWAYS redacts env, and `list`
    // dropped it. The deterministic MOCK now decodes its create-fault directives from
    // `req.envVars` (which carries the same env), not from this metadata.
    const metadata: Record<string, string> = {
      [METADATA_KEYS.labels]: JSON.stringify(spec.resourceLabels),
      [METADATA_KEYS.command]: spec.command,
      [METADATA_KEYS.workload]: spec.workloadType,
    };
    const { sandboxId } = await this.#transport.create({
      templateId: this.#templateId,
      timeoutMs: this.#ttl(ctx),
      metadata,
      // The necessary channel: E2B needs the env to run the sandbox. NOT durable metadata.
      envVars: spec.env,
    });
    // Every sandbox gets an enforced TTL (idempotent belt-and-suspenders).
    await this.#transport.setTimeout(sandboxId, this.#ttl(ctx));
    if (key) this.#idempotency.set(key, { sandboxId, resourceLabels: spec.resourceLabels });
    return { sandboxId, providerOpId: this.#nextOpId("create"), resourceLabels: spec.resourceLabels };
  }

  async execute(input: ExecuteInput, ctx: ProviderOpContext): Promise<ExecuteResult> {
    // Driver-owned command budget. A non-positive deadline is an exhausted budget →
    // a DETERMINISTIC timedOut terminal, enforced HERE rather than delegated to the
    // transport: E2B treats `timeoutMs = 0` as "disable/default" (never an instant
    // kill, returning timedOut:false), so trusting the transport's verdict on a zero
    // budget would invert the "never hangs, always bounded" guarantee against real
    // E2B. The driver owns the zero-budget verdict; a POSITIVE budget is enforced by
    // the transport's own command timeout (real E2B honours a positive timeoutMs, and
    // the keyed lane asserts a long command is killed at its budget).
    if (ctx.deadlineMs <= 0) {
      return {
        providerOpId: this.#nextOpId("execute"),
        exitCode: null,
        signal: "SIGKILL",
        timedOut: true,
        stdoutRef: `ref:stdout:${input.sandboxId}`,
        stderrRef: `ref:stderr:${input.sandboxId}`,
      };
    }
    try {
      const result = await this.#transport.runCommand({
        sandboxId: input.sandboxId,
        command: input.command,
        args: input.args,
        envVars: input.env,
        // Positive command budget: forwarded as the transport command timeout.
        timeoutMs: ctx.deadlineMs,
      });
      return {
        providerOpId: this.#nextOpId("execute"),
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        // No customer bytes cross this boundary — opaque references only (E5).
        stdoutRef: `ref:stdout:${input.sandboxId}`,
        stderrRef: `ref:stderr:${input.sandboxId}`,
      };
    } catch (err) {
      if (err instanceof E2bTransportEgressBlockedError) {
        throw new SandboxEgressDeniedError(err.destinationClass);
      }
      if (err instanceof E2bTransportNotFoundError) throw new SandboxNotFoundError();
      throw err;
    }
  }

  async cancel(sandboxId: string, _ctx: ProviderOpContext): Promise<StopResult> {
    const result = await this.#transport.signal(sandboxId, "cancel");
    return { providerOpId: this.#nextOpId("cancel"), outcome: result.delivered ? "stopped" : "ignored" };
  }

  async kill(sandboxId: string, _ctx: ProviderOpContext): Promise<StopResult> {
    const result = await this.#transport.signal(sandboxId, "kill");
    return { providerOpId: this.#nextOpId("kill"), outcome: result.delivered ? "stopped" : "ignored" };
  }

  async destroy(sandboxId: string, _ctx: ProviderOpContext): Promise<CleanupResult> {
    return this.#reclaim("destroy", sandboxId);
  }

  async reconcileCleanup(sandboxId: string, _ctx: ProviderOpContext): Promise<CleanupResult> {
    return this.#reclaim("reconcile_cleanup", sandboxId);
  }

  /** Terminate + reclaim. A transient transport failure is REPORTED as failed —
   * never thrown — so the cleanup convergence can retry it idempotently. An
   * already-gone sandbox is a converged success (idempotent). */
  async #reclaim(op: ProviderOperation, sandboxId: string): Promise<CleanupResult> {
    try {
      await this.#transport.terminate(sandboxId);
      return { providerOpId: this.#nextOpId(op), cleanupStatus: "success" };
    } catch (err) {
      if (err instanceof E2bTransportNotFoundError) {
        return { providerOpId: this.#nextOpId(op), cleanupStatus: "success" };
      }
      if (err instanceof E2bTransportTransientError) {
        return { providerOpId: this.#nextOpId(op), cleanupStatus: "failed" };
      }
      throw err;
    }
  }

  async list(input: ListInput, _ctx: ProviderOpContext): Promise<ListResult> {
    const providerOpId = this.#nextOpId("list");
    const page = await this.#transport.list({ pageSize: input.pageSize, pageToken: input.pageToken ?? null });
    const resources: ResourceSummary[] = page.items
      .map((record) => {
        const parsed = parseRecord(record);
        return {
          sandboxId: record.sandboxId,
          resourceLabels: parsed.labels,
          generation: parsed.labels.deviceGeneration ?? 0,
          state: mapState(record.state),
          hasLiveLease: record.state === "running",
        };
      })
      // DRIVER-OWNED deterministic ordering: real E2B does not promise a stable total
      // order across two list walks, so the driver sorts each page by the opaque
      // resource id. This makes the contract §8 pagination-determinism guarantee a
      // property of the driver's projection, not an artifact of a transport double.
      .sort((a, b) => (a.sandboxId < b.sandboxId ? -1 : a.sandboxId > b.sandboxId ? 1 : 0));
    return { providerOpId, resources, nextPageToken: page.nextPageToken };
  }

  async inspect(sandboxId: string, _ctx: ProviderOpContext): Promise<InspectResult> {
    let record: E2bSandboxRecord;
    try {
      record = await this.#transport.getInfo(sandboxId);
    } catch (err) {
      if (err instanceof E2bTransportNotFoundError) throw new SandboxNotFoundError();
      throw err;
    }
    const parsed = parseRecord(record);
    // The FULL, sensitive detail — held here so the cleanup authority's redaction
    // is non-vacuous. `list` deliberately never carries any of this.
    return {
      providerOpId: this.#nextOpId("inspect"),
      sandboxId: record.sandboxId,
      resourceLabels: parsed.labels,
      generation: parsed.labels.deviceGeneration ?? 0,
      state: mapState(record.state),
      command: parsed.command,
      env: parsed.env,
      logs: [],
      workspaceBytes: 0,
      objectGrants: [],
      secrets: {},
    };
  }

  /**
   * Read an in-sandbox file's bytes, mapping the transport's not-found onto the domain one.
   *
   * ★ BOTH drivers throw `E2bTransportNotFoundError` for a missing SANDBOX and for a missing
   * PATH alike (`real-transport.ts` `readFile`, `mock-transport.ts` `readFile`), and the
   * distinction does not matter here: either way there is nothing to describe, and the answer
   * must stay a THROW. A fabricated digest would mint a grant for bytes that do not exist and
   * push the refusal all the way out to the fenced commit, far from its cause.
   */
  async #readArtifactBytes(sandboxId: string, path: string): Promise<Uint8Array> {
    try {
      return await this.#transport.readFile(sandboxId, path);
    } catch (err) {
      if (err instanceof E2bTransportNotFoundError) throw new SandboxNotFoundError();
      throw err;
    }
  }

  /**
   * DAT-009 — describe an in-sandbox file. METADATA ONLY; never content.
   *
   * The digest and the size are what let the worker mint a grant at all:
   * `artifactTransferGrantRequestV1Schema` requires BOTH `expectedSha256` and `maxBytes`, and
   * only the provider can see inside the sandbox. That is the whole reason this is a separate
   * operation from the export rather than one call.
   */
  async digestArtifact(sandboxId: string, path: string, _ctx: ProviderOpContext): Promise<ArtifactDigestResult> {
    // ★ HONEST LABEL: this guard is UNREACHABLE BY CONSTRUCTION here, because the mode above is a
    // hard-coded literal. It is kept for exact symmetry with `stageFiles`'s identical shipped
    // guard, and because the port's contract is "the methods are present on every implementer and
    // only SUPPORT is optional" — so the decline path must exist even when this implementer never
    // takes it. It is a contract stub, NOT a live check, and no mutation can kill it; saying so is
    // the difference between a documented stub and a false claim of enforcement.
    if (this.artifactExportMode === "none") throw new UnsupportedProviderOperation("digest_artifact");
    const bytes = await this.#readArtifactBytes(sandboxId, path);
    return { sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.byteLength };
  }

  /**
   * DAT-009 — move an in-sandbox file to object storage under `grant`, returning a REFERENCE.
   *
   * Grant in, reference out: the bytes go sandbox -> provider -> store and never cross this
   * port. That is the exact inversion of `stageFiles`, and it is what the byte-egress decision
   * (Option D) requires — the daemon is dependency-pinned precisely so it never handles them.
   *
   * ★★ VERIFY BEFORE UPLOADING, and this is not the same check the store does. The grant was
   * minted from a PRIOR `digestArtifact` call, so between the two the file can have grown or
   * changed — a long-running agent still writing, a retry against a mutated sandbox. Re-hashing
   * here refuses AT THE CAUSE. Without it the PUT succeeds, and the fenced commit's `headObject`
   * re-verification rejects a checksum that no longer matches the manifest, in a different
   * process, with nothing left to point at. The size check is separate and comes first: a file
   * that outgrew its grant must not be uploaded at all.
   *
   * Errors carry the path and the digests, never the grant, the url or the headers.
   */
  async exportArtifact(
    sandboxId: string,
    path: string,
    grant: ArtifactUploadGrantV1,
    _ctx: ProviderOpContext,
  ): Promise<ArtifactExportResult> {
    // Unreachable by construction, exactly as in `digestArtifact` above — see the note there.
    if (this.artifactExportMode === "none") throw new UnsupportedProviderOperation("export_artifact");
    const bytes = await this.#readArtifactBytes(sandboxId, path);
    if (bytes.byteLength > grant.maxBytes) {
      throw new Error(`artifact at ${path} is ${bytes.byteLength} bytes, over the granted ${grant.maxBytes}`);
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== grant.expectedSha256) {
      // The digests, never the url.
      throw new Error(`artifact at ${path} hashed ${digest}, expected ${grant.expectedSha256}`);
    }
    await this.#performUploadGrant(grant, bytes);
    return { objectKey: grant.objectKey };
  }

  /**
   * CLI-008 Unit B — redeem each grant and write the bytes into the sandbox.
   *
   * ★ VERIFY BEFORE WRITING. The digest and the size are checked against the grant's own
   * `expectedSha256`/`maxBytes` before a single byte reaches `writeFiles`. Without that, a
   * store that served the wrong object — or a truncated response — produces a sandbox whose
   * agent works from the wrong instructions and whose run terminalizes cleanly, which is
   * indistinguishable from success on every gate downstream.
   *
   * ALL-OR-NOTHING: every file is fetched and verified first, and the single `writeFiles`
   * call happens only if all of them passed. A partial stage is worse than no stage, because
   * the agent cannot tell which files it is missing.
   *
   * Errors never carry the grant, the url or the headers.
   */
  async stageFiles(
    sandboxId: string,
    files: readonly StagedFileRequest[],
    _ctx: ProviderOpContext,
  ): Promise<StageFilesResult> {
    if (this.fileStagingMode === "none") throw new UnsupportedProviderOperation("stage_files");
    if (files.length === 0) return { stagedPaths: [] };
    const staged: E2bStagedFile[] = [];
    for (const file of files) {
      const bytes = await this.#redeemDownloadGrant(file.grant);
      if (bytes.byteLength > file.grant.maxBytes) {
        throw new Error(
          `staged-input for ${file.path} is ${bytes.byteLength} bytes, over the granted ${file.grant.maxBytes}`,
        );
      }
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== file.grant.expectedSha256) {
        // The digests, never the url.
        throw new Error(
          `staged-input for ${file.path} hashed ${digest}, expected ${file.grant.expectedSha256}`,
        );
      }
      staged.push({ path: file.path, bytes });
    }
    await this.#transport.writeFiles(sandboxId, staged);
    return { stagedPaths: staged.map((file) => file.path) };
  }

  async checkpoint(sandboxId: string, _ctx: ProviderOpContext): Promise<CheckpointResult> {
    if (!this.advertisedOperations.has("checkpoint") || typeof this.#transport.pause !== "function") {
      throw new UnsupportedProviderOperation("checkpoint");
    }
    const { snapshotId } = await this.#transport.pause(sandboxId);
    return { providerOpId: this.#nextOpId("checkpoint"), mode: this.checkpointMode, checkpointRef: snapshotId };
  }

  async restore(sandboxId: string, _ctx: ProviderOpContext): Promise<RestoreResult> {
    if (!this.advertisedOperations.has("restore") || typeof this.#transport.resume !== "function") {
      throw new UnsupportedProviderOperation("restore");
    }
    await this.#transport.resume(sandboxId);
    return { providerOpId: this.#nextOpId("restore"), restored: true };
  }

  async health(sandboxId: string, _ctx: ProviderOpContext): Promise<HealthResult> {
    if (!this.advertisedOperations.has("health")) {
      throw new UnsupportedProviderOperation("health");
    }
    const running = await this.#transport.isRunning(sandboxId);
    return { providerOpId: this.#nextOpId("health"), mode: "poll", status: running ? "healthy" : "unhealthy" };
  }
}
