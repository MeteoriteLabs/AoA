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
    sha256(`${input.title} ${input.content ?? input.fileRef ?? ""}`),
  ].join(":");
}
