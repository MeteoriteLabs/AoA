# E5 Workspaces, artifacts, secrets, and network policy — decisions

Epic-local decisions. Product-wide decisions are promoted to
`docs/architecture/decisions.md` and linked here.

**Created 2026-09-21 as a shell (M1 Step 0, S0-3).** The E5 implementation plan says epic-local
decisions belong in `decisions.md`, "which **does not exist yet**", and `DAT-009-3c` must record its
supervisor↔runtime connection here as **E5-D07** before it builds. No decision is recorded here yet.

**Reserved, not recorded:** `E5-D07` — the supervisor↔runtime connection for the export hook, owned
by `DAT-009-3c` (see that task in `implementation-plan.md` §4). Until that commit lands, nothing in
this file binds anything. The shared decisions `E5-D01`…`E5-D06` remain where they are, in the
implementation plan's §0.

★ *Updated 2026-09-21 (`DAT-009-3c`, design step):* `E5-D07` is now recorded below with
**Status: proposed**. It binds nothing until the planning session accepts it, and no hook code is
written before then. The two paragraphs above are kept as the shell's original text.

★ *Updated 2026-09-21 (`DAT-009-3c`, build step):* the planning session **accepted** `E5-D07` with the
rulings recorded under "Rulings of record" at the end of the entry. It now binds.

---

## E5-D07 — The export hook's composition surface, and a failed export is NOT a failed attempt

**Date:** 2026-09-21 · **Ticket:** `DAT-009-3c` · **Status:** accepted (2026-09-21, by the planning
session under founder delegation F2; *was* `proposed` in `8efe322bd`, the design-step commit) ·
**Authority:** decided under founder delegation **F2** (M1 execution plan §2: the founder delegates
every M1 decision to the planning session, which records it with its reason). Proposed by the
`DAT-009-3c` build session; the planning session accepts or amends it. The QA owner stays distinct (F2).

**Measured at:** `docs/replatform-program` tip `28a2dd259`, plus open PR #546 (`WRK-018`, head
`4a56c56e5`), which changes the same lifecycle step. Code is cited by **symbol**; a line is only a hint.

**What this decides:** (a) how the supervisor, which holds the per-run sandbox and effect authority,
reaches the export sequencer, which needs the control-plane client, device key and session that only
the dispatch runtime holds; (b) the E5-D07 question from the plan: is a failed export a failed attempt?

### Measured starting state

- `createArtifactExportSequencer` (`packages/worker-daemon/src/lease/artifact-export.ts`) needs
  `{client, key, session}` **at construction** (`CreateArtifactExportSequencerDeps`) and
  `{handoff, exporter, requests}` **per call**. It has zero production callers. Its only references
  are its definition, the barrel re-export in `packages/worker-daemon/src/index.ts`, and its own test.
- `SupervisorDeps` (`packages/worker-daemon/src/supervisor/supervisor.ts`) has no export dep.
  `resolveExportArtifacts` returns zero hits anywhere in the repository.
- `composeDispatchRuntime` (`packages/worker-daemon/src/lifecycle/dispatch-runtime.ts`) already owns
  `deps.client`, `deps.key` and `session`. It builds `createStagedInputResolver` from exactly those
  three and hands the result to the supervisor as `resolveStagedFiles`. This decision copies that
  exemplar.
- In `runLifecycle`, the batch arm runs `execute` → `emitOp("execute","success")` → a cancel check
  → the `observeRun` block (3b) → the normal `events.terminal({status, exitCode: exec.exitCode, …})`
  → `finishRun` (destroy under effect authority). **16** `events.terminal(` call sites exist today.
  The slice-3 design's Ruling B counted **14** at `31d33a3b0`. The two added since are the SVC-008b
  service arm's terminals, which sit upstream of `execute`. As before, exactly two sites are
  downstream of `emitOp("execute","success")`: cancelled-while-executing and the normal terminal.
- **PR #546 (`WRK-018`)** composes `observeRun: createUsageObserver(...)` in `composeDispatchRuntime`.
  It adds an optional `output: {stdoutTail, runtimeMillis}` to `observeRun`'s input and closes the
  stdout channel as soon as `execute` returns. It does **not** move the `observeRun` block. `usage` is
  still emitted inside that block, before the normal terminal. Nothing below depends on #546 merging
  first: the hook sits after the `observeRun` block whichever shape that block has.

