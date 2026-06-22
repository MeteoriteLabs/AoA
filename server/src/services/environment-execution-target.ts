import type { Environment, EnvironmentLease } from "@armyofagents/shared";
import {
  resolveAdapterExecutionTarget,
  type AdapterExecutionTarget,
  type AdapterProviderSandboxRunner,
} from "@armyofagents/adapter-utils";

export interface EnvironmentExecutionTargetInput {
  environment: Pick<Environment, "driver" | "target" | "config">;
  lease?: Pick<EnvironmentLease, "id" | "metadata" | "provider" | "providerLeaseId"> | null;
  adapterType: string;
  providerRunner?: AdapterProviderSandboxRunner | null;
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isDockerSandboxProvider(value: unknown): boolean {
  const provider = readString(value);
  return !provider || provider === "sandbox-docker" || provider === "docker" || provider === "local-docker";
}

function resolveDockerSandboxTarget(
  environment: Pick<Environment, "config">,
): AdapterExecutionTarget | null {
  const config = readObject(environment.config);
  if (!isDockerSandboxProvider(config.provider)) return null;
  const image = readString(config.image);
  if (!image) return null;

  return resolveAdapterExecutionTarget({
    type: "sandbox-docker",
    image,
    workdir: readString(config.workdir) ?? undefined,
    shell: config.shell,
    network: config.network,
    remove: typeof config.remove === "boolean" ? config.remove : undefined,
    env: readObject(config.env),
    installCommand: readString(config.installCommand),
  });
}

function resolveProviderSandboxTarget(
  input: EnvironmentExecutionTargetInput,
): AdapterExecutionTarget | null {
  const provider = readString(input.lease?.provider) ?? readString(readObject(input.environment.config).provider);
  if (!provider || isDockerSandboxProvider(provider)) return null;
  const providerLeaseId = readString(input.lease?.providerLeaseId);
  if (!providerLeaseId || !input.providerRunner) return null;

  const metadata = readObject(input.lease?.metadata);
  const providerMetadata = readObject(metadata.providerMetadata);
  const config = readObject(input.environment.config);
  const remoteCwd = readString(providerMetadata.remoteCwd) ?? readString(config.remoteCwd) ?? "/workspace";
  const shellCommand = readString(providerMetadata.shellCommand) ?? readString(config.shellCommand) ?? readString(config.shell);

  return resolveAdapterExecutionTarget({
    type: "provider-sandbox",
    provider,
    providerLeaseId,
    remoteCwd,
    shell: shellCommand === "bash" ? "bash" : "sh",
    env: readObject(config.env),
    runner: input.providerRunner,
  });
}

export function resolveEnvironmentExecutionTarget(
  input: EnvironmentExecutionTargetInput,
): AdapterExecutionTarget | null {
  if (input.environment.target) {
    return resolveAdapterExecutionTarget(input.environment.target);
  }

  if (input.environment.driver === "local") {
    return { type: "local" };
  }

  if (input.environment.driver === "sandbox") {
    return resolveDockerSandboxTarget(input.environment) ?? resolveProviderSandboxTarget(input);
  }

  return null;
}

export function resolveEnvironmentExecutionTargetConfigPatch(
  input: EnvironmentExecutionTargetInput,
): { executionTarget?: AdapterExecutionTarget } {
  const executionTarget = resolveEnvironmentExecutionTarget(input);
  return executionTarget ? { executionTarget } : {};
}
