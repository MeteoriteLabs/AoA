/**
 * crew-context-bundle.ts — Phase 4 (Tasks 4.1 + 4.2).
 *
 * Assembles the dynamic context a crew agent arrives with so it NEVER "starts
 * blind". Before this, the trigger prompt's dynamic block was IDs only
 * (`Thread: <id>`, `Inviting entry: <id>`, `Mention: @Scout`), forcing an
 * @mentioned agent to fetch everything via tools — and it often answered
 * "no precedent found". This module fetches the conversation + the thread
 * summary + relevant memory (and, for tasks, the task body + the upstream
 * artifact) and renders them into one markdown string that the runner injects
 * as a `## Context` section in the trigger prompt.
 *
 * Single responsibility: "what should this agent know going in." DB in,
 * string out. It is BEST-EFFORT by contract — the runner wraps the call in
 * try/catch, and the memory pathway here degrades to nothing (never throws)
 * when embeddings/pgvector are absent (this instance has no `embedding`
 * column). See `memoryService(db).searchMultiPath` (memory.ts:378): its
 * semantic path is guarded behind `getDbCapabilities().hasVectorSupport` and
 * its keyword/temporal paths never touch the absent column → graceful degrade.
 *
 * Token budget mirrors `context-assembly.ts`: estimate = ceil(len / 4). When
 * over budget we drop the OLDEST thread entries first (recency is the most
 * useful signal for "what is being discussed right now"), then trim memory.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import {
  discussionEntries,
  discussions,
  agents,
  issues,
  artifacts,
  artifactVersions,
} from "@armyofagents/db";
import { memoryService } from "../../memory.js";
import { logger } from "../../../middleware/logger.js";

const log = logger.child({ svc: "crew-context-bundle" });

/** Default number of most-recent thread entries to include. */
const DEFAULT_ENTRY_LIMIT = 20;
/** Default token budget for the whole bundle (~2500 tokens ≈ 10k chars). */
const DEFAULT_TOKEN_BUDGET = 2500;
/** Memory items pulled per run. */
const MEMORY_LIMIT = 5;
/** Upstream artifact body cap (chars). */
const ARTIFACT_BODY_CAP = 2000;
/** Cap a single entry's rendered text so one huge paste can't eat the budget. */
const ENTRY_TEXT_CAP = 1200;
/** Cap the query text handed to memory search. */
const QUERY_TEXT_CAP = 600;

export interface BuildCrewContextBundleArgs {
  companyId: string;
  /** Thread (discussion) id — drives the THREAD branch. */
  threadId?: string;
  /** Issue id — drives the TASK branch. */
  issueId?: string;
  /** The agent receiving the context (reserved for future per-agent scoping). */
  agentId: string;
  /** Token budget (ceil(len/4)). Default ~2500. */
  tokenBudget?: number;
}

/** ceil(len / 4) — same estimate as context-assembly.ts. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 1)) + "…";
}

interface ThreadContext {
  /** Chronological "<author>: <text>" lines, OLDEST first. */
  entryLines: string[];
  /** "Thread summary:" line(s) — summary text + routing terms. */
  summaryLines: string[];
  /** Best query text for memory search (latest entry text or the summary). */
  queryText: string;
}

/**
 * THREAD branch — fetch the last N entries (chronological) + the Chronicler
 * summary. Author label: the agent's display name when authored by an agent,
 * else "founder".
 */
