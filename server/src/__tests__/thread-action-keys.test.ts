import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPostReplyIdempotencyKey,
  buildArtifactCandidateIdempotencyKey,
} from "../services/internal-agent/tools/thread-action-keys.js";

describe("thread action idempotency keys", () => {
  it("post_reply key is run-INDEPENDENT (same inputs across runs → same key)", () => {
    const base = { threadId: "t1", agentId: "a1", parentEntryId: "p1", content: "Done.", turnAnchor: "h5" };
    expect(buildPostReplyIdempotencyKey(base)).toBe(buildPostReplyIdempotencyKey(base));
    expect(buildPostReplyIdempotencyKey(base)).not.toMatch(/run/);
  });

  it("post_reply key is content/parent/agent-sensitive (distinct → distinct keys)", () => {
    const base = { threadId: "t1", agentId: "a1", parentEntryId: "p1", content: "Done.", turnAnchor: "h5" };
    expect(buildPostReplyIdempotencyKey(base)).not.toBe(buildPostReplyIdempotencyKey({ ...base, content: "Other." }));
    expect(buildPostReplyIdempotencyKey(base)).not.toBe(buildPostReplyIdempotencyKey({ ...base, parentEntryId: "p2" }));
    expect(buildPostReplyIdempotencyKey(base)).not.toBe(buildPostReplyIdempotencyKey({ ...base, agentId: "a2" }));
  });

  it("post_reply IDENTICAL content in the SAME turn dedups, across DISTINCT turns does NOT (must-fix #4)", () => {
    const turn1 = { threadId: "t1", agentId: "a1", parentEntryId: null, content: "Done.", turnAnchor: "h5" };
    const turn1Retry = { ...turn1 }; // same turn anchor → same key (retry dedups)
    const turn2 = { ...turn1, turnAnchor: "h8" }; // new human entry → new turn → distinct key
    expect(buildPostReplyIdempotencyKey(turn1)).toBe(buildPostReplyIdempotencyKey(turn1Retry));
    expect(buildPostReplyIdempotencyKey(turn1)).not.toBe(buildPostReplyIdempotencyKey(turn2));
  });

  it("post_reply key tolerates null agent/parent/anchor without colliding distinct content", () => {
    const a = buildPostReplyIdempotencyKey({ threadId: "t1", agentId: null, parentEntryId: null, content: "Hi", turnAnchor: null });
    const b = buildPostReplyIdempotencyKey({ threadId: "t1", agentId: null, parentEntryId: null, content: "Bye", turnAnchor: null });
    expect(a).not.toBe(b);
  });

  it("artifact candidate key is run-INDEPENDENT, turn-anchored, content/title-sensitive", () => {
    const base = { threadId: "t1", agentId: "a1", title: "Spec", content: "body", fileRef: null, turnAnchor: "h5" };
    expect(buildArtifactCandidateIdempotencyKey(base)).toBe(buildArtifactCandidateIdempotencyKey(base));
    expect(buildArtifactCandidateIdempotencyKey(base)).not.toBe(buildArtifactCandidateIdempotencyKey({ ...base, content: "x" }));
    expect(buildArtifactCandidateIdempotencyKey(base)).not.toBe(buildArtifactCandidateIdempotencyKey({ ...base, title: "Other" }));
    expect(buildArtifactCandidateIdempotencyKey(base)).not.toBe(buildArtifactCandidateIdempotencyKey({ ...base, turnAnchor: "h8" }));
  });
});

describe("#198 boundary — the four deferred action types still embed runId in their key", () => {
  const TOOLS_DIR = join(__dirname, "../services/internal-agent/tools");
  const DEFERRED: Array<{ file: string; discriminator: string }> = [
    { file: "agent-dispatch.ts", discriminator: "convene_agent" },
    { file: "propose-crew-work.ts", discriminator: "create_scope_draft" },
    { file: "advance-phase-tool.ts", discriminator: "advance_phase" },
    { file: "memory-propose.ts", discriminator: "add_scope_item" },
  ];

  for (const { file, discriminator } of DEFERRED) {
    it(`${file} (${discriminator}) keeps \${ctx.runId} in its idempotencyKey (locks #197/#198 boundary)`, () => {
      const src = readFileSync(join(TOOLS_DIR, file), "utf8");
      // The stable-key change is scoped to post_reply + create_artifact_candidate ONLY.
      // If a future edit makes one of these run-independent, it must be a deliberate
      // #198 change — this guard makes that visible instead of silent.
      expect(src).toMatch(/\$\{ctx\.runId\}/);
    });
  }
});
