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
 * Runtime imports: relative `provider.ts` only — the E4-D01 boundary.
 */

import type {
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
