import type { AgentRole, AgentStatus, CatalogItem } from "@armyofagents/shared";
import type { CascadeStepResult } from "@armyofagents/db";

/**
 * Request shape for POST /api/marketplace/install.
 * Permanent — see decision M2.D11 (no overrides field).
 */
export interface InstallRequest {
  catalogItemId: string;
  targetDepartmentId?: string;     // required for snapshot installs, ignored for plugins
  idempotencyKey?: string;         // optional retry-safety token (24h app-enforced window)
}

export interface PackageInstallRequest {
  packageId: string;
  catalogItemIds: string[];
  idempotencyKey?: string;
}

export type MarketplaceInstallRequest = InstallRequest | PackageInstallRequest;

export interface AgentInstallOverrides {
  role?: AgentRole;
  adapterType?: string;
}

/**
 * Result of resolving a catalog item to its install plan.
 * Returned by GET /api/marketplace/resolve/:catalogItemId for UI confirmation.
 */
export interface InstallPlan {
  rootItem: CatalogItem;
  steps: InstallPlanStep[];
  conflicts: ConflictWarning[];
}

export interface InstallPlanStep {
  catalogItemId: string;
  itemType: "plugin" | "skill" | "agent" | "team";
  name: string;
  version: string;
  action:
    | "install-new"             // not yet present, will be installed
    | "skip-already-installed"  // already present at same version, no-op
    | "fail-version-mismatch";  // present at different version, V1 fails-fast
  reason?: string;              // human-readable explanation
}

export interface ConflictWarning {
  catalogItemId: string;
  kind: "name-collision" | "adapter-mismatch" | "model-unavailable";
  detail: string;
  resolution: "auto-suffix" | "fail-fast" | "warn-and-proceed";
}

export interface InstallContext {
  companyId: string;
  targetDepartmentId?: string;
  requestedByUserId: string;
  idempotencyKey?: string;
}

/**
 * Wire format the catalog aggregator produces for agent.json.
 * Mirrored here as a local source-of-truth for the AoA install pipeline.
 */
export interface AgentTemplateBody {
  role?: string;
  title?: string;
  icon?: string;
  adapterType?: string;
  adapterConfig?: Record<string, unknown>;
  runtimeConfig?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  skillKeys?: string[];
  capabilities?: string;
  budgetMonthlyCents?: number;
}

export interface AgentSetupRequirement {
  kind: "secret" | "plugin_config";
  key: string;
  label?: string;
  required: boolean;
  reason: string;
  usedBy?: string;
}

export interface NormalizedMarketplaceAgentTemplate {
  name: string;
  role: AgentRole | string;
  title?: string | null;
  icon?: string | null;
  status: AgentStatus;
  capabilities?: string | null;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  runtimeConfig: Record<string, unknown>;
  permissions: Record<string, unknown>;
  budgetMonthlyCents: number;
  skillKeys: string[];
  instructions:
    | { type: "inline"; files: Record<string, string>; entryFile: string }
    | { type: "file"; path: string; entryFile: string }
    | { type: "bundle"; files: string[]; entryFile: string };
  setupRequirements: AgentSetupRequirement[];
  setupRequired: boolean;
  metadata: Record<string, unknown>;
  warnings: string[];
}

export type { CascadeStepResult };
