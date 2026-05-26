import { describe, expect, it, vi } from "vitest";
import { isCodexUnknownSessionError, parseCodexJsonl } from "@armyofagents/adapter-codex-local/server";
import { parseCodexStdoutLine } from "@armyofagents/adapter-codex-local/ui";
import { printCodexStreamEvent } from "@armyofagents/adapter-codex-local/cli";

describe("codex_local parser", () => {
  it("extracts session, summary, usage, and terminal error message", () => {
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "thread-123" }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hello" } }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 4 } }),
      JSON.stringify({ type: "turn.failed", error: { message: "model access denied" } }),
    ].join("\n");

    const parsed = parseCodexJsonl(stdout);
    expect(parsed.sessionId).toBe("thread-123");
    expect(parsed.summary).toBe("hello");
    expect(parsed.usage).toEqual({
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 4,
    });
    expect(parsed.errorMessage).toBe("model access denied");
  });

  it("extracts action confirmation chunks from Codex tool_result items", () => {
    const payload = {
      toolName: "create_task",
      params: { title: "Codex approval parser UAT", priority: "low" },
      confirmId: "confirm-codex-1",
    };
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "thread-123" }),
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_tool_result_1",
          type: "tool_result",
          tool_use_id: "tool_call_1",
          content: `⚡CONFIRM:${JSON.stringify(payload)}⚡ This action requires approval.`,
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "Awaiting your approval on the `create_task` action." },
      }),
    ].join("\n");

    const parsed = parseCodexJsonl(stdout);

    expect(parsed.sessionId).toBe("thread-123");
    expect(parsed.summary).toBe("Awaiting your approval on the `create_task` action.");
    expect(parsed.chunks).toContainEqual({
      type: "action_confirmation",
      toolName: "create_task",
      params: { title: "Codex approval parser UAT", priority: "low" },
      runId: "confirm-codex-1",
    });
  });

  it("extracts action confirmation chunks from Codex mcp_tool_call result content", () => {
    const payload = {
      toolName: "create_task",
      params: { title: "UAT Raw Codex JSONL approval shape", priority: "low" },
      confirmId: "464e78bb-667f-4654-9ba9-3c4e7274667b",
      action: "runtime_tool_approval",
      description: "Create a new task with title, optional description, priority, department, goal, and assignee.",
    };
    const stdout = JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_1",
        type: "mcp_tool_call",
        server: "aoa",
        tool: "create_task",
        arguments: { title: "UAT Raw Codex JSONL approval shape", priority: "low" },
        result: {
          content: [
            {
              type: "text",
              text: `⚡CONFIRM:${JSON.stringify(payload)}⚡ This action requires your approval before I can proceed.`,
            },
          ],
          structured_content: null,
        },
        error: null,
        status: "completed",
      },
    });

    const parsed = parseCodexJsonl(stdout);

    expect(parsed.chunks).toContainEqual({
      type: "action_confirmation",
      toolName: "create_task",
      params: { title: "UAT Raw Codex JSONL approval shape", priority: "low" },
      runId: "464e78bb-667f-4654-9ba9-3c4e7274667b",
    });
  });

  it("extracts action confirmation when Codex tool_result content is an array of text blocks", () => {
    const payload = { toolName: "create_task", params: { title: "Array content" }, confirmId: "confirm-array" };
    const stdout = JSON.stringify({
      type: "item.completed",
      item: {
        type: "tool_result",
        tool_use_id: "tool_call_array",
        content: [{ type: "text", text: `⚡CONFIRM:${JSON.stringify(payload)}⚡` }],
      },
    });

    const parsed = parseCodexJsonl(stdout);
    expect(parsed.chunks).toContainEqual({
      type: "action_confirmation",
      toolName: "create_task",
      params: { title: "Array content" },
      runId: "confirm-array",
    });
  });

  it("does not expose malformed confirmation marker text as a user-visible assistant summary", () => {
    const stdout = JSON.stringify({
      type: "item.completed",
      item: {
        type: "tool_result",
        tool_use_id: "tool_call_bad",
        content: "⚡CONFIRM:{not-json}⚡",
        is_error: true,
      },
    });

    const parsed = parseCodexJsonl(stdout);
    expect(parsed.chunks.some((chunk: any) => chunk.type === "action_confirmation")).toBe(false);
    expect(parsed.summary).toBe("");
  });

  it("extracts multiple Codex confirmation markers in stream order", () => {
    const first = { toolName: "create_task", params: { title: "First" }, confirmId: "confirm-first" };
    const second = { toolName: "create_task", params: { title: "Second" }, confirmId: "confirm-second" };
    const stdout = [
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "tool_result",
          tool_use_id: "tool_call_first",
          content: `⚡CONFIRM:${JSON.stringify(first)}⚡`,
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "tool_result",
          tool_use_id: "tool_call_second",
          content: `⚡CONFIRM:${JSON.stringify(second)}⚡`,
        },
      }),
    ].join("\n");

    const parsed = parseCodexJsonl(stdout);
    expect(parsed.chunks.filter((chunk: any) => chunk.type === "action_confirmation")).toEqual([
      {
        type: "action_confirmation",
        toolName: "create_task",
        params: { title: "First" },
        runId: "confirm-first",
      },
      {
        type: "action_confirmation",
        toolName: "create_task",
        params: { title: "Second" },
        runId: "confirm-second",
      },
    ]);
  });
});

