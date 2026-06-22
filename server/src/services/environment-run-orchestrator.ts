import type { Db } from "@armyofagents/db";
import type { Environment, EnvironmentDriver, EnvironmentStatus } from "@armyofagents/shared";
import type { AdapterProviderSandboxRunner } from "@armyofagents/adapter-utils";
import { environmentService, type EnvironmentService } from "./environments.js";
import {
  environmentRuntimeService,
  type EnvironmentRuntimeLeaseRecord,
  type EnvironmentRuntimeService,
} from "./environment-runtime.js";
import { resolveEnvironmentExecutionTargetConfigPatch } from "./environment-execution-target.js";

export type EnvironmentErrorCode =
  | "environment_not_found"
  | "environment_inactive"
  | "lease_acquire_failed";

export class EnvironmentRunError extends Error {
  code: EnvironmentErrorCode;
  environmentId?: string;
  driver?: string;
  cause?: unknown;

  constructor(
    code: EnvironmentErrorCode,
    message: string,
    details?: {
      environmentId?: string;
      driver?: string;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "EnvironmentRunError";
    this.code = code;
    this.environmentId = details?.environmentId;
    this.driver = details?.driver;
    this.cause = details?.cause;
  }
}

export interface EnvironmentAcquisitionResult extends EnvironmentRuntimeLeaseRecord {
  adapterType: string;
  configPatch: ReturnType<typeof resolveEnvironmentExecutionTargetConfigPatch>;
}

type EnvironmentLookup = Pick<EnvironmentService, "get">;

function toIsoString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : typeof value === "string" ? value : new Date(0).toISOString();
}

function normalizeEnvironment(row: unknown): Environment {
  const record = (row ?? {}) as Record<string, unknown>;
  return {
    id: String(record.id ?? ""),
    companyId: String(record.companyId ?? ""),
    name: String(record.name ?? ""),
    description: typeof record.description === "string" ? record.description : null,
    driver: (typeof record.driver === "string" ? record.driver : "local") as EnvironmentDriver,
    status: (typeof record.status === "string" ? record.status : "active") as EnvironmentStatus,
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

export function environmentRunOrchestrator(
  db: Db,
  options: {
    environments?: EnvironmentLookup;
    environmentRuntime?: Pick<EnvironmentRuntimeService, "acquireRunLease"> & Partial<Pick<EnvironmentRuntimeService, "executeRunLeaseCommand">>;
  } = {},
) {
  const environmentsSvc = options.environments ?? environmentService(db);
  const runtime = options.environmentRuntime ?? environmentRuntimeService(db);

  async function resolveEnvironment(input: {
    companyId: string;
    environmentId: string | null;
  }): Promise<Environment> {
    if (!input.environmentId) {
      throw new EnvironmentRunError("environment_not_found", "No environment selected.");
    }

    const environmentRow = await environmentsSvc.get(input.companyId, input.environmentId);
    if (!environmentRow) {
      throw new EnvironmentRunError("environment_not_found", `Environment "${input.environmentId}" not found.`, {
        environmentId: input.environmentId,
      });
    }
    const environment = normalizeEnvironment(environmentRow);

    if (environment.status !== "active") {
      throw new EnvironmentRunError(
        "environment_inactive",
        `Environment "${environment.name}" is not active.`,
        {
          environmentId: environment.id,
          driver: environment.driver,
        },
      );
    }

    return environment;
  }

  function isProviderSandboxLease(lease: EnvironmentRuntimeLeaseRecord["lease"]): boolean {
    const provider = typeof lease.provider === "string" ? lease.provider.trim() : "";
    return !!provider && provider !== "sandbox-docker" && provider !== "docker" && provider !== "local-docker";
  }

  function buildProviderRunner(leaseRecord: EnvironmentRuntimeLeaseRecord): AdapterProviderSandboxRunner | null {
    if (!isProviderSandboxLease(leaseRecord.lease) || typeof runtime.executeRunLeaseCommand !== "function") {
      return null;
    }
    return {
      execute(input) {
        return runtime.executeRunLeaseCommand!({
          environment: leaseRecord.environment,
          lease: leaseRecord.lease,
          command: input.command,
          args: input.args,
          cwd: input.cwd,
          env: input.env,
          stdin: input.stdin,
          timeoutSec: input.timeoutSec,
        });
      },
    };
  }

  return {
    resolveEnvironment,

    async acquireForRun(input: {
      companyId: string;
      environmentId: string | null;
      adapterType: string;
      issueId: string | null;
      heartbeatRunId: string | null;
      persistedExecutionWorkspace: { id: string; mode: string } | null;
    }): Promise<EnvironmentAcquisitionResult> {
      const environment = await resolveEnvironment({
        companyId: input.companyId,
        environmentId: input.environmentId,
      });

      try {
        const leaseRecord = await runtime.acquireRunLease({
          companyId: input.companyId,
          environment,
          issueId: input.issueId,
          heartbeatRunId: input.heartbeatRunId,
          persistedExecutionWorkspace: input.persistedExecutionWorkspace,
        });
        return {
          ...leaseRecord,
          adapterType: input.adapterType,
          configPatch: resolveEnvironmentExecutionTargetConfigPatch({
            environment,
            lease: leaseRecord.lease,
            adapterType: input.adapterType,
            providerRunner: buildProviderRunner(leaseRecord),
          }),
        };
      } catch (err) {
        throw new EnvironmentRunError(
          "lease_acquire_failed",
          `Failed to acquire lease for environment "${environment.name}": ${err instanceof Error ? err.message : String(err)}`,
          {
            environmentId: environment.id,
            driver: environment.driver,
            cause: err,
          },
        );
      }
    },
  };
}
