import { eq, and, desc } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { debriefs, briefs, briefItems, projects, discussions, discussionEntries, discussionExtractedItems, internalAgentConfig, internalAgentRuns } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { publishLiveEvent } from "./live-events.js";
import { getProviderApiKey, createProvider } from "./internal-agent/providers/index.js";

export interface ExtractedItem {
  type: "decision" | "task" | "insight" | "context" | "reference" | "preference";
  title: string;
  description: string;
  priority?: "urgent" | "high" | "medium" | "low";
  department?: string | null;
  layer?: "identity" | "domain" | "active_context" | "working" | null;
}

const EXTRACTION_PROMPT_TEMPLATE = `You are analyzing content from a founder's debrief — raw notes, meeting summaries, brainstorming sessions, or pasted conversations.

Available departments and projects in this company:
{{DEPARTMENTS_AND_PROJECTS_LIST}}

Extract the following structured items:

1. DECISIONS — conclusions, choices, or commitments that were made
2. TASKS — action items that need to be done (include suggested priority if apparent)
3. INSIGHTS — notable observations, patterns, or learnings worth remembering
4. CONTEXT — background information, facts, or data points worth storing
5. REFERENCES — durable facts, links, contacts, docs, or resources worth retrieving later
6. PREFERENCES — founder or team preferences about style, tooling, process, or constraints

For each item, provide:
- type: 'decision' | 'task' | 'insight' | 'context' | 'reference' | 'preference'
- title: concise one-line title
- description: 1-3 sentence explanation
- priority: 'urgent' | 'high' | 'medium' | 'low' (for tasks only, if determinable)
- department: name of the most relevant department or project from the list above, or null if it doesn't clearly fit any
- layer: suggest one memory layer using these heuristics:
  - company-wide vision, principles, values, or enduring preferences => 'identity'
  - department-specific process, standards, or guidelines => 'domain'
  - goal or project-specific context that should persist while the work is active => 'active_context'
  - task-specific working notes or execution details => 'working'
  - if unclear, prefer 'domain'

Return as JSON array. If the content doesn't contain a particular type, omit that type.
Only extract items that are clearly present — do not infer or fabricate.
If an item does not clearly belong to any department or project, set department to null — do not force a match.

Respond ONLY with a valid JSON array. No markdown, no explanation, no code fences.`;

/**
 * Build the departments/projects list string for the extraction prompt.
 */
async function buildDepartmentsList(
  db: Db,
  companyId: string,
): Promise<{ text: string; lookup: Map<string, { id: string; type: string }> }> {
  const rows = await db
    .select({ id: projects.id, name: projects.name, type: projects.type })
    .from(projects)
    .where(eq(projects.companyId, companyId));

  const lookup = new Map<string, { id: string; type: string }>();

  if (rows.length === 0) {
    return { text: "(No departments or projects configured yet)", lookup };
  }

  const lines: string[] = [];
  for (const row of rows) {
    const label = row.type === "department" ? "Department" : "Project";
    lines.push(`- ${row.name} (${label})`);
    lookup.set(row.name.toLowerCase(), { id: row.id, type: row.type });
  }

  return { text: lines.join("\n"), lookup };
}

/**
 * Call the LLM to extract structured items from raw debrief content.
 * Uses a direct fetch to an OpenAI-compatible API endpoint.
 * Falls back gracefully if no API key is configured.
 */
async function callLLM(prompt: string, content: string): Promise<ExtractedItem[]> {
  // Check for API key — support both Anthropic and OpenAI
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (anthropicKey) {
    return callAnthropic(anthropicKey, prompt, content);
  }

  if (openaiKey) {
    return callOpenAI(openaiKey, prompt, content);
  }

  throw new Error(
    "No LLM API key configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable Debrief extraction.",
  );
}

async function callAnthropic(
  apiKey: string,
  systemPrompt: string,
  content: string,
): Promise<ExtractedItem[]> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.EXTRACTION_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${body}`);
  }

  const result = await response.json();
  const text = result.content?.[0]?.text;
  if (!text) throw new Error("Empty response from Anthropic API");

  return parseExtractedItems(text);
}

async function callOpenAI(
  apiKey: string,
  systemPrompt: string,
  content: string,
): Promise<ExtractedItem[]> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.EXTRACTION_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${body}`);
  }

  const result = await response.json();
  const text = result.choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty response from OpenAI API");

  return parseExtractedItems(text);
}

/**
 * Parse the LLM response text into structured items.
 * Handles potential markdown code fences around JSON.
 */
