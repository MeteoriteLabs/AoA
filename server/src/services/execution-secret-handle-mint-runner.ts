// server/src/services/execution-secret-handle-mint-runner.ts
//
// DAT-008 slice 1 — the IMPURE half of the mint: gather the decision's inputs from
// the locked placement context, ask the pure `decideExecutionSecretHandle`, and write
// the row. Split from the decision so the guards stay directly unit- and
// mutation-testable without a database (`execution-secret-handle-mint.ts`).
//
// It runs INSIDE the placement transaction, under the same lock that just decided
// the placement, because the handle is pinned to the placed target generation. A
// refusal is not an error: most jobs legitimately mint nothing (self-hosted, a
// non-agent executor, an adapter outside the v1 scope), so the caller records the
// reason and carries on. Placement must never fail because a credential could not
// be bound — that would take out the legacy path too.

import { randomUUID } from "node:crypto";
import { getDeploymentMode } from "../config/deployment-mode.js";
import { canonicalizeBinding, companyKeyTargetForAdapter } from "./secrets.js";
import {
  decideExecutionSecretHandle,
  type CanonicalProviderBinding,
  type ExecutionSecretMintDecision,
} from "./execution-secret-handle-mint.js";
import type { EnvBinding } from "@armyofagents/shared";

/** The repository surface this runner needs — the two DAT-008 methods only, so a
 * unit test can supply a pair of functions instead of a whole tenant repo. */
export interface ExecutionSecretMintRepo {
  loadAgentAdapterBinding(input: { companyId: string; agentId: string }):
    Promise<{ adapterType: string; adapterConfig: Record<string, unknown> } | null>;
  insertExecutionSecretHandle(input: {
    organizationId: string;
    companyId: string;
    jobId: string;
    handle: string;
    refKind: "provider_key" | "company_secret";
    refId: string;
    materialization: "env";
    usePolicy: "sandbox_local_only";
    envTarget: string;
    boundTargetGeneration: number | null;
    ownerPrincipalKind: string | null;
    ownerPrincipalId: string | null;
  }): Promise<{ handle: string; minted: boolean }>;
}

export interface MintExecutionSecretHandleInput {
  readonly organizationId: string;
  readonly companyId: string;
  readonly jobId: string;
  readonly executorPrincipalKind: string;
  readonly executorPrincipalId: string;
  readonly placementOwner: string | null;
  readonly credentialKind: string | null;
  readonly targetGeneration: number | null;
  /** Injected in tests; production reads the process deployment mode. */
  readonly deploymentMode?: string;
  readonly newHandleId?: () => string;
}

export type MintExecutionSecretHandleOutcome =
  | { readonly minted: true; readonly handle: string; readonly refKind: string; readonly deduped: boolean }
  | { readonly minted: false; readonly reason: string };

/** Pull the canonical binding for ONE env var out of an agent's adapterConfig.
 * Returns null when the agent sets no value for it — the `needsCompanyKeyFallback`
 * condition. A malformed binding is treated as PRESENT-but-unusable (`plain`) rather
 * than absent: falling back to the company key on a binding we failed to parse would
 * substitute a credential precisely where the agent's intent is unclear. */
export function providerBindingForEnvVar(
  adapterConfig: Record<string, unknown>,
  envVar: string,
): CanonicalProviderBinding | null {
  const env = adapterConfig.env;
  if (typeof env !== "object" || env === null || Array.isArray(env)) return null;
  const raw = (env as Record<string, unknown>)[envVar];
  if (raw === undefined) return null;
  let canonical;
  try {
    canonical = canonicalizeBinding(raw as EnvBinding);
  } catch {
    return { type: "plain" };
  }
  if (canonical.type !== "secret_ref") return { type: "plain" };
  // `canonicalizeBinding` does NOT validate: a malformed non-string binding (a
  // number, `{}`, `{type:"bogus"}`) falls through to its secret_ref arm and yields
  // `secretId: undefined`. Trusting that would mint a `company_secret` handle
  // pointing at nothing, and the failure would surface much later as an opaque
  // resolve denial. An unusable reference is treated as an override we cannot
  // represent — refuse, never substitute the company key.
  if (typeof canonical.secretId !== "string" || canonical.secretId.length === 0) return { type: "plain" };
  return { type: "secret_ref", secretId: canonical.secretId, version: canonical.version };
}

export async function mintExecutionSecretHandleForPlacement(
  repo: ExecutionSecretMintRepo,
  input: MintExecutionSecretHandleInput,
): Promise<MintExecutionSecretHandleOutcome> {
  const deploymentMode = input.deploymentMode ?? getDeploymentMode();

  // The agent lookup is deliberately AFTER nothing and BEFORE the decision, but the
  // decision re-checks the executor kind itself: this runner must not become a second
  // place where "is this an agent run?" is answered.
  const agent = input.executorPrincipalKind === "agent"
    ? await repo.loadAgentAdapterBinding({ companyId: input.companyId, agentId: input.executorPrincipalId })
    : null;

  const target = agent ? companyKeyTargetForAdapter(agent.adapterType) : null;

  const decision: ExecutionSecretMintDecision = decideExecutionSecretHandle({
    deploymentMode,
    adapterType: agent?.adapterType ?? "",
    executorPrincipalKind: input.executorPrincipalKind,
    providerKeyTarget: target,
    providerBinding: agent && target
      ? providerBindingForEnvVar(agent.adapterConfig, target.envVar)
      : null,
    placementOwner: input.placementOwner,
    credentialKind: input.credentialKind,
    targetGeneration: input.targetGeneration,
  });

  if (!decision.mint) return { minted: false, reason: decision.reason };

  // The frozen wire demands a branded UUID handle id (`secretHandleIdSchema`) while the
  // column is untyped text. A slug here mints an envelope that fails validation and the
  // job silently never leases — so the id is generated, never derived from a name.
  const handle = (input.newHandleId ?? randomUUID)();
  const written = await repo.insertExecutionSecretHandle({
    organizationId: input.organizationId,
    companyId: input.companyId,
    jobId: input.jobId,
    handle,
    refKind: decision.refKind,
    refId: decision.refId,
    materialization: "env",
    usePolicy: "sandbox_local_only",
    envTarget: decision.envTarget,
    boundTargetGeneration: decision.boundTargetGeneration,
    // Denormalized from the job's executing principal, so `resolveExecutionSecret` can
    // re-derive the owner from the LOCKED job row rather than trusting a request.
    ownerPrincipalKind: input.executorPrincipalKind,
    ownerPrincipalId: input.executorPrincipalId,
  });

  return { minted: true, handle: written.handle, refKind: decision.refKind, deduped: !written.minted };
}
