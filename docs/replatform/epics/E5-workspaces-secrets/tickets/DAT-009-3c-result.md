# DAT-009-3c Result — the supervisor export-artifacts hook

**Status:** `gate_review`
**Date (UTC):** `2026-09-21`
**Epic:** `E5-workspaces-secrets`
**Plan task:** `E5 implementation-plan DAT-009-3c — the supervisor export hook (M, M1b)`
**Decision:** [`decisions.md`](../decisions.md) **E5-D07**, `accepted` (planning session, founder delegation F2)
**Implementer:** `DAT-009-3c build session (Claude Opus 5)`
**Start SHA:** `28a2dd259` (`docs/replatform-program` tip)
**Reviewed revision (the code commit):** `79961c97c46dda930c7f7ceda6c6ee6175fead6a`

The implementer leaves `Status` at `gate_review`. Only a distinct reviewer may change it to
`complete`.

## 1. What was built

- **`SupervisorDeps.exportArtifacts`**: the sequencer, of type `ArtifactExportSequencer`. It is
  injected at construction, and the dispatch runtime builds it in `3d`. **`resolveExportArtifacts`**
  is the producer (`CLI-012`). **`exportArtifactsDeadlineMs`** is the budget, default 30 s.
- **Construction rule:** a producer without a sequencer throws in `createSupervisor`. A sequencer
  without a producer is inert.
- **`runExportWindow`** (`supervisor.ts`) runs one window per run.
  - **Placement:** batch arm only, after the `observeRun` block and before the normal
    `events.terminal` and `finishRun`.
  - **Budget:** one budget covers the producer and every file. On the networked lane it is clamped to
    `capExpiresAt − now − EXPORT_TEARDOWN_RESERVE_MS` (30 s, `run-op-deadline.ts`). If the clamped
    budget is ≤ 0, the window is not opened (`export_window_exhausted`). If the authority is already
    withdrawn, the producer is not called (`authority_withdrawn`).
  - **Per-run exporter:** closed over this run's `sandboxId`, and it reads `run.effect` **at call
    time**, so withdrawal refuses inside `EffectAuthority`.
  - **Window latch:** closes the exporter when the window ends.
  - **Metrics:** `digest_artifact` is emitted per digest call. `export_artifact` is emitted
    **exactly once per window** (`success` / `failed` / `timed_out`).
  - **Logs** carry `{leaseId, resourceLabelsHash, stage, reason, exported}` only. They never include
    the error, its message, a path, the grant URL or bytes.
- **`ArtifactExportFailedError.reason`** (`artifact-export.ts`): a path-free snake_case code. It is
  the server's own refusal code (`attempt_terminal`, `stale_fence`, …) or a fixed local code
  (`digest_failed`, `http_<n>`, `malformed_grant`, …). Anything else becomes `unknown`
  (`exportReasonCode`).
- **`ArtifactExportSequencer` is declared as its own function type**, not
  `ReturnType<typeof createArtifactExportSequencer>`. **Positive control observed:** with the
  `ReturnType` form, `check-gate-clause-wiring` went **red** ("`E5-2` … has 1 reference(s), expected
  0"). Naming the type counted as a reference to the constructor, which would have been a false
  "caller". `E5-2` stays `unwired`, and `createArtifactExportSequencer` still has zero production
  callers.
- **Ruling 6 (`timed_out`):** `emitOp` labels are the worker-daemon's own `SANDBOX_OP_METRIC` allow-list
  (`metrics.ts`), where `timed_out` already exists. `packages/worker-protocol/src` has no `timed_out`.
  `pnpm check:frozen-worker-protocol-v1` → `frozen worker-protocol v1 consumer: OK`.

## 2. RED → GREEN

**RED** (test file written before any source change), run with
`npx vitest run src/__tests__/supervisor-export-artifacts.test.ts`: **14 failed | 5 passed (19)**.
- The 14 red cases include placement, the real sequencer end to end, the construction throw, both
  best-effort cases, the deadline, both withdrawn-authority cases, the path-free reason, the F10
  cross-tenant case and all three networked cases.
- **The 5 cases green at RED are controls, green by construction before the hook existed:**
  hook-absent, sequencer-without-producer, Ruling B cancelled-while-executing, failed-command
  terminal, and no-path. Mutants in §3 prove four of them non-vacuous: M1 (failed-command terminal,
  no-path), M3 (sequencer-without-producer), M6 (no-path) and M12 (Ruling B). Hook-absent pins
  byte-identity when neither dep is set, and no mutant targets it.

**GREEN** at `79961c97c`:
- The task's verify command (the protocol build, then `vitest run` on
  `supervisor-export-artifacts` + `artifact-export-sequencer` + `supervisor-happy.component`) gives
  **3 files, 50 passed**.
