# E7 Coding/CLI on E2B — decisions

Epic-local decisions. Product-wide decisions are promoted to
`docs/architecture/decisions.md` and linked here.

**Created 2026-09-21 as a shell (M1 Step 0, S0-3).** The M1 execution plan
(`docs/replatform/qa/2026-09-21-m1-execution-plan.md` §2, F2) has the planning session record each M1
decision it takes, with its reason, in the E-epic `decisions.md`; this epic had none. No decision is
recorded here yet. ★ *Superseded 2026-09-21 by the first entry, `E7-D09` below; the sentence above is
kept as written when the shell was created.*

**Expected entries, not recorded:** the `CLI-013` event-contiguity decision. The shared decisions
`E7-D01`…`E7-D07` remain where they are, in the implementation plan's §0. Until an entry lands,
nothing in this file binds anything.
★ *Corrected 2026-09-23 (ruling F7 recorded as `E7-D11` below). Superseded text: "the `CLI-011`
output-mechanism ruling (**F7**, still open), and the `CLI-013` event-contiguity decision."*

★ `E7-D08` is **reserved**, not recorded: the implementation plan's `CLI-012` task assigns that id to
the `kind` decision (`implementation-plan.md`, `### CLI-012`), so the first entry here takes `E7-D09`.
★ *Superseded 2026-09-23: `E7-D08` is now RECORDED, below, by the ticket it was reserved for. The
sentence above is kept as written.*

---

## E7-D08 — the exported artifact's `kind` is **`other`**, NOT `workspace_patch`: `CLI-012` does not move a counter it did not earn

**Date (UTC):** 2026-09-23
**Status:** `locked` — decided by `CLI-012`, whose task section assigns this decision to it
(`implementation-plan.md`, `### CLI-012`) and requires it to state which it chose and why.
**Owner role:** `CLI-012` (build) · **Affected:** `CLI-015` (the judge), `E7-1` arm 1
**Decided on:** source, read at this tip — `countProducedOutputs`
(`server/src/services/e7-distributed-run-verifier-store.ts`) and the frozen `ARTIFACT_KINDS`
(`packages/worker-protocol/src/artifacts.ts`).

### Decision

The production composition (`composeDispatchRuntime`,
`packages/worker-daemon/src/lifecycle/dispatch-runtime.ts`) declares **`kind: "other"`** and
**`retention: "run"`** on every export request the producer mints from the ruled output root.

### Reason

The task states the trade in terms, and it is a trade between two defensible products:

- **`workspace_patch`** is what `countProducedOutputs` **arm 1** filters on. Choosing it would make
  the E7-1 QUALIFYING ARTIFACT counter move the first time a run writes a file under
  `/home/user/aoa-output`.
- **`other`** produces a real, attributable, `committed` `job_artifacts` row that arm 1 does **not**
  count.

★★★ **`other` is chosen because the file IS NOT A WORKSPACE PATCH, and because the task forbids
picking the one that makes a number go up.** A file the agent wrote under a conventional output
root is a deliverable; `workspace_patch` means the Unit-E workspace diff, which is **XL and out of
`M1b`** (`E7-D05`). Declaring an agent-written markdown file a workspace patch would make arm 1
report a capability nobody built — the `E7-F020` class the whole counter exists to refuse — and the
`kind` conjunct is the ONLY thing arm 1's precision rests on, because `stageJobInputFiles` commits
FENCELESS `job_artifacts` rows on the same job and attempt.

★ **Nothing is lost by it.** Per `E7-D11` (*What this ruling does NOT decide*) and the review's
`SD-3`, the judge counts through **arm 2** (predicate **P-A**, the receipt-backed `taskOutputs`
path), which is unchanged — so this decision does not decide what `CLI-015` counts. Moving arm 1 is
link 6's decision to take deliberately, on evidence, not a side effect of link 3's default.

★ **`retention: "run"`** is declared honestly and is **ignored** by the control plane, which derives
retention from `kind` (`artifact-commit.ts`, DAT-010). It is sent rather than hard-coded so a
disagreement surfaces as the server's own warning instead of silently.

### Alternatives considered

- **`workspace_patch`.** Rejected above: it is a false description AND it moves a counter.
- **A new frozen kind.** Rejected: `ARTIFACT_KINDS` is frozen (`@armyofagents/worker-protocol`) and
  adding a member is an `E4-D02` STOP. `other` exists for exactly this.
- **Leaving the kind to the caller with no default.** It already is the caller's: the producer takes
  `kind` as a required dep and the sequencer never substitutes one. This entry records what the
  PRODUCTION composition declares, which is the thing an operator sees.

### Consequences

- `CLI-012`'s exports are attributable and `committed` but are **not counted by arm 1**, and the
  ticket says so rather than reporting a moved number.
- `packages/worker-daemon/src/__tests__/dispatch-runtime-export-composition.test.ts` asserts
  `manifest.kind === "other"` **at the commit**, so a silent change of it reds at the production
  composition and not only at the producer's unit.

---

## E7-D09 — `E2bTransport.listDir` is FILES ONLY, recursive, absolute and bounded; `CLI-010` is widened to fix the seam

**Date (UTC):** 2026-09-21
**Status:** `locked` — **decided under founder delegation F2** (`docs/replatform/qa/2026-09-21-m1-execution-plan.md` §2,
F2: the founder delegates every M1 decision to the planning session, which records each with its reason).
QA independence still holds: this decision's ticket is approved by a distinct reviewer, not by the
session that decided it.
**Owner role:** planning session (decision owner, under F2)
**Affected tickets:** `CLI-010` (widened), `CLI-012` (consumes the seam; owns the live proof)

### Context

`CLI-010`'s task section (E7 `implementation-plan.md`, `### CLI-010`, Outcome 1) and the
`E2bTransport.listDir` interface comment (`packages/sandbox-e2b-provider/src/transport.ts`) both said
the E2B `listDir` returns **absolute file paths, not directories**. Measured at source by the `CLI-010`
build agent, that was true of the mock only:

- `RealE2bTransport.listDir` (`packages/sandbox-e2b-provider/src/real-transport.ts`) called
  `sandbox.files.list(path)` with no options and kept only `e.path ?? e.name`, **discarding each
  entry's `type`**.
- The installed `e2b@2.30.5` `Filesystem.list` (`dist/index.js`, class `Filesystem2`, method `list`)
  defaults `depth` to `1` and returns files **and** directories as `EntryInfo` with a
  `type` of `"file"`/`"dir"` (`mapEntryInfo`, `mapFileType`).
- So the real binding returned the root's immediate children, directories mixed in, and never a nested
  file. `MockE2bTransport.listDir` returned files only, recursively — every existing `listDir` test ran
  against a mock or an in-memory fake, so the divergence was never exercised.

The build agent stopped and reported it rather than pin the mock's behaviour.

### Decision