describe("codex_local stale session detection", () => {
  it("treats missing rollout path as an unknown session error", () => {
    const stderr =
      "2026-02-19T19:58:53.281939Z ERROR codex_core::rollout::list: state db missing rollout path for thread 019c775d-967c-7ef1-acc7-e396dc2c87cc";

    expect(isCodexUnknownSessionError("", stderr)).toBe(true);
  });
});

describe("codex_local ui stdout parser", () => {
  it("parses turn and reasoning lifecycle events", () => {
    const ts = "2026-02-20T00:00:00.000Z";

    expect(parseCodexStdoutLine(JSON.stringify({ type: "turn.started" }), ts)).toEqual([
      { kind: "system", ts, text: "turn started" },
    ]);

    expect(
      parseCodexStdoutLine(
        JSON.stringify({
          type: "item.completed",
          item: { id: "item_1", type: "reasoning", text: "**Preparing to use paperclip skill**" },
        }),
        ts,
      ),
    ).toEqual([
      { kind: "thinking", ts, text: "**Preparing to use paperclip skill**" },
    ]);
  });

  it("parses command execution and file changes", () => {
    const ts = "2026-02-20T00:00:00.000Z";

    expect(
      parseCodexStdoutLine(
        JSON.stringify({
          type: "item.started",
          item: { id: "item_2", type: "command_execution", command: "/bin/zsh -lc ls", status: "in_progress" },
        }),
        ts,
      ),
    ).toEqual([
      {
        kind: "tool_call",
        ts,
        name: "command_execution",
        input: { id: "item_2", command: "/bin/zsh -lc ls" },
      },
    ]);

    expect(
      parseCodexStdoutLine(
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_2",
            type: "command_execution",
            command: "/bin/zsh -lc ls",
            aggregated_output: "agents\n",
            exit_code: 0,
            status: "completed",
          },
        }),
        ts,
      ),
    ).toEqual([
      {
        kind: "tool_result",
        ts,
        toolUseId: "item_2",
        content: "command: /bin/zsh -lc ls\nstatus: completed\nexit_code: 0\n\nagents",
        isError: false,
      },
    ]);

    expect(
      parseCodexStdoutLine(
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_52",
            type: "file_change",
            changes: [{ path: "/home/user/project/ui/src/pages/AgentDetail.tsx", kind: "update" }],
            status: "completed",
          },
        }),
        ts,
      ),
    ).toEqual([
      {
        kind: "system",
        ts,
        text: "file changes: update /home/user/project/ui/src/pages/AgentDetail.tsx",
      },
    ]);
  });

  it("parses error items and failed turns", () => {
    const ts = "2026-02-20T00:00:00.000Z";

    expect(
      parseCodexStdoutLine(
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_0",
            type: "error",
            message: "This session was recorded with model `gpt-5.2-pro` but is resuming with `gpt-5.2-codex`.",
          },
        }),
        ts,
      ),
    ).toEqual([
      {
        kind: "stderr",
        ts,
        text: "This session was recorded with model `gpt-5.2-pro` but is resuming with `gpt-5.2-codex`.",
      },
    ]);

    expect(
      parseCodexStdoutLine(
        JSON.stringify({
          type: "turn.failed",
          error: { message: "model access denied" },
          usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 4 },
        }),
        ts,
      ),
    ).toEqual([
      {
        kind: "result",
        ts,
        text: "",
        inputTokens: 10,
        outputTokens: 4,
        cachedTokens: 2,
        costUsd: 0,
        subtype: "turn.failed",
        isError: true,
        errors: ["model access denied"],
      },
    ]);
  });
});

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("codex_local cli formatter", () => {
  it("prints lifecycle, command execution, file change, and error events", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      printCodexStreamEvent(JSON.stringify({ type: "turn.started" }), false);
      printCodexStreamEvent(
        JSON.stringify({
          type: "item.started",
          item: { id: "item_2", type: "command_execution", command: "/bin/zsh -lc ls", status: "in_progress" },
        }),
        false,
      );
      printCodexStreamEvent(
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_2",
            type: "command_execution",
            command: "/bin/zsh -lc ls",
            aggregated_output: "agents\n",
            exit_code: 0,
            status: "completed",
          },
        }),
        false,
      );
      printCodexStreamEvent(
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_52",
            type: "file_change",
            changes: [{ path: "/home/user/project/ui/src/pages/AgentDetail.tsx", kind: "update" }],
            status: "completed",
          },
        }),
        false,
      );
      printCodexStreamEvent(
        JSON.stringify({
          type: "turn.failed",
          error: { message: "model access denied" },
          usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 4 },
        }),
        false,
      );
      printCodexStreamEvent(
        JSON.stringify({
          type: "item.completed",
          item: { type: "error", message: "resume model mismatch" },
        }),
        false,
      );

      const lines = spy.mock.calls
        .map((call) => call.map((v) => String(v)).join(" "))
        .map(stripAnsi);

      expect(lines).toEqual(expect.arrayContaining([
        "turn started",
        "tool_call: command_execution",
        "/bin/zsh -lc ls",
        "tool_result: command_execution command=\"/bin/zsh -lc ls\" status=completed exit_code=0",
        "agents",
        "file_change: update /home/user/project/ui/src/pages/AgentDetail.tsx",
        "turn failed: model access denied",
        "tokens: in=10 out=4 cached=2",
        "error: resume model mismatch",
      ]));
    } finally {
      spy.mockRestore();
    }
  });
});