- The full worker-daemon suite gives **159 files, 1068 passed, 1 skipped**. The worker-daemon typecheck
  and build exit 0.
- `check-worker-daemon-boundary` gives PASS, and `check:frozen-worker-protocol-v1` gives OK.
- The full `pr.yml` guard set plus `check-evidence-immutability`: **0 failures**.

## 3. Mutation table (each applied alone, test file rerun, source restored)

| # | Mutant | Result | Killed by |
|---|---|---|---|
| M1 | fail-closed: a refusal re-throws out of the window | 4 red | sequencer refusal, producer throw, failed-command terminal, no-path |
| M2 | the window runs **after** the terminal | 1 red | placement (before terminal) |
| M3 | the sequencer runs with no producer (a `[]` stub) | 1 red | sequencer-without-producer inert |
| M4 | no `withDeadline` race | 2 red | both deadline-value cases |
| M5 | no window latch | 1 red | deadline + latch |
| M6 | the error message is logged | 2 red | reason-by-name, no-path |
| M7 | the exporter is bound to the last-created sandbox | 1 red | **F10 two-Organization case** |
| M8 | no networked clamp | 2 red | clamp value, window-exhausted |
| M9 | `exportArtifact` bypasses `EffectAuthority` | 1 red | lease lost mid-window |
| M10 | `reason` = free text | 2 red | reason-by-name, path-free reason |
| M11 | no withdrawn-at-open check | 1 red | authority withdrawn at open |
| M12 | cancelled-while-executing also opens the window | 1 red | Ruling B (only the normal terminal exports) |

**12 of 12 killed.** ★ M12 first **survived** (19/19 green). The Ruling B case asserted only that the
producer was not called, and a window opened after a cancel refuses at the withdrawn-authority check
without calling the producer. The case now also asserts that **no** `export_artifact` outcome is
emitted, and M12 goes red. This is recorded because a case that survives its own mutant was a check
that evaluated nothing.

## 4. Multi-tenant (F10)

The two-Organization case runs Organizations A and B concurrently in one supervisor. Both windows are
held until both sandboxes exist.
- Each exporter's `digestArtifact` and `exportArtifact` reach only **its own** `sandboxId`.
- Each grant's `expectedObjectKey` carries its own `organizations/<org>/jobs/<job>/` prefix.
- Each commit manifest carries its own `organizationId`, keyed by its own `leaseId`.
- **Same-tenant positive control:** A's export succeeds under A's prefix.
- **Mutant M7** (a supervisor-scoped "last created sandbox") goes red.

## 5. Findings and plan deltas

1. **The M1 plan (§1.2) says the E5 `decisions.md` "does not exist".** It existed at the start SHA,
   created as a shell in S0-3.
2. **Ruling B's terminal count is stale:** there are **16** `events.terminal(` call sites, not the 14
   counted at `31d33a3b0`. The two new ones are the SVC-008b service arm's, upstream of `execute`.
   Only two sites are downstream of `emitOp("execute","success")`, as before.
3. **The 3c plan's "hook throwing/timing out emits `failed`" is superseded** for the deadline case by
   ruling 6 (`timed_out`).
4. **Not built here, by ruling:**
   - the composition (`3d`);
   - the producer and its fenced enumeration (`CLI-012`);
   - the per-file policy (`CLI-012`, gated on F7);
   - the `E5-2` promotion (`CLI-012`, ruling 4).

## 6. CI

To be filled in on the final head: `ci-required`, with the `verify` shard that executed
`supervisor-export-artifacts.test.ts` and its executed test count.

## 7. Reviewer section

*(Distinct reviewer only.)*
