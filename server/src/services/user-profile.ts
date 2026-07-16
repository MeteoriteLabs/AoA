import { eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { authUsers } from "@armyofagents/db";
import type { CurrentUserProfile, UpdateCurrentUserProfile } from "@armyofagents/shared";
import { unauthorized } from "../errors.js";

/**
 * The user-table-backed slice of {@link CurrentUserProfile}. `isInstanceAdmin`
 * is actor-derived (instance_user_roles / local_implicit), not a user column —
 * the route (routes/auth-profile.ts) composes it onto every response.
 */
export type UserProfileRecord = Omit<CurrentUserProfile, "isInstanceAdmin">;

function toProfile(row: {
  id: string;
  email: string | null;
  name: string | null;
  displayName: string | null;
  image: string | null;
  avatarUrl: string | null;
}): UserProfileRecord {
  return {
    id: row.id,
    email: row.email ?? null,
    displayName: row.displayName ?? row.name ?? null,
    avatarUrl: row.avatarUrl ?? row.image ?? null,
  };
}

export function userProfileService(db: Db) {
  return {
    async load(userId: string): Promise<UserProfileRecord> {
      const row = await db
        .select({
          id: authUsers.id,
          email: authUsers.email,
          name: authUsers.name,
          displayName: authUsers.displayName,
          image: authUsers.image,
          avatarUrl: authUsers.avatarUrl,
        })
        .from(authUsers)
        .where(eq(authUsers.id, userId))
        .then((rows) => rows[0] ?? null);

      if (!row) throw unauthorized("Signed-in user not found");
      return toProfile(row);
    },

    async update(
      userId: string,
      patch: UpdateCurrentUserProfile,
    ): Promise<UserProfileRecord> {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.displayName !== undefined) updates.displayName = patch.displayName;
      if (patch.avatarUrl !== undefined) updates.avatarUrl = patch.avatarUrl;

      const row = await db
        .update(authUsers)
        .set(updates)
        .where(eq(authUsers.id, userId))
        .returning({
          id: authUsers.id,
          email: authUsers.email,
          name: authUsers.name,
          displayName: authUsers.displayName,
          image: authUsers.image,
          avatarUrl: authUsers.avatarUrl,
        })
        .then((rows) => rows[0] ?? null);

      if (!row) throw unauthorized("Signed-in user not found");
      return toProfile(row);
    },
  };
}
