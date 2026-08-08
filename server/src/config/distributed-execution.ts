import type { DeploymentMode } from "@armyofagents/shared";

export const DISTRIBUTED_EXECUTION_ENABLED_ENV = "AOA_DISTRIBUTED_EXECUTION_ENABLED";
export const DISTRIBUTED_PUBLIC_SERVICE_INGRESS_ENV =
  "AOA_DISTRIBUTED_PUBLIC_SERVICE_INGRESS_ENABLED";
export const DISTRIBUTED_CLOUD_PLUGIN_EXECUTION_ENV =
  "AOA_DISTRIBUTED_CLOUD_PLUGIN_EXECUTION_ENABLED";
export const UNSANDBOXED_MULTITENANT_OPT_IN_ENV = "AOA_ALLOW_UNSANDBOXED_MULTITENANT";

type Env = Record<string, string | undefined>;

function parseBooleanEnv(env: Env, name: string, defaultValue: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`${name}=${JSON.stringify(env[name])} is not a boolean flag`);
}

export function readDistributedExecutionDeploymentFlag(env: Env): boolean {
  return parseBooleanEnv(env, DISTRIBUTED_EXECUTION_ENABLED_ENV, false);
}

export interface DistributedExecutionRolloutInput {
  deploymentMode: DeploymentMode;
  deploymentEnabled: boolean;
  organizationEnabled: boolean;
  workloadEnabled: boolean;
}

export type DistributedExecutionRolloutDecision =
  | { enabled: true; reason: "enabled" }
  | { enabled: false; reason: "deployment_disabled" | "organization_disabled" | "workload_disabled" };

export function resolveDistributedExecutionRollout(
  input: DistributedExecutionRolloutInput,
): DistributedExecutionRolloutDecision {
  if (!input.deploymentEnabled) return { enabled: false, reason: "deployment_disabled" };
  if (!input.organizationEnabled) return { enabled: false, reason: "organization_disabled" };
  if (!input.workloadEnabled) return { enabled: false, reason: "workload_disabled" };
  return { enabled: true, reason: "enabled" };
}

export function assertHostedExecutionStartupSafe(input: {
  deploymentMode: DeploymentMode;
  env: Env;
}): void {
  for (const name of [
    DISTRIBUTED_PUBLIC_SERVICE_INGRESS_ENV,
    DISTRIBUTED_CLOUD_PLUGIN_EXECUTION_ENV,
  ]) {
    if (parseBooleanEnv(input.env, name, false)) {
      throw new Error(`${name} is excluded from this replatform release and cannot be enabled`);
    }
  }
  if (
    input.deploymentMode === "cloud_auth" &&
    parseBooleanEnv(input.env, UNSANDBOXED_MULTITENANT_OPT_IN_ENV, false)
  ) {
    throw new Error(
      `${UNSANDBOXED_MULTITENANT_OPT_IN_ENV} is forbidden in cloud_auth; ` +
        "tenant workloads must use an isolated worker/provider boundary",
    );
  }
}
