import { eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, aoaAgentTriggers } from "@armyofagents/db";
import type { CatalogItem } from "@armyofagents/shared";
import { deriveSiblingResourceUrl } from "./agent-runtime.js";
import { fetchCatalogResourceUrl } from "./fetch-resource.js";
import type { NormalizedMarketplaceAgentTemplate } from "./types.js";

export interface AgentInstructionsServiceLike {
  materializeManagedBundle(
    agent: {
      id: string;
      companyId: string;
      name: string;
      role: string;
      adapterType: string;
      adapterConfig: unknown;
    },
    files: Record<string, string>,
    options?: {
      clearLegacyPromptTemplate?: boolean;
      replaceExisting?: boolean;
      entryFile?: string;
    },
  ): Promise<{ adapterConfig: Record<string, unknown> }>;
}

export async function loadMarketplaceInstructionFiles(
  catalogItem: CatalogItem,
  template: NormalizedMarketplaceAgentTemplate,
): Promise<{ files: Record<string, string>; entryFile: string } | null> {
  if (template.instructions.type === "inline") {
    return { files: template.instructions.files, entryFile: template.instructions.entryFile };
  }

  if (template.instructions.type === "file") {
    const url = deriveSiblingResourceUrl(catalogItem, template.instructions.path);
    return {
      files: {
        [template.instructions.entryFile]: await fetchCatalogResourceUrl(url, "agent instructions"),
      },
      entryFile: template.instructions.entryFile,
    };
  }

  const entries = await Promise.all(
    template.instructions.files.map(async (file) => {
      const url = deriveSiblingResourceUrl(catalogItem, file);
      return [file, await fetchCatalogResourceUrl(url, `agent instruction file ${file}`)] as const;
    }),
  );
  return { files: Object.fromEntries(entries), entryFile: template.instructions.entryFile };
}

export async function createMarketplaceAgent(opts: {
  catalogItem: CatalogItem;
  companyId: string;
  db: Db;
  desiredName: string;
  template: NormalizedMarketplaceAgentTemplate;
  instructionsService?: AgentInstructionsServiceLike;
}): Promise<{ agentId: string }> {
  const { catalogItem, companyId, db, desiredName, template, instructionsService } = opts;

  const instructions = instructionsService
    ? await loadMarketplaceInstructionFiles(catalogItem, template)
    : null;

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(agents)
      .values({
        companyId,
        name: desiredName,
        // D1 (T3.2): propagate kind from template so crew agents land as kind='aoa'.
        // Defaults to 'org' for all legacy/org-kind templates.
        kind: template.kind ?? "org",
        role: template.role,
        title: template.title,
        icon: template.icon,
        status: template.status,
        capabilities: template.capabilities,
        adapterType: template.adapterType,
        adapterConfig: template.adapterConfig,
        runtimeConfig: template.runtimeConfig,
        permissions: template.permissions,
        budgetMonthlyCents: template.budgetMonthlyCents,
        skillKeys: template.skillKeys,
        templateOrigin: catalogItem.id,
        templateVersion: catalogItem.version,
        metadata: template.metadata,
      })
      .returning();

    const agent = inserted[0];

    // Materialise any aoa_agent_triggers rows declared in the template.
    // Each trigger is enabled by default; config is merged from the template.
    // Only executed when there are triggers to insert (org-kind agents have []).
    for (const trigger of template.triggers ?? []) {
      await tx.insert(aoaAgentTriggers).values({
        companyId,
        agentId: agent.id,
        kind: trigger.kind,
        enabled: true,
        config: trigger.config,
      });
    }

    if (instructions && instructionsService) {
      const materialized = await instructionsService.materializeManagedBundle(
        agent,
        instructions.files,
        {
          entryFile: instructions.entryFile,
          replaceExisting: true,
          clearLegacyPromptTemplate: true,
        },
      );

      await tx
        .update(agents)
        .set({ adapterConfig: materialized.adapterConfig, updatedAt: new Date() })
        .where(eq(agents.id, agent.id));
    }

    return { agentId: agent.id };
  });
}
