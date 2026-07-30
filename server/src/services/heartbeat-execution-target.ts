// server/src/services/heartbeat-execution-target.ts
//
// Pure helper extracted from the heartbeat run-scope so the P5 execution-target
// routing is unit-testable off the large-file heartbeat path. Given the run's
// current adapter config and the adapter config of a routed execution target
// (or null when routing fell back to local), it produces the config the run
// dispatches with. A null routed target returns the input config UNCHANGED (same
// reference) — the self-hosted/default-off fallback path stays byte-identical.
export function mergeResolvedExecutionTarget(
  config: Record<string, unknown>,
  adapterConfig: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!adapterConfig) return config;
  return { ...config, executionTarget: adapterConfig };
}
