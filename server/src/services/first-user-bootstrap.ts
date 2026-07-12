import type { Db } from "@armyofagents/db";
import { instanceUserRoles } from "@armyofagents/db";
import { eq, sql } from "drizzle-orm";

/**
 * RB3/A7 — promote the given user to `instance_admin` IFF no `instance_admin`
 * exists yet.
 *
 * Race-safe: serialized by a transaction-scoped Postgres advisory lock so two
 * concurrent new users cannot both become admin (the `(userId, role)` unique
 * index alone would NOT stop two DIFFERENT users each inserting). Idempotent —
 * a second call once an admin exists is a no-op.
 *
 * Email/password sign-up is removed, so Google OAuth is the only path that
 * creates a user — every created user is a Google user. If a second provider is
 * ever added, gate the caller on a Google account link (RC4).
 */
/**
 * revA A10/R16 — the CLI board-claim bootstrap is retired from the normal human
 * flow (the first Google user becomes admin via {@link promoteFirstUserToInstanceAdmin}).
 * The board-claim challenge is only initialized for headless/self-hosted server
 * setups via `AOA_HEADLESS_BOOTSTRAP`. Off by default.
 */
export function shouldEnableHeadlessBootstrap(config: { headlessBootstrap: boolean }): boolean {
  return config.headlessBootstrap === true;
}

export async function promoteFirstUserToInstanceAdmin(db: Db, userId: string): Promise<boolean> {
  return await (
    db as unknown as { transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T> }
  ).transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('aoa:first-admin-bootstrap'))`);
    const existing = await tx
      .select({ id: instanceUserRoles.id })
      .from(instanceUserRoles)
      .where(eq(instanceUserRoles.role, "instance_admin"));
    if (existing.length > 0) return false;
    await tx.insert(instanceUserRoles).values({ userId, role: "instance_admin" });
    return true;
  });
}
