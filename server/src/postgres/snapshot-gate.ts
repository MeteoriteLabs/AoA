import type { DeploymentMode } from "@armyofagents/shared";

export interface SnapshotGateInput {
  deploymentMode: DeploymentMode;
  pendingMigrationTags: string[];
  companyCount: number;
  recordedSnapshots: string[];
}

const GATED_MIGRATION = "0188";
const UNDEFINED_TABLE_SQLSTATE = "42P01";

/**
 * PostgreSQL errors can be wrapped by Drizzle and other adapters. Walk the
 * complete cause chain so only SQLSTATE 42P01 means a genuinely fresh schema.
 */
export function isUndefinedTableError(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;

  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { cause?: unknown; code?: unknown };
    if (candidate.code === UNDEFINED_TABLE_SQLSTATE) return true;
    current = candidate.cause;
  }

  return false;
}

type CompanyCountRow = { count?: unknown };

/**
 * Read the pre-migration company count without converting operational database
 * failures into an empty database. Only an actually missing companies table is
 * safe to treat as zero; every other error must abort startup.
 */
export async function readCompanyCountForSnapshotGate(
  query: () => Promise<unknown>,
): Promise<number> {
  let result: unknown;
  try {
    result = await query();
  } catch (error) {
    if (isUndefinedTableError(error)) return 0;
    throw error;
  }

  const rows = Array.isArray(result)
    ? (result as CompanyCountRow[])
    : Array.isArray((result as { rows?: unknown } | null)?.rows)
      ? (result as { rows: CompanyCountRow[] }).rows
      : null;
  const rawCount = rows?.[0]?.count;
  const count =
    typeof rawCount === "number"
      ? rawCount
      : typeof rawCount === "string" && /^\d+$/.test(rawCount)
        ? Number(rawCount)
        : Number.NaN;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Could not read a valid companies count for the migration snapshot gate");
  }
  return count;
}

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
