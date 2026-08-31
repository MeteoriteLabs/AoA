// server/src/services/task-run-batch-workload.ts
//
// CLI-006 / Blocker A — build the frozen `batch` workload a canary task run submits.
//
// WHY THIS EXISTS. The distributed path reaches the sandbox through exactly ONE channel:
// `createSpecFor` (packages/worker-daemon/src/supervisor/supervisor.ts) reads ONLY
// `workload.command` and `workload.args`. `ExecuteInput` has no stdin, `stdinArtifactId`
// has zero consumers, and `workspace` is hard-coded `null`. So argv is the whole contract.
// Until this module existed, `input` was plumbed end-to-end (heartbeat-distributed-rollout →
// run-execution-owner → job-convert-orchestrator → job-admission-bridge) and NOTHING pushed
// into it: every canary job carried `{}`, `createSpecFor` fell back to `command =
// workloadType` ("batch"), and no lease could ever run a real agent.
//
// WHAT IT IS NOT. It is not the shadow comparator (`job-shadow-comparator.ts`), which
// hand-writes `command: agent.adapterType` — a REGISTRY KEY ("claude_local"), not a binary,
// as its own comment concedes. Mirror that module's SHAPE, never its VALUES. The precedent
// this module actually follows is `browser-job-config.ts`: a pure builder that self-validates
// against the frozen schema so it cannot drift from the wire contract.
//
// PURE + SYNCHRONOUS — no I/O, no database, no clock, no randomness. That last one is load
// bearing: `job-submission.ts` hashes the whole command INCLUDING `input`, and a differing
// digest under the same `idempotencyKey` (= `run.id`) is a 409. A timestamp or a nonce here
// would turn every retry into a hard conflict. `buildTaskRunBatchWorkload` is a function of
// its inputs alone; `task-run-batch-workload.test.ts` asserts that byte-for-byte.
//
// FAIL CLOSED, NEVER GUESS. Every refusal returns `{ok:false, reason}` and the seam leaves
// the run with the legacy executor. There is no fallback command, and no truncation: a
// silently truncated prompt would produce a sandbox that runs mutilated work, terminalizes
// cleanly, and satisfies the acceptance verifier while proving nothing.
import {
  batchWorkloadV1Schema,
  type BatchWorkloadV1,
} from "@armyofagents/worker-protocol";
import { dispositionForAdapter } from "./sandbox-coding-disposition.js";
import {
  resolveHeartbeatRunTimeoutPolicy,
  type HeartbeatRunTimeoutPolicy,
} from "./heartbeat-stop-metadata.js";

/** Why a canary task run could not be expressed as a `batch` workload. Machine-readable so
 * the seam can log an attributable reason rather than an undifferentiated "stayed legacy". */
export type TaskRunBatchWorkloadRejection =
  /** The adapter is outside the v1 sandboxed-coding scope (sandbox-coding-disposition.ts). */
  | "adapter_not_v1_scope"
  /** `getRuntimeCommandSpec` returned null / an unusable command — 5 of 14 adapters do. */
  | "no_runtime_command_spec"
  /** No task content was assembled for this run, so there is no prompt to deliver. */
  | "empty_prompt"
  /** The prompt exceeds the frozen 8192-char per-arg ceiling. REFUSED, never truncated. */
  | "prompt_too_large"
  /** The serialized workload exceeds the submission surface's 64 KiB `input` bound. */
  | "workload_too_large"
  /** The assembled workload failed the FROZEN schema — the schema always has the last word. */
  | "invalid_workload";

export type BuildTaskRunBatchWorkloadResult =
  | { readonly ok: true; readonly workload: BatchWorkloadV1 }
  | { readonly ok: false; readonly reason: TaskRunBatchWorkloadRejection };

