import type { Db } from "@armyofagents/db";
import type {
  Environment,
  EnvironmentLease,
  EnvironmentLeaseCleanupStatus,
  EnvironmentLeasePolicy,
  EnvironmentLeaseStatus,
} from "@armyofagents/shared";
import { environmentService, type EnvironmentService } from "./environments.js";
import {
  sandboxProviderRuntime,
  type SandboxProviderExecuteResult,
  type SandboxProviderRuntime,
  type SandboxRuntimeProvider,
} from "./sandbox-provider-runtime.js";
import { runtimeProviderKeyService } from "./runtime-provider-keys.js";
import { logger } from "../middleware/logger.js";

type PersistedExecutionWorkspaceRef = {
  id: string;
  mode: string;
};

export function buildEnvironmentLeaseContext(input: {
  persistedExecutionWorkspace: PersistedExecutionWorkspaceRef | null;
}) {
  return {
    executionWorkspaceId: input.persistedExecutionWorkspace?.id ?? null,
    executionWorkspaceMode: input.persistedExecutionWorkspace?.mode ?? null,
  };
}

export interface EnvironmentDriverAcquireInput {
  companyId: string;
  environment: Environment;
  issueId: string | null;
  heartbeatRunId: string | null;
  persistedExecutionWorkspace: PersistedExecutionWorkspaceRef | null;
}

export interface EnvironmentDriverReleaseInput {
  environment: Environment;
  lease: EnvironmentLease;
  status: Extract<EnvironmentLeaseStatus, "released" | "expired" | "failed" | "retained">;
}

export interface EnvironmentDriverExecuteInput {
  environment: Environment;
  lease: EnvironmentLease;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  stdin?: string;
  timeoutSec: number;
}

export interface EnvironmentRuntimeLeaseRecord {
  environment: Environment;
  lease: EnvironmentLease;
  leaseContext: ReturnType<typeof buildEnvironmentLeaseContext>;
}

export interface EnvironmentRuntimeDriver {
  readonly driver: string;
  acquireRunLease(input: EnvironmentDriverAcquireInput): Promise<EnvironmentLease>;
  releaseRunLease(input: EnvironmentDriverReleaseInput): Promise<EnvironmentLease | null>;
}

function toIsoString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : typeof value === "string" ? value : new Date(0).toISOString();
}

function toNullableIsoString(value: unknown): string | null {
  if (value == null) return null;
  return toIsoString(value);
}

function normalizeEnvironment(row: unknown): Environment {
  const record = (row ?? {}) as Record<string, unknown>;
  return {
    id: String(record.id ?? ""),
    companyId: String(record.companyId ?? ""),
    name: String(record.name ?? ""),
    description: typeof record.description === "string" ? record.description : null,
    driver: (typeof record.driver === "string" ? record.driver : "local") as Environment["driver"],
    status: (typeof record.status === "string" ? record.status : "active") as Environment["status"],
    config: record.config && typeof record.config === "object" && !Array.isArray(record.config)
      ? record.config as Record<string, unknown>
      : {},
    metadata: record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? record.metadata as Record<string, unknown>
      : null,
    envVars: record.envVars && typeof record.envVars === "object" && !Array.isArray(record.envVars)
      ? record.envVars as Record<string, unknown>
      : {},
    connectionTarget: record.connectionTarget && typeof record.connectionTarget === "object" && !Array.isArray(record.connectionTarget)
      ? record.connectionTarget as Record<string, unknown>
      : null,
    target: record.target && typeof record.target === "object" && !Array.isArray(record.target)
      ? record.target as Record<string, unknown>
      : null,
    createdAt: toIsoString(record.createdAt),
    updatedAt: toIsoString(record.updatedAt),
  };
}

