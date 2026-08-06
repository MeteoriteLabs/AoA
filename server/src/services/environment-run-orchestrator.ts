import type { Db } from "@armyofagents/db";
import type { DeploymentMode, Environment, EnvironmentDriver, EnvironmentStatus } from "@armyofagents/shared";
import type { AdapterProviderSandboxRunner } from "@armyofagents/adapter-utils";
import { environmentService, type EnvironmentService } from "./environments.js";
import {
  environmentRuntimeService,
  type EnvironmentRuntimeLeaseRecord,
  type EnvironmentRuntimeService,
} from "./environment-runtime.js";
import { resolveEnvironmentExecutionTargetConfigPatch } from "./environment-execution-target.js";
import { getDeploymentMode } from "../config/deployment-mode.js";
import { assertEnvironmentRuntimeSupportedForDeployment } from "./cloud-environment-policy.js";
import { ensurePlatformDefaultEnvironmentRow } from "./platform-default-environment.js";

export type EnvironmentErrorCode =
  | "environment_not_found"
  | "environment_inactive"
  | "environment_target_unavailable"
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
    executionTargetId: typeof record.executionTargetId === "string" ? record.executionTargetId : null,
    createdAt: toIsoString(record.createdAt),
    updatedAt: toIsoString(record.updatedAt),
  };
}

export function environmentRunOrchestrator(
  db: Db,
  options: {
    environments?: EnvironmentLookup;
    environmentRuntime?: Pick<EnvironmentRuntimeService, "acquireRunLease"> & Partial<Pick<EnvironmentRuntimeService, "executeRunLeaseCommand">>;
    // DI seam mirroring `environments`/`environmentRuntime` above: pure unit
    // tests can inject a fake here instead of needing a real `db` just to
    // exercise the null-environmentId (platform-default) branch. Defaults to
    // the real materialize-a-persisted-row implementation (U1b).
    ensurePlatformDefault?: (input: { companyId: string; deploymentMode: DeploymentMode }) => Promise<Environment | null>;
  } = {},
) {
  const environmentsSvc = options.environments ?? environmentService(db);
  const runtime = options.environmentRuntime ?? environmentRuntimeService(db);
  const ensurePlatformDefault = options.ensurePlatformDefault
    ?? ((input: { companyId: string; deploymentMode: DeploymentMode }) =>
      ensurePlatformDefaultEnvironmentRow(db, input.companyId, input.deploymentMode));

  // Deployment-mode-aware gVisor hardening (P5 SSRF residual). Resolve the trust
  // boundary ONCE per env run and thread it to BOTH the lease-metadata path
  // (resolveDockerSandboxConfig) and the exec-target path
  // (resolveEnvironmentExecutionTargetConfigPatch -> resolveGvisorSandboxTarget ->
  // buildDockerRunArgs). Self-resolved via the established dynamic-import pattern
  // (config.js + cli-auth-topology); fail-closed to hardened if it cannot be read.
  async function resolveMultiTenantBoundary(): Promise<boolean> {
    try {
      const [{ loadConfig }, { resolveCliAuthTopology }] = await Promise.all([
        import("../config.js"),
        import("./cli-auth-topology.js"),
      ]);
      const cfg = loadConfig();
      return (
        resolveCliAuthTopology({
          deploymentMode: cfg.deploymentMode,
          deploymentExposure: cfg.deploymentExposure,
        }).trustBoundary === "multi_tenant"
      );
    } catch {
      return true; // fail closed: harden if the topology cannot be resolved
    }
  }

  async function resolveEnvironment(input: {
    companyId: string;
    environmentId: string | null;
  }): Promise<Environment> {
    if (!input.environmentId) {
      // Lazily materialize the PLATFORM layer as a REAL, persisted
      // `environments` row (deterministic id, idempotent insert) instead of
      // a purely synthetic object — `environment_leases.environment_id` is a
      // NOT NULL FK to `environments.id`, so a lease can never be acquired
      // against a non-persisted id. Returns null in exactly the same cases
      // the old synthetic resolver did (off-cloud, or on-cloud with no
      // operator E2B_API_KEY) — WITHOUT touching the database in either case.
      const platformDefault = await ensurePlatformDefault({
        companyId: input.companyId,
        deploymentMode: getDeploymentMode(),
      });
      if (!platformDefault) {
        throw new EnvironmentRunError("environment_not_found", "No environment selected.");
      }
      assertEnvironmentRuntimeSupportedForDeployment(getDeploymentMode(), platformDefault);
      return platformDefault;
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

    try {
      assertEnvironmentRuntimeSupportedForDeployment(getDeploymentMode(), environment);
    } catch (err) {
      throw new EnvironmentRunError(
        "environment_target_unavailable",
        err instanceof Error ? err.message : "Environment execution target is unavailable.",
        {
          environmentId: environment.id,
          driver: environment.driver,
          cause: err,
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
      const multiTenant = await resolveMultiTenantBoundary();

      try {
        const leaseRecord = await runtime.acquireRunLease({
          companyId: input.companyId,
          environment,
          issueId: input.issueId,
          heartbeatRunId: input.heartbeatRunId,
          persistedExecutionWorkspace: input.persistedExecutionWorkspace,
          multiTenant,
        });
        return {
          ...leaseRecord,
          adapterType: input.adapterType,
          configPatch: resolveEnvironmentExecutionTargetConfigPatch({
            environment,
            lease: leaseRecord.lease,
            adapterType: input.adapterType,
            providerRunner: buildProviderRunner(leaseRecord),
            multiTenant,
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
