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
      const existing = await db
        .select()
        .from(teamCoordinations)
        .where(and(
          eq(teamCoordinations.teamId, input.teamId),
          eq(teamCoordinations.status, "published"),
        ));

      if (existing.length > 0) {
        const updated = await db
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
      const inserted = await db
        .insert(teamCoordinations)
        .values({
          companyId,
          teamId: input.teamId,
          key: `${slug}:coordination`,
          slug,
          name: input.name,
          description: input.description,
          markdown: input.markdown,
        })
        .returning();
      return inserted[0];
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
