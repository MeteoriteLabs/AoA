/**
 * parse-stream-json.ts
 *
 * Stateful JSONL parser for Claude CLI's `--output-format stream-json` output.
 *
 * The parser ingests raw stdout chunks (which may be partial lines) and emits
 * typed AgentStreamChunk values.  It is the keystone of Phase 4's confirmation
 * flow: the ⚡CONFIRM:…⚡ marker is embedded as literal `tool_result.content`
 * (a string) inside `user` events — before the LLM has any chance to
 * paraphrase it — so the regex match is reliable.
 *
 * Usage:
 *   const parser = new StreamJsonParser();
 *   for (const chunk of parser.push(rawText)) { … }
 *   for (const chunk of parser.flush()) { … }  // call on process exit
 */

import type { AgentStreamChunk } from "./agent-loop.js";

// ── Marker regex ───────────────────────────────────────────────────────────────

/** Non-greedy: stops at the FIRST ⚡ after CONFIRM:, handles nested JSON braces. */
const CONFIRM_RE = /⚡CONFIRM:(.*?)⚡/s;

// ── Parser ─────────────────────────────────────────────────────────────────────

export class StreamJsonParser {
  private buffer: string = "";

  /**
   * Push raw bytes / text from the CLI's stdout.
   * Returns an array of zero or more AgentStreamChunk values derived from any
   * complete lines now available in the buffer.
   */
  push(text: string): AgentStreamChunk[] {
    const lines = (this.buffer + text).split("\n");
    // The last element is the (possibly incomplete) trailing fragment.
    this.buffer = lines.pop() ?? "";
    const chunks: AgentStreamChunk[] = [];
    for (const line of lines) {
      for (const chunk of parseLine(line)) {
        chunks.push(chunk);
      }
    }
    return chunks;
  }

  /**
   * Flush any remaining buffered content (call on process exit / stream end).
   * Treats whatever is left in the buffer as a complete line.
   */
  flush(): AgentStreamChunk[] {
    if (this.buffer.length === 0) return [];
    const remaining = this.buffer;
    this.buffer = "";
    return parseLine(remaining);
  }
}

// ── Line-level parser ──────────────────────────────────────────────────────────

function parseLine(line: string): AgentStreamChunk[] {
  const trimmed = line.trim();
  if (trimmed.length === 0) return [];

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Malformed JSON — silently discard, don't throw
    return [];
  }

  switch (event.type) {
    case "stream_event":
      return handleStreamEvent(event);

    case "assistant":
      return handleAssistantEvent(event);

    case "user":
      return handleUserEvent(event);

    case "result":
      return handleResultEvent(event);

    // All of these are informational only — no chunks emitted
    case "system":
    case "rate_limit_event":
      return [];

    default:
      return [];
  }
}

// ── stream_event ───────────────────────────────────────────────────────────────

function handleStreamEvent(event: Record<string, unknown>): AgentStreamChunk[] {
  const inner = event.event as Record<string, unknown> | undefined;
  if (!inner) return [];

  // Only content_block_delta with text_delta carries text we need to surface.
  if (inner.type !== "content_block_delta") return [];

  const delta = inner.delta as Record<string, unknown> | undefined;
  if (!delta || delta.type !== "text_delta") return [];

  const text = delta.text;
  if (typeof text !== "string") return [];

  return [{ type: "text", delta: text }];
}

// ── assistant event ────────────────────────────────────────────────────────────

function handleAssistantEvent(event: Record<string, unknown>): AgentStreamChunk[] {
  const message = event.message as Record<string, unknown> | undefined;
  if (!message) return [];

  const content = message.content;
  if (!Array.isArray(content)) return [];

  const chunks: AgentStreamChunk[] = [];

  for (const block of content as unknown[]) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as Record<string, unknown>;

    if (b.type === "tool_use") {
      // Emit a tool_call chunk using AgentStreamChunk's field names:
      // id (maps from block.id), name, input (maps from block.input)
      const id = typeof b.id === "string" ? b.id : String(b.id ?? "");
      const name = typeof b.name === "string" ? b.name : String(b.name ?? "");
      const input: unknown = b.input ?? {};

      chunks.push({ type: "tool_call", id, name, input });
    }
    // text and thinking blocks: skip — text already streamed via stream_event deltas
  }

  return chunks;
}

// ── user event ─────────────────────────────────────────────────────────────────

function handleUserEvent(event: Record<string, unknown>): AgentStreamChunk[] {
  const message = event.message as Record<string, unknown> | undefined;
  if (!message) return [];

  const content = message.content;
  if (!Array.isArray(content)) return [];

  const chunks: AgentStreamChunk[] = [];

  for (const block of content as unknown[]) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as Record<string, unknown>;

    if (b.type !== "tool_result") continue;

    // Normalise content to a string (primary: string, defensive: array of text blocks)
    const fullText: string =
      typeof b.content === "string"
        ? b.content
        : Array.isArray(b.content)
          ? (b.content as unknown[])
              .map((c) =>
                typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "text"
                  ? String((c as Record<string, unknown>).text ?? "")
                  : "",
              )
              .join("")
          : "";

    // Check for ⚡CONFIRM:…⚡ marker
    const confirmMatch = CONFIRM_RE.exec(fullText);
    if (confirmMatch) {
      try {
        const payload = JSON.parse(confirmMatch[1]) as {
          toolName?: string;
          params?: unknown;
          confirmId?: string;
        };
        if (typeof payload.toolName !== "string" || payload.toolName.length === 0) {
          throw new Error("missing toolName");
        }
        chunks.push({
          type: "action_confirmation",
          toolName: payload.toolName,
          params: payload.params,
          runId: payload.confirmId ?? crypto.randomUUID(),
        });
        continue;
      } catch {
        // Malformed marker JSON — fall through to plain tool_result
      }
    }

    // Plain tool_result: map to AgentStreamChunk's tool_result shape.
    // AgentStreamChunk.tool_result uses { name, result: ToolResult }.
    // We derive:
    //   name   ← block.tool_use_id (the only identifier available; Task 3 can
    //            cross-reference with the tool_call chunk that preceded it)
    //   result ← ToolResult { success, data, summary }
    const toolUseId = typeof b.tool_use_id === "string" ? b.tool_use_id : "";
    const isError = b.is_error === true;
    chunks.push({
      type: "tool_result",
      name: toolUseId,
      result: {
        success: !isError,
        data: fullText,
        summary: fullText,
        ...(isError ? { error: fullText } : {}),
      },
    });
  }

  return chunks;
}

// ── result event ───────────────────────────────────────────────────────────────

function handleResultEvent(event: Record<string, unknown>): AgentStreamChunk[] {
  // Emit a minimal done chunk. AgentStreamChunk.done requires a RunSummary;
  // cost/usage data is available in the event but RunSummary's fields are
  // slightly different (costCents, tokenUsage). Task 3 can extend this if needed.
  return [
    {
      type: "done",
      summary: {
        runId: "",
        toolsCalled: [],
        durationMs:
          typeof event.duration_ms === "number" ? event.duration_ms : 0,
        costCents: 0,
        tokenUsage: { inputTokens: 0, outputTokens: 0 },
      },
    },
  ];
}
