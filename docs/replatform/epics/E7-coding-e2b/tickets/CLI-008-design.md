# CLI-008 — The capability half: make the sandbox agent able to work, and make that CHECKABLE

**Status:** **Unit A shipped 2026-09-02** (§2); units B–F remain a `scoping stub` and Unit B's channel
decision is undecided, so no result doc yet. Unit A changed the JUDGE, not the capability — E7-F003
stays open and every row of §1 is still true. Evidence: a 39-agent scoping sweep, 2026-09-02, every
item verified against HEAD.
**Epic:** `E7 — Coding/CLI workload on E2B`. **Owns:** `E7-F003`.

---

## 1. The finding still stands, verified row by row

All six rows of E7-F003's table are **still true at HEAD**, checked two ways: no commit since the
finding was filed touches any cited surface, and a per-file `git log -1` on each confirms it. Nothing
has quietly closed.

- `createSpecFor` reads only `workload.command` + `workload.args` (`supervisor.ts:297-303`).
- `ExecuteInput` is exactly `{sandboxId, command, args, env}` — **no stdin** (`provider.ts:200-205`).
- `workspace: null` is hard-coded (`job-leasing.ts:371`) and the field has **zero consumers**.
- `stdinArtifactId` still has zero consumers; every non-test occurrence is a literal `: null`.
- The distributed argv is two literal shapes (`task-run-batch-workload.ts:192-203`), against a legacy
  adapter that assembles `--settings`, `--allowedTools mcp__aoa`, `--model`,
  `--append-system-prompt-file`, `--add-dir` and delivers the prompt on **stdin**
  (`claude-local/src/server/execute.ts:736-772, :879`).

---

## 2. ★★★ Start with the verifier, because today a green E7-1 proves nothing

The finding says clause 5 keys on `attempt_started`. **It is worse than that, and the fix is cheaper
than that.**

- Clause 3 is labelled *"Terminal-AGNOSTIC"* in its own comment — `failed` and `timed_out` are
  accepted (`e7-distributed-run-verifier.ts:341-348`).
- No clause anywhere reads `workload`, `args`, `exitCode`, stdout, or any produced artifact. The
  verdict is `ok: failures.length === 0` (`:456`).
- **So a `claude` that exits 127, with no tools and a context-free prompt, satisfies every clause.**

★ **And the verifier already computes the signal that would catch it.** `countProducedOutputs` counts
`job_artifacts` rows (`kind='workspace_patch'`, `status='committed'`) plus `task_outputs` by
`created_by_run_id` (`e7-distributed-run-verifier-store.ts:198-218`). The result rides on
`observed.producedArtifacts` and is **printed**. Verified independently: it appears at exactly four
lines — the type, the zero-init, the assignment, and the print — and **none of the fourteen
`failures.push` calls touches it**.

**The first unit is therefore an S**: promote that already-computed field to an asserted clause, and
ship a fixture proving the verifier currently blesses a context-free run. Everything after this is
judged by the verifier; fixing the judge first is the only ordering that makes later units provable.

### Unit A — DONE, 2026-09-02

The verifier now computes two independent dimensions.

- **`ok`** is untouched: *the distributed journey was corroborated* — the MECHANISM. Still true of
  a context-free run, and still exactly what the D1 40/40 evidence proved.
- **`capabilityProven` / `capabilityFailures`** are new: *did anything the agent produced reach
  AoA*. Unproven when both counts are 0; the clause-6 reason names the four unbuilt links in the
  return path instead of restating that a number was zero.
- The **RESULT line carries both verdicts**, so a reader who sees only it cannot come away
  believing capability was proven, and a `capability:` block with both counts prints on pass and
  fail alike — an unproven capability is exactly when it matters.
- **`--require-capability`** makes an unproven capability exit 3. **Off by default**, because the
  counts are structurally 0 until Unit F and a gate nobody can pass gets bypassed and then deleted
  (`scripts/lib/gate-clause-wiring.mjs`, header). It is the flag the campaign flips at Unit F.

Proven by mutation, not by assertion: deleting the computation reds the capability tests while the
E7-F003 pin stays green; pushing the failure into `failures` instead reds **the pin**, which is the
guard against the fix this design rejects; making the push unconditional reds both "one count
non-zero flips it true" arms.

**★ What Unit A did NOT do.** It built no capability. No MCP tool surface, no instructions bundle,
no workspace, no non-argv channel, no output capture — the gap in §1 is exactly as wide as it was,
and `capabilityProven` will be **false on every real run** until Unit F. Unit A did not touch the
`--model` argv item the §4 table pairs with it; that stays open. This unit makes the gap legible.
It is the opposite of progress toward a green campaign, and should be reported that way.

---

## 3. ★★★ The keystone decision — **DECIDED 2026-09-03, and this section was WRONG**

