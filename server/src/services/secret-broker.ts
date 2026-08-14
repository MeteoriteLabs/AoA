// server/src/services/secret-broker.ts
//
// DAT-004 — the lease-scoped secret broker: it maps an OPAQUE execution secret handle
// onto one of the four existing value stores and resolves the value ONLY behind an
// active, per-request fence. It is a PURE control-plane orchestrator — there is NO
// `secret_resolve` wire op (the frozen 10-op list is closed); resolution is in-band +
// behind the fence proxy. It mirrors `artifact-commit.ts` / `patch-apply.ts`'s one-tx,
// fence-first, no-early-broker-access template.
//
// Ordering + precedence (the hard invariant, mirroring the DAT-002 no-early-probe lesson):
//   1. ONE `runInTenant` tx: `resolveWorkerFenceContext` resolves the fence IDENTITY
//      first — a foreign/unresolvable fence throws `JobLeasingError` BEFORE any handle
//      row OR any broker/value store is ever touched, so neither is a cross-tenant oracle.
//   2. The guarded `resolveExecutionSecret` mutator runs `guardActiveFence` FIRST (a
//      stale/terminal/revoked fence surfaces as `stale_fence`/`attempt_terminal`/
//      `target_revoked`), then re-derives the LOCKED job owner + re-checks the owner's
//      ACTIVE company membership + re-verifies the materialization×use_policy /
//      sandbox-vs-network-destination / bound_target_generation invariants
//      (`authorizeSecretResolve`), and writes the audit-as-columns. It returns the
//      AUTHORIZED non-secret binding ONLY — NEVER a value.
//   3. ONLY AFTER the fence + authorization: dispatch by `ref_kind` to the legacy broker
//      to obtain the value, returned to the fence-aware proxy / remote-service seam —
//      NEVER onto a wire message, NEVER into the sandbox for a network-use handle.
//      `device_local` returns a HANDOFF DESCRIPTOR (no value) — the value never leaves
//      the OS keystore (DSK/E10 reads it via this descriptor).
//
// Every non-fence refusal is coarse, non-disclosing `malformed` (a resolve refusal must
// never disclose which invariant a foreign caller tripped, nor whether a foreign handle
// exists). DAT-004 BINDS the destination + authorizes + resolves; the fence-aware egress
// proxy that MATERIALIZES the value + enforces the destination is DAT-005 (non-goal here).

import type { AuthorizedSecretResolution, Db } from "@armyofagents/db";
import {
  JobFenceError as DbJobFenceError,
  SecretResolveRejection,
  type JobFenceErrorCode,
} from "@armyofagents/db";
import { runInTenant } from "../db/tenant-context.js";
import { JobLeasingError, type VerifiedWorkerOperation } from "./job-leasing.js";
import { resolveWorkerFenceContext } from "./worker-fence-context.js";

/** A guarded-fence refusal → the frozen protocol reason vocabulary. */
function fenceReason(code: JobFenceErrorCode): "stale_fence" | "attempt_terminal" | "target_revoked" {
  return code;
}

/** The resolve request. Not a frozen wire op — the caller presents the same complete
 * active fence as a commit plus the opaque handle id to resolve. */
export interface SecretResolveRequestV1 {
  workerId: string;
  jobId: string;
  attempt: number;
  leaseId: string;
  fenceToken: string;
  /** The opaque execution-secret handle id (the `handle` column value). */
  handleId: string;
}

export type SecretDeliverySeam = "fence_proxy" | "remote_server_fenced" | "sandbox_local_only";

/**
 * The resolved secret material handed to the DAT-005 fence-aware proxy (`fence_proxy`),
 * the fenced remote service (`remote_server_fenced`), or the fenced sandbox-local
 * materializer (`sandbox_local_only`, non-network). It is an IN-PROCESS control-plane
 * handoff: it is NEVER serialized onto the worker protocol (the frozen
 * `FORBIDDEN_WIRE_KEYS` rejects any nested token) and, for a network-use handle
 * (`fence_proxy` / `remote_server_fenced`), NEVER placed into the sandbox env.
 */
export interface FenceResolvedMaterial {
  value: string;
  materialization: "proxy" | "env" | "file";
  /** The bound egress destination (null for a sandbox-local, non-network handle). */
  destination: string | null;
}

/**
 * `device_local`: the control-plane REFERENCE + authorization ONLY. The value never
 * leaves the OS keystore — DSK/E10 reads it via this descriptor. There is NO value
 * field here (invariant #1: device_local returns a handoff descriptor, never a value).
 */
export interface DeviceLocalHandoff {
  refKind: "device_local";
  refId: string;
  ownerPrincipalKind: string | null;
  ownerPrincipalId: string | null;
  materialization: "proxy" | "env" | "file";
  usePolicy: SecretDeliverySeam;
}

export type SecretResolveOutcome =
  | { outcome: "resolved"; seam: SecretDeliverySeam; material: FenceResolvedMaterial }
  | { outcome: "device_handoff"; handoff: DeviceLocalHandoff }
  | { outcome: "denied"; reason: "stale_fence" | "attempt_terminal" | "target_revoked" | "malformed" };