### (a) The composition surface

**1. Two supervisor deps: a construction-time sequencer, and a per-run producer.**

```ts
// supervisor.ts — SupervisorDeps (additive; both optional)
readonly exportArtifacts?: ArtifactExportSequencer;      // = ReturnType<typeof createArtifactExportSequencer>
readonly resolveExportArtifacts?: (input: {
  handoff: LeaseHandoff;
  exec: ExecuteResult;
}) => Promise<readonly ArtifactExportRequest[]>;
readonly exportArtifactsDeadlineMs?: number;             // default 30_000 — see 4
```

- **`exportArtifacts`** is built by the **dispatch runtime** (`3d`) as
  `createArtifactExportSequencer({client: deps.client, key: deps.key, session: () => session.get()})`.
  This is the plan's first option, "a sequencer callback injected into the supervisor at
  construction". The runtime keeps its client, key and session. The supervisor never sees them, and
  the sequencer never sees a sandbox.
- **`resolveExportArtifacts`** is the **producer** (`CLI-012`). It has exactly the signature the plan
  gives both tickets. It returns requests, never bytes.
- **The supervisor supplies the third input, the `exporter`.** It builds it per run and closes it over
  **this run's** `created.sandboxId`, `run.makeCtx` and `run.effect`, reading `run.effect` **at call
  time** because it is reassigned on the networked branch after redemption:
  `digest(path)` → `run.effect.digestArtifact(sandboxId, path, run.makeCtx())` → `{sha256, sizeBytes}`;
  `export(path, grant)` → `run.effect.exportArtifact(sandboxId, path, grant, run.makeCtx())` →
  `{objectKey}`. `EffectAuthority` is the only door, so the fence check stays at the boundary. A
  withdrawn authority throws `EffectAuthorityWithdrawnError` in `#guard()` before the grant reaches any
  provider.
- **Construction rule.** `resolveExportArtifacts` **without** `exportArtifacts` throws at
  `createSupervisor`. A producer with nothing to hand its requests to would silently export nothing on
  every run. This follows the `makeRunProvider` ⟹ `materializeRunSecrets` fail-fast precedent.
  `exportArtifacts` **without** a producer is allowed. It is inert: no call, no metric, and the
  lifecycle is byte-identical to today. This is the state `3d` leaves behind, and it is **not** a
  `[]` stub producer, which E5-D03 forbids.
- **The hook runs only when both deps are present.** When either is absent, it makes no call and emits
  nothing. That is the plan's anti-vacuity control.

**2. Placement: one site, inside the §3.1 window.** On the batch arm only, **after** the `observeRun`
block (3b) and **before** the normal `events.terminal(...)` and `finishRun`:
- **After `execute`.** No file exists earlier.
- **After `observeRun`.** Usage is already in the durable outbox when export starts, so a slow,
  failing or timed-out export can never delay or drop the pricing evidence that `JOB-016` reads.
  This matches #546's shape, and it keeps `JOB-016`'s premise ("usage arrives just before
  `terminal`") true in the order that matters: usage still comes before terminal.
- **Before `events.terminal`.** An upload grant and a commit both need a **live** fence:
  `lockActiveFence`, and `classifyFence` → `attempt_terminal`. After the local emit, the export would
  **race the outbox drain** (slice-3 design §3.1).
- **Before `finishRun`.** `exportArtifact` reads from a live sandbox.
- **Ruling B carried forward, re-counted.** Only the normal terminal exports. Cancelled-while-executing
  does not, because the fence is most likely already gone. The service arm does not: it has no
  `ExecuteResult`, and SVC is not in M1. Neither do the 12 upstream sites.
- If `run.effect.isActive()` is already false when the window opens (a cancel or lease loss during
  `observeRun`), the producer is **not called**. The window records `failed` (reason
  `authority_withdrawn`, see 5) and continues.

**3. What the hook deliberately does not receive.** It does not receive #546's `output`. The stdout
tail is bytes held by the daemon, and this sequencer exports in-sandbox paths only. If F7 rules for a
"captured transcript" mechanism, that is a different path, and it must not be routed through this
hook. `CLI-012`'s enumeration needs a **fenced** view of this run's sandbox, and 3c does **not**
pre-build one. Declaring an empty interface now would be a placeholder that nothing checks. See
**Plan corrections** below.