**Option 1: widen `CLI-010` to fix the seam.** The contract is: `E2bTransport.listDir` returns
**files only, recursively, as absolute paths strictly under the given root**, sorted. It is
**bounded** — `E2B_LIST_DIR_MAX_ENTRIES` and `E2B_LIST_DIR_MAX_DEPTH`, named constants in
`transport.ts` — and a breach throws the named `E2bListDirBoundExceededError`; an entry that cannot be
classified or does not sit under the root throws `E2bListDirMalformedEntryError`. **It never
returns a silently truncated list.** The real binding requests typed entries through the SDK's `depth`
option; the mock and the real binding share one enforcer (`list-dir-contract.ts`,
`filesOnlyFromListing`).

Reasons, as given by the planning session:

1. `CLI-010`'s purpose is to prove this exact seam, and `CLI-012` builds on it.
2. The real `listDir` discards each entry's `type`, so it can never tell a directory from a file,
   whatever the SDK's defaults are.
3. `snapshot/capture-sandbox.ts` is the **only** production caller of `listDir`, and this ticket fences
   it to the local lane. So changing the real-transport contract has no other production consumer.

### Alternatives considered

- **Option 2 — shrink `CLI-010`** to the fence plus a characterisation test of the real behaviour, and
  move typed/recursive enumeration to `CLI-012`. Rejected: it would leave the ticket whose job is to
  prove the seam proving a seam that does not exist, and hand `CLI-012` a known-wrong transport.
- **Pin the mock's behaviour as the contract without touching the real binding.** Rejected: it is
  exactly the silent mis-enumeration (a directory treated as a file, nested files lost) the ticket
  exists to prevent.
- **Truncate at a bound instead of throwing.** Rejected: a silently shortened list is the output-loss
  class this programme is fixing.

### Consequences

- The live-sandbox behaviour is **still unproven**: what a real envd returns for `depth > 1`, and for
  entry kinds the SDK itself skips before they reach the binding (`Filesystem.list` drops any entry
  whose wire type maps to neither `file` nor `dir`), is proven only by a keyed run. That is `CLI-012`'s
  real-run acceptance, and nothing here claims it.
- `server/src/services/sandbox-coding-staging.ts` declares `listDir` on `FileStagingTransport` but has no
  production call site; its only exercise is test code over `MockE2bTransport`, whose recursive
  files-only behaviour is unchanged except that the listed root itself is no longer returned.

---

## Amendment to E7-D06 — `WRK-018`'s stdout/usage stream is instrumentation, not an output-capture path

**Date (UTC):** 2026-09-21
**Status:** `locked` — **decided under founder delegation F2** (`docs/replatform/qa/2026-09-21-m1-execution-plan.md` §2,
F2: the founder delegates every M1 decision to the planning session, which records each with its reason).
QA independence still holds: a distinct reviewer approves this, not the session that decided it.
**Owner role:** planning session (decision owner, under F2)
**Amends:** `E7-D06`, which stays where it is (E7 `implementation-plan.md` §0). No new decision id is
minted; this is a dated amendment to an existing one.
**Affected tickets:** `WRK-018` (E4), `CLI-011` (the F7 output-mechanism review)

### Context

`E7-D06` reads, in the implementation plan's §0: *"Grants inbound, references outbound, never
bytes."* The provider reads the file inside its sandbox and PUTs it directly to object storage
under a worker-minted grant (Option D of `DECISION-byte-egress-and-provider-topology.md`). The
plan's runtime rule restates it: *"The control plane carries grants and references. No payload
crosses the dependency-pinned daemon."*

`WRK-018` (E4 `implementation-plan.md`, `### WRK-018`) adds an optional stdout/usage stream channel
on the provider port. It is carried through the E2B provider (`onStdout`) and through
provider-wire/adapter-manager, with *"every chunk redacted by the per-run canaries before it leaves
the worker"*. Read literally, that is stdout bytes crossing the daemon, which the runtime rule's
"no payload" wording does not allow for. `CLI-011-review.md` §3.8 and §13 item 6 record the gap. They
also warn that unless it is closed, option 4's "just persist the stream" reads as licensed by
`WRK-018`, and it is not (review §7.1).

### Decision

1. **`WRK-018`'s stdout/usage stream is instrumentation.** It exists to derive usage (`UsagePayloadV1`
   from the `stream-json` result line) and logs. `WRK-018` requires every chunk to be redacted by the
   per-run canaries before it leaves the worker, fail-closed (its Outcome and acceptance 2; the
   canaries come from `synthesiseRunSecrets` and are held by `createRunCanaryCoordinator`). It is
   **not** an output-capture path, and a run's deliverable is never taken from it. `WRK-018` is not
   yet built; this amendment binds it as specified.
2. **`E7-D06`'s intent stands unchanged.** The daemon never reads, hashes or relays artifact
   **bytes**. Artifact bytes leave the sandbox only by the provider's direct PUT under a
   worker-minted grant. The control plane carries grants and references for artifacts.
3. **Read the runtime rule "No payload crosses the dependency-pinned daemon" as "no artifact
   payload"**. Redacted stdout instrumentation under `WRK-018` is the one named, bounded exception.

### Reasons

- `WRK-018`'s own non-goals already exclude it from output capture: *"shipping transcripts as
  artifacts (the `CLI-011` review prices the channel as an **input**, not this ticket's output)"*
  and *"carrying raw output over the wire unredacted"*.
- Recording the narrowing now stops an output mechanism from being justified by `WRK-018` without
  going through F7. If a transcript is ever adopted as an output (review §9.3, option 4, as a
  supplement only), that is an F7 ruling and it needs its own amendment here.

### Consequences

- Nothing in `WRK-018`'s scope changes, and no code changes.
- Any `CLI-011` option that persists the stdout stream as an artifact must say so explicitly, and it
  cannot cite `WRK-018` or this amendment as its licence.

---

## E7-D10 — the tool surface is the deployment kill switch AND a per-Organization opt-in; the flag's arming value is `per-organization`, never `true`

**Date (UTC):** 2026-09-21
**Status:** `locked` — **decided under founder delegation F2** (`docs/replatform/qa/2026-09-21-m1-execution-plan.md` §2,
F2: the founder delegates every M1 decision to the planning session, which records each with its reason).
The planning session's `CLI-016` brief passed this one choice to the `CLI-016` build agent ("your call,
recorded"); the build agent took it and records it here. QA independence still holds: a distinct
reviewer approves `CLI-016`, not the session that decided this.
**Owner role:** planning session (decision owner, under F2), exercised by the `CLI-016` build agent
**Affected tickets:** `CLI-016` (implements it); every later ticket or campaign that arms tools for an
Organization (`M1-D2-CODING`, `E7-1-JOURNEY-ARM`)

### Context

Founder ruling F10 makes M1 multi-tenant: enabling the distributed tool surface for one Organization
must not enable it for another. Before `CLI-016`, `readDistributedToolSurfaceFlag(process.env)`
(`server/src/config/distributed-execution.ts`) was the whole decision, read deployment-wide at the
canary dispatch in `server/src/services/heartbeat.ts`. `CLI-016` adds an optional per-Organization
`tools` field to `OrganizationRolloutPolicy` (`server/src/config/distributed-execution-rollout-source.ts`),
absent meaning not enabled (S0-8).

S0-8 also recorded the hazard this decision exists for. A binary built before `CLI-016` parses the
rollout map without rejecting unknown keys, so it **silently ignores `tools`** and falls back to the
deployment flag alone. If that flag reads `true`, the older binary arms **every tenant**. That can
happen through a normal binary rollback: the operator arms tools on the new binary, then rolls the
binary back and leaves the flag set.

### Decision

1. **The surface is a conjunction.** A run gets the tool surface only if the deployment flag is armed
   **and** its Organization's policy carries `tools: true` (`resolveDistributedToolSurface`,
   `server/src/config/distributed-execution.ts`). The deployment flag is checked first and stays the
   **kill switch**: unsetting it disarms every tenant, and the rollback rehearsal step
   ("unset `AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED`") is unchanged.
