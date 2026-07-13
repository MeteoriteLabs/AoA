import type { Db } from "@armyofagents/db";
import { userProfiles, type UserProfileSocialLink } from "@armyofagents/db";
import { eq } from "drizzle-orm";

export type UserProfileInput = {
  displayName?: string | null;
  avatarUrl?: string | null;
  title?: string | null;
  bio?: string | null;
  socialLinks?: UserProfileSocialLink[];
};

export type UserProfile = {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  title: string | null;
  bio: string | null;
  socialLinks: UserProfileSocialLink[];
};

function mapRow(row: any): UserProfile {
  return {
    userId: row.userId,
    displayName: row.displayName ?? null,
    avatarUrl: row.avatarUrl ?? null,
    title: row.title ?? null,
    bio: row.bio ?? null,
    socialLinks: Array.isArray(row.socialLinks) ? row.socialLinks : [],
  };
}

export async function getUserProfile(db: Db, userId: string): Promise<UserProfile | null> {
  const rows = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
  return rows[0] ? mapRow(rows[0]) : null;
}

/** Idempotent upsert of the global per-user profile (Stage C / C1-C3). */
export async function upsertUserProfile(
  db: Db,
  userId: string,
  input: UserProfileInput,
): Promise<UserProfile> {
  const values = {
    userId,
    displayName: input.displayName ?? null,
    avatarUrl: input.avatarUrl ?? null,
    title: input.title ?? null,
    bio: input.bio ?? null,
    socialLinks: input.socialLinks ?? [],
    updatedAt: new Date(),
  };
  const updates: Partial<typeof userProfiles.$inferInsert> = { updatedAt: values.updatedAt };
  if (input.displayName !== undefined) updates.displayName = input.displayName;
  if (input.avatarUrl !== undefined) updates.avatarUrl = input.avatarUrl;
  if (input.title !== undefined) updates.title = input.title;
  if (input.bio !== undefined) updates.bio = input.bio;
  if (input.socialLinks !== undefined) updates.socialLinks = input.socialLinks;

  await db
    .insert(userProfiles)
    .values(values)
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: updates,
    });
  const saved = await getUserProfile(db, userId);
  if (!saved) throw new Error("failed to upsert user profile");
  return saved;
}