export function normalizeEnvironmentLease(row: unknown): EnvironmentLease {
  const record = (row ?? {}) as Record<string, unknown>;
  return {
    id: String(record.id ?? ""),
    companyId: String(record.companyId ?? ""),
    environmentId: String(record.environmentId ?? ""),
    executionWorkspaceId: typeof record.executionWorkspaceId === "string" ? record.executionWorkspaceId : null,
    issueId: typeof record.issueId === "string" ? record.issueId : null,
    heartbeatRunId: typeof record.heartbeatRunId === "string" ? record.heartbeatRunId : null,
    status: (typeof record.status === "string" ? record.status : "active") as EnvironmentLeaseStatus,
    leasePolicy: (typeof record.leasePolicy === "string" ? record.leasePolicy : "ephemeral") as EnvironmentLeasePolicy,
    provider: typeof record.provider === "string" ? record.provider : null,
    providerLeaseId: typeof record.providerLeaseId === "string" ? record.providerLeaseId : null,
    acquiredAt: toIsoString(record.acquiredAt),
    lastUsedAt: toIsoString(record.lastUsedAt),
    expiresAt: toNullableIsoString(record.expiresAt),
    releasedAt: toNullableIsoString(record.releasedAt),
    failureReason: typeof record.failureReason === "string" ? record.failureReason : null,
    cleanupStatus: (typeof record.cleanupStatus === "string" ? record.cleanupStatus : null) as EnvironmentLeaseCleanupStatus | null,
    metadata: record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? record.metadata as Record<string, unknown>
      : null,
    createdAt: toIsoString(record.createdAt),
    updatedAt: toIsoString(record.updatedAt),
  };
}

export interface EnvironmentRuntimeService {
  acquireRunLease(input: EnvironmentDriverAcquireInput): Promise<EnvironmentRuntimeLeaseRecord>;
  releaseRunLease(input: EnvironmentDriverReleaseInput): Promise<EnvironmentLease | null>;
  releaseRunLeases(heartbeatRunId: string): Promise<EnvironmentLease[]>;
  executeRunLeaseCommand(input: EnvironmentDriverExecuteInput): Promise<SandboxProviderExecuteResult>;
}