**4. Deadline: one budget, and it never eats the teardown headroom.** The producer and every file's
digest→grant→export→commit share **one** budget, `exportArtifactsDeadlineMs` (default **30 s**).
They are raced with the existing `withDeadline`, which is the `stageInputDeadlineMs` shape:
"subtracted, not added". On the **networked** branch, the budget is further clamped to
`run.capExpiresAt − now() − 30 s`, so destroy keeps at least 30 s of the 60 s
`RUN_TEARDOWN_HEADROOM_MS` inside the capability window (`run-op-deadline.ts`). Without the clamp, an
export after a near-budget `execute` could push `finishRun` past the capability's expiry. The run
would then be recorded `orphaned`, and a billable sandbox would be left to the server reaper. If the
clamped budget is ≤ 0, the window is not opened (`failed`, reason `export_window_exhausted`).
**Known limit, not fixed here:** the E2B sandbox TTL is `ctx.deadlineMs`, set at `create`. After an
`execute` that ran to its own budget, the sandbox may already be gone. The digest then fails, and per
(b) that is best-effort.

**5. Closing the window, metrics and logs.**
- **Window latch.** When the deadline fires, the supervisor-built `exporter` is closed. A later
  `digest`/`export` call from the abandoned sequencer promise throws synchronously and never reaches
  `run.effect`. **Named residual:** a commit HTTP call already in flight, for an object already
  uploaded, can still land before the terminal drains. That row is real, fenced and attempt-scoped,
  so it is correct evidence reported late, never evidence fabricated.
  ★ *Refined 2026-09-21 (Codex review of PR #549, verified at source):* the latch is **also
  re-checked after each awaited provider call**. Before this, a `digest` or `export` that was
  already in flight when the deadline fired would return normally, and the abandoned sequencer would
  go on to mint a grant or commit. Now a late digest mints nothing, and a late upload is never
  committed: the uncommitted object is left to the orphan sweep (`isSweepEligible`). The residual
  narrows to a commit **already in flight** when the window closes.
- **Metrics: closed labels only, no new label.** `digest_artifact` is emitted once per provider
  digest call by the exporter adapter (`success`/`failed`). `export_artifact` is emitted **exactly
  once per window**, carrying the window's outcome: `success`, `failed` (any refusal or throw: the
  producer, digest, grant, export or commit), or `timed_out` (the deadline won). `timed_out` is
  already a registered outcome and matches `execute`/`stage_files`. ★ **This departs from the plan
  text**, which says a deadline "emits `failed`". The departure is proposed so that "the store is
  slow" and "a refusal" stay distinguishable. The planning session may keep `failed`.
- **Logs never carry a path, a `grant.url` or bytes.** ★ `ArtifactExportFailedError.message`
  **embeds the path** (`` `artifact export failed at ${stage} for ${path}: ${detail}` ``), so the hook
  must **not** log the error object or its message, which is what `observeRun`'s catch does. It logs
  `{leaseId, stage, reason}` only. That needs the reason as a field, which today exists only inside
  the message. So 3c adds a `reason` field to `ArtifactExportFailedError` (additive; see **Plan
  corrections**). The reason must survive by name. `attempt_terminal` / `stale_fence` /
  `target_revoked` are what make (b) safe (slice-3 design, Ruling A obligation 2).

**6. Multi-tenant (F10): the hook is attempt-bound, and its identity comes from the lease.**
- **One handoff per window.** The supervisor passes the `handoff` object it is running, the one
  `accept` received for this lease. It never looks a run up by id, and it never uses a
  supervisor-level "current run". Every tenant identity the sequencer writes derives from that
  handoff: `organizationId`, `companyId`, `jobId`, `attempt`, `leaseId`, `fenceToken`, the object-key
  prefix `expectedAttemptObjectPrefix({organizationId, jobId, attempt})`, and the
  `exportArtifactId(jobId, attempt, path)`. Neither the producer nor the tenant command supplies any
  of them. A request carries only `{path, kind, contentType, retention}`.
