import { eq, and, desc, gt, sql, ne, isNull, asc, inArray } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { debriefs, briefs, briefItems, projects, discussions, discussionEntries, discussionExtractedItems, internalAgentConfig } from "@armyofagents/db";
import { logger } from "../middleware/logger.js";
import { publishLiveEvent } from "./live-events.js";
import { parseExtractedItems, type ExtractedItem, type ExtractedItemType } from "./extraction-parser.js";
import { resolveExtractionEngine, resolveCompanyCliTool } from "./extraction-engine.js";
import { extractViaCli, CliExtractionError } from "./extraction-cli.js";
import { buildDiscussionPendingHubEmit, emitHubItem } from "./hub-source-producers.js";

// Re-export pure parser symbols so existing importers (`from "./extraction.js"`)
// continue to work unchanged after the move to extraction-parser.ts.
export { parseExtractedItems } from "./extraction-parser.js";
export type { ExtractedItem, ExtractedItemType } from "./extraction-parser.js";

// W2 (extract-then-scope) bounds for `extractThreadEntriesAwait`. Exported so
// the unit tests pin against the real values (no silent caps).
export const MAX_EXTRACT_ENTRIES_PER_SCOPE = 25;
export const EXTRACT_SCOPE_DEADLINE_MS = 180_000; // eng-review D2 — see W2 plan

const EXTRACTION_PROMPT_TEMPLATE = `You are extracting structured items from a founder's discussion entry — raw notes, meeting summaries, brainstorming, or pasted conversations.

Previous entries in this thread (if any) are provided for context. Extract ONLY from the new entry — do not re-extract items already covered in previous entries.

Available departments and projects:
{{DEPARTMENTS_AND_PROJECTS_LIST}}

Extract these item types:

1. DECISIONS — conclusions, choices, or commitments made
2. TASKS — concrete action items (single work items assignable to one person, not epics or vague goals)
3. INSIGHTS — notable observations, patterns, or learnings worth remembering
4. CONTEXT — background facts or data points worth storing
5. REFERENCES — durable links, contacts, docs, or resources worth retrieving later
6. PREFERENCES — founder/team preferences about style, tooling, process, or constraints

Skip: greetings, filler, small talk, emotional commentary, vague ideas without clear substance, and anything already captured in previous entries.

For each item return:
- type: 'decision' | 'task' | 'insight' | 'context' | 'reference' | 'preference'
- title: concise one-line title (under 80 chars)
- description: 1-3 sentence explanation with enough context to act on later
- priority: 'urgent' | 'high' | 'medium' | 'low' (tasks only, omit if unclear)
- department: most relevant name from the list above, or null
- layer: one of:
  - 'identity' — company-wide vision, values, enduring preferences
  - 'domain' — department standards, processes, guidelines
  - 'active_context' — goal/project-scoped, persists while work is active
  - 'working' — task-scoped notes, ephemeral execution details
  - default to 'domain' if unclear

Return [] if the entry contains no extractable items.
Do not infer or fabricate items. Do not force department matches — use null if uncertain.
Respond ONLY with a valid JSON array. No markdown, no explanation.

Example input: "Had a call with Acme Corp. They want the dashboard done by April 15. We decided to use Tailwind instead of custom CSS. Sarah should set up the CI pipeline this week."

Example output:
[
  {"type":"decision","title":"Use Tailwind CSS for dashboard","description":"Team decided to use Tailwind instead of custom CSS for the dashboard project.","department":"Engineering","layer":"domain"},
  {"type":"task","title":"Set up CI pipeline","description":"Sarah should configure the CI pipeline this week.","priority":"high","department":"Engineering","layer":"working"},
  {"type":"context","title":"Acme Corp dashboard deadline is April 15","description":"Client Acme Corp expects the dashboard completed by April 15.","department":null,"layer":"active_context"}
]

Example input: "Hey, just checking in. Nothing new really, will update tomorrow."

Example output:
[]`;

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
 * Resolve the keyless-CLI extraction context for a company: the CLI tool to
 * spawn and the codex model hint to forward. Mirrors how the discussion path
 * derives `cliTool` + `codexModel` from `internal_agent_config`. Used by the
 * debrief-push and file-import extraction paths.
 */
