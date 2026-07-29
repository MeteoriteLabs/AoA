import { eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { organizations, organizationMemberships } from "@armyofagents/db";
import { DEFAULT_ORGANIZATION_ID, DEFAULT_ORGANIZATION_SLUG } from "@armyofagents/shared";
import type { organizationAccessService } from "./organization-access.js";

/** Lowercase kebab-case slug base; falls back to "org" when name has no [a-z0-9]. */
export function slugifyOrganizationName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "org";
}

/** Walks the error cause-chain for a 23505 on organizations_slug_uq. */
export function isOrgSlugConflict(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const c = current as { cause?: unknown; code?: unknown; constraint?: unknown; constraint_name?: unknown };
    const constraint =
      typeof c.constraint === "string" ? c.constraint
      : typeof c.constraint_name === "string" ? c.constraint_name
      : undefined;
    if (c.code === "23505" && constraint === "organizations_slug_uq") return true;
    current = c.cause;
  }
  return false;
}

export function organizationService(db: Db) {
  return {
    getById: (id: string) =>
      db.select().from(organizations).where(eq(organizations.id, id)).then((r) => r[0] ?? null),

    /**
     * Guarantee the sentinel default Organization exists. Idempotent — safe to
     * call on every boot. Underpins self-hosted single-tenant + fresh installs.
     */
    ensureDefaultOrganization: async () => {
      await db
        .insert(organizations)
        .values({
          id: DEFAULT_ORGANIZATION_ID,
          name: "Default Organization",
          slug: DEFAULT_ORGANIZATION_SLUG,
          status: "active",
          plan: "beta",
        })
        .onConflictDoNothing({ target: organizations.id });
      return DEFAULT_ORGANIZATION_ID;
    },

    /** Create an Organization, de-duping the slug with a numeric suffix. */
    create: async (data: { name: string; slug?: string; plan?: string; createdByUserId?: string | null }) => {
      const base = data.slug ? slugifyOrganizationName(data.slug) : slugifyOrganizationName(data.name);
      let attempt = 0;
      while (attempt < 10000) {
        const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
        try {
          const rows = await db
            .insert(organizations)
            .values({
              name: data.name,
              slug: candidate,
              plan: data.plan ?? "beta",
              createdByUserId: data.createdByUserId ?? null,
            })
            .returning();
          const org = rows[0];
          if (data.createdByUserId) {
            await db
              .insert(organizationMemberships)
              .values({
                organizationId: org.id,
                userId: data.createdByUserId,
                role: "owner",
                status: "active",
                joinedAt: new Date(),
              })
              .onConflictDoNothing({
                target: [organizationMemberships.organizationId, organizationMemberships.userId],
              });
          }
          return org;
        } catch (error) {
          if (!isOrgSlugConflict(error)) throw error;
        }
        attempt += 1;
      }
      throw new Error("Unable to allocate unique organization slug");
    },
  };
}

/**
 * Self-serve Organization creation (Phase 2, Task 6): any signed-in board user
 * creates a fresh tenant and becomes its owner. Reuses this file's own
 * `organizationService(db).create` for the row insert + slug de-dup — NOT
 * passing `createdByUserId` here, since the owner-membership write goes
 * through the injected `orgAccess.ensureOrgOwner` instead (idempotent /
 * onConflictDoNothing-safe — see organization-access.ts — because P1's
 * ensureRealOperator/backfill may also touch the same membership row).
 */
export async function createSelfServeOrganization(
  db: Db,
  input: { name: string; ownerUserId: string },
  orgAccess: Pick<ReturnType<typeof organizationAccessService>, "ensureOrgOwner">,
) {
  const org = await organizationService(db).create({ name: input.name });
  await orgAccess.ensureOrgOwner(org.id, input.ownerUserId);
  return org;
}
