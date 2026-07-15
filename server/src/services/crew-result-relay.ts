/**
 * P3-T1: Crew result relay.
 *
 * When a crew-thread deliverable task finishes successfully, post a visible
 * `agent` entry to the source thread so the result surfaces in the chat.
 * This is the success counterpart to crew-failure-card.ts (P2-T2), which
 * posts a `system` entry when a run fails.
 *
 * Guards (Codex #18 — relay ONLY for crew-thread tasks):
 *   - issues.originKind !== 'crew_thread' → no-op ({ posted: false })
 *   - issues.sourceDiscussionId is null   → no-op ({ posted: false })
 *
 * The entry:
 *   - inputType: 'agent'           (visible as an agent message in the chat)
 *   - authorAgentId: assigneeAgentId  (the agent that did the work)
 *   - createdBy: assigneeAgentId   (mirrors crew-failure-card sentinel pattern)
 *   - extractionStatus: 'skipped'  (not prose for the LLM extractor)
 *   - rawContent: human-readable completion summary with task title + id link
 *   - seq: bumped from discussions.entrySeq atomically (same as crew-failure-card)
 *
 * Best-effort caller contract: callers should wrap this in try/catch so a
 * posting failure never masks the underlying task completion (mirroring the
 * crew-failure-card design).
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { issues, discussions, discussionEntries } from "@armyofagents/db";
import { publishLiveEvent } from "./live-events.js";
import { logger } from "../middleware/logger.js";

const log = logger.child({ svc: "crew-result-relay" });

export interface RelayCrewResultResult {
  posted: boolean;
}

/**
 * Post the completion entry for a crew-thread deliverable task into its
 * source thread. Returns { posted: true } when an entry was inserted, or
 * { posted: false } for the two no-op guard cases.
 */
export async function relayCrewResult(
  db: Db,
  params: { issueId: string },
): Promise<RelayCrewResultResult> {
  // ── Load the issue (only the fields we need) ──────────────────────────────
  const [issue] = await db
    .select({
      id: issues.id,
      title: issues.title,
      status: issues.status,
      originKind: issues.originKind,
      sourceDiscussionId: issues.sourceDiscussionId,
      assigneeAgentId: issues.assigneeAgentId,
      companyId: issues.companyId,
    })
    .from(issues)
    .where(eq(issues.id, params.issueId));

  if (!issue) {
    log.warn({ issueId: params.issueId }, "crew-result-relay: issue not found");
    return { posted: false };
  }

  // ── Guard 1: only relay crew-thread tasks (Codex #18) ────────────────────
  if (issue.originKind !== "crew_thread") {
    return { posted: false };
  }

  // ── Guard 2: must have a source thread to post into ───────────────────────
  if (!issue.sourceDiscussionId) {
    return { posted: false };
  }

  // A successful adapter process is not the same thing as a completed task.
  // The legacy callers invoke this relay when a run exits successfully, so
  // refuse to publish completion wording unless the task itself is done.
  if (issue.status !== "done") {
    return { posted: false };
  }

  const threadId = issue.sourceDiscussionId;
  // Use the assignee agent id as both author and createdBy (mirrors the
  // crew-failure-card pattern where agentId fills the createdBy sentinel).
  // If for some reason the assignee is null (edge case: re-assigned after
  // completion), fall back to the issue id as a safe non-null sentinel.
  const agentId: string = issue.assigneeAgentId ?? issue.id;

  // ── Guard 3: multi-tenant companyId cross-check (Codex #6) ───────────────
  // Verify the source discussion belongs to the SAME company as the issue.
  // An explicit check here + a constrained UPDATE below ensure a cross-company
  // update cannot happen even if auth somehow passes.
  const [sourceThread] = await db
    .select({ companyId: discussions.companyId })
    .from(discussions)
    .where(eq(discussions.id, threadId));

  if (!sourceThread || sourceThread.companyId !== issue.companyId) {
    log.warn(
      { issueId: params.issueId, issueCompanyId: issue.companyId, threadId, threadCompanyId: sourceThread?.companyId },
      "crew-result-relay: companyId mismatch — refusing to post cross-company entry",
    );
    return { posted: false };
  }

  const rawContent = `Completed: "${issue.title}" (task ${issue.id})`;
  const now = new Date();

  // ── Atomic insert: bump entrySeq + entryCount, assign seq ─────────────────
  const { entry, companyId } = await db.transaction(async (tx) => {
    // Constrained UPDATE: include companyId in WHERE so a cross-company write
    // is impossible even if the explicit check above were somehow bypassed.
    const [{ entrySeq, companyId: cid }] = await tx
      .update(discussions)
      .set({
        entrySeq: sql`${discussions.entrySeq} + 1`,
        entryCount: sql`${discussions.entryCount} + 1`,
        updatedAt: now,
      })
      .where(and(eq(discussions.id, threadId), eq(discussions.companyId, issue.companyId)))
      .returning({ entrySeq: discussions.entrySeq, companyId: discussions.companyId });

    const [inserted] = await tx
      .insert(discussionEntries)
      .values({
        discussionId: threadId,
        inputType: "agent",
        rawContent,
        authorAgentId: issue.assigneeAgentId ?? null,
        createdBy: agentId,
        extractionStatus: "skipped",
        seq: entrySeq,
      })
      .returning();

    return { entry: inserted, companyId: cid };
  });

  // ── Publish live events (same pair as crew-failure-card) ──────────────────
  publishLiveEvent({
    companyId,
    type: "discussion.entry.created",
    payload: { discussionId: threadId, entryId: entry.id, inputType: "agent" },
  });
  publishLiveEvent({
    companyId,
    type: "thread.entry.created",
    payload: { threadId, entryId: entry.id, seq: entry.seq ?? 0 },
  });

  log.debug(
    { threadId, issueId: params.issueId },
    "posted crew-result relay entry",
  );

  return { posted: true };
}
