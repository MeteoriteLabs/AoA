// server/src/services/internal-agent/output-refs.ts
//
// Pure ref-builder for the Commander viewer (design v2 §3b).
// Called from the MCP bridge with (toolName, args, structured ToolResult).
// MUST NEVER THROW — a ref bug can't be allowed to fail a tool call.
import {
  MAX_OUTPUT_REFS_PER_MESSAGE,
  MAX_OUTPUT_REF_TITLE_LENGTH,
  type CommanderOutputRef,
} from "@armyofagents/shared";
import type { ToolResult } from "./types.js";
import type { AgentStreamChunk } from "./agent-loop.js";

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
function asId(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function asTitle(v: unknown): string | null {
  return typeof v === "string" && v.length > 0
    ? v.slice(0, MAX_OUTPUT_REF_TITLE_LENGTH)
    : null;
}
function asVersionNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

function artifactRef(partial: {
  id: string | null;
  versionId?: unknown;
  versionNumber?: unknown;
  title?: unknown;
  action: "created" | "referenced";
}): CommanderOutputRef | null {
  if (!partial.id) return null;
  return {
    v: 1,
    kind: "artifact",
    id: partial.id,
    versionId: asId(partial.versionId) ?? null,
    versionNumber: asVersionNumber(partial.versionNumber),
    title: asTitle(partial.title),
    action: partial.action,
    toolCallId: null,
    mimeType: null,
  };
}

function refsFromRows(data: unknown): CommanderOutputRef[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => {
      const r = asRecord(row);
      return artifactRef({
        id: asId(r.artifactId),
        versionId: r.currentVersionId,
        title: r.title,
        action: "referenced",
      });
    })
    .filter((r): r is CommanderOutputRef => r !== null);
}

export function buildOutputRefs(
  toolName: string,
  params: unknown,
  result: ToolResult,
): CommanderOutputRef[] {
  try {
    if (!result || result.success !== true) return [];
    const p = asRecord(params);
    const d = asRecord(result.data);

    switch (toolName) {
      case "create_artifact": {
        const ref = artifactRef({
          id: asId(d.artifactId),
          versionId: d.versionId,
          // create() makes the first version when content/fileRef given.
          versionNumber: asId(d.versionId) ? 1 : null,
          title: p.title,
          action: "created",
        });
        return ref ? [ref] : [];
      }
      case "create_artifact_version": {
        const ref = artifactRef({
          id: asId(p.artifactId),
          versionId: d.versionId,
          versionNumber: d.versionNumber,
          title: null,
          action: "created",
        });
        return ref ? [ref] : [];
      }
      case "attach_task_artifact": {
        // Return shape verified: data: { artifactId, versionId, taskOutputId }
        // (attach-task-artifact-tool.ts lines 170-178)
        const ref = artifactRef({
          id: asId(d.artifactId),
          versionId: d.versionId ?? d.artifactVersionId,
          title: p.title,
          action: "created",
        });
        return ref ? [ref] : [];
      }
      case "query_artifacts":
      case "query_company_artifacts":
        // Dedupe BEFORE capping: query_artifacts inner-joins attachments, so one
        // artifact attached to N entries yields N duplicate rows (review T2 #1).
        return mergeOutputRefs([], refsFromRows(result.data));
      case "get_task": {
        const ref = artifactRef({
          id: asId(d.artifactId),
          title: d.title, // task title fallback; viewer resolves real name on open
          action: "referenced",
        });
        return ref ? [ref] : [];
      }
      default:
        return [];
    }
  } catch {
    return [];
  }
}

/** Collect refs from a forwarded chunk into a turn-level sink (mutates sink). */
export function collectChunkRefs(sink: CommanderOutputRef[], chunk: AgentStreamChunk): void {
  if (chunk.type === "tool_result" && Array.isArray(chunk.refs) && chunk.refs.length > 0) {
    sink.push(...chunk.refs);
  }
}

const refKey = (r: CommanderOutputRef) =>
  `${r.kind}|${r.id}|${r.versionId ?? ""}`;

export function mergeOutputRefs(
  existing: CommanderOutputRef[],
  incoming: CommanderOutputRef[],
): CommanderOutputRef[] {
  const map = new Map<string, CommanderOutputRef>();
  for (const r of [...existing, ...incoming]) {
    const k = refKey(r);
    const prev = map.get(k);
    if (!prev) {
      map.set(k, r);
    } else if (prev.action === "referenced" && r.action === "created") {
      map.set(k, { ...r, title: r.title ?? prev.title });
    } else if (!prev.title && r.title) {
      map.set(k, { ...prev, title: r.title });
    }
  }
  const all = [...map.values()];
  if (all.length <= MAX_OUTPUT_REFS_PER_MESSAGE) return all;
  const created = all.filter((r) => r.action === "created");
  const referenced = all.filter((r) => r.action === "referenced");
  return [...created, ...referenced].slice(0, MAX_OUTPUT_REFS_PER_MESSAGE);
}
