import {
  PLUGIN_WORKER_BLOCKED_IN_CLOUD_REASON,
  type PluginStatusReasonCode,
} from "@armyofagents/shared";
import { tenantIsolationEnforced } from "../config/deployment-mode.js";
import { logger } from "../middleware/logger.js";

export const PLUGIN_WORKER_BLOCKED_IN_CLOUD =
  PLUGIN_WORKER_BLOCKED_IN_CLOUD_REASON satisfies PluginStatusReasonCode;

export const CLOUD_PLUGIN_BLOCK_MESSAGE =
  "Plugin execution is blocked on AoA Cloud until isolated workers are available";

export const CLOUD_PLUGIN_EXECUTION_DOC_PATH =
  "/docs/guides/cloud-plugin-execution";

export type PluginActivationSource =
  | "boot"
  | "lifecycle"
  | "marketplace"
  | "dependency"
  | "direct"
  | "restart"
  | "unknown";

export interface CloudPluginExecutionContext {
  pluginId: string;
  companyId?: string;
  source?: PluginActivationSource;
  sink: "worker-manager" | "worker-fork" | "lifecycle" | "loader" | "ui-static";
}

export interface CloudPluginExecutionBlockedEnvelope {
  error: string;
  code: typeof PLUGIN_WORKER_BLOCKED_IN_CLOUD;
  docs: string;
}

export function cloudPluginExecutionBlockedEnvelope(): CloudPluginExecutionBlockedEnvelope {
  return {
    error: CLOUD_PLUGIN_BLOCK_MESSAGE,
    code: PLUGIN_WORKER_BLOCKED_IN_CLOUD,
    docs: CLOUD_PLUGIN_EXECUTION_DOC_PATH,
  };
}

/** Typed policy denial shared by lifecycle and final process sinks. */
export class CloudPluginExecutionBlockedError extends Error {
  readonly code = PLUGIN_WORKER_BLOCKED_IN_CLOUD;
  readonly statusReasonCode = PLUGIN_WORKER_BLOCKED_IN_CLOUD;

  constructor() {
    super(CLOUD_PLUGIN_BLOCK_MESSAGE);
    this.name = "CloudPluginExecutionBlockedError";
  }
}

let blockedActivationCount = 0;
const blockedActivationCountBySource: Record<PluginActivationSource, number> = {
  boot: 0,
  lifecycle: 0,
  marketplace: 0,
  dependency: 0,
  direct: 0,
  restart: 0,
  unknown: 0,
};
const bootReconciledPluginIds = new Set<string>();
let bootReconciledCount = 0;

export function isCloudPluginExecutionBlocked(): boolean {
  return tenantIsolationEnforced();
}

/**
 * Project the static cloud policy into read responses immediately, including
 * during the short startup window before durable boot reconciliation finishes.
 */
export function projectCloudPluginPolicyState<
  T extends {
    status: string;
    statusReasonCode?: unknown;
    lastError?: unknown;
  },
>(plugin: T): T {
  if (!isCloudPluginExecutionBlocked()) {
    // A cloud -> self-hosted move can leave the durable reconciliation reason
    // on an error row. It is historical in a trusted runtime, not a live policy
    // denial: clear only the canonical policy metadata in read projections so
    // operators can use Retry/Enable. A successful lifecycle write clears the
    // durable reason.
    if (plugin.statusReasonCode !== PLUGIN_WORKER_BLOCKED_IN_CLOUD) {
      return plugin;
    }
    return {
      ...plugin,
      statusReasonCode: null,
      lastError:
        plugin.lastError === CLOUD_PLUGIN_BLOCK_MESSAGE ? null : plugin.lastError,
    } as T;
  }
  if (plugin.status === "uninstalled") {
    return plugin;
  }
  return {
    ...plugin,
    status: "error",
    statusReasonCode: PLUGIN_WORKER_BLOCKED_IN_CLOUD,
    lastError: CLOUD_PLUGIN_BLOCK_MESSAGE,
  } as T;
}

export function recordCloudPluginBlock(
  context: CloudPluginExecutionContext
): number {
  const activationSource = context.source ?? "unknown";
  blockedActivationCount += 1;
  blockedActivationCountBySource[activationSource] += 1;
  logger.warn(
    {
      service: "cloud-plugin-execution",
      event: "plugin.worker.cloud_blocked",
      pluginId: context.pluginId,
      companyId: context.companyId,
      activationSource,
      sink: context.sink,
      reasonCode: PLUGIN_WORKER_BLOCKED_IN_CLOUD,
      blockedActivationCount,
      blockedActivationSourceCount:
        blockedActivationCountBySource[activationSource],
    },
    "blocked cloud plugin execution"
  );
  return blockedActivationCount;
}

export function assertCloudPluginExecutionAllowed(
  context: CloudPluginExecutionContext
): void {
  if (!isCloudPluginExecutionBlocked()) return;
  recordCloudPluginBlock(context);
  throw new CloudPluginExecutionBlockedError();
}

/** Test/diagnostic-only process counter; contains no tenant or config data. */
export function getCloudPluginBlockedActivationCount(): number {
  return blockedActivationCount;
}

export function getCloudPluginBlockMetrics() {
  return {
    total: blockedActivationCount,
    bySource: { ...blockedActivationCountBySource },
    byReason: {
      [PLUGIN_WORKER_BLOCKED_IN_CLOUD]: blockedActivationCount,
    },
    bootReconciledCount,
    bootReconciledGauge: bootReconciledPluginIds.size,
  };
}

export function beginCloudPluginBootReconciliation(): void {
  bootReconciledPluginIds.clear();
}

export function recordCloudPluginBootReconciled(
  context: Pick<CloudPluginExecutionContext, "pluginId" | "companyId">
): void {
  bootReconciledCount += 1;
  bootReconciledPluginIds.add(context.pluginId);
  logger.info(
    {
      service: "cloud-plugin-execution",
      event: "plugin.worker.cloud_boot_reconciled",
      pluginId: context.pluginId,
      companyId: context.companyId,
      reasonCode: PLUGIN_WORKER_BLOCKED_IN_CLOUD,
      bootReconciledCount,
      bootReconciledGauge: bootReconciledPluginIds.size,
    },
    "reconciled stale ready cloud plugin"
  );
}
