// server/src/config/distributed-execution-rollout-source.ts
//
// CLI-005 (D1 / O4) — the minimal, server-owned, config-driven per-Organization /
// per-workload rollout policy source that feeds the otherwise-stubbed org+workload
// inputs of `resolveDistributedExecutionRollout` (config/distributed-execution.ts).
//
// It exists ONLY to make the three rollout states (`off | shadow | active`) reachable
// for a heartbeat run without a new table or migration (a richer policy store is
// JOB-007 / MIG-002). It is DEFAULT-DISABLED: with `AOA_DISTRIBUTED_EXECUTION_ROLLOUT`
// unset (or `{}`), every Organization resolves to `off`, so the legacy adapter stays the
// sole authoritative executor and every current path is byte-identical.
//
// Format (JSON in the env var):
//   {
//     "organizations": {
//       "<organizationId>": { "mode": "shadow" | "active", "workloads": ["batch", "*"] }
//     }
//   }
// An Organization absent from the map is disabled. A workload absent from an enabled
// Organization's `workloads` list (and no "*") is disabled. `mode` is one of
// `shadow` | `active` | `canary` for that Organization's enabled workloads
// (CLI-006 added `canary`; see the `RolloutMode` doc comment below).
//
// The deployment gate (`AOA_DISTRIBUTED_EXECUTION_ENABLED`, default-off) is checked
// FIRST by `resolveRunRolloutState`, so this source can never enable distributed
// execution on a deployment that has not opted in.

import type { DeploymentMode } from "@armyofagents/shared";
import {
  readDistributedExecutionDeploymentFlag,
  resolveDistributedExecutionRollout,
} from "./distributed-execution.js";

export const DISTRIBUTED_EXECUTION_ROLLOUT_ENV = "AOA_DISTRIBUTED_EXECUTION_ROLLOUT";

type Env = Record<string, string | undefined>;

/**
 * CLI-006 (D1) adds `canary` as a strict superset of `active`: everything `active`
 * does (durable convert + the ONE checkout), PLUS placement (making the attempt
 * leasable) and suppression of the legacy `adapter.execute`. It is a distinct mode
 * rather than an overload so CLI-005's landed `active` semantics keep their exact
 * meaning and rollback stays unambiguous (delete the key, or set `active`).
 */
export type RolloutMode = "shadow" | "active" | "canary";
/**
 * The vocabulary the PLACEMENT boundary accepts. `job-placement.ts` validates
 * `["active","shadow"].includes(rollout.mode)` (`:589`) and gates leasability on
 * `mode === "active"` (`:663`), so `canary` is presented there as `active`
 * (see `resolveOrganizationPolicy`). Placement is E3-owned and is not edited.
 */
export type PlacementRolloutMode = "shadow" | "active";
/** The resolved per-run rollout state a caller acts on. */
export type RunRolloutState = "off" | "shadow" | "active" | "canary";

export interface OrganizationRolloutPolicy {
  readonly mode: RolloutMode;
  /** The set of workload types this Organization has opted in; `*` means all. */
  readonly workloads: ReadonlySet<string>;
}

export interface DistributedExecutionRolloutSource {
  /**
   * Placement-service-compatible org resolver (default `{ enabled:false }`).
   * Returns placement's vocabulary, so a `canary` Organization is reported here
   * as `active` — that is what makes its attempt lease-eligible.
   */
  resolveOrganizationPolicy(input: {
    organizationId: string;
  }): { enabled: boolean; mode: PlacementRolloutMode };
  /** Placement-service-compatible workload resolver (default `false`). */
  resolveWorkloadPolicy(input: { organizationId: string; workloadType: string }): boolean;
  /**
   * Resolve one heartbeat run to `off | shadow | active`. The deployment flag is
   * consulted FIRST — a flag-off deployment always resolves `off` regardless of the
   * rollout map, so nothing here can defeat the default-off gate.
   */
  resolveRunRolloutState(input: {
    deploymentMode: DeploymentMode;
    organizationId: string;
    workloadType: string;
  }): RunRolloutState;
}

class DistributedExecutionRolloutSourceConfigError extends Error {
  constructor(message: string) {
    super(`${DISTRIBUTED_EXECUTION_ROLLOUT_ENV} is invalid: ${message}`);
    this.name = "DistributedExecutionRolloutSourceConfigError";
  }
}