async function loadThreadContext(
  db: Db,
  threadId: string,
  entryLimit: number,
): Promise<ThreadContext> {
  // Newest first + LIMIT keeps the index scan on (discussion_id, created_at)
  // efficient; reverse to chronological for rendering (mirrors thread-list-entries.ts).
  const rowsDesc = (await db
    .select({
      id: discussionEntries.id,
      rawContent: discussionEntries.rawContent,
      authorAgentId: discussionEntries.authorAgentId,
      createdBy: discussionEntries.createdBy,
      createdAt: discussionEntries.createdAt,
    })
    .from(discussionEntries)
    .where(eq(discussionEntries.discussionId, threadId))
    .orderBy(desc(discussionEntries.createdAt))
    .limit(entryLimit)) as Array<{
    id: string;
    rawContent: string | null;
    authorAgentId: string | null;
    createdBy: string | null;
    createdAt: Date | null;
  }>;

  const chronological = Array.isArray(rowsDesc) ? [...rowsDesc].reverse() : [];

  // Chronicler summary + routing terms.
  const summaryRows = (await db
    .select({
      summaryText: discussions.summaryText,
      routingTerms: discussions.routingTerms,
    })
    .from(discussions)
    .where(eq(discussions.id, threadId))
    .limit(1)) as Array<{ summaryText: string | null; routingTerms: unknown }>;
  const summaryRow = Array.isArray(summaryRows) ? summaryRows[0] : null;

  const summaryLines: string[] = [];
  if (summaryRow?.summaryText && summaryRow.summaryText.trim().length > 0) {
    summaryLines.push(`Thread summary: ${summaryRow.summaryText.trim()}`);
  }
  const routingTerms = Array.isArray(summaryRow?.routingTerms)
    ? (summaryRow!.routingTerms as unknown[]).filter(
        (t): t is string => typeof t === "string" && t.length > 0,
      )
    : [];
  if (routingTerms.length > 0) {
    summaryLines.push(`Key terms: ${routingTerms.join(", ")}`);
  }

  // Resolve agent display names in ONE query (no N+1) when any entry is
  // agent-authored.
  const agentIds = Array.from(
    new Set(
      chronological
        .map((e) => e.authorAgentId)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  );
  const nameById = new Map<string, string>();
  if (agentIds.length > 0) {
    const nameRows = (await db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(inArray(agents.id, agentIds))) as Array<{ id: string; name: string | null }>;
    for (const r of Array.isArray(nameRows) ? nameRows : []) {
      if (r?.id) nameById.set(r.id, r.name ?? "agent");
    }
  }

  const entryLines = chronological.map((e) => {
    const author = e.authorAgentId
      ? nameById.get(e.authorAgentId) ?? "agent"
      : "founder";
    const text = truncate((e.rawContent ?? "").trim(), ENTRY_TEXT_CAP);
    return `${author}: ${text}`;
  });

  // queryText for memory: prefer the latest entry text (what's being discussed
  // right now), fall back to the summary.
  const latest = chronological.length > 0
    ? (chronological[chronological.length - 1].rawContent ?? "").trim()
    : "";
  const queryText = truncate(
    latest || (summaryRow?.summaryText ?? "").trim(),
    QUERY_TEXT_CAP,
  );

  return { entryLines, summaryLines, queryText };
}

interface TaskContext {
  lines: string[];
  queryText: string;
}

/**
 * TASK branch — fetch the issue (title/description/status/priority) and, when
 * it points at an artifact, the artifact's current-version body (truncated).
 */
async function loadTaskContext(db: Db, issueId: string): Promise<TaskContext> {
  const issueRows = (await db
    .select({
      id: issues.id,
      title: issues.title,
      description: issues.description,
      status: issues.status,
      priority: issues.priority,
      artifactId: issues.artifactId,
    })
    .from(issues)
    .where(eq(issues.id, issueId))
    .limit(1)) as Array<{
    id: string;
    title: string | null;
    description: string | null;
    status: string | null;
    priority: string | null;
    artifactId: string | null;
  }>;
  const issue = Array.isArray(issueRows) ? issueRows[0] : null;
  if (!issue) return { lines: [], queryText: "" };

  const lines: string[] = [];
  if (issue.title) lines.push(`Task: ${issue.title}`);
  const meta = [
    issue.status ? `status ${issue.status}` : null,
    issue.priority ? `priority ${issue.priority}` : null,
  ].filter((v): v is string => v !== null);
  if (meta.length > 0) lines.push(`(${meta.join(", ")})`);
  if (issue.description && issue.description.trim().length > 0) {
    lines.push(issue.description.trim());
  }

  // Upstream deliverable — the artifact's current-version body.
  if (issue.artifactId) {
    const versionRows = (await db
      .select({ content: artifactVersions.content })
      .from(artifacts)
      .innerJoin(
        artifactVersions,
        eq(artifacts.currentVersionId, artifactVersions.id),
      )
      .where(eq(artifacts.id, issue.artifactId))
      .limit(1)) as Array<{ content: string | null }>;
    const body = Array.isArray(versionRows) ? versionRows[0]?.content : null;
    if (body && body.trim().length > 0) {
      lines.push(`Upstream deliverable:\n${truncate(body.trim(), ARTIFACT_BODY_CAP)}`);
    }
  }

  const queryText = truncate(
    [issue.title ?? "", issue.description ?? ""].join(" ").trim(),
    QUERY_TEXT_CAP,
  );
  return { lines, queryText };
}

/**
 * MEMORY (both branches) — relevant items via multi-path search. BEST-EFFORT:
 * returns [] (never throws) when the search fails (embeddings/pgvector absent)
 * or finds nothing, so the caller simply omits the section.
 */
async function loadMemoryLines(
  db: Db,
  companyId: string,
  queryText: string,
): Promise<string[]> {
  const q = queryText.trim();
  if (q.length === 0) return [];
  try {
    const items = await memoryService(db).searchMultiPath(companyId, q, {
      limit: MEMORY_LIMIT,
    });
    if (!Array.isArray(items) || items.length === 0) return [];
    return items.map((m) => {
      const title = (m as { title?: unknown }).title;
      const content = (m as { content?: unknown }).content;
      const t = typeof title === "string" && title.length > 0 ? title : "Memory";
      const c = typeof content === "string" ? content : "";
      return `- ${t}: ${truncate(c.trim(), 400)}`;
    });
  } catch (err) {
    // Embeddings/pgvector absent (no `embedding` column) or any search failure:
    // degrade to no memory rather than crash the bundle. This is the key
    // robustness point — a crew run must still arrive with thread/task context.
    log.warn(
      { err: err instanceof Error ? err.message : String(err), companyId },
      "crew-context-bundle: memory search failed; omitting memory section (best-effort)",
    );
    return [];
  }
}

/**
 * Build the crew context bundle. Returns a single markdown string (clear
 * sub-headers), or "" when there is genuinely nothing to inject (no thread,
 * no task, no memory).
 *
 * Token budgeting: render thread entries NEWEST-survives-first — when the
 * assembled bundle exceeds `tokenBudget`, the OLDEST entries are dropped
 * first, then the memory section is trimmed.
 */
export async function buildCrewContextBundle(
  db: Db,
  args: BuildCrewContextBundleArgs,
): Promise<string> {
  const budget = typeof args.tokenBudget === "number" && args.tokenBudget > 0
    ? args.tokenBudget
    : DEFAULT_TOKEN_BUDGET;

  let thread: ThreadContext | null = null;
  let task: TaskContext | null = null;

  if (args.threadId) {
    thread = await loadThreadContext(db, args.threadId, DEFAULT_ENTRY_LIMIT);
  }
  if (args.issueId) {
    task = await loadTaskContext(db, args.issueId);
  }

  // Memory query: thread takes precedence (the live conversation), else task.
  const queryText = (thread?.queryText && thread.queryText.length > 0)
    ? thread.queryText
    : (task?.queryText ?? "");
  const memoryLines = await loadMemoryLines(db, args.companyId, queryText);

  // ── Assemble with the token budget ──────────────────────────────────────
  // Build the fixed (non-droppable) sections first: summary + task. Then add
  // thread entries newest-first until the budget is hit, then memory.
  const fixedBlocks: string[] = [];

  if (task && task.lines.length > 0) {
    fixedBlocks.push(task.lines.join("\n"));
  }
  if (thread && thread.summaryLines.length > 0) {
    fixedBlocks.push(thread.summaryLines.join("\n"));
  }

  const sections: string[] = [...fixedBlocks];
  let used = sections.length > 0 ? estimateTokens(sections.join("\n\n")) : 0;

  // Thread entries — add NEWEST first so, on a tight budget, the most recent
  // survive and the oldest are dropped. We collect them, then re-order to
  // chronological for the final render.
  const keptEntries: string[] = [];
  if (thread && thread.entryLines.length > 0) {
    const header = "Recent conversation:";
    const headerTokens = estimateTokens(header) + 1;
    // Walk newest → oldest.
    for (let i = thread.entryLines.length - 1; i >= 0; i--) {
      const line = thread.entryLines[i];
      const lineTokens = estimateTokens(line) + 1;
      const headerCost = keptEntries.length === 0 ? headerTokens : 0;
      if (used + lineTokens + headerCost > budget) break;
      keptEntries.push(line); // newest-first accumulation
      used += lineTokens + headerCost;
    }
    if (keptEntries.length > 0) {
      // Restore chronological order (oldest first) for readability.
      const chrono = [...keptEntries].reverse();
      sections.push(`${header}\n${chrono.join("\n")}`);
    }
  }

  // Memory last (lowest priority; trimmed item-by-item to fit).
  if (memoryLines.length > 0) {
    const header = "Relevant memory:";
    const kept: string[] = [];
    let memUsed = estimateTokens(header) + 1;
    for (const line of memoryLines) {
      const t = estimateTokens(line) + 1;
      if (used + memUsed + t > budget) break;
      kept.push(line);
      memUsed += t;
    }
    if (kept.length > 0) {
      sections.push(`${header}\n${kept.join("\n")}`);
      used += memUsed;
    }
  }

  if (sections.length === 0) return "";
  return sections.join("\n\n");
}
