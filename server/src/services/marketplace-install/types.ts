import type { CatalogItem } from "@armyofagents/shared";
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

export type { CascadeStepResult };
