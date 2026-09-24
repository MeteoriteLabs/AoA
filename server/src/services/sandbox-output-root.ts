// server/src/services/sandbox-output-root.ts
//
// CLI-017-A (ruling F7, recorded as `E7-D11`) — SD-1b, SD-2 and the server half of SD-4.
//
// `E7-D11` §1 rules the output mechanism to be a CONVENTIONAL OUTPUT ROOT, `R =
// /home/user/aoa-output`: a run's deliverable is a regular file the agent writes under `R`, and
// `CLI-012`'s producer enumerates `R` and turns each file into an export request. §2 rules the
// PLACEMENT to be SD-1b — the agent learns `R` from a `claude_local`-only directive appended at
// the DISTRIBUTED CALLER (`heartbeat.ts`'s canary block, to the task markdown it passes into
// `buildTaskRunBatchWorkload`), not from a cwd prefix in the invocation script literal (SD-1a)
// and not from a builder-side prompt append (SD-1c).
//
// ★★★ WHY THIS LIVES IN ITS OWN MODULE AND NOT BESIDE `STAGED_INPUT_DIR`. The task section
// names `server/src/services/task-run-sandbox-invocation.ts` as the natural home of the sandbox
// path vocabulary AND states the cost in the same breath: that file is on
// `.github/workflows/keyed-e2b-unit-d.yml`'s `paths`, so editing it AUTO-FIRES a keyed E2B lane
// on merge to `docs/replatform-program` (review §3.7). Keyed spend is the planning session's
// under founder ruling F8 and is not this ticket's to authorize, so the task's stated
// alternative is taken — "put the constant in a new server module instead and say so in the
// result" — and the result says so. Nothing else changes: `task-run-sandbox-invocation.ts` is
// untouched by this slice, which is also why every `E7-F026` staged-byte pin stays green
// unedited.
//
// ★★★ WHY THE DIRECTIVE IS A SEPARATE, EXPORTED, PURE FUNCTION. The review's §6 pin census
// recorded that SD-1b "moves none" of the 16 pins, and then refused to call that a win: "SD-1b's
// 'none' is a search result, not a proof. No test asserts the staged prompt bytes at the
// heartbeat call site … The emit build therefore owes a new pin at that site, because an
// unpinned directive can be deleted silently." `E7-D11` carries that caveat forward as a binding
// condition: a `CLI-017` without **PC-12** does not satisfy the ruling. The append is therefore
// not an inline string concatenation buried in a 5,000-line heartbeat — it is this function,
// which `PC-12` pins behaviourally (the exact bytes, the two gates, the cross-tenant arm) while
// the same test pins the CALL SITE, so deleting the append from `heartbeat.ts` reds.

/**
 * `R` — the conventional output root, ruled by `E7-D11` §1.
 *
 * ★★★ THIS IS THE SERVER-SIDE HALF OF SD-4's "one `R`, provably", AND IT IS ONE OF EXACTLY TWO
 * DEFINITIONS. The worker-side half is `DEFAULT_OUTPUT_ROOT`
 * (`packages/worker-daemon/src/lease/export-request-producer.ts`), which `CLI-012` already
 * shipped. A single shared constant is NOT available: the only `@armyofagents/*` package both
 * `server/package.json` and `packages/worker-daemon/package.json` depend on is
 * `@armyofagents/worker-protocol`, which is FROZEN (`E7-D07`). So SD-4 is implemented as the
 * review's second form — two constants plus an equality check that runs in CI's `policy` job
 * (`scripts/check-sandbox-output-root.mjs`, declared in `scripts/guard-inventory.json`, because a
 * check no workflow invokes is a check that nothing runs).
 *
 * ★ IF YOU CHANGE THIS VALUE you must change the worker-side constant in the same commit, or the
 * `policy` job reds. That is the intended behaviour and the whole point of the check.
 */
export const SANDBOX_OUTPUT_ROOT = "/home/user/aoa-output";