export interface TaskRunBatchWorkloadInput {
  /** `agents.adapter_type` — the REGISTRY key. Used ONLY to pick the disposition + argv
   * shape; it is never used as a command (that is the shadow comparator's bug). */
  readonly adapterType: string;
  /** `resolveGuardedAdapterExecutionContext(...).runtimeCommandSpec` — the adapter's real
   * binary, already honoring a founder `adapterConfig.command` override. `null` for the 5
   * registered adapters with no `getRuntimeCommandSpec`; a null is a REFUSAL, not a default. */
  readonly runtimeCommandSpec: { readonly command?: unknown } | null | undefined;
  /** The run-scoped adapter config (`runScopedConfig`), read ONLY for the timeout policy. */
  readonly adapterConfig: Record<string, unknown> | null | undefined;
  /** `context.currentTaskMarkdown` — the REAL assembled task content. Deliberately NOT
   * `runScopedConfig.promptTemplate`, which is an UNRENDERED `{{…}}` template (rendering
   * happens inside `adapter.execute`, two lines after the canary returns) and is DELETED
   * outright for agents migrated to the instructions bundle. Template rendering is Unit 2. */
  readonly currentTaskMarkdown: unknown;
}

/** The frozen per-arg ceiling (`batchWorkloadV1Schema`: `z.array(z.string().max(8192))`).
 * Mirrored so the prompt can be refused with an attributable reason before the schema
 * rejects it generically; the frozen schema still has the last word. */
export const FROZEN_MAX_ARG_CHARS = 8192;

/** The submission surface's `input` bound (`packages/shared/src/validators/job-control.ts`:
 * `TextEncoder().encode(JSON.stringify(input)).byteLength > 65_536`). Mirrored exactly. */
export const SUBMISSION_MAX_INPUT_BYTES = 65_536;

/** The server-owned run ceiling, deliberately BENEATH the frozen 86_400 wire ceiling, and
 * the applied default when the agent configures no timeout.
 *
 * ★ A bare clamp CANNOT be used here: `defaultTimeoutSecForAdapter` is literally `return 0;`
 * for EVERY adapter (heartbeat-stop-metadata.ts), so an unconfigured agent yields
 * `effectiveTimeoutSec === 0` and `timeoutConfigured === false`. Clamping that into
 * [1, 86_400] would produce a ONE-SECOND run for every default-configured agent. The
 * `timeoutConfigured` flag — not the number — is what distinguishes "no timeout set" from
 * "a timeout of zero". */
/** ★ The bounds the WORKER actually enforces, mirrored so the workload cannot DECLARE a budget
 * the system will not HONOUR.
 *
 * `packages/worker-daemon/src/lifecycle/run-op-deadline.ts` is the SOURCE OF TRUTH. They are
 * mirrored rather than imported because server's only worker-daemon imports are `import type`
 * (erased at compile time); a value import would pull that barrel into the control plane's
 * RUNTIME graph for the sake of two numbers. `__tests__/task-run-batch-workload.test.ts`
 * value-imports the originals and asserts equality, so drift is a RED TEST, not a silent lie.
 *
 * Why a ceiling: the owned-labels capability lives 300s and is never re-minted on renewal, so a
 * deadline past (capability TTL − teardown headroom) leaves the sandbox un-destroyable — it is
 * recorded `orphaned` and keeps billing. Why a floor: the same value is ALSO the sandbox TTL at
 * `create`, so a very small budget would reap the sandbox out from under its own creation. */
export const TASK_RUN_MIN_ENFORCEABLE_SECONDS = 60;
export const TASK_RUN_MAX_ENFORCEABLE_SECONDS = 240;

/** The applied default when the agent configures no timeout: the most the system can actually
 * honour.
 *
 * ★ This was 600. That made the workload declare a budget nothing enforced — the worker clamps
 * the provider-op deadline to 240s, while `job-leasing.ts` derives the LEASE deadline from THIS
 * field, so the lease outlived the execution deadline by six minutes and a task that used its
 * declared budget died at 240s having been promised 600. Declared and enforced now agree. */
export const TASK_RUN_DEFAULT_MAX_RUNTIME_SECONDS = TASK_RUN_MAX_ENFORCEABLE_SECONDS;

