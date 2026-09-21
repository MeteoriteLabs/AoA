# CLI-011 — the output-mechanism design review (evidence for ruling F7)

**Status:** `review` — design evidence only. **No mechanism is chosen here.** Ruling **F7** is taken
by the M1 planning session under the founder's delegation (M1 plan §2, rulings F2 and F7) **after**
this review, and it is shown to the founder before any build depends on it. This is **not** a
`-result.md`. The result is written after the ruling.
**Epic:** E7 · **Ticket:** [`CLI-011-design.md`](./CLI-011-design.md) · **Graph node:**
`program-design.md` `#### CLI-011` · **Plan task:** E7 `implementation-plan.md` `### CLI-011`
**Owns:** `E7-F026` · **Milestone:** `M1b` (the long pole)
**Measured at:** `ba534b16b` (`docs/replatform-program` tip, 2026-09-21), in worktree `C:/r011`.
**Inputs read in full:** `CLI-008-unit-f-design.md` §§0–13 (and §3, §6, §9, §12 closely);
`W7U1-output-probe-result.md`; the E7 plan's §0 decisions `E7-D01`…`E7-D07` and the `CLI-010`…`CLI-015`
tasks; the E4 plan's `WRK-018` task; `program-design.md` `CLI-010`…`CLI-015`, `JOB-017`, `WRK-018`;
`scope-triage.md` (the journey, `M1b`, exit criteria, the M1 rulings block).

★ **Scope limits, stated first.** No product code, no literal in `task-run-sandbox-invocation.ts`,
no test edit and no keyed dispatch are in this change. The `files.read` probe is authorized under F8,
but this review **designs** it (§10) and does **not** dispatch it. `codex_local` is excluded
throughout (`E7-D04`, `E7-F027`). §13's *"do not build it"* is **SUPERSEDED** (founder, 2026-09-20)
and is not reopened. Option 3 (workspace patch) is out of `M1b` (`E7-D05`). M1 is **multi-tenant**
(F10), and every section below is written for N Organizations, not one.

---

## 1. The answer in brief

| option | verdict of this review | why, in one line |
|---|---|---|
| **2 — a conventional output ROOT** | ★ **survives, conditionally** | It is the only option whose counted signal needs the model to **act**. The run's own input, the template and the CLI cannot produce it, provided the root is disjoint from the staged set (§4.3). It is counted by **arm 2 as it stands**, with no predicate change, so it avoids §4.3's refutation entirely (§4.1). Two things are unmeasured and decide it: the CLI's own writes, and agent compliance. §10's probe measures both. |
| **1 — the agent DECLARES its output** | survives **only as a refinement of option 2** | A declaration can name any path, including the staged prompt or a file carrying the run's env secrets. To pass §6.4 it must be confined to the root, and then it is option 2 plus a model-authored selection list. Not needed for `M1b` unless the probe shows that roots fill with scratch files. |
| **3 — a workspace patch** | **out** | `E7-D05` (Unit E, XL, post-`M1b`), plus `E7-F019`. Not re-argued. |
| **4 — a captured transcript** | **refuted as a sole mechanism**; viable as a provenance supplement **later** | It fails the proposed §6.7: the CLI emits frames when the model never spoke (§3.8; `W7U1` codex A2 emitted `thread.started`/`turn.started` under a 401). `WRK-018` makes the bytes cheap to *reach*, but not cheap to *persist* honestly (§7.1). |
| **(iii) neither reachable** | **not the finding today**; §12 names the probe results that would make it so | |

**Recommendation (§12):** rule **option 2**, `claude_local` only, with the sub-decisions in §11.
**Confidence: medium (≈60–65%) that option 2 is the right ruling. High (≥85%) that option 4 cannot be
the sole mechanism and that option 3 is out.** The flip points are named in §12.2. The confidence is
"medium" because two load-bearing facts are **unmeasured**: what the claude CLI itself writes inside
the sandbox, and whether it writes the deliverable where it is told to. **This review does not
convert them into claims.**

---

## 2. What is already settled, and must not be relitigated

- **`E7-D01`.** `capabilityProven` asserts provenance, never productivity. No option in this review
  is argued as proving the work was *good*. Each is argued on who can cause the counted signal to exist.
- **`E7-D02`.** The three refutations bind (argv shape, argv size, the predicate). §6 is applied to
  every option below.
- **`E7-D03`.** There are **two** counters. Arm 1 is the *qualifying artifact* counter (committed
  `kind='workspace_patch'` `job_artifacts`). Arm 2 is the *receipt-backed output* counter. Both are
  attempt-bound (`E7-F031`).
- **`E7-D04`.** `claude_local` only. **`E7-D05`.** No Unit E in `M1b`. **`E7-D06`.** Grants in,
  references out, never bytes. **`E7-D07`.** No frozen-protocol edit, so `ARTIFACT_KINDS` cannot gain
  a kind (`packages/worker-protocol/src/artifacts.ts` `ARTIFACT_KINDS`).
- **§13 / fifth option.** SUPERSEDED and ratified (`CLI-008-unit-f-design.md` §13.4.3). Clause-6
  arm 2 is **not** deleted, and `--require-capability` is **not** armed.
- **Stop-condition clause (i)** (permission posture in the product) is **discharged for
  `claude_local`**. Both claude literals carry `--dangerously-skip-permissions`
  (`server/src/services/task-run-sandbox-invocation.ts`, `buildSandboxInvocation`). **Clause (ii)**
  (adapter-agnostic) still stands, so every mechanism below is `claude_local`-only.

---

## 3. Terrain re-measured at HEAD — only what the options turn on

Each item was opened and read at `ba534b16b`. The items marked ★ **correct or extend an earlier record.**

### 3.1 The judge today

- **Arm 1:** `countProducedOutputs` (`server/src/services/e7-distributed-run-verifier-store.ts`,
  inside `createE7DistributedRunVerifierStore`, ~:425–516). It counts `job_artifacts` rows with
  `job_id = run.distributedJobId`, `kind = 'workspace_patch'` and `status = 'committed'`, joined to
  `job_attempts` on `(job_id, attempt_number)`, with `job_attempts.id = run.distributedAttemptId` and
  the company conjunct.
- **Arm 2:** the same function (~:579–606). It counts `task_outputs` rows inner-joined to a
  `job_projection_receipts` row with `projection_kind='output_projection'`,
  `aggregate_kind='task_outputs'`, `status='applied'`, and `job_id`, `attempt_id`, `company_id`
  matching the run. It does **not** read `created_by_run_id`.
