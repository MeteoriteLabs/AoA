import { describe, expect, it } from "vitest";
import { mergeServerMessagesWithTransientLocal } from "../components/InternalAgentPanel";
import type { AgentMessage } from "../api/internal-agent";

function message(id: string, role: "user" | "assistant", content: string): AgentMessage {
  return {
    id,
    conversationId: "conversation-1",
    role,
    content,
    pageContext: null,
    departmentContext: null,
    metadata: null,
    createdAt: "2026-05-26T00:00:00.000Z",
  };
}

describe("mergeServerMessagesWithTransientLocal", () => {
  it("preserves a local approval card that has no persisted assistant message yet", () => {
    const serverMessages = [message("server-user-1", "user", "Create task")];

    const merged = mergeServerMessagesWithTransientLocal(serverMessages, [
      {
        id: "local-assistant-approval",
        role: "assistant",
        content: "",
        streamingDone: true,
        createdAt: "2026-05-26T00:00:01.000Z",
        actionConfirm: {
          confirmId: "11111111-1111-4111-8111-000000000001",
          action: "create_task",
          description: "Create task",
          status: "pending",
        },
      },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[1].actionConfirm).toMatchObject({
      confirmId: "11111111-1111-4111-8111-000000000001",
      status: "pending",
    });
  });

  it("does not preserve plain local user drafts once server messages arrive", () => {
    const merged = mergeServerMessagesWithTransientLocal(
      [message("server-user-1", "user", "Create task")],
      [
        {
          id: "local-user-1",
          role: "user",
          content: "Create task",
          streamingDone: true,
          createdAt: "2026-05-26T00:00:01.000Z",
        },
      ],
    );

    expect(merged.map((m) => m.id)).toEqual(["server-user-1"]);
  });
});