/**
 * The SD-1b directive, verbatim. **This text is pinned byte-for-byte by PC-12** — changing it is
 * a deliberate act that reds the pin, which is exactly what the review asked for.
 *
 * ★ IT IS DELIBERATELY SHORT. Under SD-1b the directive is part of the staged prompt, so it
 * counts against `MAX_STAGED_FILE_BYTES` (1_048_576,
 * `server/src/services/task-run-batch-workload.ts`) — a stated behaviour change carried from
 * `E7-D11` §2: a task within roughly 200 bytes of that ceiling which built before is now
 * REFUSED, never truncated.
 *
 * ★ IT NAMES NO TENANT, NO RUN AND NO PATH BUT `R`. The root is a per-sandbox path and the
 * sandbox is per-run and single-tenant (review `A-O2-12`), so the directive is IDENTICAL for
 * every Organization and carries nothing of one run into another's prompt. That is what makes
 * the cross-tenant arm of acceptance row 5 a property rather than a coincidence.
 */
export const SANDBOX_OUTPUT_ROOT_DIRECTIVE = [
  "## Where to write your output",
  "",
  `Write every file you produce for this task under \`${SANDBOX_OUTPUT_ROOT}\`.`,
  "Create that directory if it does not already exist.",
  "Files written anywhere else are not collected and will not be delivered.",
].join("\n");

/** What `applySandboxOutputRootDirective` needs to decide. */
export interface SandboxOutputRootDirectiveInput {
  /** The agent's adapter type. Only `claude_local` gets the directive (`E7-D04`). */
  readonly adapterType: string;
  /** Whether THIS run's resolved environment driver is a sandbox. */
  readonly runTargetsSandbox: boolean;
  /** The task markdown the caller is about to hand `buildTaskRunBatchWorkload`. */
  readonly currentTaskMarkdown: unknown;
}

/**
 * SD-1b — append the output-root directive to the task markdown, or return it unchanged.
 *
 * ★ TWO GATES, BOTH REQUIRED, AND THEY ARE NOT INTERCHANGEABLE.
 *
 *   1. `adapterType === "claude_local"`. `E7-D04` excludes codex from every output ruling, the
 *      probe ran no codex arm, and the codex literal is untouched. A directive appended for
 *      codex would red the codex shape pins (census rows 4 and 7) — which is acceptance row 4's
 *      mutant, stated as a mutant precisely so this gate cannot be quietly dropped.
 *   2. `runTargetsSandbox`. `R` is a path INSIDE a sandbox. A non-distributed run has no sandbox
 *      and no `R`, and telling a local agent to write into `/home/user/aoa-output` would put
 *      files somewhere nothing enumerates — so a non-distributed run stays byte-identical, which
 *      is also this change's rollback story.
 *
 * ★ FAIL-SOFT BY RULING, AND IT UNDER-CLAIMS. The directive is ADDITIVE TEXT. `E7-D11` §5 and
 * `A-O2-8` settle the direction: a run that does not get the directive produces no output and
 * reports ZERO produced outputs, which is honest about what was counted and never fabricates a
 * produced output. So an absent/empty markdown yields the directive on its own rather than a
 * throw — there is nothing to fail closed ON here, and refusing the run would be strictly worse
 * than under-claiming.
 */
export function applySandboxOutputRootDirective(input: SandboxOutputRootDirectiveInput): string {
  const base = typeof input.currentTaskMarkdown === "string" ? input.currentTaskMarkdown : "";
  if (input.adapterType !== "claude_local") return base;
  if (!input.runTargetsSandbox) return base;
  // A blank base must not produce a leading blank line: the directive is pinned byte-for-byte,
  // and "the exact directive text" has to mean the same bytes in both shapes.
  return base.trim().length === 0 ? SANDBOX_OUTPUT_ROOT_DIRECTIVE : `${base}\n\n${SANDBOX_OUTPUT_ROOT_DIRECTIVE}`;
}
