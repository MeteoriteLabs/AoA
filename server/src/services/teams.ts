import { eq, and } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { teams, teamMembers, agentProjects } from "@armyofagents/db";
import type {
  CreateTeamInput,
  UpdateTeamInput,
  TeamRole,
} from "@armyofagents/shared";
import { generateTeamSlug, ensureUniqueSlug } from "./team-slug.js";
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
      const baseSlug = generateTeamSlug(input.name);
      const existing = await db
        .select({ slug: teams.slug })
        .from(teams)
        .where(eq(teams.companyId, companyId));
      const slug = ensureUniqueSlug(
        baseSlug,
        new Set(existing.map((r: any) => r.slug)),
      );
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
