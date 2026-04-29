import type { Db } from "@armyofagents/db";
import { agents, companySkills } from "@armyofagents/db";
import { and, eq, inArray } from "drizzle-orm";
import { parseManifest } from "./team-manifest.js";
import type { TeamManifest } from "@armyofagents/shared";

/**
 * Slice 8 / Task 8.1: Team import service.
 *
 * `preview(companyId, yamlContent)` parses the YAML manifest, detects
 * agent-name collisions against the company's existing agents, and lists
 * skills/plugins/workflows that aren't yet installed.
 *
 * `install(companyId, yamlContent, resolution)` is the transactional cascade
 * that creates agents, the team, members, and coordination row. v1 throws
 * with NotImplemented — Task 8.2 fills this in.
 */
export interface ImportPreview {
  manifest: TeamManifest;
  collisions: Array<{ kind: "agent" | "team"; name: string; existingId: string }>;
  skillsToInstall: string[];
  pluginsToInstall: string[];
  workflowsToInstall: string[];
}

export interface ImportResolution {
  /** Per-collision strategy, keyed by the colliding entity name. */
  collisions: Record<string, "rename" | "replace" | "skip">;
  parentProjectId: string;
  /** Original name → new name, when the strategy is "rename". */
  renames?: Record<string, string>;
}

export function teamImportService(db: Db) {
  return {
    /**
     * Parse + validate the manifest, then probe the DB for existing-agent
     * collisions and missing skills. Read-only — no writes.
     *
     * Throws on malformed YAML or schema-invalid manifest.
     *
     * Note: `parseManifest` already invokes `validateManifest` internally,
     * so regex/schema invariants are checked at parse time.
     */
    preview: async (
      companyId: string,
      yamlContent: string,
    ): Promise<ImportPreview> => {
      const manifest = parseManifest(yamlContent);

      // Collect agent names from BOTH inline and $ref forms:
      // - Inline agents have `name`
      // - $ref agents have `localName`
      const allNames: string[] = [];
      for (const a of manifest.agents) {
        if ("name" in a) allNames.push(a.name);
        else if ("localName" in a) allNames.push(a.localName);
      }

      // Find collisions: agents in this company that already use one of these names.
      const existingAgents = allNames.length > 0
        ? await db
            .select({ id: agents.id, name: agents.name })
            .from(agents)
            .where(
              and(
                eq(agents.companyId, companyId),
                inArray(agents.name, allNames),
              ),
            )
        : [];

      const collisions: ImportPreview["collisions"] = existingAgents.map(
        (a: { id: string; name: string }) => ({
          kind: "agent" as const,
          name: a.name,
          existingId: a.id,
        }),
      );

      // Skills to install: declared in manifest.skillDeps but not yet on the company.
      // Filter at SQL layer (not in JS) so we don't ship a full company-skills table
      // over the wire just to compute a small set difference.
      const declaredSkills = manifest.skillDeps ?? [];
      const installedSkills = declaredSkills.length > 0
        ? await db
            .select({ key: companySkills.key })
            .from(companySkills)
            .where(
              and(
                eq(companySkills.companyId, companyId),
                inArray(companySkills.key, declaredSkills),
              ),
            )
        : [];
      const installedSet = new Set(
        installedSkills.map((s: { key: string }) => s.key),
      );
      const skillsToInstall = declaredSkills.filter(
        (s) => !installedSet.has(s),
      );

      // Plugins / workflows: simplified for v1 — assume not installed.
      // Task 8.2 may refine this once it has the install pipeline wired up.
      const pluginsToInstall = manifest.pluginDeps ?? [];
      const workflowsToInstall = (manifest.workflowTemplates ?? []).map(
        (w) => w.$ref,
      );

      return {
        manifest,
        collisions,
        skillsToInstall,
        pluginsToInstall,
        workflowsToInstall,
      };
    },

    /**
     * Transactional cascade install. Replaced with full implementation in
     * Task 8.2 — for now this is a stub that throws.
     */
    install: async (
      _companyId: string,
      _yamlContent: string,
      _resolution: ImportResolution,
    ): Promise<{ id: string; slug: string; name: string }> => {
      // TODO(Task 8.2): implement transactional cascade install.
      throw new Error(
        "teamImportService.install not yet implemented (Task 8.2)",
      );
    },
  };
}
