import type { DeploymentMode } from "@armyofagents/shared";
import { unprocessable } from "../errors.js";

export const CLOUD_ENVIRONMENT_TARGET_UNAVAILABLE = "cloud_environment_target_unavailable";

type EnvironmentRuntimeShape = {
  driver?: unknown;
  config?: unknown;
  target?: unknown;
  executionTargetId?: unknown;
};

export function assertEnvironmentRuntimeSupportedForDeployment(
  mode: DeploymentMode,
  input: EnvironmentRuntimeShape,
): void {
  if (mode !== "cloud_auth") return;
  const config = input.config && typeof input.config === "object" && !Array.isArray(input.config)
    ? input.config as Record<string, unknown>
    : null;
  const supported = input.driver === "sandbox"
    && config?.provider === "e2b"
    && input.target == null
    && input.executionTargetId == null;
  if (supported) return;

  throw unprocessable(
    "AoA Cloud currently supports E2B environments without raw targets or execution-target pins. " +
      "Local, Docker, gVisor, and worker-pool routing remain unavailable until the isolated worker plane ships.",
    { code: CLOUD_ENVIRONMENT_TARGET_UNAVAILABLE },
  );
}
