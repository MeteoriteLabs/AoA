import { randomUUID } from "node:crypto";
import { asString, asNumber, parseObject, parseJson } from "@armyofagents/adapter-utils/server-utils";

const CONFIRM_RE = /⚡CONFIRM:(.*?)⚡/s;

type CodexParsedChunk = {
  type: "action_confirmation";
  toolName: string;
  params: unknown;
  runId: string;
};

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
      } else if (asString(item.type, "") === "tool_result" || asString(item.type, "") === "mcp_tool_call") {
        const chunk = parseActionConfirmation(item);
        if (chunk) chunks.push(chunk);
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
