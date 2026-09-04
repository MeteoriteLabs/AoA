/**
 * `EffectAuthority` — the ONLY path that may create/execute/resume/checkpoint
 * (WRK-004).
 *
 * It is ISSUED while the lease/fence is active and is the sole authority for the
 * "productive" provider ops plus the happy-path completion `destroy`. Once the
 * lease is lost/replaced/expired the supervisor WITHDRAWS it; every subsequent
 * effectful op throws {@link EffectAuthorityWithdrawnError}, and only the
 * (distinct) `CleanupAuthority` may act. Withdrawal is terminal and idempotent —
 * an EffectAuthority can NEVER be resurrected (a fresh lease issues a fresh one).
 *
 * The authority is a thin GATE over the provider: it does not generate op
 * contexts (the supervisor supplies stable `idempotencyKey`s + deadlines) — it
 * only enforces the active-fence invariant before every effectful call.
 *
 * Runtime imports: relative `provider.ts` only — the E4-D01 boundary. The one non-relative
 * import is TYPE-ONLY (`ArtifactUploadGrantV1`, the frozen grant `exportArtifact` carries), so
 * it is erased at compile time and adds no runtime edge; worker-protocol is an allowed
 * dependency either way.
 */

import type { ArtifactUploadGrantV1 } from "@armyofagents/worker-protocol";

import type {
  ArtifactDigestResult,
  ArtifactExportResult,
  CheckpointResult,
  CleanupResult,
  CreateResult,
  CreateSandboxSpec,
  ExecuteInput,
  ExecuteResult,
  HealthResult,
  ProviderOpContext,
  RestoreResult,
  SandboxProvider,
  StageFilesResult,
  StagedFileRequest,
} from "./provider.js";

/** The lease fence an EffectAuthority is bound to. Effect authority is valid ONLY
 * while THIS fence is the live one; a replacement/expiry withdraws it. */
export interface EffectFence {
  readonly jobId: string;
  readonly attempt: number;
  readonly leaseId: string;
  readonly fenceToken: string;
  readonly deviceGeneration: number;
  /** The highest event `seq` observed under this fence (correlation only). */
  readonly observedSeq: number;
}

/** Thrown by every effectful op once the effect authority has been withdrawn. */
export class EffectAuthorityWithdrawnError extends Error {
  readonly leaseId: string;
  constructor(leaseId: string) {
    super("effect authority has been withdrawn; only the cleanup authority may act");
    this.name = "EffectAuthorityWithdrawnError";
    this.leaseId = leaseId;
  }
}

export class EffectAuthority {
  readonly #provider: SandboxProvider;
  readonly #fence: EffectFence;
  #active = true;

  constructor(provider: SandboxProvider, fence: EffectFence) {
    this.#provider = provider;
    this.#fence = fence;
  }

  get fence(): EffectFence {
    return this.#fence;
  }

  isActive(): boolean {
    return this.#active;
  }

  /** Withdraw effect authority (idempotent, terminal). After this, every
   * effectful op throws and the supervisor must route through cleanup only. */
  withdraw(): void {
    this.#active = false;
  }

  #guard(): void {
    if (!this.#active) throw new EffectAuthorityWithdrawnError(this.#fence.leaseId);
  }

  create(spec: CreateSandboxSpec, ctx: ProviderOpContext): Promise<CreateResult> {
    this.#guard();
    return this.#provider.create(spec, ctx);
  }

  execute(input: ExecuteInput, ctx: ProviderOpContext): Promise<ExecuteResult> {
    this.#guard();
    return this.#provider.execute(input, ctx);
  }

  /**
   * CLI-008 Unit B — write the control plane's files into the sandbox before the tenant
   * command starts.
   *
   * Gated here with everything else effectful, and that is not a formality: staging writes
   * into a live sandbox, so a run whose lease was replaced must not still be putting files
   * into the sandbox its successor is about to use.
   */
  stageFiles(
    sandboxId: string,
    files: readonly StagedFileRequest[],
    ctx: ProviderOpContext,
  ): Promise<StageFilesResult> {
    this.#guard();
    return this.#provider.stageFiles(sandboxId, files, ctx);
  }

  /**
   * DAT-009 slice 3 — describe an in-sandbox file (METADATA ONLY; never content), the first
   * of the four steps that return a byte to the control plane.
   *
   * ★ GATED HERE FOR THE SAME REASON `stageFiles` IS, and it is not a formality. DAT-009 slice
   * 1 grew the PORT with `digestArtifact`/`exportArtifact` and did not grow this authority, so
   * until now the only way to reach them was to call the provider directly — which is exactly
   * the "second, quieter door onto a gated action" DAT-009 slice 2 §4 names. A run whose lease
   * was replaced must not still be reading out of the sandbox its successor is about to use,
   * and must certainly not still be redeeming a bearer grant minted under the dead fence.
   */
  digestArtifact(sandboxId: string, path: string, ctx: ProviderOpContext): Promise<ArtifactDigestResult> {
    this.#guard();
    return this.#provider.digestArtifact(sandboxId, path, ctx);
  }

  /**
   * DAT-009 slice 3 — upload an in-sandbox file directly to object storage under `grant`,
   * returning a REFERENCE. The bytes go sandbox → provider → store and never cross this class.
   *
   * ★ `grant` IS A BEARER CAPABILITY and this authority is the last gate before it reaches an
   * implementation. It must not be logged here, and a withdrawn authority must refuse before
   * the grant is passed on at all — a redeemed grant cannot be recalled, because no revocation
   * concept exists and the TTL is the only revocation mechanism (DAT-009 slice 2 §6).
   */
  exportArtifact(
    sandboxId: string,
    path: string,
    grant: ArtifactUploadGrantV1,
    ctx: ProviderOpContext,
  ): Promise<ArtifactExportResult> {
    this.#guard();
    return this.#provider.exportArtifact(sandboxId, path, grant, ctx);
  }

  /** Resume a checkpointed sandbox (the frozen optional `restore` op). Effectful:
   * denied under cleanup authority, gated here on the active fence. */
  resume(sandboxId: string, ctx: ProviderOpContext): Promise<RestoreResult> {
    this.#guard();
    return this.#provider.restore(sandboxId, ctx);
  }

  checkpoint(sandboxId: string, ctx: ProviderOpContext): Promise<CheckpointResult> {
    this.#guard();
    return this.#provider.checkpoint(sandboxId, ctx);
  }

  /** Live health probe of a running sandbox — an effect-side monitoring op (never
   * available to cleanup). */
  health(sandboxId: string, ctx: ProviderOpContext): Promise<HealthResult> {
    this.#guard();
    return this.#provider.health(sandboxId, ctx);
  }

  /** Happy-path completion teardown ("destroy under effect authority"). Abnormal
   * teardown (cancel/lease-loss/shutdown) escalates through the CleanupAuthority
   * instead. */
  destroy(sandboxId: string, ctx: ProviderOpContext): Promise<CleanupResult> {
    this.#guard();
    return this.#provider.destroy(sandboxId, ctx);
  }
}
