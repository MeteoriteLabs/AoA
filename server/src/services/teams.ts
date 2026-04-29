import { eq, and, inArray } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { teams, teamMembers, agentProjects, projects, teamCoordinations } from "@armyofagents/db";
import type {
  CreateTeamInput,
  UpdateTeamInput,
  TeamRole,
} from "@armyofagents/shared";
import { generateTeamSlug, ensureUniqueSlug } from "./team-slug.js";
import { validateManifest } from "./team-manifest.js";
import { badRequest, conflict, notFound } from "../errors.js";

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
      // P1: Cross-tenant guard — verify the parent project belongs to the
      // caller's company before writing. The FK only enforces
      // `projects.id` existence, not `projects.companyId === teams.companyId`,
      // so without this check a caller could supply another company's project
      // UUID and create a cross-tenant team.
      const projectCheck = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, input.parentProjectId),
            eq(projects.companyId, companyId),
          ),
        );
      if (projectCheck.length === 0) {
        throw badRequest(
          `parent project ${input.parentProjectId} not found in company ${companyId}`,
        );
      }

      // P1: when caller supplies inline members, validate them BEFORE the
      // transaction. Failing fast lets us surface a clean error rather than
      // entering the slug-retry loop and rolling back. We enforce:
      //   - every agent is in the parent dept (Convention C-6)
      //   - at most one lead (matches the partial unique index backstop)
      const memberInputs = input.members ?? [];
      if (memberInputs.length > 0) {
        const agentIds = memberInputs.map((m) => m.agentId);
        const deptMemberships = await db
          .select({ agentId: agentProjects.agentId })
          .from(agentProjects)
          .where(
            and(
              inArray(agentProjects.agentId, agentIds),
              eq(agentProjects.projectId, input.parentProjectId),
            ),
          );
        const inDept = new Set(
          deptMemberships.map((m: { agentId: string }) => m.agentId),
        );
        const missing = agentIds.filter((id) => !inDept.has(id));
        if (missing.length > 0) {
          throw badRequest(
            `agents not in parent department: ${missing.join(", ")}`,
          );
        }

        const leads = memberInputs.filter((m) => m.role === "lead");
        if (leads.length > 1) {
          throw badRequest(
            `at most one lead per team, got ${leads.length}`,
          );
        }
      }

      // Slug uniqueness is enforced by the (companyId, slug) unique index
      // (teams_company_slug_uq). Between the SELECT-existing-slugs probe
      // and the INSERT below, a concurrent transaction could win the race
      // and claim the slug we picked, causing PG to throw 23505. We retry
      // up to MAX_SLUG_RETRIES times — each retry re-reads the existing
      // slugs (the colliding row is now visible) and picks a fresh suffix.
      //
      // P1: when `memberInputs` is non-empty, the team insert + member
      // inserts run inside ONE transaction per attempt — partial-success is
      // impossible. Slug-retry restarts the entire transaction (cheap, since
      // we expect 0 retries in the common case).
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
          const insertedTeam = await db.transaction(async (tx: any) => {
            const teamInsert = await tx
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
            const team = teamInsert[0];

            if (memberInputs.length > 0) {
              await tx.insert(teamMembers).values(
                memberInputs.map((m) => ({
                  teamId: team.id,
                  agentId: m.agentId,
                  role: m.role,
                })),
              );
            }

            return team;
          });
          return insertedTeam;
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
      // P1-D: archive cascades to the team's coordination. Without this,
      // buildTeamCoordinationSkillEntries continues to inject the team's
      // markdown into every member agent's heartbeat run because the
      // coordination row stays status='published'.
      return db.transaction(async (tx: any) => {
        const updated = await tx
          .update(teams)
          .set({
            status: "archived",
            archivedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(teams.id, id))
          .returning();
        if (updated.length === 0) throw notFound(`team ${id} not found`);

        // Cascade — best effort. If no coord row exists, the UPDATE affects 0
        // rows and we don't care. If one exists, flipping it to archived stops
        // injection. team_coordinations has no archivedAt column (only `teams`
        // has one) — only updatedAt is touched here.
        await tx
          .update(teamCoordinations)
          .set({ status: "archived", updatedAt: new Date() })
          .where(
            and(
              eq(teamCoordinations.teamId, id),
              eq(teamCoordinations.status, "published"),
            ),
          );

        return updated[0];
      });
    },

    /**
     * Hard-delete a team. Schema cascades automatically remove team_members
     * and team_coordinations rows (both have `onDelete: "cascade"` on
     * `teams.id`). Agents survive — they were never owned by the team; they
     * live independently in `agents` + `agent_projects`.
     *
     * Use this as the founder escape hatch for "I imported the wrong team and
     * want to undo it cleanly." For temporary hide, use `archive()` instead.
     */
    dismantle: async (id: string): Promise<{ dismantledTeamId: string }> => {
      const teamRows = await db
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.id, id));
      if (teamRows.length === 0) throw notFound(`team ${id} not found`);

      await db.delete(teams).where(eq(teams.id, id));
      // Cascade handles team_members + team_coordinations.

      return { dismantledTeamId: id };
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

      // P2: convert PG 23505 unique-violation on the
      // `team_members_team_agent_uq` index into a clean 409 Conflict.
      // A naked re-insert would otherwise bubble up as 500 via the global
      // error handler — but a duplicate addMember is a client-correctable
      // condition, not a server fault.
      try {
        const inserted = await db
          .insert(teamMembers)
          .values({ teamId, agentId, role })
          .returning();
        return inserted[0];
      } catch (err) {
        const code =
          (err as { code?: string }).code ??
          (err as { cause?: { code?: string } }).cause?.code;
        if (code === "23505") {
          throw conflict(
            `agent ${agentId} is already a member of team ${teamId}`,
          );
        }
        throw err;
      }
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
