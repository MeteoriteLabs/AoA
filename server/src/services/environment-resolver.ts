import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { environments } from "@armyofagents/db";

/**
 * Resolve the environment envVars to inject between project baseline and agent
 * adapterConfig.env during heartbeat dispatch.
 *
 * Priority: issue.executionEnvironmentId > agent.defaultEnvironmentId > none.
 * The DB query is always scoped by companyId to prevent cross-tenant leakage.
 */
export async function resolveEnvironmentEnvVars(
  db: Db,
  opts: {
    executionEnvironmentId: string | null | undefined;
    defaultEnvironmentId: string | null | undefined;
    companyId: string;
  },
): Promise<Record<string, unknown>> {
  const envId = opts.executionEnvironmentId ?? opts.defaultEnvironmentId ?? null;
  if (!envId) return {};

  const row = await db
    .select({ envVars: environments.envVars })
    .from(environments)
    .where(and(eq(environments.id, envId), eq(environments.companyId, opts.companyId)))
    .then((rows) => rows[0] ?? null);

  if (!row) return {};
  return (row.envVars as Record<string, unknown>) ?? {};
}
