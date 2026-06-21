import { randomUUID } from "node:crypto";
import { asString, asNumber, parseObject, parseJson } from "@armyofagents/adapter-utils/server-utils";

const CONFIRM_RE = /⚡CONFIRM:(.*?)⚡/s;

/**
 * Structural mirror of @armyofagents/shared CommanderOutputRef (P1: artifact kind).
 * This package deliberately has no dependency on shared; the screen below
 * enforces the shape and the server zod-validates again at persist time.
 */
type LiftedOutputRef = {
  v: 1;
  kind: "artifact";
  id: string;
  versionId?: string | null;
  versionNumber?: number | null;
  title?: string | null;
  action: "created" | "referenced";
  toolCallId?: string | null;
  mimeType?: string | null;
};

type CodexParsedChunk =
  | {
      type: "action_confirmation";
      toolName: string;
      params: unknown;
      runId: string;
    }
  | {
      type: "tool_result";
      name: string;
      result: { success: boolean; data: unknown; summary: string };
      refs: LiftedOutputRef[];
    }
  | { type: "reasoning"; delta: string };

function extractConfirmPayload(text: string): string | null {
  const exactMatch = CONFIRM_RE.exec(text);
  if (exactMatch) return exactMatch[1];

  const markerIndex = text.indexOf("CONFIRM:");
  if (markerIndex < 0) return null;

  const firstBrace = text.indexOf("{", markerIndex + "CONFIRM:".length);
  if (firstBrace < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = firstBrace; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(firstBrace, i + 1);
    }
  }

  return null;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function readToolResultContentCandidate(item: Record<string, unknown>): unknown {
  const direct = item.content ?? item.output;
  if (direct !== undefined) return direct;

  const result = parseObject(item.result);
  return result.content ?? result.output ?? result.result ?? item.result;
}

function normalizeToolResultText(item: Record<string, unknown>): string {
  const value = readToolResultContentCandidate(item);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        const record = parseObject(entry);
        if (asString(record.type, "") === "text") {
          return asString(record.text, "");
        }
        return typeof entry === "string" ? entry : "";
      })
      .join("");
  }
  return stringifyUnknown(value);
}

/** Minimal structural screen — authoritative validation happens server-side. */
function liftOutputRefs(text: string): LiftedOutputRef[] | null {
  try {
    const parsed = JSON.parse(text) as { outputRefs?: unknown };
    if (!Array.isArray(parsed?.outputRefs) || parsed.outputRefs.length === 0) return null;
    const screened: LiftedOutputRef[] = [];
    for (const r of parsed.outputRefs) {
      const rec = parseObject(r);
      if (
        rec.v === 1 &&
        rec.kind === "artifact" &&
        typeof rec.id === "string" &&
        rec.id.length > 0 &&
        rec.id.length <= 256 &&
        (rec.action === "created" || rec.action === "referenced")
      ) {
        screened.push({
          v: 1,
          kind: "artifact",
          id: rec.id,
          versionId: typeof rec.versionId === "string" ? rec.versionId : null,
          versionNumber:
            typeof rec.versionNumber === "number" && Number.isInteger(rec.versionNumber) && rec.versionNumber > 0
              ? rec.versionNumber
              : null,
          title: typeof rec.title === "string" ? rec.title : null,
          action: rec.action,
          toolCallId: typeof rec.toolCallId === "string" ? rec.toolCallId : null,
          mimeType: typeof rec.mimeType === "string" ? rec.mimeType : null,
        });
      }
    }
    return screened.length > 0 ? screened.slice(0, 20) : null;
  } catch {
    return null;
  }
}

function parseActionConfirmation(item: Record<string, unknown>): CodexParsedChunk | null {
  const text = normalizeToolResultText(item);
  const confirmPayload = extractConfirmPayload(text);
  if (!confirmPayload) return null;

  try {
    const payload = parseObject(JSON.parse(confirmPayload));
    const toolName = asString(payload.toolName, "");
    if (!toolName) return null;
    return {
      type: "action_confirmation",
      toolName,
      params: payload.params,
      runId: asString(payload.confirmId, "") || randomUUID(),
    };
  } catch {
    return null;
  }
}

/**
 * Out-of-band session-id capture for the stdout chunk stream.
 *
 * `parseCodexJsonl` runs on the 4MB-capped stdout buffer, whose cap keeps the
 * TAIL — so for a run whose stdout exceeds the cap the head `thread.started`
 * line is dropped and the parsed sessionId is null (A-M17). Callers scan each
 * raw stdout chunk through this helper BEFORE capping to capture the session id
 * once, the first time it appears. Cheap: returns on the first matching line.
 */
