import {
  PLUGIN_WORKER_BLOCKED_IN_CLOUD_REASON,
  type PluginStatusReasonCode,
} from "@armyofagents/shared";
import { logger } from "../middleware/logger.js";

export const PLUGIN_WORKER_BLOCKED_IN_CLOUD =
  PLUGIN_WORKER_BLOCKED_IN_CLOUD_REASON satisfies PluginStatusReasonCode;

// U10: plugins now run via a host-resident worker process reached through the
// broker (the worker never enters the tenant VM), so the blanket cloud block
// below is lifted (`isCloudPluginExecutionBlocked` always returns `false`).
// This message text is preserved — past tense — because it is still surfaced
// for historical rows/records that captured a live block before the
// host-resident-worker model shipped (see `projectCloudPluginPolicyState`'s
// recoverable-row branch and the persisted `errorCode` envelope in
// `routes/marketplace-installs.ts`).
export const CLOUD_PLUGIN_BLOCK_MESSAGE =
  "Plugin execution was blocked on AoA Cloud until a host-resident worker was available";

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
  // U10: the plugin worker is host-resident (never enters the tenant VM) and
  // is reached from a sandboxed run only through the broker's authz-gated
  // tools/call path (company-scoped `getTool` + `registered.companyId`
  // assertion, agent-actor-only). The worker's own isolation (minimal env,
  // host-side company-ownership checks) is now the enforced posture, so the
  // blanket `tenantIsolationEnforced()` cloud block is lifted. Always `false`
  // — on every deployment mode, including `cloud_auth`.
  //
  // The `projectCloudPluginPolicyState` / `recordCloudPluginBlock` / boot
  // reconciliation machinery below is INTENTIONALLY kept: it is inert now
  // (this predicate never reports "blocked"), but it still projects/clears
  // historical rows that persisted a block from before this model shipped,
  // and `assertCloudPluginExecutionAllowed` remains a no-op-safe backstop.
  return false;
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