2. **The flag's only arming value is `per-organization`.** Unset and the falsy spellings
   (`0`/`false`/`no`/`off`) are off. The legacy truthy spellings (`1`/`true`/`yes`/`on`) are
   **refused**: `readDistributedToolSurfaceFlag` throws, and `assertHostedExecutionStartupSafe`
   turns that into a classified startup refusal (`env_flag_unparseable`, env name
   `AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED`). The new binary will not boot with them.
3. **The same decision is re-proven at use.** At `/mcp` authorization, beside the DAT-007 currency
   gate and under the same scoping (flag `AOA_DISTRIBUTED_EXECUTION_ENABLED` on, agent actor, signed
   run id), a **distributed** run whose Organization is not armed is denied with the same coarse
   forbidden (`classifyToolSurfaceAtUse`, `server/src/mcp/distributed-tool-surface-use.ts`). Local
   runs, and runs with no row, are not this gate's business and are admitted, as DAT-007 admits them.

### Why this makes the unsafe combination impossible, not just loud

- A deployment running the new binary **cannot** carry a legacy truthy value, because the new binary
  refuses to start with one. So no deployment can be rolled back to an older binary with a value the
  older binary reads as "arm everyone".
- The one arming value the new binary accepts, `per-organization`, is a value the **older** parser
  (`parseBooleanEnv`) **rejects**. At its only read site, the canary dispatch, it throws. So an older
  binary with the flag armed fails the canary runs **loudly and closed**. It never arms a tenant.
- Rollout order stays **binary first**: roll the `CLI-016` binary, then set `tools: true` on the named
  Organizations, then set the flag to `per-organization`. Rollback order: unset the flag first, then
  roll the binary back.

### Alternatives considered

- **Keep `true`, conjunction only, and document "binary first".** Rejected. It relies on the
  operator remembering the order, and a binary rollback with the flag still set reproduces exactly
  the cross-tenant arming F10 forbids, with no signal at all.
- **Refuse to arm (or refuse to boot) when the flag is on and no Organization carries `tools`.**
  Rejected as the primary control. The new binary is already fail-closed in that state (no tenant
  gets tools). The danger is the older binary, which this check cannot reach.
- **Drop the deployment flag and arm on per-Organization `tools` alone.** Rejected. It removes the
  one-switch kill the rollback rehearsal (exit criterion 6) relies on. It also changes the flag's
  default from off to "defer to per-Organization".
- **A new environment variable name.** Rejected. It would work, but it leaves the old name as a
  dormant "arm everyone" switch on older binaries. It also churns every record that names the flag.
  A new value on the same name gets the same property: an older binary cannot read it as true.

### Consequences

- `readDistributedToolSurfaceFlag({ AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED: "true" })` now throws where
  it returned `true`. One existing unit row (`crew-distributed-gate.test.ts`) encoded the old
  contract and was updated with the superseded wording quoted beside it.
- The E7 plan's `CLI-016` Interfaces line *"The deployment flag and the fence-bound gate already
  exist and are unchanged"* no longer holds for the flag's accepted values. The plan section carries
  a dated note.
- Per-tenant rollback (removing one Organization's `tools`) and the kill switch both reach
  **already-dispatched** runs at their next `/mcp` call once the changed configuration is in the
  process's environment, not only new dispatches. The run-JWT's TTL
  (≤48h) no longer bounds how long a disarmed tenant keeps its tools.

---

## E7-D11 — ruling F7: output leaves the sandbox by a CONVENTIONAL OUTPUT ROOT (`/home/user/aoa-output`), the agent learns it from a caller-side directive (SD-1b), and the provider refuses exported bytes carrying the run's own secrets (SD-5)

**Date (UTC):** 2026-09-23
**Status:** `locked` — **ruling F7, decided under founder delegation F2**
(`docs/replatform/qa/2026-09-21-m1-execution-plan.md` §2, F2: the founder delegates every M1 decision
to the planning session, which records each with its reason). QA independence still holds: a distinct
reviewer approves the tickets this ruling produces, not the session that decided it.
**Owner role:** planning session (decision owner, under F2)
**Decided on:** `tickets/CLI-011-review.md` (the design review, measured at `ba534b16b`) and the
**P-011 probe run** — workflow `Keyed E2B — CLI-011 P-011 output probe`, run
[`35833717162`](https://github.com/MeteoriteLabs/AoA/actions/runs/35833717162), job `probe`,
conclusion `success`, head `499ec4d1c3c3aab7324dcf0ca98ea34872fe18a0`, durable record artifact
`cli-011-output-probe-record` — **committed to the repository** as
`tickets/CLI-011-probe-record.json`, byte-identical, with a reading in
`tickets/CLI-011-probe-record.md`, because the workflow's artifact carries `retention-days: 90` and a
record living only in a job log expires under the decision it justifies (`E7-F025`; Codex P1, PR
#575). (`cli-011-output-probe-record.json`, schema
`aoa.cli-011.output-probe-record/1`, template `aoa-base` resolved `explicit`, `armsMode: all`,
`outputRoot: /home/user/aoa-output`). The record's `disposition` is **`measured`** — *"every arm
observed and every control held"* — and its three controls all report `held: true`: **PC-1** (a
planted file in `R` is reported present), **PC-2** (with `R = /home/user` the staged paths are found
under `R`), and **C-census** (the census sees a planted write under `R` and in cwd).
**Affected tickets:** `CLI-017` (filed by this ruling — the emit build), `CLI-012` (consumes the root
and the per-file failure policy), `CLI-015` (the judge, which waits on F7), `CLI-011` (the review that
this ruling is taken on)

### Context

`CLI-011`'s review compared four candidate output mechanisms and recommended **option 2, a
conventional output root**, at *"medium (≈60–65%)"* confidence, with the confidence stated as medium
because **two load-bearing facts were unmeasured**: what the claude CLI itself writes inside the
sandbox, and whether the agent writes its deliverable where it is told. The review designed the
P-011 probe (its §10) to measure exactly those, and it did not dispatch it. The probe has now run.
Ruling F7 is taken on that measurement, with the review's §10.5 decision table applied as written.

### Decision

#### 1. Mechanism — **option 2, a conventional output ROOT.** `R = /home/user/aoa-output`.

A run's deliverable is a regular file the agent writes under `R`; the producer enumerates `R` and
turns each file into an export request. This is the mechanism ruled in.

**Reason, by measurement.** The review's §9.1 named `A-O2-3` — *"the claude CLI writes session files
under `R`, so a run in which the model never acted produces a file"* — as **the decisive attack**, and
recorded it `UNRESOLVED`. The probe's `A-neg` arm ran the **unmodified production claude literal**
with a prompt instructing the model not to create, modify or delete any file, and the record's
decision-table row **R6** fired: *"A-neg: nothing under R or cwd"* → *"6.7 holds for option 2"*, on
`filesUnderRoot=0 removedUnderRoot=0 filesCwdOther=[] cwdMutations=[]`, with the CLI's own home state
**reported and explicitly not counted** (5 paths, all under the record's declared
`classification.cliHomeStatePrefixes`, i.e. `/home/user/.claude/` and its siblings — never under `R`).
Row **R5** (*"A-neg finds files under R"* → SD-1a refuted / option 2 refuted) did **not** fire.
**So a no-op run cannot produce a counted file: A-O2-3 is refuted by measurement, not by argument.**

And the counted signal is reachable when the model does act: row **R7** fired — *"A-dir writes
R/hello.txt; A-cwd writes R/hello.txt"* on `A-dir=true A-cwd=true`, with `helloElsewhere=[]` and
`otherFilesUnderRoot=[]` on both arms, and `rootCreatedDuringArm=true` (the agent creates `R` itself
when it is missing). Rows R8, R9 and R10 — the single-placement and no-compliant-placement readings —
did not fire.

#### 2. Placement — **SD-1b, the caller-side directive.**

The agent learns `R` from a `claude_local`-only directive appended at the **distributed caller**
(`server/src/services/heartbeat.ts`, the canary block that passes `currentTaskMarkdown` into
`buildTaskRunBatchWorkload`), **not** from a cwd prefix in the invocation script literal and **not**
from a builder-side prompt append.

**Reason.** The review's §6 pin census, re-measured at HEAD, records that SD-1b **moves none** of the
16 pins, where SD-1a's cwd prefix **moves pins 1 and 2** (`workloadBytes` 326 / `submissionHeadroomBytes`
65_210 in `cli-008-unit-b-byte-source.integration.test.ts`) and additionally auto-fires the keyed
`keyed-e2b-unit-d.yml` lane on merge, because that lane's `paths` include
`server/src/services/task-run-sandbox-invocation.ts` (review §3.7). SD-1c (the builder prompt-append)
moves 5–6 `E7-F026` assertions and is ruled out. The probe makes the choice free: R7 shows **both**
placements comply, so §10.5's *"both placements are viable; choose by pin cost: SD-1b recommended"*
applies exactly.

