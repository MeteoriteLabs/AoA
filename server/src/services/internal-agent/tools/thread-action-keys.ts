import { createHash } from "node:crypto";

/** Run-independent content hash for idempotency-key derivation. */
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Run-INDEPENDENT, turn-anchored idempotency key for a `post_reply` thread action.
 *
 * - NOT keyed on runId → a re-run re-proposes the SAME key and dedups against the
 *   `(companyId, idempotencyKey)` unique index (closes the cross-run duplicate).
 * - `turnAnchor` (the latest human entry id at run start) keeps two genuine turns
 *   distinct even with identical content, while a same-turn retry stays identical.
 *   A null anchor (agent-only thread with no human entry) falls back to content-only
 *   dedup — a narrow residual fenced to #198.
 */
export function buildPostReplyIdempotencyKey(input: {
  threadId: string;
  agentId?: string | null;
  parentEntryId?: string | null;
  content: string;
  turnAnchor?: string | null;
}): string {
  return [
    input.threadId,
    "post_reply",
    input.agentId ?? "agent",
    input.parentEntryId ?? "root",
    input.turnAnchor ?? "noanchor",
    sha256(input.content),
  ].join(":");
}

/**
 * Run-INDEPENDENT, turn-anchored idempotency key for a `create_artifact_candidate`
 * thread action. Same construction discipline as the post_reply key above.
 */
export function buildArtifactCandidateIdempotencyKey(input: {
  threadId: string;
  agentId?: string | null;
  title: string;
  content?: string | null;
  fileRef?: string | null;
  turnAnchor?: string | null;
}): string {
  return [
    input.threadId,
    "create_artifact_candidate",
    input.agentId ?? "agent",
    input.turnAnchor ?? "noanchor",
    // Delimited tuple (not space-join) so title/content boundaries are unambiguous,
    // and fileRef is always included even when content is present.
    sha256(JSON.stringify([input.title, input.content ?? null, input.fileRef ?? null])),
  ].join(":");
}

/**
 * Run-INDEPENDENT, turn-anchored idempotency key for a `convene_agent` thread
 * action. Same construction discipline as the keys above. Keyed on the target
 * agent + reason so distinct dispatches stay distinct.
 */
export function buildConveneAgentIdempotencyKey(input: {
  threadId: string;
  agentId?: string | null;
  targetAgentId: string;
  reason?: string | null;
  turnAnchor?: string | null;
}): string {
  return [
    input.threadId,
    "convene_agent",
    input.agentId ?? "agent",
    input.turnAnchor ?? "noanchor",
    sha256(JSON.stringify([input.targetAgentId, input.reason ?? "agent_dispatch"])),
  ].join(":");
}

/**
 * Run-INDEPENDENT, turn-anchored idempotency key for a `create_scope_draft`
 * thread action. Summary + proposed tasks are hashed (not raw-interpolated) so
 * boundaries are unambiguous and distinct drafts stay distinct.
 */
export function buildScopeDraftIdempotencyKey(input: {
  threadId: string;
  agentId?: string | null;
  summary?: string | null;
  proposedTasks?: Array<{ title?: string; assigneeRole?: string | null }>;
  turnAnchor?: string | null;
}): string {
  const tasks = (input.proposedTasks ?? []).map((t) => [t.title ?? "", t.assigneeRole ?? null]);
  return [
    input.threadId,
    "create_scope_draft",
    input.agentId ?? "agent",
    input.turnAnchor ?? "noanchor",
    sha256(JSON.stringify([input.summary ?? "", tasks])),
  ].join(":");
}

/**
 * Run-INDEPENDENT, turn-anchored idempotency key for an `add_scope_item` (memory
 * proposal) thread action. Title/content/layer/category are hashed together.
 */
export function buildAddScopeItemIdempotencyKey(input: {
  threadId: string;
  agentId?: string | null;
  title: string;
  content?: string | null;
  layer?: string | null;
  category?: string | null;
  turnAnchor?: string | null;
}): string {
  return [
    input.threadId,
    "add_scope_item",
    "memory",
    input.agentId ?? "agent",
    input.turnAnchor ?? "noanchor",
    sha256(JSON.stringify([input.title, input.content ?? null, input.layer ?? null, input.category ?? null])),
  ].join(":");
}

/**
 * Run-INDEPENDENT, turn-anchored idempotency key for an `advance_phase` thread
 * action. Keyed on the target phase so distinct transitions stay distinct.
 */
export function buildAdvancePhaseIdempotencyKey(input: {
  threadId: string;
  agentId?: string | null;
  toPhase: string;
  turnAnchor?: string | null;
}): string {
  return [
    input.threadId,
    "advance_phase",
    input.agentId ?? "agent",
    input.turnAnchor ?? "noanchor",
    input.toPhase,
  ].join(":");
}