async function resolveCliExtractionContext(
  db: Db,
  companyId: string,
): Promise<{ cliTool: string; codexModel: string | null }> {
  const cliTool = await resolveCompanyCliTool(db, companyId);
  const [config] = await db
    .select({ model: internalAgentConfig.model })
    .from(internalAgentConfig)
    .where(eq(internalAgentConfig.companyId, companyId));
  return { cliTool, codexModel: config?.model ?? null };
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

        // 3. Extract via the keyless CLI (no hosted provider key).
        const { cliTool, codexModel } = await resolveCliExtractionContext(
          db,
          companyId,
        );
        log.info({ cliTool }, "Starting CLI extraction");
        const extractedItems = await extractViaCli(cliTool, prompt, debrief.rawContent, {
          codexModel,
        });
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

        // P1-T7: scope_proposal entries are NOT prose for the extractor — their
        // rawContent is a structured proposal JSON and their lifecycle lives in
        // proposalStatus. Never claim/extract them: doing so would flip their
        // extractionStatus (pending -> processing -> completed) and corrupt the
        // Approve handler's idempotency read. Last line of defense behind the
        // dispatcher sweep filter + the "skipped" insert default.
        if (entry.inputType === "scope_proposal") {
          log.info("Entry is a scope_proposal — skipping extraction (not extractable prose)");
          return;
        }

        // Atomic claim: flip pending -> processing in a single statement.
        // Only the writer that gets a row back proceeds. This replaces the
        // prior non-atomic read-then-check, fixing a pre-existing race
        // (concurrent reprocess / reprocess-all) AND making the durable
        // sweeper (sub-agent #1) safe to run alongside the untouched
        // reprocess direct-call path.
        const claimed = await db
          .update(discussionEntries)
          .set({ extractionStatus: "processing" })
          .where(
            and(
              eq(discussionEntries.id, entryId),
              eq(discussionEntries.extractionStatus, "pending"),
            ),
          )
          .returning();
        if (claimed.length === 0) {
          log.info(
            { currentStatus: entry.extractionStatus },
            "Entry not claimable (already processing/terminal) — skipping",
          );
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

        // 3. Skip trivially short content
        if (!entry.rawContent || entry.rawContent.trim().length < 10) {
          log.info("Content too short — skipping extraction");
          await db
            .update(discussionEntries)
            .set({
              extractionStatus: "skipped",
              sourceInfo: sql`jsonb_set(COALESCE(${discussionEntries.sourceInfo}, '{}'::jsonb), '{extractionError}', '"Content too short to extract from."'::jsonb)`,
            })
            .where(eq(discussionEntries.id, entryId));
          return;
        }

        // 4. Resolve the extraction ENGINE. Extraction is CLI-only (keyless) —
        //    `resolveExtractionEngine` returns "cli" or throws. The `skipped`
        //    outcome happens when no supported CLI is available; a hosted
        //    provider key is NEVER consulted (keys are embeddings-only).
        try {
          await resolveExtractionEngine(db, companyId);
        } catch (engineErr) {
          const msg =
            engineErr instanceof Error
              ? engineErr.message
              : "No extraction engine available. Install a CLI (e.g. the Claude Code CLI) and run its login flow (`claude login`).";
          log.warn(msg);
          await db
            .update(discussionEntries)
            .set({
              extractionStatus: "skipped",
              sourceInfo: sql`jsonb_set(COALESCE(${discussionEntries.sourceInfo}, '{}'::jsonb), '{extractionError}', ${JSON.stringify(msg)}::jsonb)`,
            })
            .where(eq(discussionEntries.id, entryId));
          return;
        }

        // (status was already set to 'processing' by the atomic claim above)

        // 5. Fetch agent config (CLI tool hint + codex model for the keyless
        //    extractor). Cheap single read.
        const [agentConfig] = await db
          .select()
          .from(internalAgentConfig)
          .where(eq(internalAgentConfig.companyId, companyId));

        // 6. Get thread context (most recent 10 entries, excluding current).
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

        // 7. Build extraction prompt. Shared by BOTH engines — there is no
        //    second extraction prompt to maintain.
        const { text: deptList, lookup: deptLookup } =
          await buildDepartmentsList(db, companyId);
        const prompt = EXTRACTION_PROMPT_TEMPLATE.replace(
          "{{DEPARTMENTS_AND_PROJECTS_LIST}}",
          deptList,
        );

        const userContent = threadContext
          ? `Previous context:\n${threadContext}\n\n---\n\nNew entry to extract from:\n${entry.rawContent}`
          : entry.rawContent;

        let extractedItems: ExtractedItem[] = [];

        // ── Keyless CLI extraction ──────────────────────────────────────
        // Extraction is CLI-only — no hosted provider key is ever consulted.
        // extractViaCli returns already-parsed ExtractedItem[] (no
        // parseExtractedItems step).
        const cliTool = agentConfig?.cliTool ?? (await resolveCompanyCliTool(db, companyId));
        log.info({ cliTool }, "Using CLI engine for extraction (keyless)");

        // Bounded retry for transient timeout failures (up to 3 attempts total).
        // Only `timeout` errors are retried — structural errors (not_installed,
        // not_authed, nonzero_exit, unparseable) terminalize immediately.
        const MAX_CLI_ATTEMPTS = 3;
        const CLI_RETRY_DELAY_MS = 500;
        let lastCliErr: CliExtractionError | undefined;

        for (let attempt = 1; attempt <= MAX_CLI_ATTEMPTS; attempt++) {
          try {
            extractedItems = await extractViaCli(cliTool, prompt, userContent, {
              codexModel: agentConfig?.model ?? null,
            });
            lastCliErr = undefined; // success — clear any prior transient error
            break; // exit retry loop
          } catch (cliErr) {
            if (!(cliErr instanceof CliExtractionError)) {
              // Non-CLI error (e.g. DB, network): rethrow into the outer catch.
              throw cliErr;
            }

            if (cliErr.kind !== "timeout") {
              // Structural failure (not_installed, not_authed, nonzero_exit,
              // unparseable) — no point retrying, terminalize immediately.
              lastCliErr = cliErr;
              break;
            }

            // Transient timeout — retry if we have attempts left.
            lastCliErr = cliErr;
            if (attempt < MAX_CLI_ATTEMPTS) {
              log.warn(
                { attempt, maxAttempts: MAX_CLI_ATTEMPTS, kind: cliErr.kind },
                "CLI extraction timed out — retrying",
              );
              await new Promise<void>((resolve) => setTimeout(resolve, CLI_RETRY_DELAY_MS));
            }
          }
        }

        if (lastCliErr !== undefined) {
          // All attempts exhausted (or non-retryable error) — terminalize failed.
          // There is NO hosted-API fallback: extraction is CLI-only. Record kind
          // + message so the failure UX can surface actionable CLI guidance.
          const failPayload = JSON.stringify({
            kind: lastCliErr.kind,
            message: lastCliErr.message,
          });
          log.error(
            { kind: lastCliErr.kind, err: lastCliErr },
            "CLI extraction failed (all attempts exhausted)",
          );
          await db
            .update(discussionEntries)
            .set({
              extractionStatus: "failed",
              sourceInfo: sql`jsonb_set(COALESCE(${discussionEntries.sourceInfo}, '{}'::jsonb), '{extractionError}', ${failPayload}::jsonb)`,
            })
            .where(eq(discussionEntries.id, entryId));

          publishLiveEvent({
            companyId,
            type: "discussion.extraction.failed",
            payload: { discussionId, entryId, error: lastCliErr.message },
          });
          return;
        }

        log.info({ itemCount: extractedItems.length }, "Extraction complete");

        await db.transaction(async (tx) => {
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

            await tx.insert(discussionExtractedItems).values(itemValues);

            // Increment discussion's pendingItemCount
            await tx
              .update(discussions)
              .set({
                pendingItemCount: sql`${discussions.pendingItemCount} + ${itemValues.length}`,
                updatedAt: new Date(),
              })
              .where(eq(discussions.id, entry.discussionId));
            const [discussion] = await tx
              .select()
              .from(discussions)
              .where(eq(discussions.id, entry.discussionId));
            if (discussion) {
              await emitHubItem(tx as unknown as Db, buildDiscussionPendingHubEmit(discussion));
            }
          }

          // 9. Mark completed
          await tx
            .update(discussionEntries)
            .set({ extractionStatus: "completed" })
            .where(eq(discussionEntries.id, entryId));
        });

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

        const errMessage = err instanceof Error ? err.message : String(err);
        await db
          .update(discussionEntries)
          .set({
            extractionStatus: "failed",
            sourceInfo: sql`jsonb_set(COALESCE(${discussionEntries.sourceInfo}, '{}'::jsonb), '{extractionError}', ${JSON.stringify(errMessage)}::jsonb)`,
          })
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

    /** W2 (D6 extract-then-scope): extract the thread's never-extracted entries and WAIT.
     *  Selection is conservative — entries with any existing extracted items are left
     *  alone (a founder may be mid-review; reprocess semantics stay in reprocessAllEntries).
     *  Serial (one CLI at a time), best-effort per entry, capped by COUNT
     *  (MAX_EXTRACT_ENTRIES_PER_SCOPE) and by WALL-CLOCK (eng-review D2:
     *  EXTRACT_SCOPE_DEADLINE_MS — a hung CLI must not stall the controller pipeline
     *  for ~50 min; give an honest answer within minutes). Never throws. */
    extractThreadEntriesAwait: async (
      companyId: string,
      discussionId: string,
      opts?: {
        /** Injectable extractor (tests). Defaults to the sibling extractFromDiscussionEntry. */
        extractOne?: (companyId: string, entryId: string) => Promise<unknown>;
        /** Injectable clock for the deadline unit test. Defaults to Date.now. */
        now?: () => number;
      },
    ): Promise<{ attempted: number; failed: number; truncated: boolean; deadlineHit: boolean }> => {
      const log = logger.child({ service: "extraction", discussionId, companyId, mode: "scope-await" });
      const extractOne =
        opts?.extractOne ??
        ((c: string, e: string) => extractionService(db).extractFromDiscussionEntry(c, e));
      const now = opts?.now ?? Date.now;
      const startedAt = now();
      try {
        // Eligible: HUMAN prose entries never extracted — status pending/skipped/failed
        // AND no existing extracted items. Entries with items are a founder-review
        // surface; deleting/re-extracting them is reprocess-only semantics
        // (discussions.ts). Codex #270 P2: agent/system entries are excluded too —
        // scoping must derive work from the founder's instructions, not crew chatter
        // (same human discriminator as crew-task-service: authorAgentId IS NULL +
        // inputType not agent/system/scope_proposal). LEFT JOIN + isNull keeps only
        // zero-item entries, so join duplication is moot.
        const rows = (await db
          .select({ id: discussionEntries.id, extractionStatus: discussionEntries.extractionStatus })
          .from(discussionEntries)
          .leftJoin(
            discussionExtractedItems,
            eq(discussionExtractedItems.discussionEntryId, discussionEntries.id),
          )
          .where(and(
            eq(discussionEntries.discussionId, discussionId),
            isNull(discussionEntries.authorAgentId),
            ne(discussionEntries.inputType, "agent"),
            ne(discussionEntries.inputType, "system"),
            ne(discussionEntries.inputType, "scope_proposal"),
            inArray(discussionEntries.extractionStatus, ["pending", "skipped", "failed"]),
            isNull(discussionExtractedItems.id),
          ))
          .orderBy(asc(discussionEntries.seq))) as Array<{ id: string; extractionStatus: string }>;

        const truncated = rows.length > MAX_EXTRACT_ENTRIES_PER_SCOPE;
        const selected = rows.slice(0, MAX_EXTRACT_ENTRIES_PER_SCOPE);
        if (truncated) {
          log.warn(
            { eligible: rows.length, cap: MAX_EXTRACT_ENTRIES_PER_SCOPE },
            "extract-then-scope truncated eligible entries at cap",
          );
        }

        let failed = 0;
        let attempted = 0;
        let deadlineHit = false;
        for (const row of selected) {
          // Eng-review D2: wall-clock deadline — a hung-but-installed CLI must never turn
          // one scoping pass into a ~50-minute controller-pipeline stall. Compile with
          // whatever was extracted so far; the founder gets an honest answer in minutes.
          if (now() - startedAt > EXTRACT_SCOPE_DEADLINE_MS) {
            deadlineHit = true;
            log.warn(
              { attempted, remaining: selected.length - attempted, deadlineMs: EXTRACT_SCOPE_DEADLINE_MS },
              "extract-then-scope deadline hit — compiling with items extracted so far",
            );
            break;
          }
          try {
            if (row.extractionStatus !== "pending") {
              // extractFromDiscussionEntry only claims 'pending' rows.
              await db.update(discussionEntries)
                .set({ extractionStatus: "pending", extractionRunId: null })
                .where(eq(discussionEntries.id, row.id));
            }
            attempted += 1;
            await extractOne(companyId, row.id);
          } catch (err) {
            failed += 1;
            log.warn({ err, entryId: row.id }, "extract-then-scope entry failed (best-effort)");
          }
        }
        return { attempted, failed, truncated, deadlineHit };
      } catch (err) {
        log.warn({ err }, "extract-then-scope selection failed (best-effort) — compiling without");
        return { attempted: 0, failed: 0, truncated: false, deadlineHit: false };
      }
    },

    /**
     * Extract structured memory items from raw text (e.g. imported file content).
     * Returns ExtractedItem[] — does NOT persist anything. Caller handles DB writes.
     * Falls back gracefully: if LLM is unavailable, returns [].
     * Caller should fall back to paragraph chunking when this returns [].
     */
    extractFromRawText: async (
      companyId: string,
      rawText: string,
    ): Promise<ExtractedItem[]> => {
      if (!rawText || rawText.trim().length < 10) return [];

      try {
        const { text: deptList } = await buildDepartmentsList(db, companyId);
        const systemPrompt = EXTRACTION_PROMPT_TEMPLATE.replace(
          "{{DEPARTMENTS_AND_PROJECTS_LIST}}",
          deptList,
        );
        const { cliTool, codexModel } = await resolveCliExtractionContext(
          db,
          companyId,
        );
        return await extractViaCli(cliTool, systemPrompt, rawText, { codexModel });
      } catch (err) {
        // CLI unavailable/unauth or timeout — caller falls back to paragraph chunking
        logger.warn({ err, companyId }, "extractFromRawText: CLI extraction failed, falling back to chunking");
        return [];
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 (Task C1) — Tool-callable extraction surface.
//
// The Phase 1 design eliminates Scribe as an *autonomous* agent. Extraction is
// instead exposed as a small set of named functions that other crew agents
// (Memory Keeper at phase=done, Adjutant optionally mid-discussion) invoke
// through their tool wrappers (built in Task C2 batch 3).
//
// Implementation notes:
//   • These exports REUSE every internal helper above — same prompt template,
//     same departments lookup, same JSON parser. There is no second extraction
//     prompt to maintain. The only divergence from `extractFromDiscussionEntry`
//     is that NOTHING is written to the database here: the caller (tool wrapper)
//     decides what to persist (e.g. `submit_extracted_items`-style inserts).
//   • `extractDecisions`, `extractInsights`, `extractReferences` are thin
//     filters over `extractMemoryCandidates` — DRY win. If a future tool
//     needs `extractTasks` or `extractPreferences` add another one-liner.
//   • The `ExtractionLlm` interface is a test/eval-only injection seam. In
//     production callers pass `null` and extraction runs through the keyless
//     CLI (`extractViaCli`). No hosted provider key is ever consulted.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal LLM surface the tool-callable extractors depend on — a single
 * `generate(prompt, content)` method. This is a TEST/EVAL-ONLY injection seam
 * (e.g. the memory-keeper eval injects a real OpenAI client for deterministic
 * quality measurement).
 *
 * In production callers pass `null`: extraction then runs through the keyless
 * CLI (`extractViaCli`). No hosted provider key is consulted.
 */
export interface ExtractionLlm {
  /**
   * Generate a completion. Implementations must return the raw text response;
   * `parseExtractedItems` will strip any markdown fences and parse the JSON.
   */
  generate(prompt: string, content: string): Promise<string>;
}

/**
 * Structured extraction candidate returned by the tool-callable extractors.
 *
 * Mirrors the writable columns on `discussion_extracted_items`, but the
 * extractor does NOT persist — the tool wrapper decides what to insert. The
 * shape is a superset of the legacy `ExtractedItem` (which has `priority` /
 * `department` / `layer`), renamed to match the schema column names that
 * actually land downstream:
 *   • `suggestedPriority`   ← legacy `priority`
 *   • `suggestedDepartment` ← legacy `department` (still a NAME, not an ID;
 *                              the caller resolves to `suggestedDepartmentId`
 *                              when persisting)
 *   • `suggestedLayer`      ← legacy `layer`
 *
 * Fields default to `null` rather than `undefined` so the candidate is a flat
 * shape suitable for JSON-RPC tool responses.
 */
export interface MemoryCandidate {
  type: ExtractedItemType;
  title: string;
  description: string | null;
  suggestedLayer: "identity" | "domain" | "active_context" | "working" | null;
  suggestedPriority: "urgent" | "high" | "medium" | "low" | null;
  suggestedDepartment: string | null;
}

/**
 * Translate a parsed `ExtractedItem` (legacy shape) into a `MemoryCandidate`
 * (tool-call shape). Pure function — same input always yields the same shape.
 */
function toMemoryCandidate(item: ExtractedItem): MemoryCandidate {
  return {
    // ExtractedItem.type is the six-tuple legacy enum; widen to
    // ExtractedItemType (an eight-tuple superset) by direct assignment. The
    // legacy types are a strict subset so this is type-safe.
    type: item.type as ExtractedItemType,
    title: item.title,
    description: item.description && item.description.length > 0 ? item.description : null,
    suggestedLayer: item.layer ?? null,
    suggestedPriority: item.priority ?? null,
    suggestedDepartment: item.department ?? null,
  };
}

/**
 * Run an LLM extraction over a thread's entries and return structured
 * candidates. Does NOT persist — the caller decides what to do with the
 * results (typically: queue them in `discussion_extracted_items` for founder
 * approval, or surface them inline in an Adjutant response).
 *
 * If `sinceEntryId` is provided, only entries created strictly after that
 * entry are considered (cursor-based incremental extraction). When omitted
 * the entire thread's entries are used as input.
 *
 * If `llm` is `null` (production) the function runs the keyless CLI extractor
 * (`extractViaCli`), which returns already-parsed items. If `llm` is supplied
 * (tests/evals only) it is called with the prompt + concatenated entry content
 * and the raw response is fed through `parseExtractedItems`.
 *
 * Errors are surfaced (the function rejects) so the tool wrapper can return
 * a structured `{ ok: false }` to the calling agent. An empty thread returns
 * `{ candidates: [] }` without invoking the LLM at all.
 */
export async function extractMemoryCandidates(
  db: Db,
  llm: ExtractionLlm | null,
  params: { companyId: string; threadId: string; sinceEntryId?: string },
): Promise<{ candidates: MemoryCandidate[] }> {
  const log = logger.child({
    service: "extraction.extractMemoryCandidates",
    companyId: params.companyId,
    threadId: params.threadId,
  });

  // ── 0. Per-thread privacy gate (G4 wiring-gap fix, G3 contract).
  //       Threads with allowMemoryExtraction=false MUST short-circuit at
  //       the top of the chain: we don't even fetch entries, much less
  //       burn LLM tokens. The propose_memory_from_thread tool also
  //       enforces this downstream, but extracting candidates that will
  //       immediately be rejected wastes time and budget.
  const threadRows = await db
    .select({ allowMemoryExtraction: discussions.allowMemoryExtraction })
    .from(discussions)
    .where(eq(discussions.id, params.threadId));
  const allowExtraction = threadRows[0]?.allowMemoryExtraction;
  if (allowExtraction === false) {
    log.info(
      "thread has allowMemoryExtraction=false — returning empty candidate set",
    );
    return { candidates: [] };
  }

  // ── 1. Resolve the cursor: when sinceEntryId is given, look up its
  //       createdAt so we can express "strictly after this entry" with a
  //       single index-friendly `createdAt > cursor` predicate. Falling back
  //       to the discussionId-only filter when no cursor is given.
  let cursorCreatedAt: Date | null = null;
  if (params.sinceEntryId) {
    const cursorRows = await db
      .select({ createdAt: discussionEntries.createdAt })
      .from(discussionEntries)
      .where(eq(discussionEntries.id, params.sinceEntryId));
    const cursorRow = cursorRows[0];
    if (cursorRow?.createdAt) {
      cursorCreatedAt = cursorRow.createdAt as Date;
    } else {
      // Cursor referenced an entry that does not exist — treat as "no
      // cursor" rather than an error so a stale tool argument can't break
      // an otherwise valid sweep. The agent likely picked an old/deleted
      // entry id; better to extract from the full thread than fail.
      log.info({ sinceEntryId: params.sinceEntryId }, "sinceEntryId not found — falling back to full thread");
    }
  }

  // ── 2. Fetch entries (ordered ascending so the LLM reads the thread
  //       chronologically). Cursor-aware predicate when applicable.
  const entryPredicate = cursorCreatedAt
    ? and(
        eq(discussionEntries.discussionId, params.threadId),
        gt(discussionEntries.createdAt, cursorCreatedAt),
      )
    : eq(discussionEntries.discussionId, params.threadId);

  const entries = await db
    .select({ id: discussionEntries.id, rawContent: discussionEntries.rawContent, createdAt: discussionEntries.createdAt })
    .from(discussionEntries)
    .where(entryPredicate)
    .orderBy(discussionEntries.createdAt);

  if (entries.length === 0) {
    log.info("no entries to extract from — returning empty candidate set");
    return { candidates: [] };
  }

  // Concatenate entry content using the same `---` separator the legacy
  // discussion-entry path uses for thread context. Skip empty entries
  // (defensive; should not happen in practice).
  const userContent = entries
    .map((e) => (e.rawContent ?? "").trim())
    .filter((s) => s.length > 0)
    .join("\n---\n");

  if (userContent.length < 10) {
    log.info({ length: userContent.length }, "thread content too short — returning empty candidate set");
    return { candidates: [] };
  }

  // ── 3. Build the same prompt the autonomous path uses.
  const { text: deptList } = await buildDepartmentsList(db, params.companyId);
  const systemPrompt = EXTRACTION_PROMPT_TEMPLATE.replace(
    "{{DEPARTMENTS_AND_PROJECTS_LIST}}",
    deptList,
  );

  // ── 4. Run extraction. A caller-supplied `llm` (tests/evals only) takes
  //       precedence; otherwise extraction runs through the keyless CLI.
  //       extractViaCli already returns parsed ExtractedItem[], so there is
  //       no parseExtractedItems step on the CLI branch.
  let items: ExtractedItem[];
  if (llm) {
    const raw = await llm.generate(systemPrompt, userContent);
    items = parseExtractedItems(raw);
  } else {
    const { cliTool, codexModel } = await resolveCliExtractionContext(
      db,
      params.companyId,
    );
    items = await extractViaCli(cliTool, systemPrompt, userContent, { codexModel });
  }

  log.info({ candidateCount: items.length, entries: entries.length }, "extraction complete");
  return { candidates: items.map(toMemoryCandidate) };
}

/**
 * Extract candidates and filter to type='decision'. Thin convenience wrapper
 * around `extractMemoryCandidates` — same arguments minus `companyId`, which
 * the tool wrapper resolves from the thread.
 *
 * NOTE: these three filtered helpers (`extractDecisions`, `extractInsights`,
 * `extractReferences`) require the `companyId` to resolve via the thread.
 * The tool wrapper layer that calls these always has the thread in hand and
 * can look it up; for unit tests, callers pass it via the `companyId`
 * parameter on the underlying `extractMemoryCandidates` call.
 */
export async function extractDecisions(
  db: Db,
  llm: ExtractionLlm | null,
  params: { companyId: string; threadId: string; sinceEntryId?: string },
): Promise<MemoryCandidate[]> {
  const { candidates } = await extractMemoryCandidates(db, llm, params);
  return candidates.filter((c) => c.type === "decision");
}

/**
 * Extract candidates and filter to type='insight'. See `extractDecisions`.
 */
export async function extractInsights(
  db: Db,
  llm: ExtractionLlm | null,
  params: { companyId: string; threadId: string; sinceEntryId?: string },
): Promise<MemoryCandidate[]> {
  const { candidates } = await extractMemoryCandidates(db, llm, params);
  return candidates.filter((c) => c.type === "insight");
}

/**
 * Extract candidates and filter to type='reference'. See `extractDecisions`.
 */
export async function extractReferences(
  db: Db,
  llm: ExtractionLlm | null,
  params: { companyId: string; threadId: string; sinceEntryId?: string },
): Promise<MemoryCandidate[]> {
  const { candidates } = await extractMemoryCandidates(db, llm, params);
  return candidates.filter((c) => c.type === "reference");
}
