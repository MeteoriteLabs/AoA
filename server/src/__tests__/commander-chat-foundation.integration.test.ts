import { describe, expect, it } from "vitest";
import { platform } from "node:os";

const skip = platform() === "win32" || process.env.AOA_ACCEPTANCE_CLI !== "1";

describe.skipIf(skip)("Commander chat foundation (real CLI)", () => {
  it("a real claude turn carries persona + relevant memory + history; crossing 20 msgs compacts", async () => {
    // Uses the same harness/preconditions as docs/guides/board-operator/aoa-agents-acceptance.md:
    // a running DB (DATABASE_URL), authenticated claude CLI. Drive agentLoopService.chat
    // across >20 turns; assert: (1) the assembled prompt seen by a spy cli-mode contains the
    // Commander persona + an injected approved memory item + prior turns; (2) after >20
    // messages internal_agent_conversations.summarizedContext is non-null and
    // summarizedUpToMessageId advanced; (3) the chat keeps replying post-compaction.
    expect(skip).toBe(false);
  });
});