export function parseExtractedItems(text: string): ExtractedItem[] {
  let cleaned = text.trim();

  // Strip markdown code fences if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  const parsed = JSON.parse(cleaned);

  if (!Array.isArray(parsed)) {
    throw new Error("LLM response is not a JSON array");
  }

  const validTypes = new Set(["decision", "task", "insight", "context", "reference", "preference"]);
  const validPriorities = new Set(["urgent", "high", "medium", "low"]);
  const validLayers = new Set(["identity", "domain", "active_context", "working"]);

  return parsed
    .filter((item: unknown) => {
      if (!item || typeof item !== "object") return false;
      const obj = item as Record<string, unknown>;
      return (
        typeof obj.type === "string" &&
        validTypes.has(obj.type) &&
        typeof obj.title === "string" &&
        obj.title.length > 0
      );
    })
    .map((item: Record<string, unknown>) => ({
      type: item.type as ExtractedItem["type"],
      title: String(item.title),
      description: typeof item.description === "string" ? item.description : "",
      priority:
        item.type === "task" &&
        typeof item.priority === "string" &&
        validPriorities.has(item.priority)
          ? (item.priority as ExtractedItem["priority"])
          : undefined,
      department:
        typeof item.department === "string" ? item.department : null,
      layer:
        typeof item.layer === "string" && validLayers.has(item.layer)
          ? (item.layer as ExtractedItem["layer"])
          : null,
    }));
}