★ **The review's own caveat on that "none" is carried into this ruling and binds the build.** §6
states it in terms: *"SD-1b's 'none' is a search result, not a proof. No test asserts the staged
prompt bytes at the heartbeat call site … The emit build therefore owes a new pin at that site,
because an unpinned directive can be deleted silently."* Accordingly: **`CLI-017` MUST carry `PC-12`** —
a pin at the SD-1 site asserting the **exact** directive reaches the agent, whose positive control is
that **deleting the directive reds it**. A `CLI-017` without PC-12 does not satisfy this ruling.

★ **Stated behaviour change, carried from the review's SD-1.** Under SD-1b the directive is part of
the staged prompt, so `MAX_STAGED_FILE_BYTES` (1_048_576, `server/src/services/task-run-batch-workload.ts`)
now includes it: a task within roughly 200 bytes of that ceiling which built before will be refused.

#### 3. **SD-5 is RULED IN, and is REQUIRED before `M1b`'s campaign.**

`E2bSandboxProvider.exportArtifact` (`packages/sandbox-e2b-provider/src/e2b-provider.ts`) refuses
bytes that carry any secret-classified value of the run's own `env`, with a classification on the
refusal. It is not optional and not deferred.

**Reason, by measurement.** The review recorded `A-O2-5` (secret exfiltration into a durable store)
as *"survives with constraint only if SD-5 is ruled in"*, and §10.5 made the probe decide it: *"S-P7
nonce present → SD-5 moves from 'recommended' to 'required before `M1b`'s campaign'"*. Row **R4**
fired on `noncePresent=true`; the `S-P7` arm's own verdict reads `nonce-exported-in-file-bytes`. So an
environment value **can** land in a file under `R` and be read back out of the sandbox, and without a
provider-side refusal a tenant secret written into `R` reaches a durable store — which is what
Decision #104's *"must not hit a durable store"* forbids.

