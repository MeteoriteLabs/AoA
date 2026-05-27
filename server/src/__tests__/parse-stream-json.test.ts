/**
 * Tests for parse-stream-json.ts
 *
 * Uses the real fixture captured at:
 *   server/src/__tests__/fixtures/claude-stream-json-tool-call.jsonl
 *
 * All 17+ cases from the Phase 4 Task 2 plan are covered.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StreamJsonParser } from "../services/internal-agent/parse-stream-json.js";
import type { AgentStreamChunk } from "../services/internal-agent/agent-loop.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseAll(lines: string[]): AgentStreamChunk[] {
  const parser = new StreamJsonParser();
  const chunks: AgentStreamChunk[] = [];
  for (const line of lines) {
    chunks.push(...parser.push(line + "\n"));
  }
  chunks.push(...parser.flush());
  return chunks;
}

function parseOnce(line: string): AgentStreamChunk[] {
  return parseAll([line]);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("StreamJsonParser", () => {

  // Test 1: system init events emit no chunks
  it("system init events emit no chunks", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "x",
      cwd: "/tmp",
    });
    expect(parseOnce(line)).toEqual([]);
  });

  // Test 2: other system subtypes emit no chunks
  it("system.hook_started / hook_response / post_turn_summary / status events emit no chunks", () => {
    const cases = [
      { type: "system", subtype: "hook_started" },
      { type: "system", subtype: "hook_response" },
      { type: "system", subtype: "post_turn_summary" },
      { type: "system", subtype: "status" },
    ];
    for (const c of cases) {
      expect(parseOnce(JSON.stringify(c))).toEqual([]);
    }
  });

  // Test 3: rate_limit_event emits no chunks
  it("rate_limit_event emits no chunks", () => {
    const line = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed" },
    });
    expect(parseOnce(line)).toEqual([]);
  });

  // Test 4: text_delta emits one text chunk
  it("text_delta emits one text chunk", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      },
    });
    const chunks = parseOnce(line);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ type: "text", delta: "Hello" });
  });

  // Test 5: multi-delta text streaming emits chunks in order
  it("multi-delta text streaming emits three text chunks in order", () => {
    const deltas = ["Hello", " world", "!"];
    const lines = deltas.map((text) =>
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text },
        },
      }),
    );
    const chunks = parseAll(lines);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ type: "text", delta: "Hello" });
    expect(chunks[1]).toEqual({ type: "text", delta: " world" });
    expect(chunks[2]).toEqual({ type: "text", delta: "!" });
  });

  // Test 6: assistant event with tool_use block emits one tool_call chunk
  it("assistant event with tool_use block emits one tool_call chunk", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_abc123",
            name: "Read",
            input: { file_path: "/tmp/test.txt" },
          },
        ],
      },
    });
    const chunks = parseOnce(line);
    expect(chunks).toHaveLength(1);
    const chunk = chunks[0];
    expect(chunk.type).toBe("tool_call");
    if (chunk.type === "tool_call") {
      expect(chunk.id).toBe("toolu_abc123");
      expect(chunk.name).toBe("Read");
      expect(chunk.input).toEqual({ file_path: "/tmp/test.txt" });
    }
  });

  // Test 7: assistant event with text-only content emits no chunks
  it("assistant event with text-only content emits no chunks (text already streamed via deltas)", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Some response text." }],
      },
    });
    expect(parseOnce(line)).toEqual([]);
  });

  // Test 8: assistant event with thinking block emits no chunks
  it("assistant event with thinking block emits no chunks", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "Let me reason about this...",
            signature: "abc",
          },
        ],
      },
    });
    expect(parseOnce(line)).toEqual([]);
  });

  // Test 9: user event with plain tool_result (no marker) emits tool_result chunk
  it("user event with plain tool_result (no marker) emits tool_result chunk", () => {
    const line = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            content: "file content here",
            is_error: false,
            tool_use_id: "toolu_x",
          },
        ],
      },
    });
    const chunks = parseOnce(line);
    expect(chunks).toHaveLength(1);
    const chunk = chunks[0];
    expect(chunk.type).toBe("tool_result");
    if (chunk.type === "tool_result") {
      expect(chunk.name).toBe("toolu_x");
      expect(chunk.result.success).toBe(true);
      expect(chunk.result.data).toBe("file content here");
    }
  });

  // Test 10: user event with marker in tool_result content emits action_confirmation
  it("user event with marker in tool_result content emits action_confirmation chunk", () => {
    const markerPayload = {
      toolName: "update_company_identity",
      params: { vision: "X" },
      confirmId: "abc-123",
    };
    const content = `⚡CONFIRM:${JSON.stringify(markerPayload)}⚡ Tool needs approval.`;
    const line = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            content,
            is_error: false,
            tool_use_id: "toolu_confirm_1",
          },
        ],
      },
    });
    const chunks = parseOnce(line);
    expect(chunks).toHaveLength(1);
    const chunk = chunks[0];
    expect(chunk.type).toBe("action_confirmation");
    if (chunk.type === "action_confirmation") {
      expect(chunk.toolName).toBe("update_company_identity");
      expect(chunk.params).toEqual({ vision: "X" });
      expect(chunk.runId).toBe("abc-123");
    }
  });

  it("user event with unicode lightning marker emits action_confirmation chunk", () => {
    const markerPayload = {
      toolName: "create_task",
      confirmId: "33333333-3333-4333-8333-333333333333",
    };
    const content = `\u26a1CONFIRM:${JSON.stringify(markerPayload)}\u26a1 Tool needs approval.`;
    const line = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            content: [{ type: "text", text: content }],
            is_error: false,
            tool_use_id: "toolu_confirm_unicode",
          },
        ],
      },
    });

    const chunks = parseOnce(line);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      type: "action_confirmation",
      toolName: "create_task",
      runId: "33333333-3333-4333-8333-333333333333",
    });
  });

  // Test 11: user event with malformed marker JSON falls through to plain tool_result
  it("user event with malformed marker JSON falls through to plain tool_result (no throw)", () => {
    const content = "⚡CONFIRM:{not valid json}⚡";
    const line = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            content,
            is_error: false,
            tool_use_id: "toolu_bad",
          },
        ],
      },
    });
    let chunks: AgentStreamChunk[];
    expect(() => {
      chunks = parseOnce(line);
    }).not.toThrow();
    chunks = parseOnce(line);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("tool_result");
  });

  // Test 12: user event with tool_result.content as array (defensive)
  it("user event with tool_result.content as array still extracts marker from joined text", () => {
    const markerPayload = {
      toolName: "archive_goal",
      params: { goalId: "g-1" },
      confirmId: "def-456",
    };
    const markerText = `⚡CONFIRM:${JSON.stringify(markerPayload)}⚡`;
    const line = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            content: [{ type: "text", text: markerText }],
            is_error: false,
            tool_use_id: "toolu_array",
          },
        ],
      },
    });
    const chunks = parseOnce(line);
    expect(chunks).toHaveLength(1);
    const chunk = chunks[0];
    expect(chunk.type).toBe("action_confirmation");
    if (chunk.type === "action_confirmation") {
      expect(chunk.toolName).toBe("archive_goal");
      expect(chunk.runId).toBe("def-456");
    }
  });

  // Test 13: result.success event emits one done chunk
  it("result.success event emits one done chunk", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      total_cost_usd: 0.01,
      duration_ms: 1234,
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const chunks = parseOnce(line);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("done");
    if (chunks[0].type === "done") {
      expect(chunks[0].summary.durationMs).toBe(1234);
    }
  });

  // Test 14: partial-line buffering
  it("partial-line buffering: split across two pushes parses correctly", () => {
    const fullLine = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "x",
    });
    const half1 = fullLine.slice(0, 20);
    const half2 = fullLine.slice(20) + "\n";

    const parser = new StreamJsonParser();
    const chunks1 = parser.push(half1);
    expect(chunks1).toEqual([]); // incomplete line — no output yet
    const chunks2 = parser.push(half2);
    expect(chunks2).toEqual([]); // system event — no chunks
  });

  // Test 15: non-JSON line does not throw and emits a text chunk (plain-text fallback)
  it("non-JSON line does not throw and emits a text chunk", () => {
    const parser = new StreamJsonParser();
    let chunks: AgentStreamChunk[];
    expect(() => {
      chunks = parser.push("this is not json\n");
    }).not.toThrow();
    chunks = parser.push("this is not json\n");
    expect(chunks).toEqual([{ type: "text", delta: "this is not json\n" }]);
  });

  // Test 16: blank lines emit a text chunk (paragraph break in plain-text fallback)
  it("blank lines emit a text chunk with a newline (paragraph break)", () => {
    const parser = new StreamJsonParser();
    // Three blank lines → three completed lines of "", each → { type: "text", delta: "\n" }
    const chunks = parser.push("\n\n\n");
    expect(chunks).toEqual([
      { type: "text", delta: "\n" },
      { type: "text", delta: "\n" },
      { type: "text", delta: "\n" },
    ]);
    // Nothing buffered after the three newlines
    expect(parser.flush()).toEqual([]);
  });

  // Test 17: real-world fixture parses cleanly
  it("real-world fixture parses and emits at least one tool_call and one tool_result", () => {
    const fixturePath = resolve(
      __dirname,
      "./fixtures/claude-stream-json-tool-call.jsonl",
    );
    const content = readFileSync(fixturePath, "utf8");

    const parser = new StreamJsonParser();
    const chunks: AgentStreamChunk[] = [
      ...parser.push(content),
      ...parser.flush(),
    ];

    const toolCallChunks = chunks.filter((c) => c.type === "tool_call");
    const toolResultChunks = chunks.filter((c) => c.type === "tool_result");
    const doneChunks = chunks.filter((c) => c.type === "done");

    // The fixture contains one Read tool call (toolu_01TbzVFkavX9oo829qMEJnU2)
    expect(toolCallChunks.length).toBeGreaterThanOrEqual(1);
    // The fixture contains one tool_result (file does not exist, is_error: true)
    expect(toolResultChunks.length).toBeGreaterThanOrEqual(1);
    // The fixture ends with a result event
    expect(doneChunks.length).toBeGreaterThanOrEqual(1);

    // The tool_call should be the Read tool
    const readCall = toolCallChunks.find(
      (c) => c.type === "tool_call" && c.name === "Read",
    );
    expect(readCall).toBeDefined();
    if (readCall?.type === "tool_call") {
      expect(readCall.id).toBe("toolu_01TbzVFkavX9oo829qMEJnU2");
    }

    // The tool_result should be an error (file not found)
    const errorResult = toolResultChunks.find(
      (c) => c.type === "tool_result" && c.result.success === false,
    );
    expect(errorResult).toBeDefined();
  });

  // Test 18: signature_delta stream_events are silently skipped
  it("signature_delta and input_json_delta stream_events emit no chunks", () => {
    const sigDelta = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "abc==" },
      },
    });
    const inputDelta = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"fi' },
      },
    });
    expect(parseOnce(sigDelta)).toEqual([]);
    expect(parseOnce(inputDelta)).toEqual([]);
  });

  // Test 19: message_start / message_stop / content_block_start / content_block_stop
  it("message_start, message_stop, content_block_start, content_block_stop emit no chunks", () => {
    const cases = [
      { type: "stream_event", event: { type: "message_start", message: {} } },
      { type: "stream_event", event: { type: "message_stop" } },
      { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: {} } },
      { type: "stream_event", event: { type: "content_block_stop", index: 0 } },
      { type: "stream_event", event: { type: "message_delta", delta: {} } },
    ];
    for (const c of cases) {
      expect(parseOnce(JSON.stringify(c))).toEqual([]);
    }
  });

  // Test 20a: plain-text markdown across multiple lines reconstructs correctly
  it("plain-text markdown pushed in one chunk yields text chunks that reconstruct the markdown", () => {
    const markdown = "# Title\n\nbody paragraph\n";
    const parser = new StreamJsonParser();
    const chunks = parser.push(markdown);
    // split("\n") on "# Title\n\nbody paragraph\n" gives:
    //   ["# Title", "", "body paragraph", ""] — last "" stays buffered
    // so push() emits 3 completed lines:
    expect(chunks).toEqual([
      { type: "text", delta: "# Title\n" },
      { type: "text", delta: "\n" },
      { type: "text", delta: "body paragraph\n" },
    ]);
    // The trailing empty fragment "" has length 0, so flush() returns [] early.
    const flushed = parser.flush();
    expect(flushed).toEqual([]);
    // Reconstruct: joining all push() deltas gives back the original markdown.
    const reconstructed = chunks.map((c) => (c as { delta: string }).delta).join("");
    expect(reconstructed).toBe(markdown);
  });

  // Test 20: tool_result with is_error: true sets success=false and error field
  it("tool_result with is_error: true sets success=false and error field", () => {
    const errorMsg = "File does not exist.";
    const line = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            content: errorMsg,
            is_error: true,
            tool_use_id: "toolu_err",
          },
        ],
      },
    });
    const chunks = parseOnce(line);
    expect(chunks).toHaveLength(1);
    const chunk = chunks[0];
    expect(chunk.type).toBe("tool_result");
    if (chunk.type === "tool_result") {
      expect(chunk.result.success).toBe(false);
      expect(chunk.result.error).toBe(errorMsg);
    }
  });
});
