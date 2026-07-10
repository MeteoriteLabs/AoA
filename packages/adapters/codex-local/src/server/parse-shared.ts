import { randomUUID } from "node:crypto";
import { asString, parseObject } from "@armyofagents/adapter-utils/server-utils";

/**
 * Shared chunk-derivation helpers for the codex_local parser.
 *
 * Extracted verbatim from `parse.ts` so BOTH the `codex exec` JSONL path
 * (`parseCodexJsonl` in parse.ts) and the `codex app-server` notification path
 * (`parse-events.ts`) derive their `chunks` from ONE copy of the code and cannot
 * drift. This is a pure move+export — the logic is unchanged. See the
 * accumulator parity test (`appserver-parse-events.test.ts`) which feeds the same
 * tool payload through both paths and asserts identical chunks.
 */

const CONFIRM_RE = /⚡CONFIRM:(.*?)⚡/s;

/**
 * Structural mirror of @armyofagents/shared CommanderOutputRef (P1: artifact kind).
 * This package deliberately has no dependency on shared; the screen below
 * enforces the shape and the server zod-validates again at persist time.
 */
export type LiftedOutputRef = {
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

export type CodexParsedChunk =
  | {
      type: "action_confirmation";
      toolName: string;
      params: unknown;
      runId: string;
    }
  | {
      type: "tool_call";
      id: string;
      name: string;
      input: unknown;
    }
  | {
      type: "tool_result";
      id?: string;
      name: string;
      result: { success: boolean; data: unknown; summary: string };
      refs: LiftedOutputRef[];
    }
  | { type: "reasoning"; delta: string };

export function extractConfirmPayload(text: string): string | null {
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

export function normalizeToolResultText(item: Record<string, unknown>): string {
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
export function liftOutputRefs(text: string): LiftedOutputRef[] | null {
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

const CODEX_ROLLOUT_NOISE_RE =
  /^\d{4}-\d{2}-\d{2}T[^\s]+\s+ERROR\s+codex_core::rollout::list:\s+state db missing rollout path for thread\s+[a-z0-9-]+$/i;

/**
 * Strip codex's benign "state db missing rollout path" stderr noise lines.
 * Shared by BOTH stderr paths (exec: runChildProcess capture in execute.ts;
 * app-server: spawnAppServerClient onStderr in execute-app-server.ts) so their
 * logging matches. Lives here — not in execute.ts — to avoid an
 * execute ↔ execute-app-server module cycle.
 */
export function stripCodexRolloutNoise(text: string): string {
  const parts = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) {
      kept.push(part);
      continue;
    }
    if (CODEX_ROLLOUT_NOISE_RE.test(trimmed)) continue;
    kept.push(part);
  }
  return kept.join("\n");
}

export function parseActionConfirmation(item: Record<string, unknown>): CodexParsedChunk | null {
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