★★★ **The provider is the only component REACHABLE by both — it does not hold both today, and SD-5's
scope includes making it do so.** *Corrected 2026-09-23 (Codex, PR #575), verified at source.* The
review's §3.5 says the provider *"is the only component that holds both the bytes and the env
values"*, and this entry first repeated it. At source that is true of `create` and **false of
export**: `E2bSandboxProvider.create` forwards `spec.env` to the transport as `envVars` and retains
only `{sandboxId, resourceLabels}` in its idempotency map, while
`exportArtifact(sandboxId, path, grant, ctx)` receives no env at all. **So SD-5 cannot be delivered by
adding a content check to `exportArtifact` alone.** It requires a **sandbox-scoped secret handoff with
a stated lifecycle** — populated at `create` from `spec.env`, purged on teardown, and **fail-closed**
when the entry is absent (an export for a sandbox with no registered secret set is refused, never
allowed), which is also what makes an adapter-manager restart safe. That is `CLI-017`'s design
obligation and is written into its task section. **The ruling is unchanged — SD-5 stays REQUIRED** —
but its cost is higher than the review's *"about 0.5–1 agent-day, a provider-only change"*, and a
build that met PC-11 only against synthetic state absent from production would be a check that
nothing runs.

★★★ **SD-5 IS A LITERAL-VALUE REFUSAL, AND IT DOES NOT CLOSE EXFILTRATION — a named OPEN residual.**
*Added 2026-09-23 (Codex P1, PR #575).* An agent with shell access can `base64`- or `hex`-encode
`$ANTHROPIC_API_KEY`, reverse it, or split it across several files; the per-file policy (`E5-D07`)
then finds no exported file containing the literal value and **every PUT proceeds**. So SD-5 closes
the case the probe actually measured (`S-P7`, a **verbatim** env value written out) and **not**
Decision #104's artifact invariant in general. It is the accident and naive-agent control, not a
secure boundary against a hostile agent. `E7-D01`'s discipline applies: a refusal is not a proof of
containment. **The residual is FILED as `E7-F038`** (`findings.md`, MEDIUM, **open**, declared
`unowned` in `scripts/finding-ownership.json` with its closure path) — **not accepted**: unlike
`A-O2-8` below, which is accepted because it under-claims, this one over-permits, and it is **not
closed by `CLI-017-B` shipping.** Closing it needs a different boundary (an
egress/DLP design over the artifact path, or removing the credential from the sandbox environment
altogether), which is **out of `M1b` and needs its own ruling**; `CLI-017` carries the encoded and
split cases as **characterisation tests that assert the current pass-through**, so the gap lives in
the suite rather than in nobody's head.

**Acceptance (this is `CLI-017`'s, and it is the review's PC-11 verbatim in substance):** a planted
canary env value written into `R/x` makes the export **REFUSE with a classification**, and **a
provider without the check exports it** — the positive control. A check without that mutation row is
not a check.

#### 4. **Option 1b (the agent declaration) is FEASIBLE, and is recorded as a post-`M1b` refinement.**

Row **R11** fired: `declaration={"present":true,"declared":"hello.txt","resolved":"/home/user/aoa-output/hello.txt","relative":true,"matchesWritten":true,"matchesRequested":true}` — the final frame
carried a correct, relative declaration matching both the file written and the file requested. §10.5
reads that as *"option 1b is feasible; recorded for a post-M1b refinement"*. **It is not built now.**
It buys selection, not counting, and the probe found nothing to select from: `otherFilesUnderRoot=[]`
on every model arm, so `R` did not fill with scratch files. Adopting it later needs a `WRK-018`-channel
consumer, final-`result`-frame-only parsing (review `A-O1-2`) and paths-only validation (6.8), and it
would be a further ruling, not an implied licence from this one.

#### 5. **`A-O2-8` is an ACCEPTED NAMED RESIDUAL.**

`A-O2-8` is *"the agent writes the deliverable elsewhere"* — a false negative. It is accepted, not
closed. **It under-claims, which is the safe direction** for a precision counter: a run whose
deliverable is invisible reports zero produced outputs, which is honest about what was counted and
never fabricates a produced output. The probe measured `helloElsewhere=[]` on all three model arms,
so it is not observed at the single-sample level, but one sample is an existence proof and not a
rate, and this ruling does not convert it into one.

#### 6. **`R2` confirms `CLI-010`'s files-only recursion requirement**, which is already built and merged.

Row **R2** fired — *"S-P2 shows directory entries at default depth"* → *"confirms §3.3; `CLI-010` must
implement files-only recursion"* — on `defaultDepthDirs=["/home/user/aoa-output/sub"]`, with
`defaultDepthReachesNested=false` and `deepReachesNested=true`. That is the real SDK behaviour
`E7-D09` was decided on, now confirmed against a live sandbox rather than against the installed
package's source. **No new work follows from it:** `E7-D09` widened `CLI-010` to exactly this
contract, `CLI-010-result.md` is `complete`, and the enforcer (`filesOnlyFromListing`,
`packages/sandbox-e2b-provider/src/list-dir-contract.ts`, bounded by `E2B_LIST_DIR_MAX_ENTRIES` /
`E2B_LIST_DIR_MAX_DEPTH` in `transport.ts`) is merged. The probe's `transportListDir` observation on
the same arm returned `["/home/user/aoa-output/a.txt", "/home/user/aoa-output/sub/b.txt"]` — files
only, recursive, absolute.

### Conditions on the ruling — the template precondition

★★★ **`R` IS PROVEN EMPTY ON `aoa-base` AND ON NOTHING ELSE, AND THAT IS A GATING PRECONDITION, NOT A
FOOTNOTE.** *Added 2026-09-23 (Codex P1, PR #575), which noticed this ruling had not carried
`E7-F022`'s own standing instruction forward.*

`E7-F022`'s severity block has always read: *"Re-derive this to HIGH the moment any candidate output
mechanism becomes location-based; the conditional is the only thing holding it down."* This ruling
**is** that moment, so **`E7-F022` is re-derived from MEDIUM to HIGH** in the same commit, in both
`findings.md` and `scripts/finding-ownership.json`.

Why it bites: `CLI-012` counts every regular file under `R`, so a template that pre-populates `R`
makes **every run of every tenant "produce output" with the agent doing nothing** — the `E7-F020`
class, arriving through the template instead of through a predicate, and `A-O2-2` in the review's
attack table. The probe's `S-P0` arm closes it for **one** template: `root-absent`, `present=false`,
`paths=[]`, on **`aoa-base`**. The committed record states in terms that it establishes nothing about
*"any template other than the one named"*, and the production template is an unpinned operator input
under three uncoordinated variable names — which is exactly `E7-F022`.

★★★ **AND `S-P0` IS NOT ENOUGH ON ITS OWN — `A-neg` MUST BE RE-RUN TOO.** *Added 2026-09-23 (Codex
P1, PR #575; ruled by the planning session under F2).* `S-P0` proves the root is empty **before
execution**. It does **not** re-establish `A-neg`, the decisive result that the CLI itself writes
nothing there — and those are different failures. The probe measured `A-neg` against
**`claude 2.1.251 (Claude Code)`** (recorded on all four model arms of the committed record), while
`e2b/e2b.Dockerfile` installed `@anthropic-ai/claude-code` **unpinned**. A rebuild could therefore
pick up a release that writes session state into the working directory, **silently falsifying R6
while `S-P0` still passed**. Two separate remedies, because they close different halves:

- **Accidental drift → the version is PINNED.** `e2b/e2b.Dockerfile` now installs
  `@anthropic-ai/claude-code@2.1.251`, **the version this ruling was measured against**, with a
  comment saying that changing it re-opens the measurement. Codex stays unpinned: `E7-D04` excludes
  it, so no ruling depends on its behaviour.
  ★ **The pin's scope, stated so it is not over-read (found by this session's own self-audit).** It
  pins the **image**. The spawn-time path — `SANDBOX_INSTALL_COMMAND`
  (`packages/adapters/claude-local/src/index.ts`), delivered by
  `buildNpmGlobalInstallIfMissingCommand` (`packages/adapter-utils/src/sandbox-install.ts`) as
  `if ! command -v claude …; then npm install -g …; fi` — is **install-if-missing** and stays
  unpinned. On this image `claude` is present, so that branch does not fire and the pinned version is
  what runs; on a **bare** template it fires and installs latest. **This is exactly why the
  precondition below is per-TEMPLATE:** the pin removes accidental drift on the built image, and the
  `A-neg` re-run covers every other case.
- **Deliberate change → an `A-neg` RE-RUN, authorized under F8.** One `A-neg` re-run of the `CLI-011`
  probe on the `M1b` candidate, **before `M1b`'s campaign** — added to F8's named list by this ruling.
  ★ It is a precondition of **`M1b`**, not of `M1a`, and it is the **campaign's** to fire: no build
  agent may dispatch it. Cost: one claude turn capped at 180 s plus one `aoa-base`-class sandbox.
  ★★★ **It is dispatched with `-f arms=a-neg-only`, and that value exists because of this ruling.**
  *Added 2026-09-23 (Codex P2, PR #575).* As built the workflow's `arms` input offered only `all`
  (**four** model turns) and `shell-only` (**no** `A-neg` at all), so the operation authorized here
  **was not dispatchable** — an operator could only over-spend or under-measure. The third choice
  `a-neg-only` runs P-011a **plus `A-neg` and its `C-census` control**, and nothing else: exactly
  **one** model turn, so the authorization and the mechanism now match. It keeps the shell arms
  because they cost no model tokens and this precondition needs `S-P0` too, so **one dispatch collects
  both**; and it keeps `C-census` because that is `A-neg`'s positive control — an `A-neg` null result
  with no control proves nothing — and it is a shell write in the same sandbox. The value is enforced
  in both directions by the probe's workflow-shape check (`arms-options-mismatch` /
  `arms-options-unreadable`, `scripts/lib/cli-011-output-probe.mjs`), so the dispatchable options and
  the modes the core accepts cannot drift apart again.

**So the ruling is conditional, and the condition is discharged per deployment, not once:**

1. **Before any template is used for `M1b`'s campaign, `R` must be proven empty on THAT template** by
   the `S-P0` arm **and a no-op run must be shown to write nothing under it** by the `A-neg` arm,
   with both results recorded (a verdict that lives only in a job log is lost — `E7-F025`).
2. **Re-run BOTH on every template change or rebuild**, and on any bump of the pinned CLI version.
   The template is built by an operator from a repo Dockerfile with nothing verifying that the
   registered template matches it.
3. **If `R` is not empty on a template, do not run the campaign on it.** Per the review's §10.5 row
   for `S-P0`: *"choose another `R` and re-run"*. **Do not rule around it.**
4. **It is an OPERATOR precondition, not code.** `CLI-017` cannot discharge it, and `CLI-012` cannot
   tell a template-owned file from an agent-written one — that is the whole point of the closure
   property in the review's §4.3.

### What this ruling does NOT decide

- **The `+1 day` lstat contingency does not fire — but the metadata does NOT reach a consumer today,
  and `CLI-012` must widen the seam.** §10.5's row **R3** (*"list does not expose `symlinkTarget`/`type`,
  **and** read follows links"*) did not fire, because the record reports `listExposesLink=true`: the
  **SDK** returns `type: "file"` and `symlinkTarget: "/home/user/.aoa-run-prompt.md"` for the probe's
  `l1`. So a second means (a per-entry `lstat`) is not needed, and the contingency's `+1 day` is not
  spent.
  ★★★ *Corrected 2026-09-23 (Codex P1, PR #575), verified at source: this bullet first concluded
  "the SDK's own listing metadata is sufficient for `CLI-012` to refuse a symlink", which confuses
  what the SDK exposes with what a consumer receives.* `RealE2bTransport.listDir` returns
  `readonly string[]`: it passes the typed entries through `filesOnlyFromListing`
  (`packages/sandbox-e2b-provider/src/list-dir-contract.ts`), which uses `type` only to drop
  directories and **discards `symlinkTarget` entirely**. The probe shows the consequence directly —
  the same arm's `transportListDir` returned 5 paths with `includesL1: true`, i.e. **the link arrives
  as an ordinary file path**, while `readFollowsLink=true` means digesting it reads the target. So
  `CLI-012`, whose port is *"paths only"* over that same private `#transport.listDir`, **cannot refuse
  a symlink from what it is given**.
  **Obligation, on `CLI-012` and not on `CLI-017`:** the transport/port must carry enough per-entry
  metadata (at minimum a link marker) for the refusal, or the refusal must come from a means that
  does.
  ★★★ **AND THE FALLBACK IS PRE-AUTHORIZED, so `CLI-012` is NOT blocked on an unmeasured SDK
  detail.** *Ruled 2026-09-23 by the planning session under F2 (Codex P1, PR #575).* Whether
  `e2b@2.30.5` exposes a no-follow / handle-bound read is **unmeasured here and must not be guessed**.
  `CLI-012` measures it against the **installed** SDK when it builds and records which branch it took:
  **if a primitive exists**, it is the atomic operation; **if it does not**, `CLI-012` implements the
  refusal **by a second means — a per-entry `lstat`**, which the review already priced at **about +1
  agent-day** (§10.5's contingency). **Both outcomes are authorized in advance, so `CLI-012` is
  assignable.** It stops and reports **only if BOTH** the primitive is absent **and** a per-entry
  `lstat` proves unavailable. What is never authorized is a check-then-read pair presented as
  atomic.

  ★★★ **AND THE `lstat` FALLBACK IS ITSELF A CHECK-THEN-READ PAIR. THE RACE IS A NAMED, BOUNDED
  RESIDUAL; `CLI-012` PROCEEDS.** *Ruled 2026-09-23 by the planning session under F2, after Codex
  raised it on PR #575 and the build session stopped rather than build it.*

  - **The residual, stated plainly.** A per-entry `lstat` cannot be made atomic through the SDK's
    **path** API: `lstat` inspects a path, the later read **re-resolves** that path, and a background
    process that swaps the file between the two wins. Because the swapped-in target is **stable**,
    the sequencer's existing re-hash refusal **passes**. So `lstat` closes the enumeration-time
    symlink and narrows — not closes — the racing one. It is recorded here rather than papered over,
    the way `A-O2-8` is below.
  - ★ **Why it is BOUNDED — this is the load-bearing part, and the bound is SD-5, not luck.** The
    sandbox is **per-run and single-tenant**: every supervisor op mints a fresh `randomUUID`
    idempotency key, so `E2bSandboxProvider.create` never reuses a sandbox across attempts (the
    review's `A-O2-12`). A successful swap therefore reads a file in the **tenant's own** sandbox —
    its own staged prompt, its own environment — never another tenant's, so `F10`'s cross-tenant line
    is not crossed. The one materially damaging outcome left is **a redeemed secret reaching durable
    storage**, and that is exactly what **`SD-5` refuses** (§3 above): `exportArtifact` refuses bytes
    carrying any secret-classified value of the run's own `env`, and **SD-5 is already ruled IN and
    REQUIRED before `M1b`'s campaign**. The bound is that clause, cited deliberately: **if SD-5 were
    descoped or weakened, this residual would stop being bounded and the in-sandbox atomic read below
    would become REQUIRED.**
  - **What `CLI-012` must therefore carry.** Its real-run acceptance includes a **deliberate
    symlink-swap attempt**. Exactly two outcomes are acceptable: **(i)** the `lstat` check refuses it,
    or **(ii)** it exports and **SD-5's scan refuses** the bytes. ★ **A swap that produces a STORED
    artifact containing a planted canary is a FAIL, not a residual** — that is the line between this
    being bounded and being a hole.
  - **The closure route, recorded but not required now.** An **in-sandbox atomic read**: open the path
    with `O_RDONLY|O_NOFOLLOW` and stream from the **file descriptor**, through the provider's
    `runCommand`, so the inode inspected is the inode read. ★ **Measurement gap, stated honestly: this
    is UNVERIFIED.** It was proposed from the template's contents (`e2b/e2b.Dockerfile` installs
    `python3`) and `E2bTransport.runCommand`'s existence, **not** from a measurement — no
    `node_modules/e2b` was available to the session that proposed it and no keyed run was authorized.
    Its cost is real and unpriced: executing an interpreter **inside the tenant's sandbox during
    export**, plus encoding and bounding a byte path that today is a direct provider PUT. ★ On the
    data-plane question: `E7-D06`'s operative rule is *"No payload crosses the **dependency-pinned
    daemon**"*, and `digest_artifact` / `export_artifact` already materialise bytes in the
    **adapter-manager** (`packages/adapter-manager/src/server.ts`; that materialisation is `E5-F009`'s
    whole subject) — so this route is **not obviously** a breach of `E7-D06`. **That is a question to
    MEASURE when the route is taken, not to assert in either direction.** The refusal itself stays required (`A-O2-4`): unrefused, `R/l1 → .aoa-run-prompt.md` exports
  the run's own input and re-creates §4.3, and `R/l1 → /proc/self/environ` exports the secrets.
- **SD-2, SD-3, SD-4, SD-7 and SD-8 stand as the review states them** and are not re-argued here.
- ★★★ **SD-6 stands EXCEPT for its grant clause, which is SUPERSEDED BY SHIPPED BEHAVIOUR.**
  *Corrected 2026-09-23 (Codex P2, PR #575; ruled by the planning session under F2), verified at
  source.* The review's SD-6 says *"The grant's `maxBytes` = the per-file cap"*. The shipped sequencer
  does the opposite and says why: `packages/worker-daemon/src/lease/artifact-export.ts` sets
  **`maxBytes: described.sizeBytes`** with the comment *"`maxBytes` is the EXACT size, not a ceiling.
  Step 1 always knows it, and the server refuses a declared size over its own ceiling before a byte
  moves … so declaring more than the file is only a wider orphan bound with nothing to gain."*
  **The code is the truth.** A cap-sized grant would let the adapter-manager read and retain a file
  that grew after digest, up to the cap, before the hash mismatch rejected it — a wider window for no
  benefit. **The bounds themselves are unchanged** (per file ≤ 25 MiB, per attempt ≤ 100 MiB, ≤ 64
  files, depth ≤ 8): the 25 MiB per-file limit stays an **independent admission check** applied from
  listing metadata before the read, and the **grant carries the exact digested size**. Recorded rather
  than silently corrected so the next reader does not resurrect the review's wording. SD-8 is already enacted as the dated amendment to `E7-D06` above.
- **The `kind` (`E7-D08`) stays `CLI-012`'s**, per the review's SD-3: the judge counts through arm 2
  (predicate **P-A**, unchanged), so the kind does not decide what the judge counts.
- **Nothing about codex.** `E7-D04` binds; the probe ran no codex arm, and the codex literal is
  untouched.
- **Option 3 (a workspace patch) stays out of `M1b`** (`E7-D05`), and the fifth option stays
  SUPERSEDED (review §2).

### Alternatives considered

- **SD-1a, the cwd prefix in the script literal.** Rejected on cost, not on compliance: R7 shows it
  complies (`A-cwd` wrote `R/hello.txt`, `initCwd=/home/user/aoa-output`), but it moves pins 1 and 2
  and auto-fires a keyed E2B lane on merge. It stays the recorded fallback if a later measurement
  refutes SD-1b.
- **SD-1c, the builder prompt-append.** Rejected: it moves the `E7-F026` staged-byte pins for no gain
  over SD-1b, and `E7-F026` exists precisely because that option's cost was understated once already.
- **Option 1b now, instead of option 2.** Rejected: it is option 2 plus a model-authored selection
  list, it loses output on a run that dies before its `result` frame, and the probe found nothing to
  select.
- **Option 4, the captured transcript.** Rejected as a sole mechanism, structurally: an
  authentication-failed CLI still emits frames (review §3.8), so it fails proposed constraint 6.7 —
  the counted signal must need a **model action**, not merely a CLI run.
- **Outcome (iii), "neither is reachable".** Not taken. Its three triggers (R5, R10, R3-with-no-
  provider-side-means) all failed to fire, and row **R12** — *"any arm inconclusive … not a
  measurement"* — did not fire either.

### Consequences

- **`CLI-017` is filed by this ruling** — the emit build: the SD-1b directive plus `PC-12`; the `R`
  constant plus SD-4's single-source check; and SD-5's handoff and refusal plus `PC-11`. Its graph
  node is in `program-design.md` (E7 section) and its task section is in this epic's
  `implementation-plan.md`. ★ It is split into **two slices** (`CLI-017-A`, the directive and `R`;
  `CLI-017-B`, SD-5), because the Definition of Ready caps a ticket at three agent-days and
  `CLI-017` is not on its closed exemption list (Codex P2, PR #575). **Both are required** — SD-5 is
  not the optional half.
- **`scope-triage.md`'s `M1b` required result set** now names `CLI-017` where it named *"the emit
  build"* with no id.
- **`CLI-012`'s real-run acceptance pairs with `CLI-017`**: a real run produces a file under `R` only
  once the directive ships, so neither ticket's real-run half is provable alone.
- **`CLI-015` is unblocked.** Its dependency on F7 is satisfied; it counts through arm 2 unchanged
  (SD-3), which keeps its change a text/attribution fix (`E7-F016`) rather than a predicate change.
- **The review's §13 record corrections are not enacted by this ruling.** They remain the planning
  session's, and this entry neither adopts nor closes them.

---

## E7-D12 — the `artifact_prepared` contiguity question is answered **FATAL**: a sink failure aborts the attempt, and the announcement is never best-effort

**Date (UTC):** 2026-09-24
**Status:** `locked` — decided by `CLI-013`, whose task section says it "owes a DECISION before it
is assignable as build" and names the three admissible options.
**Owner role:** `CLI-013` (build) · **Affected:** `CLI-014` (the projector), `CLI-015` (the judge)
**Decided on:** source, read at tip `7be35ae6b7` — `EventSequencer` (`supervisor/events.ts`),
`createSupervisor` (`supervisor/supervisor.ts`), `createJobEventIngestService`
(`server/src/services/job-events.ts`).

### Decision

**Option 1, FATAL.** A rejection from the sink on `artifact_prepared` propagates out of the
announcement loop in `runLifecycle`; it is NOT caught, and the run reaches no terminal.

### Reason

`EventSequencer.#emit` increments `#seq` **before** awaiting the sink, so a failed emit has already
consumed its sequence number. Swallowing it leaves a **hole**, and `createJobEventIngestService`
classifies exactly that as a gap and accepts nothing past it — the terminal included. So the
superseded "log and continue to a truthful terminal" wording promised the one outcome the ingest
contract forbids.

Of the three options the task admits:

- **Option 2 (allocate-on-success)** changes the SHARED sequencer every sibling emitter uses. The
  task itself rules that out of this ticket, and nothing here smuggles it in.
- **Option 3 (durable retry before the terminal)** assumes a transient failure. Measured at source,
  the sink is `DurableWorkerEventSink` over a LOCAL encrypted outbox store, not a network call: its
  failure modes are disk and KEK, which a retry loop does not clear. It would add an unbounded loop
  (or a new bound, and a new policy to review) to an `S` ticket for no measured recovery.
- **Option 1** needs no new machinery and no change to anything shared.

### ★★★ What "fails the attempt" actually means here, verified at source

It is **NOT a rejection out of `accept()`**, and an earlier draft of this ticket's test asserted one.
`createSupervisor().accept` catches everything out of `runLifecycle` by design — *"never reject out
of `accept` (the loop treats settle as the in-flight lifetime)"* — logs `run lifecycle error` and
calls `escalateCleanup(run, "lifecycle_error")`. So the observable consequence is:

1. the lifecycle **aborts at the emit**;
2. **no terminal is written after the hole** — which is the whole point, because a terminal past a
   gap would never land anyway;
3. the attempt is left **non-terminal** for the `JOB-006` reaper, and cleanup is escalated.

The committed artifact is unaffected: the commit is never retracted, and `countProducedOutputs`
reads `job_artifacts` directly and joins no events, so the artifact counts whether or not the
announcement landed. **The cost of this option is an attempt, never a deliverable.**

### Consequences

- The announcement loop sits in `runLifecycle` **outside** `runExportWindow`'s catch. The export
  window stays best-effort about EXPORTING (`E5-D07`); this loop is not best-effort about EMITTING,
  and the two must not be conflated.
- **The contiguity assertion is unconditional** and stays so under any successor option: no option
  is permitted to leave a hole in the stream.
- A committed reference with no matching export request throws rather than announcing a guessed
  `kind` — the same fail-closed posture, for the same reason.
- **This decision does NOT reopen** the `CLI-012` charge invariant ("the tenant is charged unless it
  is PROVEN that no bytes left the sandbox"), which converged separately and is untouched here.

---

## E7-D13 — ruling on `CLI-014`: the same-batch projection is CLOSED AS DELIVERED BY `JOB-017`, `detectedFiles.path` is DESCOPED for M1, and an unsubstantiated path is OMITTED, never invented

**Date (UTC):** 2026-09-24
**Status:** `locked` — decided by the M1 planning session on `CLI-014`'s owed design step, which
the task section says is required before the ticket "is assignable as build".
**Owner role:** M1 planning session (founder delegation F2) · **Affected:** `CLI-014` (the
projector), `CLI-015` (the judge), any future protocol widening
**Decided on:** source, read at `eb8458bb3538c99ee5cb54b6872202c5f268dd74` — `job-output-bridge.ts`,
`job-accepted-output-projection.ts`, `job-accepted-event-seam.integration.test.ts`,
`gate-clause-wiring.json`, `packages/worker-protocol/src/artifacts.ts`,
`packages/worker-protocol/src/events.ts`, `packages/db/src/schema/job_artifacts.ts`,
`packages/worker-daemon/src/lease/artifact-export.ts`,
`packages/worker-daemon/src/supervisor/supervisor.ts`.

### Decision

**(a) `CLI-014`'s same-batch projection is CLOSED AS DELIVERED BY `JOB-017`.** The design the task
section says is owed was already chosen and built: `projectAcceptedOutputCore`
(`server/src/services/job-output-bridge.ts`) is the transaction-taking core, and
`resolveAcceptedOutputProjector` / `applyAcceptedOutputEvent`
(`server/src/services/job-accepted-output-projection.ts`) is the in-transaction registration that
`createJobEventIngestService` runs inside `acceptEvent`'s savepoint while the fence is live.
`scripts/gate-clause-wiring.json`'s `E3-17-output` is **`wired`**, and the owed integration case
exists **verbatim** as `[acc 2] an output event and the terminal event in ONE batch yield ONE
task_outputs row with its output_projection receipt, and no attempt_terminal throw`
(`server/src/__tests__/job-accepted-event-seam.integration.test.ts`).

★ **So no later reader should re-open this.** The framing the `CLI-014` task section quotes —
*"task_outputs is still written by the legacy path"*, *"a second writer landing in M1 would make
two mechanisms own one row"* — is the **PRIOR** reason preserved inside that same register entry,
not its current one. Re-writing the owed test under the owed filename would be a **vacuous RED**:
it passes at HEAD against no new code, which is the trap `CLI-013` caught in its own build.

**(b) `detectedFiles.path` is DESCOPED for M1. Do not widen the wire.**

**(c) The constraint that makes the descope honest: OMIT, NEVER INVENT.** The founder-facing
surface must not display a path it cannot substantiate. Absent a durable relative path the field is
**omitted** — not defaulted, not reconstructed from the object key, not filled with the digest.

**(d) `E7-F046` stays OPEN**, re-pointed off `CLI-014` to the post-M1 protocol question.

### Reason

`M1b`'s criterion is *"an agent's output reaches the founder"*, and `{artifactId, kind}` plus
retrievable bytes satisfies it. **A displayed filename is fidelity, not capability.** Against that,
widening costs a change to a `.strict()` v1 schema whose `protocolVersion` is `z.literal(1)`, plus
re-minting the hash-pinned frozen consumer fixture (`check:frozen-worker-protocol-v1`, which pins
the whole `packages/worker-protocol/src` tree at a recorded source sha). Changing a frozen protocol
leaf in order to render a filename is the wrong trade inside a milestone. If the wire is ever
widened it must be a deliberate **protocol** decision carrying its own compatibility analysis —
never a side effect of adding a display field.

(c) is the real requirement behind the task section's design item 4 (*do not "mint a path the
sandbox never reported"*), and it is what separates a descope from a quiet fabrication. It is
enforced by test, not by prose: `server/src/__tests__/cli-014-output-path-omission.test.ts` pins
that a fold over committed `artifact_prepared` events yields **no** file entry, that no folded
value carries the artifact/job/attempt identity in a path position, that the founder's run summary
renders no `Files:` line, and — the structural arm — that the frozen payload **refuses** a `path`
field, so a silent widening reds here rather than shipping. Its positive controls and mutations are
tabled in `tickets/CLI-014-result.md`.

### Why the measurement is not re-derivable from the register

No relative path is durable anywhere on the control plane, and each boundary drops it for its own
good reason: `exportArtifactId` hashes `jobId:attempt:path` **one-way** into the artifact identity
(so a retry presents the same id), the object key is that digest again, `artifactManifestV1Schema`
is `.strict()` with **no** path field, `job_artifacts` has **no** path column, and
`announcementsFor` holds `ref.path` in a local `Map` and deliberately emits only
`{artifactId, kind}`. `E7-F046` carries the full measurement.

### Consequences

- **`CLI-014` is not a build ticket.** Its projection half is delivered; its path half is descoped;
  what it leaves behind is the documented disposition plus the omission pin.
- **The materialization residue** (`job_artifacts` → a product `artifacts` row, so
  `task_outputs.artifactId` resolves rather than staying null) is **NOT** ruled here. It is
  independent of the path question and remains available as separate work.
- **This decision does NOT reopen `E7-D12`** (the `artifact_prepared` contiguity posture) or the
  `CLI-012` charge invariant. Neither is touched.
- **`E7-D11`'s Observability clause** — which permits *"the declared relative path"* — describes a
  value that does not exist today. Under this ruling that clause is dormant, not violated: nothing
  declares a path, so nothing may render one.
