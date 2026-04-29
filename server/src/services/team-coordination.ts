import { eq, and } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { teamCoordinations } from "@armyofagents/db";
import type { CreateTeamCoordinationInput } from "@armyofagents/shared";
import { generateTeamSlug } from "./team-slug.js";
import { notFound } from "../errors.js";
import { replaceAutoSection } from "./coordination-parser.js";

export function teamCoordinationService(db: Db) {
  return {
    getByTeam: async (teamId: string) => {
      const rows = await db
        .select()
        .from(teamCoordinations)
        .where(and(eq(teamCoordinations.teamId, teamId), eq(teamCoordinations.status, "published")));
      return rows[0] ?? null;
    },

    upsert: async (companyId: string, input: CreateTeamCoordinationInput) => {
      // P2: wrap read-existing + insert-or-update in a single transaction to
      // narrow the TOCTOU window where two concurrent upserts could each see
      // "no published row" and both insert, producing two published
      // coordination rows for the same team. The schema does not yet enforce
      // single-published-per-team; followup work should add a partial unique
      // index `(teamId) WHERE status = 'published'` (mirrors the
      // `team_members_one_lead_uq` pattern from Slice 1) — the migration-
      // level constraint is the proper fix. Until then the transaction wrap
      // is the cheapest defense-in-depth.
      return db.transaction(async (tx: any) => {
        const existing = await tx
          .select()
          .from(teamCoordinations)
          .where(and(
            eq(teamCoordinations.teamId, input.teamId),
            eq(teamCoordinations.status, "published"),
          ));

        if (existing.length > 0) {
          const updated = await tx
            .update(teamCoordinations)
            .set({
              name: input.name,
              description: input.description,
              markdown: input.markdown,
              updatedAt: new Date(),
            })
            .where(eq(teamCoordinations.id, existing[0].id))
            .returning();
          return updated[0];
        }

        const slug = generateTeamSlug(input.name);
        // P2: derive `key` from teamId (always unique per company) rather
        // than the name slug. Two teams with similar names previously
        // generated the same slug → identical key → 23505 on the second
        // insert. teamId is unique per companyId, so
        // `team-${teamId}:coordination` collisions are impossible (one
        // coordination row per team is correct).
        const inserted = await tx
          .insert(teamCoordinations)
          .values({
            companyId,
            teamId: input.teamId,
            key: `team-${input.teamId}:coordination`,
            slug,
            name: input.name,
            description: input.description,
            markdown: input.markdown,
          })
          .returning();
        return inserted[0];
      });
    },

    archive: async (id: string) => {
      const updated = await db
        .update(teamCoordinations)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(teamCoordinations.id, id))
        .returning();
      if (updated.length === 0) throw notFound(`coordination ${id} not found`);
      return updated[0];
    },

    regenerateAutoSections: async (
      coordinationId: string,
      sections: Record<string, string>,
    ) => {
      const rows = await db
        .select()
        .from(teamCoordinations)
        .where(eq(teamCoordinations.id, coordinationId));
      if (rows.length === 0) throw notFound(`coordination ${coordinationId} not found`);

      let markdown = rows[0].markdown;
      for (const [name, content] of Object.entries(sections)) {
        markdown = replaceAutoSection(markdown, name, content);
      }

      const updated = await db
        .update(teamCoordinations)
        .set({ markdown, updatedAt: new Date() })
        .where(eq(teamCoordinations.id, coordinationId))
        .returning();
      return updated[0];
    },
  };
}