/**
 * The legacy value-store brokers the resolver dispatches to. Injected so the service is
 * testable without live secret infra, and so DAT-005 can wire the real chokepoints:
 *   - `connector_oauth` → the existing MCP-OAuth path (`mcp:oauth:<id>` company secret);
 *     the token is rendered into fence-proxy request HEADERS at delivery — never a spec.
 *   - `provider_key` / `company_secret` → `resolveSecretValue` (secrets.ts) / the
 *     provider resolver.
 * A broker is invoked ONLY after the fence + authorization admit the resolve.
 */
export interface SecretBrokerSet {
  resolveConnectorOAuth(input: { companyId: string; refId: string }): Promise<string>;
  resolveProviderOrCompanySecret(input: {
    companyId: string;
    refKind: "provider_key" | "company_secret";
    refId: string;
  }): Promise<string>;
}

/** The default fail-closed broker set: every store throws until DAT-005 wires the real
 * chokepoints. Resolution is authorized but cannot leak a value through an unwired seam. */
export const failClosedSecretBrokers: SecretBrokerSet = {
  async resolveConnectorOAuth() {
    throw new Error("connector_oauth broker not wired (DAT-005)");
  },
  async resolveProviderOrCompanySecret() {
    throw new Error("provider/company secret broker not wired (DAT-005)");
  },
};

/**
 * Dispatch an AUTHORIZED resolution to its legacy broker + delivery seam. PURE of the
 * fence/DB layer (it runs AFTER the fenced authorization), so it is unit-testable
 * directly. `device_local` short-circuits to a handoff descriptor (NO value) BEFORE any
 * broker is touched — the value stays in the OS keystore regardless of its use policy.
 */
export async function dispatchResolvedSecret(
  authorized: AuthorizedSecretResolution,
  brokers: SecretBrokerSet,
): Promise<SecretResolveOutcome> {
  // device_local: never resolve a value — return the control-plane handoff descriptor.
  if (authorized.refKind === "device_local") {
    return {
      outcome: "device_handoff",
      handoff: {
        refKind: "device_local",
        refId: authorized.refId,
        ownerPrincipalKind: authorized.ownerPrincipalKind,
        ownerPrincipalId: authorized.ownerPrincipalId,
        materialization: authorized.materialization,
        usePolicy: authorized.usePolicy,
      },
    };
  }

  let value: string;
  if (authorized.refKind === "connector_oauth") {
    value = await brokers.resolveConnectorOAuth({ companyId: authorized.companyId, refId: authorized.refId });
  } else {
    // provider_key | company_secret
    value = await brokers.resolveProviderOrCompanySecret({
      companyId: authorized.companyId,
      refKind: authorized.refKind,
      refId: authorized.refId,
    });
  }

  return {
    outcome: "resolved",
    seam: authorized.usePolicy,
    material: {
      value,
      materialization: authorized.materialization,
      destination: authorized.destination,
    },
  };
}

export function createSecretBrokerService(input: {
  appDb: Db;
  brokers?: SecretBrokerSet;
  maxHeartbeatAgeMs?: number;
}) {
  const brokers = input.brokers ?? failClosedSecretBrokers;
  const maxHeartbeatAgeMs = Math.max(1000, input.maxHeartbeatAgeMs ?? 300_000);

  return {
    async resolve(resolveInput: {
      auth: VerifiedWorkerOperation;
      request: SecretResolveRequestV1;
    }): Promise<SecretResolveOutcome> {
      const { auth, request } = resolveInput;
      if (request.workerId !== auth.workerId) throw new JobLeasingError("unauthorized");

      // Fence identity + authorization inside ONE tenant tx, BEFORE any broker access.
      const authorized = await runInTenant(input.appDb, auth.organizationId, async (repos):
        Promise<AuthorizedSecretResolution | { denied: SecretResolveOutcome & { outcome: "denied" } }> => {
        const ctx = await resolveWorkerFenceContext(repos, auth, {
          leaseId: request.leaseId,
          jobId: request.jobId,
          attempt: request.attempt,
          fenceToken: request.fenceToken,
        }, maxHeartbeatAgeMs);
        try {
          return await repos.jobControl.resolveExecutionSecret({
            ...ctx.fenceIdentity,
            handle: request.handleId,
          });
        } catch (error) {
          if (error instanceof DbJobFenceError) {
            return { denied: { outcome: "denied", reason: fenceReason(error.code) } };
          }
          if (error instanceof SecretResolveRejection) {
            // Coarse + non-disclosing: never reveal which invariant tripped.
            return { denied: { outcome: "denied", reason: "malformed" } };
          }
          throw error;
        }
      });

      if ("denied" in authorized) return authorized.denied;

      // ONLY AFTER the fence + authorization: dispatch to the legacy broker for the value.
      // A broker fetch failure is a coarse, non-disclosing `malformed` (never a value leak,
      // never a disclosing error) — e.g. an unwired seam or a broker-side revocation.
      try {
        return await dispatchResolvedSecret(authorized, brokers);
      } catch {
        return { outcome: "denied", reason: "malformed" };
      }
    },
  };
}
