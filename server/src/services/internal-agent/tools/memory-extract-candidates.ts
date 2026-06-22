// server/src/services/internal-agent/tools/memory-extract-candidates.ts
//
// Task C2 batch 3 — `extract_memory_candidates` (memory tool, Scribe/Memory Keeper).
//
// Thin wrapper over C1's `extractMemoryCandidates` (server/src/services/extraction.ts).
// Returns structured memory candidates (decision|insight|reference|context|preference|...)
// without persisting — callers decide whether to submit_extracted_items or
// propose_memory_from_thread.
//
// LLM resolution: prefers an injected `ctx.services.extraction?.llm` (used by
// tests), otherwise falls back to the same `resolveAvailableProvider` chain the
// autonomous Scribe path uses (by passing `null` to the underlying function).
// This way production callers don't need extraction.llm wired into the
// ServiceContainer — the legacy provider chain handles it.

import { extractMemoryCandidates } from "../../extraction.js";
import type { AgentTool } from "../types.js";

export const extractMemoryCandidatesTool: AgentTool = {
  name: "extract_memory_candidates",
  description:
    "Run LLM extraction over thread entries and return structured memory candidates " +
    "(decisions, insights, references, etc.). Does not persist — pair with " +
    "submit_extracted_items or propose_memory_from_thread to act on the results.",
  parameters: {
    type: "object",
    properties: {
      threadId: {
        type: "string",
        description: "The thread (discussion) id to extract from",
      },
      sinceEntryId: {
        type: "string",
        description:
          "Optional cursor — only consider entries posted strictly after this entry",
      },
    },
    required: ["threadId"],
  },
  category: "memory",
  requiredRole: "team_member",
  requiresConfirmation: false,
  async execute(params, ctx) {
    const { threadId, sinceEntryId } = (params ?? {}) as {
      threadId?: string;
      sinceEntryId?: string;
    };
    if (!threadId || typeof threadId !== "string") {
      return {
        success: false,
        data: { candidates: [] },
        summary: "threadId is required",
        error: "INVALID_PARAMS",
      };
    }

    // Prefer an injected ExtractionLlm (tests + future custom wrappers), but
    // fall back to `null` so the extraction service resolves a provider via
    // the same chain the autonomous Scribe path uses. Either way the function
    // returns a stable `{ candidates }` shape.
    const llm = (ctx.services as any)?.extraction?.llm ?? null;

    try {
      const result = await extractMemoryCandidates(ctx.db, llm, {
        companyId: ctx.companyId,
        threadId,
        ...(sinceEntryId ? { sinceEntryId } : {}),
      });
      const count = result.candidates.length;
      return {
        success: true,
        data: result,
        summary: `Extracted ${count} memory candidate${count === 1 ? "" : "s"}`,
      };
    } catch (err: any) {
      // Provider-resolution failure surfaces here when no `llm` is injected
      // and no provider has a key configured.
      const msg = err?.message ?? "unknown error";
      const isProviderMissing = /No LLM provider configured/i.test(msg);
      return {
        success: false,
        data: { candidates: [] },
        summary: isProviderMissing
          ? "Extraction LLM unavailable"
          : `Extraction failed: ${msg}`,
        error: isProviderMissing ? "EXTRACTION_LLM_UNAVAILABLE" : "EXTRACTION_FAILED",
      };
    }
  },
};
