import type { DeploymentMode } from "@armyofagents/shared";

export interface SnapshotGateInput {
  deploymentMode: DeploymentMode;
  pendingMigrationTags: string[];
  companyCount: number;
  recordedSnapshots: string[];
}

const GATED_MIGRATION = "0188";

/**
 * Pure predicate: true => refuse to apply 0188 until an operator records a
 * snapshot marker. Only bites on cloud_auth with real data at stake.
 */
export function shouldBlockForMissingSnapshot(input: SnapshotGateInput): boolean {
  if (input.deploymentMode !== "cloud_auth") return false;
  if (input.companyCount <= 0) return false;
  const pending = input.pendingMigrationTags.some((t) => t.startsWith(GATED_MIGRATION));
  if (!pending) return false;
  return !input.recordedSnapshots.some((s) => s === GATED_MIGRATION);
}

export class SnapshotGateError extends Error {
  constructor() {
    super(
      "Refusing to apply migration 0188 (multi-tenant tenant schema): deploymentMode is " +
        "cloud_auth with a populated companies table and no snapshot marker. Take a full DB " +
        "snapshot, then record it via instance_settings.general.migrationSnapshots += \"0188\" " +
        "before restarting. (One-way door once a second Organization exists.)",
    );
    this.name = "SnapshotGateError";
  }
}