/**
 * Parse the rollout map from an env bag. Empty/unset → an empty map (all Organizations
 * disabled). Throws `DistributedExecutionRolloutSourceConfigError` on malformed JSON or
 * shape so a misconfiguration fails loudly at startup validation rather than silently
 * disabling the rollout at runtime.
 */
export function parseDistributedExecutionRolloutMap(
  env: Env,
): Map<string, OrganizationRolloutPolicy> {
  const raw = env[DISTRIBUTED_EXECUTION_ROLLOUT_ENV]?.trim();
  const map = new Map<string, OrganizationRolloutPolicy>();
  if (!raw) return map;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DistributedExecutionRolloutSourceConfigError("value is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new DistributedExecutionRolloutSourceConfigError("value must be a JSON object");
  }
  const organizations = (parsed as Record<string, unknown>).organizations;
  if (organizations === undefined) return map;
  if (typeof organizations !== "object" || organizations === null || Array.isArray(organizations)) {
    throw new DistributedExecutionRolloutSourceConfigError("`organizations` must be an object");
  }

  for (const [organizationId, value] of Object.entries(organizations as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new DistributedExecutionRolloutSourceConfigError(
        `organization ${organizationId} must be an object`,
      );
    }
    const record = value as Record<string, unknown>;
    const mode = record.mode;
    if (mode !== "shadow" && mode !== "active" && mode !== "canary") {
      throw new DistributedExecutionRolloutSourceConfigError(
        `organization ${organizationId} mode must be "shadow", "active", or "canary"`,
      );
    }
    const workloadsRaw = record.workloads ?? [];
    if (!Array.isArray(workloadsRaw) || workloadsRaw.some((w) => typeof w !== "string")) {
      throw new DistributedExecutionRolloutSourceConfigError(
        `organization ${organizationId} workloads must be a string array`,
      );
    }
    map.set(organizationId, {
      mode,
      workloads: new Set(workloadsRaw as string[]),
    });
  }
  return map;
}

/** Validate the rollout source config once at startup (loud failure on malformed input). */
export function assertDistributedExecutionRolloutSourceValid(env: Env): void {
  parseDistributedExecutionRolloutMap(env);
}

/**
 * Build the config-driven rollout source. Parsing happens ONCE at construction; the
 * returned resolvers are pure and effect-free.
 */
export function createDistributedExecutionRolloutSource(
  env: Env = process.env,
): DistributedExecutionRolloutSource {
  const map = parseDistributedExecutionRolloutMap(env);
  const deploymentEnabled = readDistributedExecutionDeploymentFlag(env);

  function organizationPolicy(organizationId: string): OrganizationRolloutPolicy | undefined {
    return map.get(organizationId);
  }

  function workloadEnabled(policy: OrganizationRolloutPolicy | undefined, workloadType: string): boolean {
    if (!policy) return false;
    return policy.workloads.has("*") || policy.workloads.has(workloadType);
  }

  return {
    resolveOrganizationPolicy({ organizationId }) {
      const policy = organizationPolicy(organizationId);
      if (!policy) return { enabled: false, mode: "shadow" };
      // CLI-006 (D1): `canary` is presented to placement as `active` — that is the
      // whole mechanism by which a canary attempt becomes lease-eligible without
      // touching the E3-owned placement module. The canary DISTINCTION is carried
      // on the ownership decision + job provenance, not on the placement mode.
      return { enabled: true, mode: policy.mode === "canary" ? "active" : policy.mode };
    },
    resolveWorkloadPolicy({ organizationId, workloadType }) {
      return workloadEnabled(organizationPolicy(organizationId), workloadType);
    },
    resolveRunRolloutState({ deploymentMode, organizationId, workloadType }) {
      const policy = organizationPolicy(organizationId);
      const decision = resolveDistributedExecutionRollout({
        deploymentMode,
        deploymentEnabled,
        organizationEnabled: policy !== undefined,
        workloadEnabled: workloadEnabled(policy, workloadType),
      });
      if (!decision.enabled) return "off";
      // `policy` is defined here (organizationEnabled was true).
      return policy!.mode;
    },
  };
}
