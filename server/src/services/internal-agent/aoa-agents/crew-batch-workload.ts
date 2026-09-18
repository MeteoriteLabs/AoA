// server/src/services/internal-agent/aoa-agents/crew-batch-workload.ts
//
// MIG-006 slice 1 — the crew distributed workload builder (a thin PURE adapter).
//
// A `crew_run` reaches the distributed sandbox through the SAME channel a `task_run`
// does: `buildTaskRunBatchWorkload` is already source-agnostic (it takes an adapter
// type, a resolved binary, a prompt and an optional instructions bundle — none of them
// intrinsically task_run), applies the v1-scope gate, validates against the frozen
// `batchWorkloadV1Schema`, and returns an attributable refusal otherwise. So this module
// does NOT duplicate that builder. It contributes the ONE crew-specific decision — map the
// company's crew provider to the v1 sandbox adapter via `resolveCrewAdapterFor` — and
// delegates everything else.
//
// PURE, like the builder it wraps: no I/O, no clock, no randomness. The idempotency digest
// hashes the whole workload, so a differing digest under the same run-id key is a 409. The
// binary (`runtimeCommandSpec`) is therefore a CALLER-SUPPLIED input, resolved by the crew
// seam via `acquireExecutionContext` — exactly as the heartbeat seam passes it for a
// task_run — not resolved here through the adapter registry.

import { resolveCrewAdapterFor } from "./resolve-crew-adapter.js";
import {
  buildTaskRunBatchWorkload,
  type BuildTaskRunBatchWorkloadResult,
} from "../../task-run-batch-workload.js";

export interface CrewBatchWorkloadInput {
  /** `internal_agent_config.provider` — the company's crew provider (anthropic/openai/…). */
  readonly provider: string | null | undefined;
  /** `internal_agent_config.crew_model` override, if any. */
  readonly crewModel?: string | null;
  /** The adapter's resolved binary, already honoring a founder `command` override. `null`/an
   * unusable command is a REFUSAL (`no_runtime_command_spec`), never a default. Caller-supplied
   * to keep this function pure. */
  readonly runtimeCommandSpec: { readonly command?: unknown } | null | undefined;
  /** The crew run's assembled prompt (the crew analogue of `context.currentTaskMarkdown`). */
  readonly currentTaskMarkdown: unknown;
  /** The crew agent's instructions bundle entry content, or null when it has none. */
  readonly instructions?: string | null;
}

/**
 * Build the `batch` workload for one crew run, or refuse with an attributable reason.
 *
 * `google`/`opencode` companies resolve to a non-v1 adapter (`gemini_local`/`opencode_local`)
 * and refuse `adapter_not_v1_scope` through the inherited gate — the same refusal the credential
 * mint gives — so the seam has ONE place to read "this company's crew cannot go distributed".
 */
export function buildCrewBatchWorkload(input: CrewBatchWorkloadInput): BuildTaskRunBatchWorkloadResult {
  // The ONE crew-specific decision: map the company's crew provider to the v1 sandbox
  // adapter. `google`/`opencode` resolve to a non-v1 adapter (`gemini_local`/`opencode_local`)
  // and refuse `adapter_not_v1_scope` through the delegated gate — the same refusal the mint
  // gives. Everything else — the argv shape, staging, the frozen-schema validation, the
  // timeout policy, the attributable refusal reasons — is inherited from the generic builder.
  const { adapterType, adapterConfig } = resolveCrewAdapterFor(input.provider, input.crewModel);
  return buildTaskRunBatchWorkload({
    adapterType,
    runtimeCommandSpec: input.runtimeCommandSpec,
    adapterConfig,
    currentTaskMarkdown: input.currentTaskMarkdown,
    instructions: input.instructions ?? null,
  });
}
