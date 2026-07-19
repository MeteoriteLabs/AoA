// server/src/services/internal-agent/output-refs.ts
//
// Pure ref-builder for the Commander viewer.
// Called from the MCP bridge with (toolName, args, structured ToolResult).
// MUST NEVER THROW — a ref bug can't be allowed to fail a tool call.
import {
  MAX_OUTPUT_REFS_PER_MESSAGE,
  MAX_OUTPUT_REF_TITLE_LENGTH,
  showRefsSchema,
  type ShowRef,
  type ShowRefProvenance,
  type ShowRefSurface,
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

/**
 * Emission context threaded from the MCP bridge. `provenanceBase` carries the
 * per-turn who/where/when (surface/entity/run/agent/emittedAt); `nextSeq` is a
 * PER-REF ordering allocator (a module-level counter in the bridge subprocess).
 * `entityId` may be null (a Commander turn without a conversation) — in that
 * case the emitted ref carries `provenance: null` (still v2, never v1).
 */
export interface OutputRefProvenanceBase {
  surface: ShowRefSurface;
  entityId: string | null;
  runId: string | null;
  agentId: string | null;
  messageId: string | null;
  emittedAt: string;
}
export interface OutputRefEmitCtx {
  provenanceBase: OutputRefProvenanceBase | null;
  /** Called ONCE per ref actually emitted — each ref gets a distinct, contiguous seq. */
  nextSeq: () => number;
}

function buildProvenance(ctx?: OutputRefEmitCtx): ShowRefProvenance | null {
  const base = ctx?.provenanceBase;
  // Schema forbids an empty entityId — a null conversation → provenance: null.
  if (!ctx || !base || !base.entityId) return null;
  return {
    surface: base.surface,
    entityId: base.entityId,
    runId: base.runId,
    agentId: base.agentId,
    messageId: base.messageId,
    emittedAt: base.emittedAt,
    seq: ctx.nextSeq(),
  };
}

function artifactRef(
  partial: {
    id: string | null;
    versionId?: unknown;
    versionNumber?: unknown;
    title?: unknown;
    action: "created" | "referenced";
  },
  ctx?: OutputRefEmitCtx,
): ShowRef | null {
  if (!partial.id) return null;
  return {
    v: 2,
    kind: "artifact",
    id: partial.id,
    versionId: asId(partial.versionId) ?? null,
    versionNumber: asVersionNumber(partial.versionNumber),
    title: asTitle(partial.title),
    action: partial.action,
    toolCallId: null,
    mimeType: null,
    provenance: buildProvenance(ctx),
  };
}

function refsFromRows(data: unknown, ctx?: OutputRefEmitCtx): ShowRef[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => {
      const r = asRecord(row);
      return artifactRef(
        {
          id: asId(r.artifactId),
          versionId: r.currentVersionId,
          title: r.title,
          action: "referenced",
        },
        ctx,
      );
    })
    .filter((r): r is ShowRef => r !== null);
}

export function buildOutputRefs(
  toolName: string,
  params: unknown,
  result: ToolResult,
  ctx?: OutputRefEmitCtx,
): ShowRef[] {
  try {
    if (!result || result.success !== true) return [];
    const p = asRecord(params);
    const d = asRecord(result.data);

    let refs: ShowRef[] = [];
    switch (toolName) {
      case "create_artifact": {
        const ref = artifactRef(
          {
            id: asId(d.artifactId),
            versionId: d.versionId,
            // create() makes the first version when content/fileRef given.
            versionNumber: asId(d.versionId) ? 1 : null,
            title: p.title,
            action: "created",
          },
          ctx,
        );
        refs = ref ? [ref] : [];
        break;
      }
      case "create_artifact_version": {
        const ref = artifactRef(
          {
            id: asId(p.artifactId),
            versionId: d.versionId,
            versionNumber: d.versionNumber,
            title: null,
            action: "created",
          },
          ctx,
        );
        refs = ref ? [ref] : [];
        break;
      }
      case "attach_task_artifact": {
        // Return shape verified: data: { artifactId, versionId, taskOutputId }
        // (attach-task-artifact-tool.ts lines 170-178)
        const ref = artifactRef(
          {
            id: asId(d.artifactId),
            versionId: d.versionId ?? d.artifactVersionId,
            title: p.title,
            action: "created",
          },
          ctx,
        );
        refs = ref ? [ref] : [];
        break;
      }
      case "query_artifacts":
      case "query_company_artifacts":
        // Dedupe BEFORE capping: query_artifacts inner-joins attachments, so one
        // artifact attached to N entries yields N duplicate rows (review T2 #1).
        // seq is allocated per row inside refsFromRows (before dedup).
        refs = mergeOutputRefs([], refsFromRows(result.data, ctx));
        break;
      case "get_task": {
        const ref = artifactRef(
          {
            id: asId(d.artifactId),
            title: d.title, // task title fallback; viewer resolves real name on open
            action: "referenced",
          },
          ctx,
        );
        refs = ref ? [ref] : [];
        break;
      }
      default:
        refs = [];
    }

    // Validate before returning — a malformed ref must not reach the envelope.
    // On failure return [] (Task 4 adds drop logging at this silent boundary).
    const parsed = showRefsSchema.safeParse(refs);
    if (!parsed.success) return [];
    return refs;
  } catch {
    return [];
  }
}

/** Collect refs from a forwarded chunk into a turn-level sink (mutates sink). */
export function collectChunkRefs(sink: ShowRef[], chunk: AgentStreamChunk): void {
  if (chunk.type === "tool_result" && Array.isArray(chunk.refs) && chunk.refs.length > 0) {
    sink.push(...chunk.refs);
  }
}

const refKey = (r: ShowRef) =>
  `${r.v}|${r.kind}|${r.id}|${r.versionId ?? ""}`;

export function mergeOutputRefs(
  existing: ShowRef[],
  incoming: ShowRef[],
): ShowRef[] {
  const map = new Map<string, ShowRef>();
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
