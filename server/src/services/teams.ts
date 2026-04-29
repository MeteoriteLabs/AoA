import { eq, and } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { teams, teamMembers, agentProjects } from "@armyofagents/db";
import type {
  CreateTeamInput,
  UpdateTeamInput,
  TeamRole,
} from "@armyofagents/shared";
import { generateTeamSlug, ensureUniqueSlug } from "./team-slug.js";
import { validateManifest } from "./team-manifest.js";
import { badRequest, notFound } from "../errors.js";

export function teamsService(db: Db) {
  return {
    list: async (companyId: string, projectId?: string) => {
      if (projectId) {
        return db
          .select()
          .from(teams)
          .where(
            and(
              eq(teams.companyId, companyId),
              eq(teams.parentProjectId, projectId),
            ),
          );
      }
      return db.select().from(teams).where(eq(teams.companyId, companyId));
    },

    getById: async (id: string) => {
      const rows = await db.select().from(teams).where(eq(teams.id, id));
      if (rows.length === 0) throw notFound(`team ${id} not found`);
      return rows[0];
    },

    getBySlug: async (companyId: string, slug: string) => {
      const rows = await db
        .select()
        .from(teams)
        .where(and(eq(teams.companyId, companyId), eq(teams.slug, slug)));
      if (rows.length === 0) throw notFound(`team ${slug} not found`);
      return rows[0];
    },

    create: async (companyId: string, input: CreateTeamInput) => {
      // Slug uniqueness is enforced by the (companyId, slug) unique index
      // (teams_company_slug_uq). Between the SELECT-existing-slugs probe
      // and the INSERT below, a concurrent transaction could win the race
      // and claim the slug we picked, causing PG to throw 23505. We retry
      // up to MAX_SLUG_RETRIES times — each retry re-reads the existing
      // slugs (the colliding row is now visible) and picks a fresh suffix.
      const MAX_SLUG_RETRIES = 5;
      const baseSlug = generateTeamSlug(input.name);
      let lastError: unknown = null;

      for (let attempt = 0; attempt < MAX_SLUG_RETRIES; attempt++) {
        const existing = await db
          .select({ slug: teams.slug })
          .from(teams)
          .where(eq(teams.companyId, companyId));
        const slug = ensureUniqueSlug(
          baseSlug,
          new Set(existing.map((r: { slug: string }) => r.slug)),
        );

        try {
          const inserted = await db
            .insert(teams)
            .values({
              companyId,
              parentProjectId: input.parentProjectId,
              name: input.name,
              slug,
              description: input.description,
              manifest: input.manifest ?? {},
            })
            .returning();
          return inserted[0];
        } catch (err) {
          // PostgreSQL unique_violation = 23505. Drizzle wraps the underlying
          // pg/postgres-js error; the code may live on the cause chain.
          const code =
            (err as { code?: string }).code ??
            (err as { cause?: { code?: string } }).cause?.code;
          if (code !== "23505") throw err;
          lastError = err;
          // Loop will re-fetch existing slugs and pick a new suffix.
        }
      }

      // Exhausted retries — re-throw the last error so the caller sees a
      // real DB error (not a generic "could not generate slug").
      throw (
        lastError ??
        new Error(
          `failed to generate unique slug for "${input.name}" after ${MAX_SLUG_RETRIES} attempts`,
        )
      );
    },

    update: async (id: string, patch: UpdateTeamInput) => {
      const updated = await db
        .update(teams)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(teams.id, id))
        .returning();
      if (updated.length === 0) throw notFound(`team ${id} not found`);
      return updated[0];
    },

    updateManifest: async (id: string, manifest: unknown) => {
      // Enforces invariants (regex compilation, schema shape) beyond what the
      // route-level Zod validator covers. Throws on violation.
      const validated = validateManifest(manifest);
      const updated = await db
        .update(teams)
        .set({ manifest: validated, updatedAt: new Date() })
        .where(eq(teams.id, id))
        .returning();
      if (updated.length === 0) throw notFound(`team ${id} not found`);
      return updated[0];
    },

    archive: async (id: string) => {
      const updated = await db
        .update(teams)
        .set({
          status: "archived",
          archivedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(teams.id, id))
        .returning();
      if (updated.length === 0) throw notFound(`team ${id} not found`);
      return updated[0];
    },

    listMembers: async (teamId: string) => {
      return db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.teamId, teamId));
    },

    addMember: async (teamId: string, agentId: string, role: TeamRole) => {
      const teamRows = await db
        .select()
        .from(teams)
        .where(eq(teams.id, teamId));
      if (teamRows.length === 0) throw notFound(`team ${teamId} not found`);
      const team = teamRows[0];

      // Verify agent is a member of the team's parent department
      const deptMembership = await db
        .select()
        .from(agentProjects)
        .where(
          and(
            eq(agentProjects.agentId, agentId),
            eq(agentProjects.projectId, team.parentProjectId),
          ),
        );
      if (deptMembership.length === 0) {
        throw badRequest(
          `agent is not a member of the team's parent department`,
        );
      }

      // Verify no existing lead if adding a lead
      if (role === "lead") {
        const existingLead = await db
          .select()
          .from(teamMembers)
          .where(
            and(
              eq(teamMembers.teamId, teamId),
              eq(teamMembers.role, "lead"),
            ),
          );
        if (existingLead.length > 0) {
          throw badRequest(`team already has a lead — reassign first`);
        }
      }

      const inserted = await db
        .insert(teamMembers)
        .values({ teamId, agentId, role })
        .returning();
      return inserted[0];
    },

    removeMember: async (teamId: string, agentId: string) => {
      const membershipRows = await db
        .select()
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.agentId, agentId),
          ),
        );
      if (membershipRows.length === 0) throw notFound(`membership not found`);
      const membership = membershipRows[0];

      if (membership.role === "lead") {
        const leadCount = await db
          .select()
          .from(teamMembers)
          .where(
            and(
              eq(teamMembers.teamId, teamId),
              eq(teamMembers.role, "lead"),
            ),
          );
        if (leadCount.length === 1) {
          throw badRequest(
            `cannot remove the only lead — designate a new lead first`,
          );
        }
      }

      await db
        .delete(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.agentId, agentId),
          ),
        );
      return { ok: true };
    },

    updateMemberRole: async (
      teamId: string,
      agentId: string,
      role: TeamRole,
    ) => {
      // If promoting to lead, demote any existing lead first (transactional)
      return db.transaction(async (tx: any) => {
        if (role === "lead") {
          const existingLead = await tx
            .select()
            .from(teamMembers)
            .where(
              and(
                eq(teamMembers.teamId, teamId),
                eq(teamMembers.role, "lead"),
              ),
            );
          for (const lead of existingLead) {
            if (lead.agentId !== agentId) {
              await tx
                .update(teamMembers)
                .set({ role: "member" })
                .where(eq(teamMembers.id, lead.id));
            }
          }
        }
        const updated = await tx
          .update(teamMembers)
          .set({ role })
          .where(
            and(
              eq(teamMembers.teamId, teamId),
              eq(teamMembers.agentId, agentId),
            ),
          )
          .returning();
        if (updated.length === 0) throw notFound(`membership not found`);
        return updated[0];
      });
    },
  };
}