/** The frozen wire ceiling on `maxRuntimeSeconds` (`batchWorkloadV1Schema`, 1..86_400). */
const FROZEN_MAX_RUNTIME_SECONDS = 86_400;

function readCommand(spec: TaskRunBatchWorkloadInput["runtimeCommandSpec"]): string | null {
  if (!spec || typeof spec !== "object") return null;
  const command = (spec as { command?: unknown }).command;
  if (typeof command !== "string") return null;
  const trimmed = command.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolve the run's `maxRuntimeSeconds`.
 *
 * `timeoutConfigured ? min(600, floor(clamp(sec, 1, 86_400))) : 600`. The clamp is applied
 * BEFORE the floor, and the floor is unconditional because `effectiveTimeoutSec` can be
 * FRACTIONAL (`heartbeat-stop-metadata.ts` derives the `http` branch as `timeoutMs / 1000`)
 * while the frozen schema is `.int()`. `http` cannot reach this module today (it is `infra`
 * in the disposition matrix), so the floor is defensive rather than load-bearing — which is
 * exactly why it stays: the gate above it is the only thing making it unreachable.
 */
export function resolveTaskRunMaxRuntimeSeconds(
  adapterType: string,
  adapterConfig: Record<string, unknown> | null | undefined,
): number {
  return maxRuntimeSecondsForPolicy(
    resolveHeartbeatRunTimeoutPolicy(adapterType, adapterConfig ?? {}),
  );
}

/**
 * The policy → seconds arithmetic, split out so its FAIL-CLOSED arms are directly testable.
 *
 * `HeartbeatRunTimeoutPolicy.effectiveTimeoutSec` is typed `number | null` even though today
 * both branches of `resolveHeartbeatRunTimeoutPolicy` return a number. A null (or a NaN
 * arriving through the same widened type) must resolve to the 600s DEFAULT, never to
 * `Math.max(1, null) === 1` — which is the one-second trap wearing a different hat. The
 * split exists because that arm is unreachable through the public resolver, and an untestable
 * guard is one nobody can prove is a guard.
 */
export function maxRuntimeSecondsForPolicy(
  policy: Pick<HeartbeatRunTimeoutPolicy, "effectiveTimeoutSec" | "timeoutConfigured">,
): number {
  const seconds = policy.effectiveTimeoutSec;
  if (!policy.timeoutConfigured || typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return TASK_RUN_DEFAULT_MAX_RUNTIME_SECONDS;
  }
  const floored = Math.floor(Math.min(FROZEN_MAX_RUNTIME_SECONDS, Math.max(1, seconds)));
  // ★ Clamp to what the worker ENFORCES, not to the wire ceiling. A configured 45s was
  // previously emitted as 45 and enforced as 60 (the worker's floor); a configured 900s was
  // emitted as 600 and enforced as 240. Both were the same defect in opposite directions.
  return Math.min(
    TASK_RUN_MAX_ENFORCEABLE_SECONDS,
    Math.max(TASK_RUN_MIN_ENFORCEABLE_SECONDS, floored),
  );
}

/**
 * The per-adapter argv shapes. TWO explicit shapes, never one: the claude flags are
 * meaningless to codex and vice versa, and the argv is the ONLY thing the sandbox executes.
 *
 * Both shapes deliver the prompt as an argv POSITIONAL, a deliberate divergence from the
 * legacy adapters — `claude` is spawned as `--print -` with the prompt on stdin
 * (claude-local/src/server/execute.ts) and `codex exec … -` likewise. There is no stdin
 * channel into the sandbox, so the `-` placeholder is replaced by the prompt itself;
 * `codex exec <PROMPT>` is a supported positional form.
 *
 * Everything else the legacy adapters pass — `--mcp-config`, `--append-system-prompt-file`,
 * `--add-dir`, `--settings` — names HOST paths that do not exist inside the sandbox. Model
 * pinning, permission flags and the instructions bundle are Unit 2 (CAPABILITY); Unit 1 is
 * the MECHANISM and deliberately emits the minimal shape that runs.
 */
function buildArgsFor(adapterType: string, prompt: string): readonly string[] | null {
  switch (adapterType) {
    case "claude_local":
      return ["--print", prompt, "--output-format", "stream-json", "--verbose"];
    case "codex_local":
      return ["exec", "--json", prompt];
    default:
      // Unreachable while the disposition gate admits exactly the two v1 adapters. Kept as a
      // refusal rather than a throw so widening the matrix without widening this switch fails
      // closed instead of emitting a claude-shaped argv for an unrelated binary.
      return null;
  }
}

/**
 * Build the `batch` workload for one canary task run, or refuse with an attributable reason.
 *
 * Never throws; never mutates its input; emits keys in a fixed order so an equivalent
 * resubmission produces a byte-identical workload (the idempotency digest depends on it).
 */
export function buildTaskRunBatchWorkload(
  input: TaskRunBatchWorkloadInput,
): BuildTaskRunBatchWorkloadResult {
  // 1. The disposition gate. There is NO adapter gate at the canary fork in heartbeat.ts
  //    (seven conjuncts, none adapter-related), so ANY of the 14 registered adapters can
  //    reach this seam. Without this gate an `http` agent would emit `command: "http"` —
  //    which passes `z.string().min(1).max(256)` — and the supervisor would run a
  //    nonexistent binary inside a sandbox while the real webhook stayed suppressed.
  //
  //    This is the SAME matrix the credential mint gates on
  //    (`execution-secret-handle-mint.ts`), so a non-v1 adapter could never obtain a
  //    credential handle — and therefore never a capability, and therefore never a sandbox.
  //    Refusing here makes that structural rather than incidental.
  if (dispositionForAdapter(input.adapterType).bucket !== "v1") {
    return { ok: false, reason: "adapter_not_v1_scope" };
  }

  // 2. The real binary. NEVER `agent.adapterType`.
  const command = readCommand(input.runtimeCommandSpec);
  if (command === null) return { ok: false, reason: "no_runtime_command_spec" };

  // 3. The prompt: the REAL assembled task content.
  const prompt =
    typeof input.currentTaskMarkdown === "string" ? input.currentTaskMarkdown.trim() : "";
  if (prompt.length === 0) return { ok: false, reason: "empty_prompt" };
  // REFUSE, never truncate. A truncated prompt still creates a sandbox, still runs, still
  // terminalizes, and still satisfies the acceptance verifier — while the agent works from a
  // mutilated task. The repo's own audit cap (`prompt-snapshot.ts`,
  // MAX_PROMPT_SNAPSHOT_CHARS = 16_000) is 2x this ceiling, so real prompts DO exceed it.
  if (prompt.length > FROZEN_MAX_ARG_CHARS) return { ok: false, reason: "prompt_too_large" };

  const args = buildArgsFor(input.adapterType, prompt);
  if (args === null) return { ok: false, reason: "adapter_not_v1_scope" };

  const candidate = {
    command,
    args: [...args],
    // Zero consumers anywhere in the daemon; a value here would be inert, so `null` is the
    // honest encoding rather than a promise the runtime does not keep.
    stdinArtifactId: null,
    maxRuntimeSeconds: resolveTaskRunMaxRuntimeSeconds(input.adapterType, input.adapterConfig),
  };

  // 4. The FROZEN schema is the final authority — this module cannot drift from the wire
  //    contract, because every accepted output has been through it.
  const parsed = batchWorkloadV1Schema.safeParse(candidate);
  if (!parsed.success) return { ok: false, reason: "invalid_workload" };

  // 5. The submission surface's own bound, mirrored. A prompt within the 8192-CHAR arg
  //    ceiling can still exceed 64 KiB once JSON-escaped (a `\uXXXX` escape is 6 bytes per
  //    source char), and that failure would otherwise surface far from its cause.
  const encoded = JSON.stringify(parsed.data);
  if (new TextEncoder().encode(encoded).byteLength > SUBMISSION_MAX_INPUT_BYTES) {
    return { ok: false, reason: "workload_too_large" };
  }

  return { ok: true, workload: parsed.data };
}
