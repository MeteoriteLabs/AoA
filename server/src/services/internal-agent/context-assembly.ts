import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companies, memoryItems, projects } from "@paperclipai/db";

const SYSTEM_INSTRUCTIONS = `You are the internal AI assistant for this company. Your role is to help the founder manage their team of AI agents and human collaborators.

Capabilities:
- Query and manage tasks, goals, agents, departments, and projects
- Access and suggest updates to company memory/knowledge base
- Process debriefs and discussion content
- Analyze workload and suggest improvements
- Manage task dependencies and coordination

Rules:
- Always be concise and actionable
- When taking write actions, explain what you're about to do before doing it
- Respect the user's role and permissions
- If unsure, ask for clarification rather than guessing
- Reference specific tasks, goals, or agents by name when possible`;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  // Slice to fit within budget; subtract 3 for "..." suffix, then floor to ensure
  // ceil(result.length / 4) <= maxTokens
  const sliceLen = maxChars - 3;
  if (sliceLen <= 0) return "";
  return text.slice(0, sliceLen) + "...";
}

export function contextAssemblyService(db: Db) {
  return {
    async assembleContext(
      companyId: string,
      options: {
        pageContext?: string;
        departmentContext?: string;
        conversationSummary?: string | null;
        contextTokenBudget?: number;
      } = {},
    ): Promise<{ systemPrompt: string; estimatedTokens: number }> {
      const budget = options.contextTokenBudget ?? 8000;
      const sections: string[] = [];
      let usedTokens = 0;

      const addSection = (label: string, content: string) => {
        if (!content.trim()) return;
        const section = `## ${label}\n${content}`;
        const sectionTokens = estimateTokens(section);
        const remaining = budget - usedTokens;
        if (remaining <= 0) return;
        if (sectionTokens <= remaining) {
          sections.push(section);
          usedTokens += sectionTokens;
        } else {
          sections.push(truncateToTokenBudget(section, remaining));
          usedTokens = budget;
        }
      };

      // 1. System instructions (always included, highest priority)
      addSection("Instructions", SYSTEM_INSTRUCTIONS);

      // 2. Company identity
      const company = await db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .then((rows: any[]) => rows[0] ?? null);

      if (company) {
        const parts: string[] = [];
        if (company.vision) parts.push(`Vision: ${company.vision}`);
        if (company.mission) parts.push(`Mission: ${company.mission}`);

        const identityItems = await db
          .select()
          .from(memoryItems)
          .where(
            and(
              eq(memoryItems.companyId, companyId),
              eq(memoryItems.layer, "identity"),
              eq(memoryItems.status, "approved"),
            ),
          );

        for (const item of identityItems) {
          parts.push(`${item.title}: ${item.content}`);
        }

        if (parts.length > 0) {
          addSection("Company Identity", parts.join("\n"));
        }
      }

      // 3. Department context (if set)
      if (options.departmentContext) {
        const dept = await db
          .select()
          .from(projects)
          .where(eq(projects.id, options.departmentContext))
          .then((rows: any[]) => rows[0] ?? null);

        if (dept) {
          const parts: string[] = [`Department: ${dept.name}`];
          if (dept.description) parts.push(dept.description);

          const domainItems = await db
            .select()
            .from(memoryItems)
            .where(
              and(
                eq(memoryItems.companyId, companyId),
                eq(memoryItems.layer, "domain"),
                eq(memoryItems.departmentId, options.departmentContext),
                eq(memoryItems.status, "approved"),
              ),
            );

          for (const item of domainItems) {
            parts.push(`${item.title}: ${item.content}`);
          }

          addSection("Department Context", parts.join("\n"));
        }
      }

      // 4. Conversation summary
      if (options.conversationSummary) {
        addSection("Conversation Summary", options.conversationSummary);
      }

      // 5. Page context
      if (options.pageContext) {
        addSection("Current Context", options.pageContext);
      }

      const separator = "\n\n";
      const systemPrompt = sections.join(separator);

      // If over budget (due to join separators), truncate the final output
      let finalPrompt = systemPrompt;
      if (estimateTokens(finalPrompt) > budget) {
        finalPrompt = truncateToTokenBudget(finalPrompt, budget);
      }

      return {
        systemPrompt: finalPrompt,
        estimatedTokens: estimateTokens(finalPrompt),
      };
    },
  };
}
