/**
 * Pure flag resolver for the W5b runtime-decision routing bridge.
 *
 * ALL four conditions must hold to return true:
 *   1. AOA_RUNTIME_DECISION_ROUTING=1  (instance-wide kill-switch — anything else → false)
 *   2. adapterType === "claude_local"  (only the local CLI adapter supports PreToolUse hooks)
 *   3. executionTargetType === "local" (docker/remote sandboxes can't reach 127.0.0.1)
 *   4. agentRuntimeConfig?.runtimeDecisionRoutingEnabled === true  (per-agent opt-in)
 *
 * Intentionally has zero side-effects and zero I/O so it is trivially testable
 * without mocking.
 */

export interface ResolveRuntimeDecisionRoutingInput {
  agentRuntimeConfig: unknown;
  instanceEnv: NodeJS.ProcessEnv | Record<string, string | undefined>;
  adapterType: string;
  executionTargetType: string;
}

export function resolveRuntimeDecisionRoutingEnabled(
  input: ResolveRuntimeDecisionRoutingInput,
): boolean {
  const { agentRuntimeConfig, instanceEnv, adapterType, executionTargetType } = input;

  // 1. Instance kill-switch — MUST be exactly "1"
  if (instanceEnv.AOA_RUNTIME_DECISION_ROUTING !== "1") return false;

  // 2. Adapter guard — only claude_local supports PreToolUse hooks
  if (adapterType !== "claude_local") return false;

  // 3. Execution-target guard — remote/sandbox targets can't reach loopback
  if (executionTargetType !== "local") return false;

  // 4. Per-agent opt-in — null-safe access on the opaque JSON blob
  const config = agentRuntimeConfig != null && typeof agentRuntimeConfig === "object"
    ? (agentRuntimeConfig as Record<string, unknown>)
    : null;
  if (config?.runtimeDecisionRoutingEnabled !== true) return false;

  return true;
}