- **The release-shape pressure of §6 is gone.** §6 warned that removing the forgeable arm without a
  producer "converts a forgeable gate into an unpassable one". W21 (PR #422) replaced arm 2's
  predicate instead of removing it, and `E7-F020` is resolved. **So no option below needs to remove
  or widen either arm** (§4.1). This is the single largest change since Unit F was written.

### 3.2 ★ §9.2's core question is already answered — by a run nobody linked to it

§9.2 asks *"does the E2B SDK's `files.read` return bytes for a file written by a redirected `exec`?"*,
and §12.0.2 lists it as *"unrun"*. **It has run.**
`packages/sandbox-e2b-provider/src/__tests__/keyed-dat-009-artifact-export.test.ts`, case *"digests a
file the SANDBOX produced, and exports its bytes byte-identically"*:
- it writes the file with `produceInSandbox`, which is
  `sh -c "printf '%s' '<b64>' | base64 -d > /home/user/aoa-dat-009-out.bin"` through
  `RealE2bTransport.runCommand`;
- it then reads it back through `digestArtifact` and `exportArtifact`, and each of those reads it
  with `#transport.readFile`, which is `sandbox.files.read(path, {format:"bytes"})`;
- it asserts the bytes are identical across all 256 byte values.

Run **`33856478690`**, job **`keyed-e2b-dat-009-export`**, conclusion `success`, log `Tests 4 passed
(4)`, head `f6ffc183b` (verified with `gh run view` for this review).

**What is still unmeasured from §9.2:** sub-case (a), a redirect after a **non-zero** exit; and
sub-case (b), an **unwritable** redirect target. Both bear only on redirect-based variants, which
means option 4's tee route (§7.1). Neither bears on option 2, where the agent writes through its own
tools rather than through a shell redirect. §10 keeps both, as cheap shell arms.

### 3.3 ★ The real `listDir` and the mock `listDir` disagree; the E7 plan describes neither

- **Real** (`RealE2bTransport.listDir`, `packages/sandbox-e2b-provider/src/real-transport.ts`):
  `sandbox.files.list(path)` with **no depth**, then `e.path ?? e.name` per entry. In `e2b@2.30.5`,
  `Filesystem.list` defaults to **`depth: 1`**, returns both **`file` and `dir`** entries, and carries
  `type`, `size` and `symlinkTarget` per entry. The transport **discards** `type`, `size` and
  `symlinkTarget`.
- **Mock** (`MockE2bTransport.listDir`, `mock-transport.ts`) returns every **file** key under the
  prefix, **recursively**, and sorted.
- **The E7 plan** (`### CLI-010`, Outcome 1) says `listDir` *"returns absolute file paths, not
  directories"*. That is true of the mock and false of the real driver.

This is the `E7-F014` class (a mock modelling the opposite contract), and it is exactly what the
brief calls *"CLI-010's corrected listDir (files-only, recursive, bounded)"*. ★ **I could not verify
that correction at source.** No `CLI-010` branch or PR exists on `origin` at this tip. §7.2 therefore
states what option 2 **requires** of it, not what it has.

### 3.4 The staged inputs live in the agent's working directory

- `STAGED_INPUT_DIR = "/home/user"` (`task-run-sandbox-invocation.ts`). It holds the flat files
  `.aoa-run-prompt.md`, `.aoa-run-instructions.md` and `.aoa-run-mcp.json`.
- `W7U1-output-probe-result.md` §4 records the sandbox cwd as `/home/user`, taken from codex's own
  stderr.

**So the default cwd is the staging directory**, and the agent's natural place to write is next to
the run's own input. That is §4.3's class re-expressed inside the sandbox (§4.3 of this review).

### 3.5 Secrets reach the agent as environment, and artifact bytes are never redacted

- The model-provider key reaches the sandbox as `envVars: spec.env` (`E2bSandboxProvider.create`,
  whose `[Cred-1]` comment says the key "must not hit a durable store", Decision #104).
- The brokered MCP config refers to the run bearer **by env-var reference**
  (`packages/adapter-utils/src/mcp-server-spec.ts`, `renderTokenRef`). So the secrets exist inside
  the sandbox only as process environment.
- **The worker redacts redeemed secrets from every event it emits.** It holds per-run canaries in
  `createRunCanaryCoordinator` (`packages/worker-daemon/src/supervisor/run-canaries.ts`), and
  `scrubEventStrings` applies them.
- **It never sees artifact bytes.** Under `E7-D06` the bytes go provider → object store. The
  provider's `exportArtifact` (`e2b-provider.ts`) checks size and hash and nothing else.
- **Consequence:** a file the agent writes can carry `$ANTHROPIC_API_KEY` or the run JWT into
  durable object storage, **unscanned**. Nothing in the tree stops it today. The only component that
  holds both the bytes and the env values is the **provider** (§11, SD-5).

### 3.6 ★ The pins have drifted since §3.2 was measured

- **Pins 1 and 2** now read **`326` and `65_210`**
  (`cli-008-unit-b-byte-source.integration.test.ts`, the `workloadBytes` / `submissionHeadroomBytes`
  expectations). They were `295` and `65_241`. The posture PR added a fixed +31 bytes, and the
  comment beside the pins records that.
- `E7-F026`'s three staged-prompt pins have moved from `:180/:415/:438` to **`:195/:548/:571`** of
  `task-run-batch-workload.test.ts`. By symbol they are: the hostile-prompt test's
  `toBe(nasty)`; *"carries the REAL assembled task markdown"* `toBe(PROMPT)`; and the E7-F008
  `it.each` `byteLength` assertion. ★ **`E7-F026` also under-counts by one test.** *"accepts a prompt
  exactly at the staging ceiling"* (~:587) reds as well, **if** a builder-side append is counted
  against `MAX_STAGED_FILE_BYTES` (1,048,576). If the append is not counted, the staged file exceeds
  the ceiling instead. Either way, one more invariant moves.
- ★ `findings.md`'s `E7-F026` owner line still reads **`CLI-008`**, while
  `scripts/finding-ownership.json` reads **`CLI-011`** (the M0 unit-4 re-point). Recorded here; not
  edited in this change.

### 3.7 ★ Two edits auto-spend E2B, outside the F8 list

`keyed-e2b-unit-d.yml` fires on `push` to `docs/replatform-program` whenever its `paths` change.
Those paths include **`server/src/services/task-run-sandbox-invocation.ts`** and
**`packages/sandbox-e2b-provider/src/real-transport.ts`**. So two things spend E2B money on merge,
though no model tokens (the lane uses the bare `base` template):
- **any** option-2 placement that edits the script literal (§11, SD-1a);
- the `CLI-010` `listDir` correction itself.

**Neither run is on F8's named list.** The planning session must either add the run to F8 or accept
it as a known side effect before merging either change.

### 3.8 ★ `WRK-018` and `E7-D06` need a stated reconciliation

- `E7-D06` says no payload crosses the dependency-pinned daemon.
- `WRK-018` (E4 plan) streams stdout chunks **into the worker** so that it can parse usage and
  redact, *"every chunk redacted by the per-run canaries before it leaves the worker"*.

That is a byte crossing of the daemon, scoped to stdout. It is not wrong. But `E7-D06` should say
that stdout crosses, and that artifact bytes still never do. **Otherwise option 4's "just persist the
stream" reads as licensed by `WRK-018`, and it is not** (§7.1).

---

## 4. The writer census (§9.1)

§4.4 of the Unit F design names this census as *"the first work of any fourth pass"*. Round 3 widened
a predicate without it and was refuted. There are two layers:
- **(A)** which control-plane **rows** a candidate predicate admits;
- **(B)** which **in-sandbox writers** can put a file where a location-based mechanism reads.

A mechanism is sound only if (A) is closed onto the worker's export **and** (B) is closed onto the
agent.

### 4.1 The candidate predicates

| id | predicate | recommendation |
|---|---|---|
| **P-A** | **arm 2, unchanged.** It counts a receipt-backed `task_outputs` row for the run's attempt. | ★ **Count through this.** Option 2's artifact reaches it via `CLI-013` (announcement), then `JOB-017`/`CLI-014` (bridge projection under the live fence). **No predicate change.** |
| P-B | arm 1 widened from `workspace_patch` to the kind `CLI-012` declares (`K`). | **Do not.** It is §4.3's move with a different kind. It also buys nothing that P-A does not, and exit criterion 4 asks for *visible on the task*, which is P-A's subject. Arm 1 stays `workspace_patch` and reads 0 on `M1b` runs. That is honest, because no patch was made. |

### 4.2 Layer A — control-plane rows, closed on INSERT sites (measured)

**`job_artifacts`.** Found with `grep -rn "insert(jobArtifacts)\|update(jobArtifacts)" server packages
--include=*.ts`, excluding tests. There are five insert sites and two update sites. Each enclosing
function was identified by reading it.

| # | writer (symbol, file) | status written | `kind` | fence | admitted by P-B (`K`)? |
|---|---|---|---|---|---|
| 1 | `commitArtifactVersion` (`packages/db/src/repositories/tenant/job-control.ts`), sole caller `artifact-commit.ts` (route `POST /worker-control/artifact-commits`) | `committed` | **worker-declared** (`manifest.kind`) | live fence first; `headObject` checksum; prefix `organizations/<org>/jobs/<job>/attempts/<n>/`; `tenantValid` from the **auth** org and the **locked lease's** company | **yes**, for every file a fence-holding worker exports as `K` |
| 2 | `jobArtifacts.insert` (`repositories/tenant/index.ts`), sole production consumer `stageJobInputFiles` (`server/src/services/job-input-staging.ts`) | `committed` | `staged_input` (fixed) | **none, by design** | no, if `K ≠ staged_input` |
| 3 | `recordArtifactGrantIntent` | `granted` | declared | fenced | no (status) |
| 4 | `authorizeArtifactCommit` | `NULL` | — | fenced | no |
| 5 | `recordOrphanQuarantine` | `quarantined` | declared | — | no |
| 6 | `recordPatchApplyState` (update) | none. It sets `baseManifestHash`, `resultManifestHash` and `applyStatus` on an existing patch row, and never `status` or `kind` | — | — | no |
| 7 | `markSwept` (update) | `granted` → `swept` only | — | — | no |

**`job_projection_receipts` with `output_projection` / `task_outputs` (what P-A admits).**
- `recordGovernedProjection` (`job-control.ts`) is the generic fenced insert. Its production callers
  write `runtime_decision`/`product_approval` (`job-approval-bridge.ts`), `activity_audit`
  (`job-audit-bridge.ts`), `authoritative_cost` (`job-budget-cost-bridge.ts`) and **`output_projection`
  (`job-output-bridge.ts`, `projectAcceptedOutput`) only**.
- The other raw inserts write `task_terminal` (`job-output-bridge.ts`, `projectTerminalWinner`),
  `attempt_started`/`attempt_terminal` (`applyProjectionForFence`, whose `ProjectionInput.projectionKind`
  is typed to those two values) and `service_instance_status`.
- **So P-A has exactly one writer, `projectAcceptedOutput`, with zero production callers today.**
  `E3-17-output` is `unwired`, and `JOB-017` owns the registration (`scripts/gate-clause-wiring.json`).

★ **Closure obligation this places on `JOB-017`/`CLI-014`.** P-A admits whatever accepted event the
registration projects. **The registration must project `artifact_prepared` only, and the census must
be re-taken if a second event kind is ever registered.** Otherwise a platform-emitted event (a
service-status event, say) becomes a "produced output". That is `E7-F020`'s class, one layer up.

**Method limits.** Literal `insert(<table>)` / `update(<table>)`. `sql.raw` and migration SQL are not
covered. The Unit F design §1.2 checked both classes for `task_outputs` at `611a78bfb` and found them
absent. They were not re-swept for `job_artifacts` in this pass; a reviewer should repeat
`grep -rn "INSERT INTO job_artifacts" packages/db/drizzle`.

### 4.3 Layer B — who can put a file under the output root `R` (the in-sandbox census)

`R` is the proposed root, `/home/user/aoa-output` (§11, SD-2). Under P-A, a committed and projected
file under `R` counts. **So every writer below is a writer of a counted row.**

| # | writer | can it write under `R`? | status |
|---|---|---|---|
| W1 | **the agent** (`claude`, acting on the model's tool calls) | yes, and it is the intended writer | ★ **write capability measured** (`W7U1` A2, run `34087197668`). A2's prompt named the exact absolute path (`/home/user/aoa-w7u1-<adapter>-<arm>.txt`, flat), so it is also a **single-sample** proof that the agent writes where a prompt tells it to. **Unmeasured:** compliance when the task does not name a path, and whether the agent creates a missing directory → §10 arms `A-dir` and `A-cwd` |
| W2 | **the claude CLI itself** (session state, transcripts, settings) | unknown. Claude Code keeps state under `$HOME` (`~/.claude*`). Whether `--print` writes into the **cwd** is not measured anywhere in this repo | ★★ **UNMEASURED, and load-bearing** → §10 arm `A-neg` |
| W3 | **the template / image** | the `W7U1` probe B found none of **7 candidate paths** pre-filled in `aoa-base`. **`R` was not among them.** The template is operator input (`E7-F022`) | **must be re-measured for `R`** → §10 arm `S-P0` |
| W4 | **staging** (`writeFiles` of the staged set) | writes `STAGED_INPUT_DIR` flat. **Disjoint from `R` iff `R ≠ /home/user` and `R` is not an ancestor of a staged path** | by construction (constant). `R = cwd = /home/user` would re-create §4.3 inside the sandbox, because the prompt, instructions and MCP config would be exported and counted → positive control PC-2 |
| W5 | **the invocation script** | none today. A redirect or `tee` variant (option 4) would add one | measured absent at HEAD (both claude literals) |
| W6 | **MCP tools** (`mcp__aoa__*`, once `CLI-016` arms them) | no. They execute at the control plane, not in the sandbox | by construction |
| W7 | **background processes the agent started** that outlive `exec` | yes, and possibly still mid-write at enumeration | `exportArtifact` re-hashes against the grant and refuses a changed file (`keyed-dat-009` case 2, live). A truncated file is **refused, not exported**. Output is lost, not corrupted |
| W8 | **the worker / provider** | no. `digestArtifact`/`exportArtifact` only read | by construction |
| W9 | **a hostile or injected agent** (W1, adversarial) | yes, with arbitrary content | provenance still holds and productivity is unknowable (`E7-D01`). See §9 |

**Closure property.** Suppose `R` is template-empty (S-P0), CLI-write-free (A-neg) and disjoint from
the staged set (W4). Then every file under `R` at enumeration was written by a process the **agent**
started (W1/W7/W9). That is the only claim P-A can then support, and it is the claim §6.4/§6.7 need.
**A future pass that finds a tenth in-sandbox writer breaks this property and must say so.**

---

## 5. The §6-constraint table, per option

Rows 6.1–6.6 are Unit F §6, verbatim in substance. Rows 6.7–6.10 are **proposed by this review**,
each derived from a measurement cited above. They are **not binding** until F7 adopts them.

| constraint | 1 — declared | 2 — convention root | 3 — patch | 4 — transcript |
|---|---|---|---|---|
| **6.1** no argv positional | ✅ | ✅ (`R` is a constant, never an argv element) | — | ✅ via the `WRK-018` stream; ⚠️ a script redirect puts no path in argv either |
| **6.2** workload bytes move pins 1+2 with a stated delta | depends on placement (§6) | SD-1a moves pins 1+2 (stated delta); SD-1b moves **none found by search** | — | a `tee`/redirect moves pins 1+2; the stream route moves none |
| **6.3** predicate change justified by a writer census | ✅ via P-A (no change) | ✅ via P-A (no change); §4 is the census | ✗ needs arm 1 fed; `E7-F019` | ✗ **no row exists to count.** A transcript artifact of kind `log` would need a P-B-style arm |
| **6.4** a signal the run's own INPUT cannot produce | ✗ **unless declarations are confined to `R`.** A declaration can name `/home/user/.aoa-run-prompt.md` | ✅ **iff** W4 is disjoint (PC-2) and W3 is empty (S-P0) | — | ✅ (the input cannot emit frames) |
| **6.5** survives `E7-F014`'s early return | ✅ (resolved, PR #351). Residual: provider fault, `execute_timeout` and cancel still destroy the sandbox | ✅ same residual | — | ⚠️ a stream route loses the tail on a timeout; a redirect route loses everything if the target is unwritable (§9.2b, unmeasured) |
| **6.6** emit predicate is not `workloadType`; extension arithmetic | ✅ if the producer runs on every attempt | ✅ **the producer needs no predicate.** It enumerates `R` on every attempt; an absent or empty `R` yields `[]` with zero HTTP calls (the sequencer's anti-vacuity property). This is §3.5's "read of the artefact" discriminator. No envelope extension is added (SD-4) | — | ✅ |
| **6.7 (proposed)** the counted signal needs a **model action**, not merely a CLI run | ✅ | ✅ **iff** A-neg shows the CLI writes nothing under `R` | — | ✗ **fails by construction** (§3.8; `W7U1` codex A2) |
| **6.8 (proposed, F10)** all attribution (org, company, job, attempt, issue) comes from the **fence**, never from model-authored bytes | ⚠️ the manifest or declaration must carry **relative paths only**; any other field is refused | ✅ (paths only) | — | ✅ |
| **6.9 (proposed)** artifact bytes never transit the daemon (`E7-D06`) | ✅ file route. ⚠️ the stdout-declaration route reads **declarations**, not artifact bytes, which is acceptable under §3.8's reconciliation | ✅ | — | ✗ for "persist the stream from the daemon" (§7.1); ✅ only for a provider-side route that does not exist yet |
| **6.10** `claude_local` only (`E7-D04`) | ✅ if conditioned on the adapter | ✅ if conditioned on the adapter. The codex literal is untouched, and codex runs enumerate an empty `R` → `[]` | — | ✅ |

---

## 6. Which pins each option moves (§3.2's 16, re-measured at HEAD)

The placements are defined in §11 (SD-1). **"moves" means an existing assertion reds and must be
edited, with the delta stated in the same edit (§3.3's rule).**

| # | pin (by symbol) | O2 · SD-1a cwd-prefix in script | O2 · SD-1b caller-side directive | O2 · SD-1c builder prompt-append | O1 · stdout declaration | O4 · script `tee`/redirect |
|---|---|---|---|---|---|---|
| 1–2 | `workloadBytes` **326** / headroom **65_210** | ★ **moves** (+~55 B for `mkdir -p '<R>' && cd '<R>' && `) | no | no | no (if SD-1b placement) | ★ moves (+~40 B) |
| 3 | claude shape, `stringContaining('exec "$0" --print - … --verbose < "$1"')` | no. The prefix precedes `exec` and the substring survives | no | no | no | ★ **a redirect of stdout breaks `WRK-018`** (the stream no longer reaches `onStdout`). A pipe loses `exec`'s exit code without `pipefail`, which POSIX `sh` lacks |
| 4, 7 | codex shapes | no (claude-only) | no | no | no | no |
| 5 | argv ↔ staged **set equality** | no (`R` is in the script, not the argv) | no | no | no | no |
| 6, 8 | bundle flag / no-bundle staged set | no | no | no | no | no |
| 9 | guard arity | no | no | no | no | no |
| 10 | `stdinFromScript` | no (it matches codex shapes only) | no | no | no | no |
| 11 | E7-F008 `it.each` (100× prompt still builds) | no | no | ★ **moves** (the `byteLength` toBe × 3) | no | no |
| 12 | 64 KiB structural bound (an inequality) | no | no | no | no | no |
| 13 | workload key set / order | no | no | no | no | no |
| 14 | `pointerFitsExtension` union | no (no new extension) | no | no | no | no |
| 15 | keyed unit-d argv/stdin | no assertion changes, **but the lane auto-fires on merge** (§3.7) | no | no | no | fires |
| 16 | `stdoutRef` literals | no | no | no | no | only if the refs become real |
| E7-F026 | `toBe(nasty)`, `toBe(PROMPT)`, and the ceiling test (§3.6) | no | no | ★ **moves** (5–6 assertions in 3–4 tests) | ★ moves **if** the directive rides the builder | no |

**Census method.** The same search set as §3.2 (`buildTaskRunBatchWorkload`, `STAGED_PROMPT_PATH`,
`aoa-run-prompt`, `workloadBytes`, `stringContaining`, `toBe(` on staged bytes) was run over
`server/src/__tests__` and `packages/*/src`.

★ **SD-1b's "none" is a search result, not a proof.** No test asserts the staged prompt bytes at the
heartbeat call site. The files that name `STAGED_PROMPT_PATH` outside the builder's own test either
assert paths only (`crew-seam-suppression.test.ts`) or use synthetic bytes
(`cli-008-unit-d-seam-wiring.test.ts`). The emit build therefore **owes a new pin at that site**,
because an unpinned directive can be deleted silently.

---

## 7. Interactions with in-flight work

### 7.1 `WRK-018` — the stdout/usage stream (M1a)

- **It makes option 4 cheaper to *reach*.** The redacted stdout arrives at the worker for free.
- **It does not make option 4 cheaper to *persist*.** Each persistence route has a measured cost:
  - as `log` events: `E7-F024` (silent truncation at 65,536 UTF-16 units, a 480-event cap, and a
    corrupt rather than absent transcript) and `E7-F023` (clause 4 then scans model content as a
    hard-fail gate);
  - uploaded from the daemon: this breaks `E7-D06`/§3.8 as stated, and the daemon has no S3 client
    (`AOA_WORKER_S3_ENDPOINT` has zero TypeScript readers, Unit F §8);
  - uploaded by the provider: needs a new port operation. That is the `E7-F010` shape of §3.4.
- **And persisting it would still fail 6.7.**
- **It enables a cheap declared-output-over-stdout variant (option 1b).** Parse a declaration line
  from the **final `result` frame only**, never from the whole stream, because tool-result frames
  echo file contents an attacker controls (§9, A-O1-2). This adds a second consumer of the channel
  and a parser behind the `E4-D01` boundary, which must be injected exactly like `WRK-018`'s usage
  parser. The declaration is lost on a run that dies before its `result` frame.
- **Recommendation:** `M1b` does not build option 1b. It keeps `WRK-018`'s channel usage-only.
- **A hard constraint the ruling must carry:** *no option may redirect or pipe the claude process's
  stdout*, or `WRK-018`'s usage parse (and so `JOB-016`/`E3-F037`) silently loses its input.
- **And `WRK-018` sets the placement for any future transcript:** it would be a provider-side capture
  of the same stream, never a script redirect.

### 7.2 `CLI-010` — the corrected `listDir` (files-only, recursive, bounded)

Option 2 **requires** each of these properties. Each one closes a named hole:

1. **Files only.** The real driver today returns directories (§3.3). An enumerator that exported a
   directory path would make `digestArtifact` fail on it, and one that silently skipped it would drop
   everything nested.
2. **Recursive with a depth bound.** The agent may write `R/src/...`. The real driver's `depth:1`
   would see only `R/src`, so it must recurse. The SDK's `depth` option does this in one call.
3. **Type and `symlinkTarget` preserved and refused.** Today the transport maps both away (§3.3). An
   agent can `ln -s /home/user/.aoa-run-prompt.md R/x`, and then either `files.read` follows the link
   (unmeasured → S-P5) and the run's **own input is exported and counted**, which re-creates §4.3, or
   a secret-bearing file is.
4. **`size` preserved,** so the §9.6 bound is applied **before** `digestArtifact` reads the whole file
   into provider memory (§11, SD-6).
5. **Absent `R` maps to `[]`, not an error,** so extraction one-shots and codex runs are unaffected
   (6.6).

★ Because the correction edits `real-transport.ts`, **it auto-fires `keyed-e2b-unit-d.yml` on
merge** (§3.7).

### 7.3 `CLI-012` — the producer's `outputRoot` interface

- **The shape.** `createExportRequestProducer(deps: {capture, outputRoot, kind, contentTypeFor,
  retention})` (E7 plan `### CLI-012` Interfaces) already assumes **one location**, one root. That is
  option 2's shape exactly. Option 1 fits only if declarations are confined under `outputRoot`, which
  6.4 requires anyway. Option 4 does not fit: a transcript is not a file under a root.
- **The two copies of `R`.** `outputRoot` is a **worker-side** composition input, and the directive
  or cwd is a **server-side** literal. Two constants in two packages is the drift shape `E7-F010`
  names. SD-4 resolves it without a frozen edit or a new envelope extension.
- **`kind` is no longer a capability decision.** Under P-A, `CLI-012`'s `kind` (`E7-D08`) does not
  decide what the judge counts. That removes the "silently pick the kind that makes a number go up"
  hazard the plan warns about.
- **Choosing the kind.** Pick a frozen kind no other producer commits. `artifactCommit` has **zero**
  production callers today (`transport/client.ts`; `result-commit.ts` names it only in a comment), so
  any kind is unique now. `other` is the honest frozen choice, and a future producer adopting `other`
  must re-take §4.2's census.

---

## 8. Positive-control table

A control that cannot go red is not a control. Every row names the **mutant** that must red it.

| # | claim | control (green) | mutant that must go red | where it runs |
|---|---|---|---|---|
| PC-1 | `R` is empty before the agent runs | S-P0 reads and lists `R` before any exec → not-found | plant a file in `R` via `writeFiles` before exec → the pre-exec check reports non-empty | P-011a (keyed, shell) |
| PC-2 | the run's own input is never exported | enumerate `R` after staging → none of the three `STAGED_*` paths | set `R = /home/user` → the enumerator returns the staged paths | unit (fake provider) + P-011a |
| PC-3 | the CLI writes nothing under `R` | A-neg (the agent is told not to write) → `R` is absent or empty | none possible; it is a measurement. If it fails, option 2 needs a different `R` or is dead | P-011b (keyed, claude) |
| PC-4 | an agent-written file is counted exactly once | a fixture run with one file in `R` → one committed `job_artifacts` row, one `artifact_prepared`, one receipted `task_outputs` row → arm 2 = 1 | an empty `R` → zero rows, zero HTTP calls, zero session fetches (anti-vacuity) | `CLI-012`/`CLI-014`/`JOB-017` tests |
| PC-5 | a symlink in `R` is refused | a symlink → refused, never digested | an enumerator that follows links → exports the link target | unit + S-P5 |
| PC-6 | an oversize file is refused before any read or PUT | `size > cap` → refused from list metadata | drop the pre-digest check → the provider reads the whole file | unit + S-P6 |
| PC-7 | the forged route does not count (`E7-F015`) | `POST /api/issues/:id/outputs` carrying `createdByRunId` → arm 2 = 0 | the existing `e7-f020-arm2-provenance` suite; reuse, do not duplicate | existing |
| PC-8 | cross-tenant: Organization B's output never counts for, or is visible to, Organization A | two Organizations, one attempt each → each run's arm 2 counts only its own receipt; B's fence presented by A's worker → `stale_fence`/refusal | swap `companyId` in the bridge input → it must throw, never write under the wrong tenant | `JOB-017` two-Organization case + `DEP-018` matrix |
| PC-9 | the control tenant is refused | control Organization → legacy path, no distributed attempt → arm 2 = 0 (fail-closed on a null attempt) | enable the control Organization → it must now show a distributed attempt, which proves the refusal was live | `DEP-018` |
| PC-10 | output survives a non-zero exit | agent exits non-zero after writing → still exported (post-`E7-F014`) | capture only on `exitCode === 0` → red | unit + S-P3 |
| PC-11 | a secret written into `R` does not reach the store (**only if SD-5 is ruled in**) | write a planted canary env value into `R/x` → export refused, classified | provider without the check → exported | provider unit + S-P7 |
| PC-12 | the directive or cwd reaches the agent (the emit build) | the new pin at the SD-1 site asserts the exact directive or prefix | delete it → red | emit-build unit |

---

## 9. Adversarial attack pass

Each surviving option was attacked as an adversary. The default is to refute, and a refutation
must name a measurement. The verdicts are **survives**, **survives with a named constraint**, or
**refuted**.

### 9.1 Option 2 — the convention root

| # | attack | verdict |
|---|---|---|
| A-O2-1 | **`R` = cwd = `/home/user`** exports the staged prompt, instructions and MCP config as "output" (§4.3 inside the sandbox) | **survives with constraint:** `R` must be a dedicated directory disjoint from `STAGED_INPUT_DIR`'s files (SD-2), with PC-2 |
| A-O2-2 | **The template pre-fills `R`.** Every run of every tenant then "produces output" | **survives with constraint:** S-P0 per template, re-run on any template change (`E7-F022`: the template is an unpinned operator input) |
| A-O2-3 | **The claude CLI writes session files under `R`**, so a run in which the model never acted produces a file | **UNRESOLVED; this is the decisive attack.** It is the transcript refutation (§3.8) arriving by the back door. The attack succeeds if A-neg finds any file under `R`, and then SD-1a (cwd = `R`) is dead. SD-1b (a directive with the cwd unchanged) might survive, because the CLI's state lives under `$HOME`, not under `R`. Measured by A-neg |
| A-O2-4 | **A symlink** `R/x → /home/user/.aoa-run-prompt.md` (the input) or `→ /proc/self/environ` (the secrets) | **survives with constraint:** type and `symlinkTarget` preserved and refused (§7.2 item 3). Whether `files.read` follows links is unmeasured (S-P5). The refusal is required either way |
| A-O2-5 | **Secret exfiltration into a durable store:** the agent writes `env` into `R` | **survives with constraint only if SD-5 is ruled in.** Otherwise it is a **named residual**: tenant-scoped (the Company's own key into the Company's own restricted artifact), but it breaks Decision #104's "must not hit a durable store". ★ **Not cross-tenant**, and still not acceptable silently |
| A-O2-6 | **A scratch flood** (`npm install` into `R`: 10⁴ files, gigabytes) | **survives with constraint:** count, depth and size bounds (SD-6), refused per file and classified, best-effort (`E5-D07`). The attempt is **not** failed, because the work is done and only its evidence is partial |
| A-O2-7 | **Prompt injection in the task** ("do not write to `R`") | **survives:** the result is an honest zero, not a false positive |
| A-O2-8 | **The agent writes the deliverable elsewhere** (a false negative) | **survives as a residual:** the answer is the SD-1a/SD-1b choice measured by A-cwd/A-dir. A false negative under-claims, which is the direction a precision counter tolerates |
| A-O2-9 | **TOCTOU:** a background process keeps writing | **survives:** the re-hash refuses (live, `keyed-dat-009` case 2). The output is lost and not corrupted |
| A-O2-10 | **★ Cross-tenant (F10):** Organization A's agent writes a file whose *content* claims Organization B (B's issue id, B's company id), hoping a projector parses it | **survives:** option 2 never parses content. The key prefix is derived from the fence (`expectedAttemptObjectPrefix(org, job, attempt)`), `tenantValid` from the **auth** org and the **locked lease's** company (`artifact-commit.ts`), and the bridge `lockActiveFence`s the attempt inside `runInTenant`. Constraint 6.8 makes this binding, and PC-8 proves it with a two-Organization case |
| A-O2-11 | **★ Cross-tenant (F10):** a compromised worker enrolled for Organization A commits into Organization B's job | **survives, and not on option 2's merits.** `resolveWorkerFenceContext` finds the lease **by the presented fence token** under the auth org, so B's fence is refused before storage is touched (`artifact-commit.ts`, the DAT-011 stale-fence comment). The existing DAT-002 hostile suite ("malicious keys and stale fences") and `DEP-018`'s matrix row "outputs" carry it |
| A-O2-12 | **★ Cross-tenant (F10):** a shared sandbox or shared `R` across tenants | **survives:** every supervisor op mints a fresh `randomUUID` idempotency key (`supervisor.ts`, `newIdempotencyKey ?? randomUUID`), so `E2bSandboxProvider.create` never reuses a sandbox across attempts. `R` is a per-sandbox path |

### 9.2 Option 1 — declared (as a refinement of option 2)

| # | attack | verdict |
|---|---|---|
| A-O1-1 | Declare `/home/user/.aoa-run-mcp.json` or any path outside `R` | **refuted unless confined to `R`**, and confined to `R` it is option 2 plus selection |
| A-O1-2 | A **forged declaration** echoed through a tool-result frame (the agent `cat`s a hostile file containing `AOA-OUTPUT: …`) | **survives with constraint:** parse the final `result` frame only |
| A-O1-3 | A declaration carrying routing ids (issue, company) | **refuted unless** 6.8 holds (relative paths only; every other field refused) |
| A-O1-4 | A run dies before the `result` frame | **survives as a residual:** option 1b loses output on exactly the failing runs, the §3.7 problem again. The manifest-file variant (1a) does not |

### 9.3 Option 4 — transcript (as a supplement only)

| # | attack | verdict |
|---|---|---|
| A-O4-1 | "A transcript proves the agent worked" | **refuted** (§3.8; 6.7). An auth-failed CLI still emits frames |
| A-O4-2 | "`WRK-018` already streams it, so persisting it is free" | **refuted** (§7.1): `E7-F024`/`E7-F023` for events, and `E7-D06` for a daemon upload |
| A-O4-3 | Secrets in the transcript | **survives better than options 1/2.** The stream is canary-redacted (`WRK-018` acceptance 2). This is the one axis on which option 4 is stronger, and it is why SD-5 exists for option 2 |

---

## 10. The `files.read` probe — designed, NOT dispatched

**Authorized:** F8 names *"the `CLI-011` `files.read` probe"*.
**Status:** **not dispatched by this review.** The planning session dispatches it.

### 10.1 Why the §9.2 probe as written is not enough

- **Its core is answered** (§3.2).
- **Its two sub-cases decide only option 4.**
- **What decides options 1 and 2 is unmeasured:**
  - W2 (the CLI's own writes);
  - compliance (A-dir/A-cwd);
  - the symlink, depth and size behaviour of `files.list`;
  - template-emptiness for `R`.

So the probe below is **P-011**, in two parts:
- **P-011a** (shell only, no model tokens) is the §9.2 probe proper, plus the `files.list` questions.
- **P-011b** (claude, model tokens) is the census and compliance arms. ★ **Whether P-011b falls
  under F8's "`files.read` probe" line is a planning-session call.** It spends Anthropic tokens as
  well as E2B time, as `W7U1` did.

### 10.2 It needs an apparatus PR first — no existing workflow can run it

- `keyed-e2b-w7u1-output-probe.yml` takes only `e2b_template` and runs a fixed pack (probes T/A/B/C).
- `keyed-e2b-dat-009-export.yml` and `keyed-e2b-unit-d.yml` run fixed suites.
- **So P-011 needs a test-only apparatus PR**, reviewed like `W7U1`'s. Size: **S–M (1–2 agent-days)**.
  It makes no product change:
  - **create** `packages/sandbox-e2b-provider/src/__tests__/keyed-cli-011-output-probe.test.ts`,
    modelled on `keyed-w7u1-agent-output-probe.test.ts`. It reuses that pack's `resolveTemplate`,
    redactor and durable-record writer, and it imports `buildSandboxInvocation` so the claude arms run
    the **exact shipped literal**;
  - **create** `.github/workflows/keyed-e2b-cli-011-output-probe.yml`, dispatch-only:
    - `workflow_dispatch` with input `e2b_template`, where empty means `aoa-base` (never bare `base`,
      `E7-F022`);
    - a push route on **only** `.github/keyed-e2b-cli-011-output-probe-trigger`, a file the PR must
      not create;
    - secrets `E2B_API_KEY` and `ANTHROPIC_API_KEY` only (both exist; `gh secret list`,
      2026-09-21). **No `OPENAI_API_KEY`**: codex is excluded;
    - an `always()` durable-record step, and an `always()` upload of artifact
      **`cli-011-output-probe-record`** (90 days);
    - an `always()` **skip guard** that fails if `E2B_API_KEY` was empty (a skip is not a measurement);
    - `timeout-minutes: 45`.

### 10.3 Dispatch, once the apparatus is merged (for the planning session)

```
# bind to a NAMED candidate per F8: record the candidate sha in the dispatch note
gh workflow run keyed-e2b-cli-011-output-probe.yml --ref docs/replatform-program -f e2b_template=aoa-base
# if the workflow is not yet indexed (HTTP 404), the push route:
echo "CLI-011 P-011 run #1 (<date>, candidate <sha12>): F7 evidence" >> .github/keyed-e2b-cli-011-output-probe-trigger
git add .github/keyed-e2b-cli-011-output-probe-trigger && git commit -m "chore(cli-011): fire the output probe" && git push
```

**Then** copy the durable record into `tickets/CLI-011-probe-result.md`, naming the run id and the
job. This is `E7-F025`'s lesson: a verdict that lives only in a job log is lost.

### 10.4 The arms

`R = /home/user/aoa-output` (SD-2). Every model arm is capped at 180 s, as in `W7U1`. All secrets are
redacted by the pack's redactor. **No real key is ever written into a file**: S-P7 uses a synthetic
canary.

**P-011a — sandbox S1, template `aoa-base`, shell only (`RealE2bTransport` directly):**

| arm | action | records | decides |
|---|---|---|---|
| **S-P0** template control for `R` | before any `writeFiles` or exec: `files.list(R)`, `files.read(R)`, `files.list("/home/user", {depth:3})` | the not-found kind; the full home listing | not-found → A-O2-2 passes for `aoa-base`. Anything present → **`R` is rejected**; pick another and re-run |
| **S-P1** staged baseline | `writeFiles` the exact staged set `buildSandboxInvocation` emits for `claude_local` with instructions and an MCP config; then list `/home/user` at depth 8 → **B0** | B0 | PC-2 at the real layer: no staged path under `R` |
| **S-P2** depth and type | `sh -c 'mkdir -p R/sub && printf N1 > R/a.txt && printf N2 > R/sub/b.txt'`; then `files.list(R)` (default), `files.list(R,{depth:8})`, and `files.read` of each | entry `type`/`path`/`size` per call; the bytes | confirms §3.3 (default depth 1, dirs included) against the real SDK, and that depth recursion reaches `sub/b.txt` → the `CLI-010` interface |
| **S-P3** non-zero exit (§9.2a) | `sh -c 'printf N3 > R/c.txt; exit 3'` via `runCommand` **and** via `E2bSandboxProvider.execute` | `exitCode` (3, not a throw); `files.read(R/c.txt)` | PC-10 at the real layer |
| **S-P4** unwritable redirect (§9.2b) | `sh -c 'exec printf SHOULD_NOT_RUN > /nonexistent-dir/x'` | exit code, stdout, stderr | the redirect fails **before** the command runs (stdout empty) → a redirect-based option 4 fails closed and the agent never starts |
| **S-P5** symlinks | `ln -s /home/user/.aoa-run-prompt.md R/l1; ln -s /home/user R/l2`; then `files.list(R,{depth:8})`, `files.read(R/l1)` | `type` and `symlinkTarget` for `l1` and `l2`; whether `read` returns the prompt bytes | whether list **exposes** a link (so `CLI-010` can refuse on the SDK's metadata) and whether read **follows** it (the severity of A-O2-4) |
| **S-P6** size metadata | `head -c 3145728 /dev/urandom > R/big.bin`; `files.list` `size`; `files.read` length and wall time | `size` equals the actual size | SD-6's pre-digest bound can use list metadata |
| **S-P7** env secret in a file | at `create`, `envVars: {AOA_PROBE_CANARY: <nonce>}`; `sh -c 'printf "%s" "$AOA_PROBE_CANARY" > R/env.txt'`; `files.read` | whether the nonce is present | demonstrates A-O2-5 on the real read path. Decides whether SD-5 is required, not hypothetical |

**P-011b — sandbox S2, template `aoa-base`, the exact production claude literal, `ANTHROPIC_API_KEY`
as env:**

| arm | action | records | decides |
|---|---|---|---|
| **A-neg** CLI self-write census (W2) | stage the exact set; list `/home/user` at depth 8 (B0); run the **unmodified** literal with the prompt *"Reply with the single word OK. Do not create, modify or delete any file."*; list again (B1) | `B1 − B0` in full; whether any entry is under `R` or under cwd; `permissionMode` from the `init` frame (`bypassPermissions` expected) | **the decisive arm.** Anything under `R` → **refutes SD-1a**. Anything in cwd → W2 writes into cwd and a cwd-based `R` is dead. **Empty under `R` → 6.7 holds for option 2** |
| **A-dir** SD-1b (directive, cwd unchanged) | the same literal; prompt = the task *"Create a file named hello.txt containing `<nonce>`."* plus the directive *"Write every deliverable file under /home/user/aoa-output/ (create it if needed)."* | `R` listing and bytes; whether `R` was created by the agent; files written outside `R` (diffed against the A-neg delta) | **compliance under SD-1b**; whether the agent creates `R` itself (if not, the emit must create it) |
| **A-cwd** SD-1a (cwd = `R`, no directive) | the literal with `mkdir -p R && cd R && ` inserted before `exec`. **Probe-local**, named as such, exactly as `W7U1` A2 was. The task names **no** location | where `hello.txt` landed; the delta under `R` beyond `hello.txt` | **compliance under SD-1a**, and whether cwd = `R` drags CLI files into `R` (cross-checked with A-neg) |
| **A-decl** option 1b feasibility | as A-dir, plus *"End your final message with one line `AOA-OUTPUT: <relative path>`."* Capture stdout through `onStdout` exactly as `WRK-018` would | whether the **final `result` frame** carries the line; whether it matches the file written | whether option 1b is viable at all. If the line is absent or wrong, option 1b is dead |

★ **One arm per case, one run.** That is a single sample, so compliance results are **existence
proofs, not rates**. If the planning session wants a rate for SD-1, it must authorize N repetitions
separately. This review does not ask for them.

### 10.5 Decision table — what result decides what

| result | reading |
|---|---|
| S-P0 non-empty for `R` | choose another `R` and re-run S-P0. **Do not rule until a template-empty `R` exists** |
| S-P2 shows directory entries at default depth | confirms §3.3; `CLI-010` **must** implement files-only recursion (a hard input to its acceptance) |
| S-P5: list does **not** expose `symlinkTarget`/`type`, **and** read follows links | `CLI-012` must refuse by a second means (a per-entry `lstat` via the provider). **+1 day** on the emit build |
| S-P7 nonce present | SD-5 moves from "recommended" to "required before `M1b`'s campaign"; otherwise A-O2-5 is recorded as a residual with an owner |
| **A-neg finds files under `R`** | ★ **SD-1a is refuted.** If files also appear under a directive-only `R`, **option 2 is refuted → outcome (iii)**, with the cause "the CLI writes into every candidate root" |
| A-neg: nothing under `R` or cwd | 6.7 holds for option 2 |
| A-dir writes `R/hello.txt`; A-cwd writes `R/hello.txt` | both placements are viable; choose by pin cost (§6): **SD-1b recommended** |
| only A-cwd writes | SD-1a (pins 1+2 move, delta stated; the keyed unit-d lane auto-fires, §3.7) |
| only A-dir writes | SD-1b |
| **neither writes the file into `R`** | **option 2 has no compliant placement on the evidence**. Option 1a (a manifest under `R`) has the same compliance dependency, so the result is **outcome (iii)**, with the cause "`claude --print` does not place deliverables at a directed location". Re-probing with more samples is the only honest next step |
| A-decl carries a correct line | option 1b is feasible, and is recorded for a post-`M1b` refinement |
| any arm `inconclusive` (no key, template without the CLIs, a timeout) | **not a measurement.** Re-dispatch; never rule on it |

**Cost:** one GitHub-hosted job of about 20–30 minutes. Two E2B sandboxes of at most about 10 minutes
each on `aoa-base`. Four claude turns of at most 180 s each, which at current rates is **well under
US$1** of model tokens, with the same arm count and cap as `W7U1`'s claude half.

**What P-011 does NOT establish:**
- codex (excluded);
- the networked/container lane (no `stage_files` route, `E7-F011`);
- any template other than the one named;
- compliance **rates**;
- anything about the control-plane half (grant, commit, announcement, projection), which is
  `CLI-012`…`CLI-014`'s acceptance.

---

## 11. Open questions §9.3 and §9.6, and the other sub-decisions F7 must carry

| id | question | answer, or the sub-decision stated |
|---|---|---|
| **§9.3** | one output path or a list? | **One root, many files.** A single constant `R`; the producer enumerates every regular file under it within the bounds (SD-6). §9.3's objection ("a list cannot be a script constant, re-opens §4.1") applies to a list of **paths in the argv**. A root is one constant and nothing rides the argv (6.1). Each file costs one grant round trip. **The per-file failure policy is independent:** one file's refusal never drops the others, and every refusal is classified (`E5-D07`, best-effort outward) |
| **§9.6** | size ceiling; does the worker refuse before the PUT; what does the operator see? | **Sub-decision SD-6, recommended values for the ruling to fix:** per file ≤ **25 MiB**, per attempt ≤ **100 MiB**, ≤ **64 files**, depth ≤ **8**. Refuse **from `files.list` metadata, before `digestArtifact`**, because the provider reads a whole file into memory (`#readArtifactBytes`) and the server ceiling is 5 GiB (`DEFAULT_MAX_ARTIFACT_BYTES`, `artifact-size-ceiling.ts`), which a provider cannot hold. The grant's `maxBytes` = the per-file cap. **What the operator sees:** a per-file classified refusal (`output_too_large` / `output_limit_exceeded` / `output_symlink_refused`) through `emitOp` labels and the run summary, and **never** the path or content (`CLI-012` observability). The rest of the run's output still exports |
| **SD-1** | how does the agent learn `R`? | **(a)** a cwd prefix in the script: pins 1+2 move, and the keyed unit-d lane auto-fires. **(b)** a claude-only directive appended at the **distributed caller** (`heartbeat.ts`, the canary block before `buildTaskRunBatchWorkload`): no pin found by search, one new pin owed. **(c)** a builder prompt-append: 5–6 E7-F026 assertions move. **Recommend (b), subject to A-dir.** Fall back to (a) if only A-cwd complies. Never (c). ★ Under (b), `MAX_STAGED_FILE_BYTES` now includes the directive, so a task within ~200 bytes of the 1 MiB ceiling that built before will be refused. Record that as a stated behaviour change |
| **SD-2** | the value of `R` | **`/home/user/aoa-output`.** Under `/home/user`, because `W7U1` A0/A2 proved writes there. A dedicated directory, disjoint from the flat staged set. **Not** `/home/user` itself (A-O2-1), and **not** under `~/.claude`. It must be re-proven template-empty (S-P0) |
| **SD-3** | which counter? | **P-A only** (arm 2 via the bridge). Do not widen arm 1 (§4.1). This makes `CLI-015`'s change a text/attribution fix (`E7-F016`) rather than a predicate change |
| **SD-4** | one source of truth for `R` | a constant exported from a non-frozen package **both** the server literal and the worker composition import, **or** two constants plus a `policy`-job equality check (the `W7U1` `default-template-mismatch` pattern). **No** new envelope extension (that would bring §3.6's sibling arithmetic), and **no** frozen edit (`E7-D07`) |
| **SD-5** | a secret check on export | Recommended: `E2bSandboxProvider.exportArtifact` refuses bytes containing any **secret-classified** value of the run's own `env`. The provider is the only component holding both. Cost about 0.5–1 agent-day, a provider-only change, PC-11. If it is ruled out, A-O2-5 is recorded as a residual with a named owner |
| **SD-6** | bounds | see §9.6 above |
| **SD-7** | the `JOB-017` registration scope | project `artifact_prepared` only; re-take §4.2 on any addition |
| **SD-8** | reconcile `E7-D06` with `WRK-018` (§3.8) | one sentence in `E7-D06`: stdout crosses the worker, redacted, for usage parsing only; artifact bytes never do. No stdout redirect or pipe in any literal (§7.1) |

---

## 12. Recommendation

### 12.1 What to rule, priced and sized

**Rule option 2 (a conventional output root), `claude_local` only, with SD-1b, SD-2, SD-3, SD-4,
SD-6, SD-7 and SD-8, and SD-5 recommended. Take the ruling only after P-011 returns,** and with
§10.5's table applied as written.

| option | build it needs, beyond `CLI-010`/`012`/`013`/`014` and `JOB-017` (already filed) | size | keyed |
|---|---|---|---|
| **2** (recommended) | **`CLI-017`, the emit build:** the directive at the distributed caller (claude-only) plus its new pin; the `R` constant plus the SD-4 equality check; SD-5 in the provider (optional). **Required interface properties of `CLI-010`/`CLI-012`** (not new work in `CLI-017`): files-only recursion, symlink refusal, bounds, absent `R` → `[]` | **S–M: 1–2 agent-days**, +0.5–1 with SD-5, +1 if S-P5 forces an `lstat` path | P-011 (one run); acceptance inside `M1-D2-CODING` |
| 1a (manifest file) | option 2, plus a manifest parser and a paths-only validation | M: 2–3 agent-days | the same |
| 1b (stdout declaration) | option 2, plus a `WRK-018`-channel consumer and an injected parser (the `E4-D01` boundary) plus final-frame-only parsing | M: 3–4 agent-days; lost on a run that dies before its `result` frame | the same |
| 4 (transcript) | a provider-side persistence op (§3.4 cost) or events (`E7-F024`/`F023`); **cannot satisfy criterion 4** | M–L; **not recommended for `M1b`** | — |
| 3 (patch) | Unit E | XL, post-`M1b` (`E7-D05`) | — |

### 12.2 What evidence would flip it

- **→ outcome (iii).** A-neg finds CLI-written files under every candidate `R`; **or** neither A-dir
  nor A-cwd places a file in `R`; **or** S-P5 shows links are neither exposed nor refusable by any
  provider-side means. The cause is then named from the arm, and `M1b` records it as blocked, as the
  plan's §9 requires. It does not reinterpret the criterion.
- **→ option 1a.** A-cwd complies, but the delta under `R` carries scratch files beyond the
  deliverable. Selection is then needed, and a manifest under `R` supplies it.
- **→ SD-1a over SD-1b.** Only A-cwd complies.
- **Confidence down.** Any `inconclusive` arm leaves the recommendation where it is and its
  confidence unchanged. **It is not evidence either way.**
- **Nothing measured here moves option 4 to primary.** 6.7 is structural (§3.8).

---

## 13. Contradictions with the plan, found at source

1. **§9.2's "unrun" probe has run** (§3.2). Unit F §9.2 and §12.0.2, and the M1 plan's framing of
   "the `files.read` probe", all describe it as open. Its core is answered by run `33856478690`.
2. **The E7 plan's `CLI-010` Outcome 1** says the real `listDir` returns file paths and not
   directories. At source it returns both, at depth 1, and discards `type`, `size` and
   `symlinkTarget`. **The mock is the one that returns files only** (§3.3).
3. **`E7-F026`** cites drifted lines, and under-counts by one test (the staging-ceiling test). Its
   `findings.md` owner line still says `CLI-008` while the manifest says `CLI-011` (§3.6).
4. **Unit F §3.2's pins 1+2** (`295`/`65_241`) are stale; HEAD reads `326`/`65_210` (§3.6).
5. **The F8 list** omits two auto-fired keyed runs: any edit to `task-run-sandbox-invocation.ts`, and
   the `CLI-010` `real-transport.ts` correction (§3.7).
6. **`E7-D06`'s "never touch the daemon"** is narrowed by `WRK-018` for stdout and does not say so
   (§3.8).
7. **The E7 plan's `CLI-011` "Files"** lists an amendment to the Unit F design, a
   `DECISION-REQUEST-cli-008-unit-f-emit.md` and `CLI-011-result.md`. **This review is none of
   those, by brief.** The result follows the ruling, and the amendment and decision request are the
   planning session's to write if F7 wants them.

**None of these is fixed in this change.** Each is a record correction for the planning session. Each
was verified by reading the cited source at `ba534b16b`.