export function extractCodexSessionId(chunk: string): string | null {
  for (const rawLine of chunk.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // Cheap pre-filter so we only JSON.parse lines that could be the head event.
    if (!line.includes("thread.started")) continue;
    const event = parseJson(line);
    if (!event) continue;
    if (asString(event.type, "") !== "thread.started") continue;
    const threadId = asString(event.thread_id, "");
    if (threadId) return threadId;
  }
  return null;
}

/**
 * Stateful carry-buffer wrapper around `extractCodexSessionId` for the live
 * stdout chunk stream (Codex P2).
 *
 * `extractCodexSessionId` only sees COMPLETE lines within the chunk it is
 * handed. The stdout pipe can split the head `thread.started` JSONL line across
 * two `onLog` chunks (the first ends mid-line, the second completes it), and
 * each half on its own is unparseable JSON — so the per-chunk extractor would
 * lose the session id. This capture accumulates a carry buffer, scans only the
 * complete lines (everything before the last newline) and retains the trailing
 * partial line for the next chunk. Once captured it stops buffering and
 * scanning entirely (the first session id wins; later thread.started events are
 * ignored).
 */
export function createCodexSessionIdCapture() {
  let carry = "";
  let sessionId: string | null = null;

  return {
    /**
     * Feed the next raw stdout chunk. Returns the captured session id once it
     * has been seen (and on every subsequent call), or null until then.
     */
    feed(chunk: string): string | null {
      if (sessionId) return sessionId;
      carry += chunk;
      const lines = carry.split("\n");
      // The final element is the (possibly empty) partial line after the last
      // newline — keep it as carry for the next chunk; scan the rest.
      carry = lines.pop() ?? "";
      for (const line of lines) {
        const found = extractCodexSessionId(line);
        if (found) {
          sessionId = found;
          carry = ""; // captured — stop buffering
          return sessionId;
        }
      }
      return null;
    },
    get sessionId(): string | null {
      return sessionId;
    },
  };
}

export function parseCodexJsonl(stdout: string) {
  let sessionId: string | null = null;
  const messages: string[] = [];
  const chunks: CodexParsedChunk[] = [];
  let errorMessage: string | null = null;
  const usage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  };

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const event = parseJson(line);
    if (!event) continue;

    const type = asString(event.type, "");
    if (type === "thread.started") {
      sessionId = asString(event.thread_id, sessionId ?? "") || sessionId;
      continue;
    }

    if (type === "error") {
      const msg = asString(event.message, "").trim();
      if (msg) errorMessage = msg;
      continue;
    }

    if (type === "item.completed") {
      const item = parseObject(event.item);
      if (asString(item.type, "") === "agent_message") {
        const text = asString(item.text, "");
        if (text) messages.push(text);
      } else if (asString(item.type, "") === "reasoning") {
        const text = asString(item.text, "");
        if (text) chunks.push({ type: "reasoning", delta: text });
      } else if (asString(item.type, "") === "tool_result" || asString(item.type, "") === "mcp_tool_call") {
        const chunk = parseActionConfirmation(item);
        if (chunk) {
          chunks.push(chunk);
        } else if (asString(item.type, "") === "mcp_tool_call") {
          // Gate: lift outputRefs ONLY from mcp_tool_call items.
          // Plain tool_result items are built-in/shell results and must never
          // produce ref chips — that is the phantom-defense gate (mirrors Task 4's
          // mcp__-prefix gate on the claude parser side).
          const text = normalizeToolResultText(item);
          const refs = liftOutputRefs(text);
          if (refs) {
            const name = asString(item.name, "") || asString(item.tool, "");
            // refs imply success: buildOutputRefs only emits for result.success === true (output-refs.ts).
            chunks.push({
              type: "tool_result",
              name,
              result: { success: true, data: text, summary: text },
              refs,
            });
          }
        }
      }
      continue;
    }

    if (type === "turn.completed") {
      const usageObj = parseObject(event.usage);
      usage.inputTokens = asNumber(usageObj.input_tokens, usage.inputTokens);
      usage.cachedInputTokens = asNumber(usageObj.cached_input_tokens, usage.cachedInputTokens);
      usage.outputTokens = asNumber(usageObj.output_tokens, usage.outputTokens);
      continue;
    }

    if (type === "turn.failed") {
      const err = parseObject(event.error);
      const msg = asString(err.message, "").trim();
      if (msg) errorMessage = msg;
    }
  }

  return {
    sessionId,
    summary: messages.join("\n\n").trim(),
    chunks,
    usage,
    errorMessage,
  };
}

export function isCodexUnknownSessionError(stdout: string, stderr: string): boolean {
  const haystack = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return /unknown (session|thread)|session .* not found|thread .* not found|conversation .* not found|missing rollout path for thread|state db missing rollout path/i.test(
    haystack,
  );
}