> **Superseded by [`qa/2026-09-03-cli-008-unit-b-channel-decision.md`](../../../qa/2026-09-03-cli-008-unit-b-channel-decision.md).**
> A 40-agent sweep measured **both** load-bearing claims below to be false:
>
> 1. *"The FROZEN `SandboxProvider` port has no file-staging operation"* — this **conflates two
>    objects**. `capabilities.ts` defines a wire/registry VOCABULARY; the port is
>    `worker-daemon/src/supervisor/provider.ts:339`, in a package that is **not frozen**, and it has
>    **already grown to thirteen methods plus a mode field** (`digestArtifact`, `exportArtifact`,
>    `artifactExportMode` — shipped as DAT-009 slice 1, `d5885053f`, with the frozen package
>    untouched).
> 2. *"argv is bounded … therefore the channel must not be argv-shaped"* — the cliff is **8,192
>    CHARACTERS PER ARGUMENT** and ~64 KiB per job, not 8 KiB per job. Chunked argv carries **65,306
>    prompt characters**, 8× today's capacity. The bound is a property of `buildArgsFor`'s
>    one-positional shape, not of the protocol.
>
> **DECISION: `stageFiles` as a non-frozen port method + a local `fileStagingMode`** — the exact
> DAT-009 shape. The text below is retained as the record of what was believed before it was measured.

### (superseded) The constraint as originally stated

**Every remaining gap is the same problem wearing six hats: there is no channel into the sandbox
except argv.**

Two facts bound the answer, and both were measured:

- **The FROZEN `SandboxProvider` port has no file-staging operation.** The eleven operations are
  create, execute, cancel, kill, destroy, list, inspect, reconcile_cleanup, checkpoint, restore,
  health (`worker-protocol/src/capabilities.ts:125-153`). The port must not grow.
- **`worker-daemon` is dependency-pinned** to `@armyofagents/worker-protocol` + `pino`, enforced by a
  policy guard, so it cannot reach the E2B transport's file primitives directly.

So a file reaches the sandbox by `sh -c` staging through argv, or it does not reach it at all —
unless a frozen contract changes, which is a separate and much larger decision.

★ **And argv is bounded.** The sweep measured that a task whose description exceeds **~7.4 KB** cannot
run distributed at all today, because the prompt is a positional argument. That is both a live defect
and the constraint that decides the channel: whatever carries the MCP config, the instructions bundle
and the prompt must not be argv-shaped.

**Nothing else in this ticket can be written until that channel is decided.** It is the fork the whole
capability half turns on.

---

## 4. The shape, once the channel is decided

Sizes are the sweep's, corrected by a verification pass. They are indicative, not committed.

| Unit | Size | What |
|---|---|---|
| **A — the judge** | **S** | ✅ **DONE 2026-09-02** (§2). `producedArtifacts` promoted to a `capabilityProven` dimension separate from `ok`, pinned fixture, `--require-capability` off by default. **`--model` in the argv was NOT done** and stays open |
| **B — the channel** | **M** (decision) | ✅ **DECIDED 2026-09-03** — `stageFiles` on the NON-FROZEN port + a local `fileStagingMode`, the DAT-009 shape; the frozen vocabulary is untouched. See `qa/2026-09-03-cli-008-unit-b-channel-decision.md`. Building it is the next unit |
| **C — tools** | **L–XL** | A brokered HTTP `aoa` MCP config plus its env vars, and a run-identity credential as a second secret handle, so `mcp__aoa__*` is actually callable |
| **D — context** | **M** | The instructions bundle reaches the sandbox (`--append-system-prompt-file`), and the prompt stops being a positional |
| **E — workspace** | **XL** | A repository to work in. `workspaceV1Schema` requires a `manifestArtifactId` that has **zero producers**; `buildWorkspaceManifest` walks a LOCAL filesystem and cannot be pointed at an E2B sandbox |
| **F — the return path** | **XL** | Output capture is **four** unbuilt links: the E2B driver never passes stream handlers; `stdoutRef`/`stderrRef` are fabricated literals, not references to stored bytes; `observeRun` is uncomposed (its absence is *pinned by a test*); `buildWorkspacePatch` and `createResultCommitter` have zero production callers |

★ **The control-plane half of F is already shipped** — `job_artifacts` carries RLS, grants, a commit
path, an orphan sweeper and DR manifest reconciliation. What is missing is a **producer**. That is
worth knowing before anyone estimates F as greenfield.

---

## 5. Acceptance (to be fixed when this stops being a stub)

A distributed coding run that the verifier **can distinguish** from a context-free one: the agent had
tools, had its identity and company context, had a repository, and something it produced reached AoA
— each asserted by a clause, not printed as an observation.

★ **No green E7-1 should be read as evidence of capability.** Since Unit A that is computed rather
than asserted: the verifier prints `CAPABILITY: NOT PROVEN` beside every PASS, and
`--require-capability` is the flag that enforces it once Unit F gives it something to find.

## 6. Depends on

`CLI-006` (the canary seam), `CLI-007` (the credential path), and the frozen contracts in
`packages/worker-protocol` — which Unit B must work **within**, not around.