export function extractionService(db: Db) {
  return {
    /**
     * Main extraction function. Fetches debrief content, calls LLM,
     * creates Brief + BriefItems, updates debrief status.
     */
    extractFromDebrief: async (companyId: string, debriefId: string) => {
      const log = logger.child({ service: "extraction", debriefId, companyId });

      try {
        // 1. Fetch the debrief
        const [debrief] = await db
          .select()
          .from(debriefs)
          .where(
            and(eq(debriefs.id, debriefId), eq(debriefs.companyId, companyId)),
          );

        if (!debrief) {
          log.error("Debrief not found");
          return;
        }

        // 2. Build prompt with departments list
        const { text: deptList, lookup: deptLookup } =
          await buildDepartmentsList(db, companyId);
        const prompt = EXTRACTION_PROMPT_TEMPLATE.replace(
          "{{DEPARTMENTS_AND_PROJECTS_LIST}}",
          deptList,
        );

        // 3. Call LLM
        log.info("Starting LLM extraction");
        const extractedItems = await callLLM(prompt, debrief.rawContent);
        log.info({ itemCount: extractedItems.length }, "Extraction complete");

        // 4-6. Create Brief + BriefItems + update debrief atomically
        await db.transaction(async (tx) => {
          const [brief] = await tx
            .insert(briefs)
            .values({
              companyId,
              debriefId,
              status: "ready",
              departmentId: debrief.departmentId,
              projectId: debrief.projectId,
              goalId: debrief.goalId,
            })
            .returning();

          // 5. Create BriefItems
          if (extractedItems.length > 0) {
            const itemValues = extractedItems.map((item) => {
              // Resolve department name to ID
              let suggestedDepartmentId: string | null = null;
              let suggestedProjectId: string | null = null;

              if (item.department) {
                const match = deptLookup.get(item.department.toLowerCase());
                if (match) {
                  if (match.type === "department") {
                    suggestedDepartmentId = match.id;
                  } else {
                    suggestedProjectId = match.id;
                  }
                }
              }

              return {
                briefId: brief.id,
                type: item.type,
                title: item.title,
                description: item.description || null,
                suggestedPriority: item.priority || null,
                suggestedDepartmentId,
                suggestedProjectId,
                suggestedLayer: item.layer ?? "domain",
                layer: item.layer ?? "domain",
                status: "pending" as const,
              };
            });

            await tx.insert(briefItems).values(itemValues);
          }

          // 6. Update debrief status to 'ready'
          await tx
            .update(debriefs)
            .set({ status: "ready" })
            .where(eq(debriefs.id, debriefId));

          log.info(
            { briefId: brief.id, itemCount: extractedItems.length },
            "Brief created successfully",
          );
        });
      } catch (err) {
        const log = logger.child({
          service: "extraction",
          debriefId,
          companyId,
        });
        log.error({ err }, "Extraction failed");

        // Update debrief status to 'processing_failed'
        await db
          .update(debriefs)
          .set({ status: "processing_failed" })
          .where(eq(debriefs.id, debriefId))
          .catch((updateErr) => {
            log.error({ err: updateErr }, "Failed to update debrief status after extraction failure");
          });
      }
    },

    extractFromDiscussionEntry: async (companyId: string, entryId: string) => {
      const log = logger.child({ service: "extraction", entryId, companyId });
      let discussionId = "";

      try {
        // 1. Fetch the entry
        const [entry] = await db
          .select()
          .from(discussionEntries)
          .where(and(eq(discussionEntries.id, entryId)));

        if (!entry) {
          log.error("Discussion entry not found");
          return;
        }

        discussionId = entry.discussionId;

        // Guard: skip if already processing or completed (prevents double extraction)
        if (entry.extractionStatus !== "pending") {
          log.info({ currentStatus: entry.extractionStatus }, "Entry not in pending status — skipping");
          return;
        }

        // 2. Fetch parent discussion for companyId verification
        const [discussion] = await db
          .select()
          .from(discussions)
          .where(eq(discussions.id, entry.discussionId));

        if (!discussion || discussion.companyId !== companyId) {
          log.error("Discussion not found or company mismatch");
          return;
        }

        // 3. Set extraction status to processing
        await db
          .update(discussionEntries)
          .set({ extractionStatus: "processing" })
          .where(eq(discussionEntries.id, entryId));

        // 4. Get thread context (most recent 10 entries, excluding current)
        const previousEntries = await db
          .select()
          .from(discussionEntries)
          .where(eq(discussionEntries.discussionId, entry.discussionId))
          .orderBy(desc(discussionEntries.createdAt))
          .limit(11);

        const threadContext = previousEntries
          .filter((e: any) => e.id !== entryId)
          .slice(0, 10)
          .reverse()
          .map((e: any) => e.rawContent)
          .join("\n---\n");

        // 5. Build extraction prompt
        const { text: deptList, lookup: deptLookup } =
          await buildDepartmentsList(db, companyId);
        const prompt = EXTRACTION_PROMPT_TEMPLATE.replace(
          "{{DEPARTMENTS_AND_PROJECTS_LIST}}",
          deptList,
        );

        // 6. Check if internal agent is configured
        const [agentConfig] = await db
          .select()
          .from(internalAgentConfig)
          .where(eq(internalAgentConfig.companyId, companyId));

        let extractedItems: ExtractedItem[];

        if (agentConfig?.provider) {
          // ── Agent-based extraction ────────────────────────────────────
          log.info("Using agent provider for extraction");

          const [run] = await db
            .insert(internalAgentRuns)
            .values({
              companyId,
              triggerType: "event",
              triggerSource: "discussion_entry",
              status: "running",
            })
            .returning();

          try {
            const apiKey = await getProviderApiKey(db, companyId, agentConfig.provider);
            const provider = createProvider(agentConfig.provider, apiKey);
            const model = agentConfig.model ?? "claude-sonnet-4-6";

            const userContent = threadContext
              ? `Previous context:\n${threadContext}\n\n---\n\nNew entry to extract from:\n${entry.rawContent}`
              : entry.rawContent;

            let text = "";
            for await (const chunk of provider.chat({
              messages: [{ role: "user", content: userContent }],
              tools: [],
              model,
              maxTokens: 4096,
              systemPrompt: prompt,
            })) {
              if (chunk.type === "text") text += chunk.delta;
            }

            extractedItems = parseExtractedItems(text);

            await db
              .update(internalAgentRuns)
              .set({ status: "completed", completedAt: new Date() })
              .where(eq(internalAgentRuns.id, run.id));

            await db
              .update(discussionEntries)
              .set({ extractionRunId: run.id })
              .where(eq(discussionEntries.id, entryId));
          } catch (providerErr: any) {
            log.error({ err: providerErr }, "Agent provider extraction failed");
            await db
              .update(internalAgentRuns)
              .set({
                status: "failed",
                errorMessage: providerErr?.message ?? "Unknown error",
                completedAt: new Date(),
              })
              .where(eq(internalAgentRuns.id, run.id));
            throw providerErr;
          }
        } else {
          // ── Legacy fallback extraction ────────────────────────────────
          log.info("No agent config — using legacy extraction");
          const userContent = threadContext
            ? `Previous context:\n${threadContext}\n\n---\n\nNew entry to extract from:\n${entry.rawContent}`
            : entry.rawContent;
          extractedItems = await callLLM(prompt, userContent);
        }

        log.info({ itemCount: extractedItems.length }, "Extraction complete");

        // 7. Create extracted items
        if (extractedItems.length > 0) {
          const itemValues = extractedItems.map((item) => {
            let suggestedDepartmentId: string | null = null;
            let suggestedProjectId: string | null = null;

            if (item.department) {
              const match = deptLookup.get(item.department.toLowerCase());
              if (match) {
                if (match.type === "department") {
                  suggestedDepartmentId = match.id;
                } else {
                  suggestedProjectId = match.id;
                }
              }
            }

            return {
              discussionEntryId: entryId,
              type: item.type,
              title: item.title,
              description: item.description || null,
              suggestedPriority: item.priority || null,
              suggestedDepartmentId,
              suggestedProjectId,
              suggestedLayer: item.layer ?? "domain",
              layer: item.layer ?? "domain",
              status: "pending" as const,
            };
          });

          await db.insert(discussionExtractedItems).values(itemValues);
        }

        // 8. Mark completed
        await db
          .update(discussionEntries)
          .set({ extractionStatus: "completed" })
          .where(eq(discussionEntries.id, entryId));

        // 9. Publish completion event
        publishLiveEvent({
          companyId,
          type: "discussion.extraction.completed",
          payload: {
            discussionId: entry.discussionId,
            entryId,
            itemCount: extractedItems.length,
          },
        });
      } catch (err) {
        log.error({ err }, "Discussion entry extraction failed");

        await db
          .update(discussionEntries)
          .set({ extractionStatus: "failed" })
          .where(eq(discussionEntries.id, entryId))
          .catch((updateErr: any) => {
            log.error({ err: updateErr }, "Failed to update entry status after extraction failure");
          });

        publishLiveEvent({
          companyId,
          type: "discussion.extraction.failed",
          payload: { discussionId, entryId, error: err instanceof Error ? err.message : String(err) },
        });
      }
    },
  };
}