function createLocalEnvironmentDriver(environmentsSvc: EnvironmentService): EnvironmentRuntimeDriver {
  return {
    driver: "local",

    async acquireRunLease(input) {
      const leaseContext = buildEnvironmentLeaseContext({
        persistedExecutionWorkspace: input.persistedExecutionWorkspace,
      });
      return normalizeEnvironmentLease(await environmentsSvc.acquireLease({
        companyId: input.companyId,
        environmentId: input.environment.id,
        executionWorkspaceId: leaseContext.executionWorkspaceId,
        issueId: input.issueId,
        heartbeatRunId: input.heartbeatRunId,
        leasePolicy: "ephemeral",
        provider: "local",
        metadata: {
          driver: input.environment.driver,
          executionWorkspaceMode: leaseContext.executionWorkspaceMode,
        },
      }));
    },

    async releaseRunLease(input) {
      const released = await environmentsSvc.releaseLease(input.lease.id, input.status);
      return released ? normalizeEnvironmentLease(released) : null;
    },
  };
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolveDockerSandboxConfig(environment: Pick<Environment, "config">): Record<string, unknown> {
  const config = readObject(environment.config);
  const provider = readString(config.provider) ?? "sandbox-docker";
  if (provider !== "sandbox-docker" && provider !== "docker" && provider !== "local-docker") {
    throw new Error(`Unsupported sandbox provider "${provider}"`);
  }
  const image = readString(config.image);
  if (!image) {
    throw new Error("Sandbox Docker environments require config.image.");
  }
  return {
    ...config,
    provider: "sandbox-docker",
    image,
  };
}

function isDockerSandboxProvider(provider: string): boolean {
  return provider === "sandbox-docker" || provider === "docker" || provider === "local-docker";
}

type RuntimeProviderKeyResolver = Pick<ReturnType<typeof runtimeProviderKeyService>, "resolveCredential">;

async function resolveRuntimeProviderConfig(input: {
  companyId: string;
  provider: string;
  config: Record<string, unknown>;
  runtimeProviderKeys: RuntimeProviderKeyResolver | null;
  issueId?: string | null;
  heartbeatRunId?: string | null;
}) {
  if (input.provider !== "e2b" || !input.runtimeProviderKeys) return input.config;
  const resolvedApiKey = await input.runtimeProviderKeys.resolveCredential(
    input.companyId,
    "e2b",
    input.config,
    {
      consumerType: "system",
      consumerId: "runtime-provider-key:e2b",
      actorType: "system",
      configPath: "runtimeProviderKeys.e2b.default",
      issueId: input.issueId ?? null,
      heartbeatRunId: input.heartbeatRunId ?? null,
    },
  );
  const config: Record<string, unknown> = { ...input.config, resolvedApiKey };
  delete config.apiKey;
  return config;
}

function sanitizeProviderMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (/^(apiKey|resolvedApiKey)$/i.test(key)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

function createSandboxDockerEnvironmentDriver(
  environmentsSvc: EnvironmentService,
  providerRuntime: SandboxProviderRuntime,
  runtimeProviderKeys: RuntimeProviderKeyResolver | null,
): EnvironmentRuntimeDriver {
  return {
    driver: "sandbox",

    async acquireRunLease(input) {
      const leaseContext = buildEnvironmentLeaseContext({
        persistedExecutionWorkspace: input.persistedExecutionWorkspace,
      });
      const rawConfig = readObject(input.environment.config);
      const provider = readString(rawConfig.provider) ?? "sandbox-docker";
      if (!isDockerSandboxProvider(provider)) {
        const providerConfig = await resolveRuntimeProviderConfig({
          companyId: input.companyId,
          provider,
          config: rawConfig,
          runtimeProviderKeys,
          issueId: input.issueId,
          heartbeatRunId: input.heartbeatRunId,
        });
        const providerLease = await providerRuntime.acquireLease(provider, {
          companyId: input.companyId,
          environmentId: input.environment.id,
          issueId: input.issueId,
          heartbeatRunId: input.heartbeatRunId,
          config: providerConfig,
          workspaceMode: leaseContext.executionWorkspaceMode,
        });
        try {
          return normalizeEnvironmentLease(await environmentsSvc.acquireLease({
            companyId: input.companyId,
            environmentId: input.environment.id,
            executionWorkspaceId: leaseContext.executionWorkspaceId,
            issueId: input.issueId,
            heartbeatRunId: input.heartbeatRunId,
            leasePolicy: "ephemeral",
            provider,
            providerLeaseId: providerLease.providerLeaseId,
            expiresAt: providerLease.expiresAt ? new Date(providerLease.expiresAt) : null,
            metadata: {
              driver: input.environment.driver,
              executionWorkspaceMode: leaseContext.executionWorkspaceMode,
              provider,
              providerMetadata: sanitizeProviderMetadata(providerLease.metadata),
            },
          }));
        } catch (err) {
          await providerRuntime.releaseLease(provider, {
            providerLeaseId: providerLease.providerLeaseId,
            leaseMetadata: sanitizeProviderMetadata(providerLease.metadata),
            config: providerConfig,
          }).catch((releaseErr: unknown) => {
            logger.warn(
              {
                err: releaseErr,
                provider,
                providerLeaseId: providerLease.providerLeaseId,
                environmentId: input.environment.id,
                heartbeatRunId: input.heartbeatRunId,
              },
              "environment runtime: failed to release provider lease after DB acquire failure",
            );
          });
          throw err;
        }
      }

      const sandboxConfig = resolveDockerSandboxConfig(input.environment);
      return normalizeEnvironmentLease(await environmentsSvc.acquireLease({
        companyId: input.companyId,
        environmentId: input.environment.id,
        executionWorkspaceId: leaseContext.executionWorkspaceId,
        issueId: input.issueId,
        heartbeatRunId: input.heartbeatRunId,
        leasePolicy: "ephemeral",
        provider: "sandbox-docker",
        metadata: {
          driver: input.environment.driver,
          executionWorkspaceMode: leaseContext.executionWorkspaceMode,
          ...sandboxConfig,
        },
      }));
    },

    async releaseRunLease(input) {
      const provider = readString(input.lease.provider);
      if (provider && provider !== "sandbox-docker" && !isDockerSandboxProvider(provider)) {
        try {
          const providerConfig = await resolveRuntimeProviderConfig({
            companyId: input.lease.companyId,
            provider,
            config: readObject(input.environment.config),
            runtimeProviderKeys,
            issueId: input.lease.issueId,
            heartbeatRunId: input.lease.heartbeatRunId,
          });
          const released = await providerRuntime.releaseLease(provider, {
            providerLeaseId: input.lease.providerLeaseId,
            leaseMetadata: input.lease.metadata,
            config: providerConfig,
          });
          const row = await environmentsSvc.releaseLease(input.lease.id, input.status, {
            cleanupStatus: released.cleanupStatus,
          });
          return row ? normalizeEnvironmentLease(row) : null;
        } catch (err) {
          const row = await environmentsSvc.releaseLease(input.lease.id, "failed", {
            cleanupStatus: "failed",
            failureReason: `provider release failed: ${err instanceof Error ? err.message : String(err)}`,
          });
          return row ? normalizeEnvironmentLease(row) : null;
        }
      }

      const released = await environmentsSvc.releaseLease(input.lease.id, input.status);
      return released ? normalizeEnvironmentLease(released) : null;
    },
  };
}

export function environmentRuntimeService(
  db: Db,
  options: {
    environments?: Pick<EnvironmentService, "acquireLease" | "releaseLease" | "releaseLeasesForRun"> & Partial<Pick<EnvironmentService, "get" | "listActiveLeasesForRun">>;
    sandboxProviders?: SandboxRuntimeProvider[];
    runtimeProviderKeys?: RuntimeProviderKeyResolver;
  } = {},
): EnvironmentRuntimeService {
  const environmentsSvc = (options.environments ?? environmentService(db)) as EnvironmentService;
  const providerRuntime = sandboxProviderRuntime({ providers: options.sandboxProviders });
  const runtimeProviderKeys = options.runtimeProviderKeys ?? runtimeProviderKeyService(db);
  const localDriver = createLocalEnvironmentDriver(environmentsSvc);
  const sandboxDriver = createSandboxDockerEnvironmentDriver(
    environmentsSvc,
    providerRuntime,
    runtimeProviderKeys,
  );

  function getDriver(environment: Pick<Environment, "driver">): EnvironmentRuntimeDriver {
    if (environment.driver === "local") return localDriver;
    if (environment.driver === "sandbox") return sandboxDriver;
    throw new Error(`Unsupported environment driver "${environment.driver}"`);
  }

  return {
    async acquireRunLease(input) {
      const leaseContext = buildEnvironmentLeaseContext({
        persistedExecutionWorkspace: input.persistedExecutionWorkspace,
      });
      const lease = await getDriver(input.environment).acquireRunLease(input);
      return {
        environment: input.environment,
        lease,
        leaseContext,
      };
    },

    async releaseRunLease(input) {
      return await getDriver(input.environment).releaseRunLease(input);
    },

    async releaseRunLeases(heartbeatRunId) {
      if (typeof environmentsSvc.listActiveLeasesForRun !== "function" || typeof environmentsSvc.get !== "function") {
        return (await environmentsSvc.releaseLeasesForRun(heartbeatRunId)).map(normalizeEnvironmentLease);
      }

      const leases = (await environmentsSvc.listActiveLeasesForRun(heartbeatRunId)).map(normalizeEnvironmentLease);
      const released: EnvironmentLease[] = [];
      for (const lease of leases) {
        try {
          const environmentRow = await environmentsSvc.get(lease.companyId, lease.environmentId);
          if (!environmentRow) {
            const row = await environmentsSvc.releaseLease(lease.id, "failed", {
              cleanupStatus: "failed",
              failureReason: "environment missing during lease release",
            });
            if (row) released.push(normalizeEnvironmentLease(row));
            continue;
          }
          const environment = normalizeEnvironment(environmentRow);
          const row = await getDriver(environment).releaseRunLease({
            environment,
            lease,
            status: "released",
          });
          if (row) released.push(row);
        } catch (err) {
          logger.warn(
            { err, leaseId: lease.id, environmentId: lease.environmentId, heartbeatRunId },
            "environment runtime: failed to release run lease",
          );
        }
      }
      return released;
    },

    async executeRunLeaseCommand(input) {
      const provider = readString(input.lease.provider);
      if (!provider || isDockerSandboxProvider(provider)) {
        throw new Error(`Lease provider "${provider ?? "unknown"}" does not support provider execution.`);
      }
      const providerLeaseId = readString(input.lease.providerLeaseId);
      if (!providerLeaseId) {
        throw new Error(`Lease "${input.lease.id}" is missing providerLeaseId.`);
      }
      const metadata = readObject(input.lease.metadata);
      const providerMetadata = readObject(metadata.providerMetadata);
      const providerConfig = await resolveRuntimeProviderConfig({
        companyId: input.lease.companyId,
        provider,
        config: readObject(input.environment.config),
        runtimeProviderKeys,
        issueId: input.lease.issueId,
        heartbeatRunId: input.lease.heartbeatRunId,
      });
      return providerRuntime.execute(provider, {
        providerLeaseId,
        leaseMetadata: providerMetadata,
        config: providerConfig,
        command: input.command,
        args: input.args,
        cwd: input.cwd,
        env: input.env,
        stdin: input.stdin,
        timeoutMs: input.timeoutSec > 0 ? input.timeoutSec * 1000 : null,
      });
    },
  };
}