- **One sandbox per window.** The exporter is closed over this run's `created.sandboxId` and this
  run's `run.effect`, whose `EffectFence` was built from the same handoff in `buildRun`. The producer
  cannot name a sandbox. A path is resolved inside this run's sandbox only.
- **The server re-binds, so the worker is not trusted to.** The mint and the commit both run
  `resolveWorkerFenceContext` (`server/src/services/worker-fence-context.ts`), which finds the lease
  **by the presented fence tuple under the authenticated authority**. The mint then
  `lockActiveFence`s it (`artifact-transfer-grant.ts`). The commit checks `tenantValid` against the
  auth organization **and** the locked lease's company (`artifact-commit.ts`). A handoff for
  Organization B presented under Organization A's authority is refused `stale_fence` before storage
  is touched.
- **3c's cross-tenant test obligation.** Two concurrent runs (Organizations A and B) run in one
  supervisor, each with its own hook. Each sequencer call receives its own handoff, and its exporter
  reaches only its own `sandboxId`. Same-tenant positive control: A's file exports under A's prefix.
  Mutant: bind the exporter to a supervisor-scoped "last created sandbox". It must go red.

### (b) E5-D07: is a failed export a failed attempt? **No. Export is best-effort.**

**Recommended answer.** A refused, thrown or timed-out export window **logs, emits
`export_artifact` `failed`/`timed_out`, and continues to the truthful terminal**. The terminal's
`status`/`exitCode`/`errorCode` are computed from `exec` exactly as today, and the attempt is **not**
failed. This adopts, and makes binding, the slice-3 design's **Ruling A** (2026-09-06). That ruling was
an implementer-level default. This makes it the epic decision the plan requires.

**Reasons (re-verified at this tip):**
1. **The terminal is a fact about the tenant command, and fail-closed would make it false.** The
   status is `exec.exitCode === 0 && !exec.timedOut ? "succeeded" : "failed"`, computed immediately
   before the normal `events.terminal`. A fail-closed export would report an agent `failed` on a run
   whose command exited 0, because storage refused. Staging is the opposite case. It fails closed
   because a run without its input produces a clean terminal for mutilated work
   (`SupervisorDeps.resolveStagedFiles`'s ★ FAIL CLOSED docstring).
2. **The likeliest refusals are lifecycle-window placement errors, not work failures.**
   `attempt_terminal` / `stale_fence` / `target_revoked` are carried by name by the sequencer's
   `rejected`-first branch. Failing the attempt would turn each of the hook's own timing bugs into a
   false red run.
3. **Fail-closed buys nothing at the margin.** An S3-compatible store is already a hard precondition:
   `artifact-commit.ts` refuses when the store cannot supply a checksum ("integrity unverifiable →
   fail closed"). A systemic outage fails every run's evidence either way.
4. **The consumer already assumes it.** `CLI-012`'s task says "a capture throw is best-effort per
   E5-D07: log, `emitOp failed`, truthful terminal, attempt NOT failed". The `CLI-011` review's attack
   **A-O2-6** and its §9.3 row say the same ("the attempt is **not** failed, because the work is done
   and only its evidence is partial"). Ruling the other way would silently invalidate a reviewed
   design two tickets downstream.

**The cost, recorded rather than glossed.** Evidence can be missing from a run that terminalized
`succeeded`. It is never hidden. The obligations: the window **always** emits one `export_artifact`
outcome. The reason survives by name in the log (5). 3c carries **the fail-closed mutant**: make a
refusal fail the attempt, and a test must go red. It also carries the converse: a run whose terminal
is unchanged by a refusal. The verdict that missing evidence should move is **clause 6**, the judge
(`CLI-015`), not the attempt's terminal status.

**What E5-D07 does NOT settle (a separate question, found while measuring).** The **attempt** verdict
is not the same question as the **per-file** policy. The sequencer as built **stops at the first
failing file** ("Fails per-file and does NOT continue: a caller cannot tell which of a partial set is
missing", `createArtifactExportSequencer`'s docstring). The `CLI-011` review expects the opposite:
"one file's refusal never drops the others, and every refusal is classified" (§9.3 row, A-O2-6,
SD-6). The two conflict. Resolving it changes the sequencer's **return contract**, from all-or-throw
to per-file outcomes. `CLI-012` owns SD-6 and the refusal classes, so the recommendation is that
**`CLI-012` owns the change**, gated on F7. 3c builds against the sequencer as it is today, where
first-failure aborts the window and the window reports `failed`. **This needs the planning session's
ruling before `CLI-012` is assigned.**

### Plan corrections this surfaces (for the planning session; not applied here)

1. **`DAT-009-3c` file list:** add `packages/worker-daemon/src/lease/artifact-export.ts`, for the
   additive `reason` field on `ArtifactExportFailedError` (5). The 3c RED list gains the fail-closed
   mutant, the cross-tenant pair (6), the networked clamp (4), and the window latch (5).
2. **`DAT-009-3d`:** its RED "`composeDispatchRuntime` passes `resolveExportArtifacts`" becomes
   "passes `exportArtifacts` (the sequencer)". The producer arrives with `CLI-012`. `3d`'s `wired`
   promotion of `E5-2` then means **constructed at the boot root and invoked on no run until
   `CLI-012`**, which is weaker than `E7-1-staged-input-write` (that resolver runs every run and
   returns `[]`). The `3d` result must say so in its own words.
3. **`CLI-012` file list:** its enumeration must be **fenced**, so it goes through `EffectAuthority`
   (`effect-authority.ts`). It also reaches the producer only if the supervisor passes a per-run view
   bound to this run's sandbox (`supervisor.ts`: an additive field on `resolveExportArtifacts`'s
   input). Neither file is in `CLI-012`'s list today. Without them, the producer has no fenced way to
   see the sandbox it enumerates.
4. **Per-file policy** (above): a ruling is owed before `CLI-012`.

### Rulings of record (2026-09-21, planning session, under founder delegation F2)

The proposal above is kept as written. Where a ruling changes or settles it, **the ruling governs**.

1. **(a) The wiring is accepted as designed**: `exportArtifacts` is injected at construction, a
   producer without a sequencer throws at construction, the window fires only before the normal
   terminal and after `observeRun`, there is one 30 s deadline, clamped on the networked lane so
   destroy keeps 30 s, and every export is bound to its own attempt, with the cross-tenant test and
   mutant specified in 6.
2. **(b) E5-D07 is accepted**: a failed export does **not** fail the attempt. It logs, emits a
   metric, and the terminal reports the command's true result.
3. **Plan correction 1 (the path-free reason) is accepted.** `ArtifactExportFailedError` gains a
   non-path `reason` field. `DAT-009-3c`'s Files add `artifact-export.ts`. The path is never logged.
4. **Plan correction 2 is ruled DIFFERENTLY from the proposal: `DAT-009-3d` does NOT promote `E5-2`
   to `wired`.** "Built at boot, run by nothing" is the vacuous-claim class this programme forbids.
   `E5-2` is promoted when a **production producer drives it**, which is `CLI-012`. The `3d` task
   text is amended to say so, with its history kept.
5. **Plan correction 3 is accepted.** `CLI-012`'s Files in the E7 plan add `effect-authority.ts` and
   `supervisor.ts`.
6. **`timed_out` versus `failed` for the deadline: `timed_out` is used.** The ruling allowed
   `timed_out` **only if** it adds no value to a status vocabulary inside the frozen
   `@armyofagents/worker-protocol` v1. Measured:
   - `emitOp` labels are validated by the **worker-daemon's own** closed allow-list:
     `SANDBOX_OP_METRIC`'s `outcome` set in `packages/worker-daemon/src/metrics/metrics.ts`.
     `timed_out` has been a member since WRK-004, used by `execute` and `stage_files`.
   - `grep -rn "timed_out" packages/worker-protocol/src` returns **no hits**, so the frozen package
     has no such vocabulary member to add to or change.
   - `pnpm check:frozen-worker-protocol-v1` passes on the build commit.

   So `timed_out` adds nothing to the frozen protocol, and it keeps "the store is slow" distinguishable
   from "a refusal" on the same metric. The log also carries `reason: "deadline"`.
7. **Per-file policy: `CLI-012` owns it, gated on ruling F7.** `DAT-009-3c` builds against the
   sequencer as it is today. The first failing file aborts the window, and the window reports `failed`
   with that file's `stage` and `reason`.
8. **Points 1 and 6 of the design report are noted in the `3c` result, not here.** Point 1: the E5
   `decisions.md` already existed when the M1 plan said it did not. Point 6: there are 16 terminal
   call sites, not 14.

### Rollback

Leave `resolveExportArtifacts` unset at composition. The hook then never runs, and the lifecycle is
byte-identical. Removing `exportArtifacts` too returns the sequencer to zero production callers.

---

## E5-D08 - audit rule R2 is satisfied by ATTESTATION plus a blob pin, not by presence in the candidate's tree

**Status:** `accepted` - **Decided:** 2026-09-24 by the M1 planning session as decision owner, under
founder ruling **F2** (the founder owns every role and delegates every M1 decision to the planning
session, with the QA owner staying a distinct session).

**Raised by** the `a2` QA owner in `qa/2026-09-24-d0-e5-exit-gate-audit-7be35ae6b771-a2.md` SS5.1,
which recorded R2 `FAILED` and handed the question up rather than reinterpreting a frozen rule to
reach a pass. That was the correct handling and this decision exists because of it.

### The defect

R2 as frozen (`audit-matrix/2026-09-21-e5-seven-clause-matrix.md`, *"R2: exact candidate"*) reads:
*"Every grade rests on a committed record or a CI job **on the attested candidate**, cited by path or
by job."* The `a2` owner read *"on the attested candidate"* as requiring
`git show <candidate>:<record path>` to resolve - the record must exist **inside the candidate's
tree**. Under that reading R2 is **unsatisfiable by construction**: a campaign record is written
*after* its candidate is frozen, so no attempt, ever, could cite one. A rule no attempt can satisfy
is not a bar; it is a permanent fail that teaches nothing.

### The ruling

R2 is **clarified, not weakened**. It is satisfied when either:

- **a CI job ran ON the attested candidate**, cited by run and job id; or
- **a committed record ATTESTS the attested candidate** - it names that candidate as its subject -
  and is cited by **path AND blob SHA** (`git hash-object`), so the exact bytes relied upon are
  pinned.

The blob pin is what *"in the candidate's tree"* was reaching for, and it is **stricter**: a tree
path fixes only which file, while a blob SHA fixes the bytes. It is also the mechanism the milestone
folder already uses - `milestones/M1a/README.md`: *"The candidate-freeze record pins their blob
SHAs, so the version that was relied on is fixed by the record that relies on it."*

R2's actual intent is unchanged and still binding: **no grade may rest on evidence from another
candidate or be carried forward from `a1`.**

### This ruling does NOT change the `a2` verdict, and that is the point

`a2` is immutable and stays `Result: fail`. It failed **R2, R4 and R5**, and the clarification
touches only R2 - clauses 4 and 5 still miss their `M1a` floor and all nine `d2m.tenant.cross.*`
cases are still `pending`. **`M1a` exit criterion 7 remains unmet on candidate `7be35ae6b771`.**

That is stated plainly because the decision owner here is also the session whose campaign the audit
judged, and a clarification issued in that position is worth only as much as its independence from
the outcome. This one changes no verdict. It applies from `a3` onward.

## E5-D09 - audit attempt numbers track corrections; floors track the named milestone

**Status:** `accepted` - **Decided:** 2026-09-26 by the M1 planning session under founder delegation F2.

The frozen matrix assigns M1a to a2 and M1b to a3 onward. EVID-02 requires corrections to use the
next attempt number, so a failed M1a audit cannot be corrected without this allocation selecting
M1b prematurely. PR #616's review correctly found that a3 had no ruling authorizing its choice.

From the next audit onward, the attempt ordinal identifies the immutable sequence only. The audit
must explicitly name M1a or M1b and apply that milestone's unchanged floors and campaign set. M1a
requires spine and mechanism; M1b requires those plus coding, all on its candidate. Supersedes must
link the highest prior attempt regardless of milestone. This recorded amendment changes the
allocation references in the frozen topology table and R4 without editing the frozen file.

This ruling grants no retroactive pass to a3. Candidate identity, the clause-5 unseeded control,
and separate author/certifier ownership remain binding. A successor audit must independently meet
them before a milestone handoff can pass.
