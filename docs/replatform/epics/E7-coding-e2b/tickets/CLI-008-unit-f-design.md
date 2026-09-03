# CLI-008 Unit F — Terrain + Design: the return path

**Epic:** E7 · **Plan node:** `docs/replatform/program-design.md`, `#### CLI-008`
**Depends on:** CLI-008 Unit B (the staging channel, SHIPPED `393f7a251`) · Unit D (the sandbox
command line, SHIPPED `b9ab89e36`) · DAT-002 + DAT-002 slice-7 live-MinIO (SHIPPED) · DAT-009 slice 1
(the provider export port, SHIPPED) · **Size: L — corrected DOWN from XL, see §2** · **Status:**
`design` (2026-09-03). Measured at `d0b75be19`, in `C:/uf`.

**Governing decision:** [`DECISION-byte-egress-and-provider-topology.md`](../../../DECISION-byte-egress-and-provider-topology.md)
— Option D, "the provider reads the file from inside its sandbox and PUTs it directly to object
storage under a worker-minted grant; the port carries a grant inbound and a reference outbound, and
**never bytes**." Unit F does not re-open that decision; it becomes its first coding-lane consumer.

---

## 0. The answer in five sentences

`capabilityProven` turns on **two counters**, and **not one of the four links the verifier's own
failure text blames is one of them.** The arm the text is really about — a committed `workspace_patch`
job artifact — is blocked behind Unit E *and* behind an in-sandbox manifest capture that does not
exist, because `buildWorkspaceManifest` walks a **local** filesystem with `node:fs`. The other arm —
a `task_output` keyed to the run — is reachable today by **a board `curl`**, which makes the
programme's headline gate forgeable. So the honest cheapest path is neither of the two the estimate
assumed: it is **one named file, written by the agent to a fixed absolute path Unit D's own script
already owns, exported by the provider under an upload grant that the D1 lane has already proven end
to end against real MinIO, committed as a `log` job artifact, and projected onto the task**. That
path needs no workspace, no `buildWorkspacePatch`, no `createResultCommitter`, and no `observeRun` —
and it is **L**.

---

## 1. Terrain — what is true at `d0b75be19`, measured in this worktree

Everything in §1 was opened and read in `C:/uf` at `d0b75be19`. Where a line number differs from an
earlier record, §10 says so.

### 1.1 The bar, exactly

`E7ProducedOutputCounts` is two numbers and nothing else
(`server/src/services/e7-distributed-run-verifier.ts:126-129`):

```ts
export interface E7ProducedOutputCounts {
  readonly workspacePatchArtifacts: number;
  readonly taskOutputs: number;
}
```

Clause 6 is the module's **only** `capabilityFailures.push`, guarded by an AND of two misses
(`:506`), and `capabilityProven` is `capabilityFailures.length === 0` (`:522`). `ok` is computed
from a disjoint array, so neither verdict can suppress the other — Unit A's shape, unchanged.
`e7VerifyExitCode` short-circuits `return 1` on `!ok` before reading capability (`:549`), so
`--require-capability` partitions the already-green population into exit 0 and exit 3.

The two counters come from `countProducedOutputs`
(`server/src/services/e7-distributed-run-verifier-store.ts:198-218`):

| arm | predicate | who can write it |
|---|---|---|
| `workspacePatchArtifacts` | `job_artifacts` where `job_id = run.distributedJobId` **AND `kind = 'workspace_patch'` AND `status = 'committed'`** (`:201-211`) | ONLY `commitArtifactVersion`, behind a live fence, a device proof, and a control-plane `headObject` that independently verifies the object's `ChecksumSHA256` |
| `taskOutputs` | `task_outputs` where `created_by_run_id = run.id` (`:213-216`) — **no type, provider, agent or provenance filter** | anything that can write the table |

★ **Two different citations for the same predicate.** `store:165` is the byte-identical
`eq(taskOutputs.createdByRunId, run.id)` inside `listRunSecretScanSurfaces` — the **clause-4 leak
scan**, not the counter. Earlier records that cite `:166` for the capability bar are pointing at the
`for (const o of outputs)` loop header of the wrong function. The conclusion (one predicate, run
linkage only, nothing workspace-related) holds at both sites.

### 1.2 The write census for each arm

**`workspacePatchArtifacts` — zero producers, and the missing producer is not merely uncomposed.**
`createResultCommitter` (`packages/worker-daemon/src/patch/result-commit.ts:66`) needs an injected
`commitVia` and a `BuildWorkspacePatchInput` carrying **base and result `WorkspaceManifestV1`s**.
The only manifest producer, `buildWorkspaceManifest`
(`packages/worker-daemon/src/snapshot/build-manifest.ts:308`), imports
`lstatSync/readFileSync/readdirSync` from `node:fs` (`:24`) and walks the **daemon's own**
filesystem. On the E2B lane the agent's files are inside a remote sandbox the daemon cannot `lstat`.
So this arm is blocked on two things at once: a repository to diff (**Unit E**) and an in-sandbox
manifest capture that **does not exist anywhere in the tree**.

**`taskOutputs` — six writers, none of which can fire on a distributed run, and one that can be
`curl`ed.**

| writer | `createdByRunId` | reachable on a distributed run? |
|---|---|---|
| `heartbeat.ts:5557` → `emitSandboxPreviewTaskOutput` | `run.id` (`:5574`) | **No.** `return; // CLI-006-SUPPRESSION-RETURN` at `heartbeat.ts:5451` fires whenever `shouldSuppressLegacyExecution(owner)` — i.e. `owner?.owner === "distributed"` — and sits above `adapter.execute` (`:5453`) and above this emitter, all inside `executeRun` (`3061`–`6119`) |
| `routes/output-detection.ts:201` (founder confirm) | `runId` (a `heartbeat_runs` id) | **No.** Its only feed is `heartbeat_runs.detected_outputs`, whose sole creating writer is `heartbeat.ts:5907` — also past the suppression return, and additionally reading `adapterResult`, which only `adapter.execute` assigns |
| `task-output-emitters.ts:113` (runtime service) | `row.startedByRunId` | No — needs a `workspace_runtime_services` row |
| `crew-output-capture.ts:129` | **hard-coded `null`** — a crew run id lives in `internal_agent_runs` while the column FKs `heartbeat_runs` | Structurally incapable, by design |
| `attach-task-artifact-tool.ts` (MCP) | never set — only `createdByAgentId` (`:162`) | Structurally incapable |
| **`POST /api/issues/:issueId/outputs`** (`routes/task-outputs.ts:45-53`, mounted `app.ts:566`) | **whatever the request body says** | **YES — see §1.3** |

### 1.3 ★ FINDING E7-F015 — the capability bar is forgeable by a board POST

`upsertTaskOutputSchema` (`packages/shared/src/validators/task-output.ts:50`) admits
`createdByRunId: z.string().uuid().nullable().optional()`; the route hands `req.body` straight to
`svc.upsertForIssue` (`routes/task-outputs.ts:53`); and the only guard on that field is
`assertCompanyOwnedRef(db, heartbeatRuns, input.createdByRunId, companyId, "Heartbeat run")`
(`services/task-outputs.ts:123`) — the run must merely belong to the issue's company. Only `type` and
`title` are required.

So **one authenticated POST of `{type:"external_link", title:"x", createdByRunId:"<the canary run>"}`
flips `capabilityProven` to true**, with no agent, no worker, no sandbox and no output. That is the
gate the whole programme is pointed at. Filed as **E7-F015**, MEDIUM (the present reach is bounded:
`--require-capability` is off by default, no workflow runs the verifier, and GO-BOOK §9 tells the
operator not to pass it — but Unit F exists precisely to make an operator start passing it).

**This is why slice A comes first.** Making the bar flippable before making it unforgeable ships a
gate that a `curl` passes — the exact defect one altitude up from the fabricated `stdoutRef`.

### 1.4 ★ FINDING E7-F016 — clause 6's own failure text names four links, three of which cannot flip either counter

The reason string printed to the operator on every verify run
(`e7-distributed-run-verifier.ts:509-515`) says output capture is unbuilt because:

| the text's link | measured |
|---|---|
| "the E2B driver passes no stream handlers" | TRUE at `e2b-provider.ts:261-297`, but **the transport already implements them** — `RealE2bTransport.runCommand(req, handlers?)` binds `onStdout`/`onStderr` to the E2B SDK (`real-transport.ts:107-120`). And wiring them **flips neither counter**: `log` events are not `job_artifacts` and not `task_outputs` |
| "`stdoutRef`/`stderrRef` are fabricated literals" | TRUE (`e2b-provider.ts:276,293`). Making them real *means* exporting bytes to object storage — i.e. it is not a separate link, it is the same work as the artifact path, named twice |
| "`observeRun` is uncomposed" | TRUE (`lifecycle/dispatch-runtime.ts:178-181`, with the absence stated in the comment). `RunObservation` is `{logs?, progress?, usage?}` (`supervisor/supervisor.ts:73-77`) — **flips neither counter** |
| "`buildWorkspacePatch`/`createResultCommitter` have zero production callers" | TRUE, and the only one of the four that touches a counter — but it is blocked behind Unit E **and** the missing in-sandbox capture of §1.2, neither of which the text names |

And it omits the links that are actually decisive: `artifactExportMode: "none"` on **both** shipped
providers (`sandbox-e2b-provider/src/e2b-provider.ts:178`,
`provider-wire/src/driver.ts:83`), the absence of any `artifactPrepared` emitter on `EventSequencer`
(seven emitters at `supervisor/events.ts:147,155,162,170,178,206,220`; `artifact_prepared` is in the
frozen vocabulary at `worker-protocol/src/events.ts:358` with payload `{artifactId, kind}` at
`:92-94`), the absence of any **upload-direction** grant consumer in the daemon (the only
`artifactTransferGrant` caller is `lease/staged-input.ts:242`, download-only, which explicitly
rejects a cross-paired `upload_granted`), and the absence of any control-plane projector from durable
evidence onto `task_outputs`.

Filed as **E7-F016**, LOW — it fails no gate, but it is the programme's stated answer to "what does
Unit F have to build", it is printed as evidence, and it produced the XL estimate this document
corrects.

### 1.5 The byte pipeline is not greenfield — it is built and **live-proven**

This is the finding that moves the size, and it is the one most likely to be missed because it lives
in an E5 result doc rather than an E7 one.

[`DAT-002-live-minio-result.md`](../../E5-workspaces-secrets/tickets/DAT-002-live-minio-result.md)
records `d1-merge-train` run `31885553697` **13/13 green on `b27817824`**, proving on the Linux D1
lane, against **real MinIO over TLS**:

> grant(upload) → **real presigned PUT** → commit `committed` + persisted `job_artifacts` row;
> grant(download) → real GET byte-identical.

and, as a second assertion, that a toxiproxy `limit_data` truncation of the PUT makes the fenced
commit **reject fail-closed** and persist **no row**. Its own §3 names the one thing left: *"the
worker-daemon S3 client consumer is deferred (the tier drives `/api/worker-control/*` from the
test-runner directly)."*

The recipe is therefore known, not researched — including the sharp edge: *"the server binds
`ChecksumAlgorithm:SHA256` but returns `headers:{}`, so the raw-bytes PUT step-script computes and
sends `x-amz-checksum-sha256`; the fenced commit re-verifies it via `headObject`."* An exporter that
omits that header will be rejected by `artifact-commit.ts:141-145`, which fails closed when the store
cannot supply a checksum. (`checksumSha256` is supplied only by `storage/s3-provider.ts:212`; the
local-disk provider supplies none, so **an S3-compatible store is a hard precondition** for this arm.
Staging sets `AOA_STORAGE_PROVIDER: "s3"` — `docker-compose.staging.yml:81,132`.)

Everything above the worker is likewise live: `POST /worker-control/artifact-transfer-grants`
(`routes/worker-control.ts:605`) and `POST /worker-control/artifact-commits` (`:654`) are mounted
whenever distributed execution is on, backed by `createArtifactCommitService` and
`createArtifactTransferGrantService`, and the port surface the worker needs already exists:
`digestArtifact` / `exportArtifact` / `artifactExportMode` on the **non-frozen**
`SandboxProvider` port (`worker-daemon/src/supervisor/provider.ts:414,430,433`), with a conformance
suite and a working `grant_upload` double
(`worker-daemon/src/__tests__/artifact-export-capability.test.ts`,
`support/fake-provider.ts`).

### 1.6 So the genuinely missing links are these, and only these

1. **No file to export.** Unit D's script runs `claude --print -` and lets stdout go nowhere in
   particular. There is no agreed absolute path inside the sandbox that holds what the agent produced.
2. **No real `exportArtifact`/`digestArtifact`.** `E2bSandboxProvider` declares
   `artifactExportMode = "none"` and declines both (`e2b-provider.ts:178,391-402`) — honestly, and
   with `#transport.readFile` (`real-transport.ts:196`) sitting one line away, uncalled.
3. **No worker-side consumer.** Nothing sequences digest → mint upload grant → export → commit. This
   is DAT-009 slice 3, chartered on Track B (GO-BOOK §1.9.3) and unbuilt.
4. **No announcement.** `EventSequencer` has no `artifactPrepared` method, so a committed artifact is
   invisible to the control plane's evidence stream.
5. **No projector.** `foldAttemptEvidence` hard-codes `detectedFiles: []`
   (`canary-terminal-projection.ts:251`) and `createCanaryRunProjector.projectTerminal`
   (`canary-run-projector.ts:149`) has exactly four steps — events (`:163`), terminal (`:188`),
   `finalizeRun` (`:211`), run-summary comment (`:228`) — **none of which writes `task_outputs`**.
6. **A judge that counts the wrong things** (§1.3, §1.4).

---

## 2. ★ CORRECTED SIZE — **L, not XL**, and Unit E is NOT required

**This is my own measurement, not the sweep's.** The XL estimate sized the `workspace_patch` route.
That route really is XL and really is blocked on Unit E — but it was never the cheapest honest route,
and clause 6 does not require it: the predicate is an **OR of two satisfiers**, and the artifact arm
is satisfied by any *committed* artifact, not by a workspace diff, once the judge stops filtering on
one kind (slice A).

| route | what it needs | size | verdict |
|---|---|---|---|
| **workspace_patch** | Unit E (a repository) **+** an in-sandbox `WorkspaceManifestV1` capture that does not exist **+** base/result snapshotting **+** `createResultCommitter` composition | **XL**, and gated on Unit E | not first |
| **stdout as `log` events** | `observeRun` composition + provider stream capture | M | **flips no counter** — evidence, not capability. Out of scope (§7) |
| **one named file → export → commit → project** | §1.6's six links, all small or already proven | **L** | **this unit** |

**Where the L sits.** Slices A, B, F are S; C, D, E are M–L. Nothing in the path is research: the
grant→PUT→commit half is live-proven (§1.5), the port and its conformance suite exist, the terminal
projector is composed and reachable, and the sandbox command line is already ours (Unit D).

**A measured "it really is XL" was on the table and is not what the evidence says.** What *is* XL and
genuinely Unit-E-blocked is the workspace-patch arm — and the honest consequence is that
**capabilityProven going green after Unit F does NOT close E7-F003**. §7 states that as an acceptance
criterion so a green cannot be read as more than it is.

---

## 3. ★★★ WHAT SUPPLIES THE OUTPUT

A composed bridge with nothing to feed it is this programme's most-repeated defect: `job_artifacts`
has RLS, grants, a commit path, an orphan sweeper and DR reconciliation, and **no producer**. So the
producer is named first, concretely, before any consumer is designed.

### 3.1 The producer: the agent's own output, at a fixed absolute path

Unit D already owns the sandbox command line. It emits a **fixed literal** `sh -c` script per
(adapter, has-bundle) pair, with the binary and the staged paths as separate argv elements
(`CLI-008-design.md` §4a). Unit F adds **one redirection and one constant path**:

```
sh -c 'for f in "$1" "$2"; do [ -r "$f" ] || { echo "[cli-008] staged input missing: $f" >&2; exit 78; }; done;
       exec "$0" --print - --output-format stream-json --verbose --append-system-prompt-file "$2" < "$1" > "$3"'
   claude  /home/user/.aoa-run-prompt.md  /home/user/.aoa-run-instructions.md  /home/user/.aoa-run-output.jsonl
```

Four properties, each deliberate:

- **A redirection, not a pipeline.** `> "$3"` preserves `exec`'s exit code exactly. `| tee` would
  replace the agent's exit status with `tee`'s, and POSIX `sh` has no `pipefail` — the run's
  success/failure verdict must not become a property of the capture.
- **Still a fixed literal.** `$3` is a fourth constant argv element read back positionally, exactly
  like `$1`/`$2`. Nothing is interpolated; Unit D's four "interpolate the binary" mutants stay valid
  and a founder-supplied `adapterConfig.command` still cannot close a quote.
- **A FLAT sibling in `/home/user`**, for Unit D's stated reason: a nested path rests on the E2B
  SDK MKDIRing a parent, which no test in this repo exercises against a real sandbox.
- **The bytes are the agent's own.** `--output-format stream-json` is the assistant's turns, its tool
  calls and its result — the thing the agent produced, byte for byte, not a description of it.

★ **This is the whole reason the unit is L.** "What did the agent produce?" is an open question if
you have to discover it (walk a tree, diff a repo, ask the provider to enumerate). It is a **fixed
constant** if the command line that starts the agent also decides where its output lands. Unit D put
that command line under our control; Unit F spends it.

**What this does NOT claim.** Capturing the transcript proves the agent produced *output*. It does
not prove the agent had tools, identity or a repository — those are E7-F003, and Units C and E. §7
holds the line.

### 3.2 Why the terminal projector, and not `jobOutputBridge`

`jobOutputBridge.projectAcceptedOutput` is the written-but-uncalled producer built for this shape
(`services/job-output-bridge.ts:250`, passing `createdByRunId` at `:291` and an optional
`executionWorkspaceId` at `:297` into `upsertTaskOutputForIssue` at `:303`; measured **0 production
callers** by `node scripts/check-gate-clause-wiring.mjs --counts`). **It is the wrong caller here,
and the reason is mechanical, not stylistic.**

Its first act inside the tenant transaction is `await repos.jobControl.lockActiveFence(input.fence)`
(`:263`) — the attempt must still be **RUNNING**. But `acceptEvent` applies the `attempt_terminal`
projection **inside the same batch loop that appends the events**
(`packages/db/src/repositories/tenant/job-control.ts:2605-2621`), and `guardActiveFence` refuses a
terminal attempt with the closed code `attempt_terminal`. The supervisor emits `artifact_prepared`
and `terminal` back to back, and the durable outbox batches by size and time, not by semantics — so
**the common case is that both ride one upload**, the attempt is terminal at commit, and any
after-commit fence-requiring projection finds a dead fence.

An "`onAcceptedOutput` hook beside `onAttemptTerminal`" therefore fails on the happy path. That is
the same shape as E7-F010: grow one side of a seam and the structures derived from the other side do
not follow you.

**The terminal projector does not have this problem, because it is fence-independent by
construction.** `createAttemptTerminalProjectionHandler` already:

- fires only when `run.executionOwner === "distributed"` (`canary-terminal-projection.ts:306`),
- holds `run.id` — a company-owned `heartbeat_runs` id, exactly the ref
  `assertTaskOutputRefs` validates for `createdByRunId` (`services/task-outputs.ts:123`) — and
  `target.issueId` (`:331`, resolved by `heartbeat.ts:7076` from `issues.executionRunId = run.id`
  **before** `finalizeRun` releases that lock),
- **already reads the attempt's durable `job_events`** (`:310-315`) and folds them, discarding
  `artifact_prepared` today,
- is composed and live: `index.ts` → `app.ts` → `worker-control.ts` → `job-events.ts:330` (after
  commit) → `heartbeat.ts:7092` → `canary-run-projector.ts:149`.

So the projection reads **committed, device-proofed, control-plane-verified** evidence and writes a
row. No fence, no new hook, no new ingest signal.

★ **Consequence for the register:** Unit F does **not** touch `jobOutputBridge`, so clause
`E3-17-output` stays honestly `unwired` (`scripts/gate-clause-wiring.json`), no
`unwired_but_now_has_caller` fires in the required `policy` job, and the sink-cutover owner's
decision is left where it belongs. This is a deliberate scope choice with a mechanical reason, not an
avoidance.

### 3.3 Why the judge must change first, and why that is not "widening to pass"

Slice A replaces the clause-6 predicate's inputs:

| | today | after slice A |
|---|---|---|
| artifact arm | committed `job_artifacts` for the job **whose `kind = 'workspace_patch'`** | committed `job_artifacts` for the job, **any frozen `kind`** |
| task-output arm | **in the predicate** — and forgeable by a POST (§1.3) | **observed and printed, not in the predicate** |

Three reasons this is strictly more honest, not less:

1. It **removes** the only forgeable arm. After slice A a `curl` cannot prove capability at all.
2. The widening it does is within one evidentiary class. Every committed `job_artifacts` row —
   `log` or `workspace_patch` alike — requires a leased worker, a live fence, a verified device
   proof, an object under the attempt-scoped key prefix, and a control-plane `headObject` that
   independently confirms the SHA-256 the worker declared. The per-row strength is identical; only
   the `kind` differs.
3. `workspace_patch` was never a discriminator for *"the agent produced something"*. It is a
   discriminator for *"the run had a repository"* — which is Unit E's question, and belongs in a
   clause that says so, not smuggled into clause 6's `kind` filter.

The task-output count stays in `E7ProducedOutputCounts` and stays printed, because the gap between
"an artifact was committed" and "the founder can see it on the task" is exactly the state slice E
closes, and an operator should be able to read that gap off the verdict line.

**Unit A's precedent is the template and is respected:** a clause nobody can pass gets bypassed,
argued around, then deleted. Slice A does not add such a clause — it takes an unpassable-but-honest
arm and a passable-but-dishonest arm and leaves one arm that is both.

---

## 4. The lettered slice plan

Each slice lands on its own commit with its own tests. **The order is load-bearing:** A before
anything (pin the defect first, or the anti-regression mutation cannot exist); the producer (B, C, D)
before the consumer (E), so no slice ships a composed thing with nothing to feed it.

### Slice A — the judge (S) · `server/src/services/e7-distributed-run-verifier{,-store}.ts`

1. `countProducedOutputs`: drop `eq(jobArtifacts.kind, "workspace_patch")` from the artifact query
   (`store:207`); keep `status = 'committed'` and the `jobId` binding. Rename the field
   `workspacePatchArtifacts` → `committedJobArtifacts` and add `kindsSeen: readonly string[]` to the
   observed shape so the printout says *what* was committed.
2. Clause 6's predicate becomes `produced.committedJobArtifacts < 1`. `taskOutputs` stays in
   `E7ProducedOutputCounts` and in `formatVerifyResult`, and leaves the predicate.
3. Rewrite the reason string to name the real links (§1.4) — the current text is E7-F016.

**Non-goals:** `ok` is not touched; `--require-capability` stays off by default; the CLI's exit codes
are unchanged.

### Slice B — the agent's output has a path (S) · `server/src/services/task-run-sandbox-invocation.ts` + `task-run-batch-workload.ts`

Add a fourth exported constant beside `STAGED_PROMPT_PATH` and `STAGED_INSTRUCTIONS_PATH`
(`task-run-sandbox-invocation.ts:60,64`) — `DECLARED_OUTPUT_PATH`, built from the same
`STAGED_INPUT_DIR` and resolving to `/home/user/.aoa-run-output.jsonl` — and the `> "$3"` redirect
(§3.1) to all four
(adapter × has-bundle) script shapes in `task-run-batch-workload.ts`.

★ **Unit D's structural invariant now has an exception, and it must be STATED in the assertion
rather than worked around.** Criterion 2 was *"every absolute path the argv names is a path the same
build stages, and the converse"*, asserted from the emitted argv. `$3` is an **output** path — named
by the argv and deliberately **not** staged, so the naive assertion fails. Split it into two sets
(staged inputs ↔ argv input positions; declared outputs ↔ argv output positions) rather than
loosening it to one, or the property Unit D bought stops discriminating.

★★ **Slice B also EMITS the pointer the worker will read.** The control plane knows the declared
output path; the worker must be told it. Use the namespace Unit B established — a per-run pointer on
the frozen envelope's `extensions[]` — as a **new** entry beside `com.armyofagents.job/staged-input`
(say `com.armyofagents.job/declared-output`), carrying `{path, kind: "log", contentType}`. Nothing
about the frozen schema changes; `extensions[]` is the bounded additive channel that exists for
exactly this (`packages/worker-protocol/src/extensions.ts`). See open question 3 for the
`critical` flag, which is a real fork and must be decided before slice D starts.

★ **The in-sandbox guard does NOT grow to cover `$3`.** `STAGED_INPUT_MISSING_EXIT_CODE = 78`
(`:80`) fires when a needed *input* is unreadable, before the agent starts. An unwritable output
path is a different failure with the opposite polarity (§4 slice D.5) and must not fail the attempt
closed; `sh`'s redirection failure is the honest signal, and the export step's absence of an
artifact is what the verdict then reads.

### Slice C — a real provider export (M) · `packages/sandbox-e2b-provider`

Implement `digestArtifact` and `exportArtifact` on `E2bSandboxProvider` and flip
`artifactExportMode` to `"grant_upload"`.

- `digestArtifact` = `#transport.readFile` + `node:crypto` sha256 + byte length. **Metadata only**;
  a missing path **rejects** and never fabricates a digest (the WRK-009 lesson, already pinned by the
  slice-1 conformance suite).
- `exportArtifact` = `#transport.readFile` + an HTTPS `PUT` to `grant.url` carrying
  `x-amz-checksum-sha256` (§1.5's sharp edge), returning `{objectKey}` — a **reference**, never
  bytes. Refuse if the read exceeds `grant.maxBytes` or its digest differs from
  `grant.expectedSha256`, before any PUT.
- **Boundary-legal without a new dependency:** `scripts/check-sandbox-e2b-provider-boundary.mjs`
  enforces an exact dependency set plus Node built-ins; global `fetch` is a Node global, not an
  import, and a presigned PUT carries no credential, so nothing enters the `E2B_API_KEY` /`e2b`-SDK
  confinement that guard also enforces.
- **The grant is a bearer capability** (`provider.ts:418-424`): it must never reach a log line, an
  error message, or a `RedactedResourceProjection`.
- `provider-wire`'s driver and `noop-provider` stay `"none"` — see the lane statement in §5.9.

### Slice D — the worker-side consumer (M–L) · `packages/worker-daemon`

This is DAT-009 slice 3, scoped to **one declared output path** rather than to a general capture.

0. **Read the pointer.** A `readDeclaredOutputPointers(handoff.offer.job.extensions)` mirroring
   `readStagedInputPointers` (`lease/staged-input.ts`). A run whose envelope carries no pointer
   resolves to `[]` and the lifecycle is byte-identical to today — which is what keeps export
   optional, exactly as staging is. **Do not start slice D before open question 3 is answered**: the
   `critical` flag on that pointer decides whether an un-understood namespace refuses or exports
   nothing, and that is the same fork Unit B decided for staging.
1. **`EffectAuthority` grows the pair**, mirroring `stageFiles` exactly
   (`supervisor/effect-authority.ts:94-108`): both are effectful reads of a live sandbox and must be
   fence-gated, so a run whose lease was replaced cannot still be exporting from the sandbox its
   successor is about to use.
2. **The supervisor's post-execute step**: after `execute` and *before* `terminal`, for each declared
   output path — digest → `artifactTransferGrant(operation:"upload", expectedSha256, maxBytes)` over
   the frozen op → `exportArtifact` → `artifactCommit`
   (`transport/client.ts:567`, whose route is already mounted).
3. **`EventSequencer.artifactPrepared(artifactId, kind)`** — the eighth emitter, emitted after a
   successful commit. The event type is already frozen (`worker-protocol/src/events.ts:358`) and
   already in the `job_events` CHECK constraint (`packages/db/src/schema/job_events.ts:72-82`), so
   **no protocol change and no migration**.
4. ★★★ **Register `digest_artifact` and `export_artifact` in
   `CLOSED_LABEL_VALUES.operation`** (`worker-daemon/src/metrics/metrics.ts:80-103`). Neither is a
   frozen `PROVIDER_OPERATIONS` member, so — exactly like `stage_files` — nothing adds them for you,
   and an unregistered label makes `emitOp` **throw on the happy path**, landing in `accept()`'s
   last-resort catch, which emits **no terminal**. That is E7-F010, verbatim, and it is the single
   likeliest way this slice ships broken.
5. **Failure polarity — export fails OPEN, unlike staging.** Staging is *input*: a run without its
   context produces plausible work and a clean terminal, so it fails closed. Export is *after the
   work*: losing the terminal costs the run its issue lock, the agent its status, and — because
   `finalizeAgentStatus` recomputes from the count of running rows — every **other** run of that
   agent (R7). A failed export must therefore be caught, logged, `emitOp(..., "failed")`, and the
   terminal emitted anyway. This is not a fail-open in the safety sense: the observable result is
   `capabilityProven === false` on a run that succeeded, which is the **true** statement "nothing the
   agent produced reached AoA".
6. **Enrol the new orphans.** Add a `gate-clause-wiring.json` clause naming `exportArtifact` (or the
   supervisor's export step) with an explicit `expectedReferences`, so a later removal of the caller
   reds the required `policy` job. Every orphan composed is born with its caller — Unit B's rule.

### Slice E — the projector (M) · `server/src/services/canary-*.ts`

1. `foldAttemptEvidence`: fold `artifact_prepared` rows into a new
   `evidence.producedArtifacts: ReadonlyArray<{artifactId: string; kind: string}>`. Leave
   `detectedFiles: []` alone — that field means *file paths*, which `artifact_prepared` genuinely
   does not carry. (While here, fix the stale citation at `canary-terminal-projection.ts:251`: the
   payload is at `worker-protocol/src/events.ts:92-94`; `:294` is
   `serviceInstanceStoppedPayloadV1Schema`.)
2. `CanaryRunProjectorDeps` gains an **optional** `writeProducedOutput?` port (optional so a
   deployment that has not wired the canary path composes exactly the pre-Unit-F projector — the
   `finalizeRun` precedent at `canary-run-projector.ts:88-95`).
3. `projectTerminal` gains **step (5)**, placed *after* step (4)'s block so it inherits the
   `if (lostLatch || !target.issueId) return;` early return at `:226` — which is precisely the
   replay-once and no-fabricated-task guarantees, obtained from the code that already owns them.
   Best-effort, in its own `try/catch`, like every other substep.
4. The row, per produced artifact:
   `{ type: "detected_file", provider: "aoa", externalId: "distributed-artifact:<artifactId>",
   title: <kind + basename>, createdByRunId: target.runId, createdByAgentId: target.agentId,
   executionWorkspaceId: undefined, metadata: { jobId, attemptId, jobArtifactId, kind } }`.
   ★ **`externalId` is mandatory, not decoration:** `upsertTaskOutputForIssue` is idempotent **only**
   through the `(provider, externalId)` branch (`services/task-outputs.ts:150`); without it, line
   `:180` is an unconditional `insert`, and a redelivered terminal duplicates the row.
   ★ `CanaryProjectionTarget` (`canary-run-projector.ts:52-58`) does **not** carry `agentId` today,
   though `CanaryRunRow` does (`canary-terminal-projection.ts:53`). Add it to the target rather than
   re-reading the run — the handler already holds the row.
5. Compose the port at `heartbeat.ts:7122`, beside `postRunSummary`.
6. ★ **The row must be honest about what it is.** It carries no `assetId` and no `url`, so
   `OutputsSection`'s field-aware mapping renders it as a non-clickable entry. That is the correct
   v1 rendering of "a committed artifact exists and is not yet downloadable from here" — but the
   title must say `kind` plainly rather than implying a file the founder can open. Making it
   downloadable is §7's named follow-up, not a thing to half-build here.

### Slice F — advertisement and lane (S) · config + docs

Per the byte-egress decision's **ordered** prerequisite list (advertise **before** requiring, never
the reverse — requiring first sends every job to a permanent no-match): the E2B target's
`capabilityCeiling` and the worker's `reportedCapabilities` gain `artifact.direct_upload`
(already accepted by the request→frozen translation, so no code change there), and only then may any
job require it. Unit F does **not** add it to any `requiredCapabilities`. Document the lane
(§5.9) and add `AOA_STORAGE_PROVIDER: "s3"` to the E7-1 campaign preconditions.

### Slice G — the campaign (OPERATOR, not session-buildable)

Re-run the E7-1 staging canary with `--require-capability`. Exit 3 → the mechanism ran and nothing
was produced; exit 0 → clause 6 is satisfied by a committed artifact. This is the only slice that can
promote `E7-1-coding-journey` past the capability half, and it needs the deployed staging fleet.

---

## 5. Every fail-closed / gate clause, and the positive control that proves it can fire

A guard that has never gone red is a guard nobody has tested. Each row names the mutation that must
turn it red.

| # | clause | positive control | mutation that must RED it |
|---|---|---|---|
| 5.1 | **A forged `task_output` does not prove capability** (slice A) | Write a `task_output` with `createdByRunId = <a distributed run>` through the real service; assert `capabilityProven === false` | Re-add `\|\| produced.taskOutputs >= 1` to the clause-6 predicate → this test goes red |
| 5.2 | **A committed non-`workspace_patch` artifact DOES prove capability** (slice A) | Insert a `committed` `log` `job_artifacts` row for `run.distributedJobId`; assert `capabilityProven === true` | Restore `eq(jobArtifacts.kind, "workspace_patch")` → red |
| 5.3 | **An uncommitted artifact does NOT** (slice A, unchanged) | A `granted`-status row leaves `capabilityProven === false` | Drop the `status = 'committed'` predicate → red |
| 5.4 | **`digestArtifact` on a missing path fails rather than fabricating** (slice C) | Reject on an unknown path; assert no digest is returned. Already the strongest test in the slice-1 conformance suite — extend it to the real provider | Return a digest of empty bytes → red |
| 5.5 | **A provider that cannot export still declines honestly** (slice C) | `provider-wire` + `noop` keep `artifactExportMode: "none"` and throw `UnsupportedProviderOperation` | Flip either to `grant_upload` without an implementation → the conformance decline test reds |
| 5.6 | ★★★ **The new metric labels are registered** (slice D) | A test that constructs a **real** metrics registry (not `undefined`) and calls `emitOp("digest_artifact","success")` and `emitOp("export_artifact","success")`, asserting neither throws | Delete either label from `CLOSED_LABEL_VALUES.operation` → red. **Without this test the slice ships E7-F010 again**, and E7-F010 was invisible precisely because no staging test composed a real registry |
| 5.7 | **A failed export never strands the attempt non-terminal** (slice D) | Make `exportArtifact` throw; assert a `terminal` event is still emitted and **no** `artifact_prepared` is | Remove the try/catch around the export step → red |
| 5.8 | **A truncated upload never commits** (slices C+D, live) | Re-use the DAT-002 slice-7 D1 assertion: a `limit_data` toxic on `worker-to-minio` truncates the PUT; assert the commit rejects and **no** `job_artifacts` row persists — and therefore `capabilityProven === false` | Skip the `x-amz-checksum-sha256` header, or verify size only → red |
| 5.9 | **The lane is stated, and the other lane still refuses** (slice F) | `ProviderWireDriver.artifactExportMode` stays `"none"`; `export_artifact` stays out of the frozen `PROVIDER_OPERATIONS` and out of `adapter-manager/src/server.ts`'s handler set, so a container-lane export is a refusal, not a silent skip | Add a wire route without adding it to the gate's required-ops set → the adapter-manager boundary/gate test reds |
| 5.10 | **A redelivered terminal writes ONE row** (slice E) | Project the same terminal twice; assert exactly one `task_outputs` row | Null the `externalId` → two rows → red |
| 5.11 | **A lost terminal latch writes NO row** (slice E) | `setRunStatus` resolves `false`; assert no `task_outputs` row and no summary | Move step (5) above the `:226` early return → red |
| 5.12 | **A run with no issue writes NO row** (slice E) | `target.issueId === null`; assert nothing is written (`task_outputs.issueId` is `notNull`, `task_outputs.ts:29`) | Same mutation as 5.11 |
| 5.13 | **A legacy-owned run is never projected** (slice E, existing) | `run.executionOwner !== "distributed"` returns at `canary-terminal-projection.ts:306` before any write | Delete the guard → a legacy run gains a distributed artifact row → red |

★ **The gate this unit must NOT create.** Unit A faced a clause nobody could pass and the remedy was
a **second verdict computed beside `ok`**, never a fold into `ok`. Unit F does not fold anything into
`ok` either: clause 6 stays in `capabilityFailures`, `--require-capability` stays off by default, and
slice A's change makes the existing second verdict *reachable* rather than adding a third.

---

## 6. Acceptance

**Unit F is met when a distributed coding run on the E2B lane produces, without human action:**

1. a `job_artifacts` row for that run's job, `status = 'committed'`, whose object the control plane
   independently verified by SHA-256 — i.e. `capabilityProven === true` and
   `pnpm verify:e7-1-distributed-run <runId> --require-capability` exits **0**;
2. an `artifact_prepared` `job_events` row naming that artifact, with a `terminal` row after it;
3. exactly **one** `task_outputs` row on the run's task, `created_by_run_id = <the run>`,
   surviving a redelivered terminal;
4. and a run whose **export failed** still reaching a durable `terminal`, with
   `capabilityProven === false` — the true statement, not a masked one.

**Explicitly NOT acceptance, and stated so a green cannot be over-read:**

5. **E7-F003 is not closed.** No clause reads the artifact's *content*, so a run that produced a
   transcript and a run that produced a *good* transcript are still indistinguishable to the
   verifier. Tools are Unit C; a repository is Unit E.
6. **`ok` is unchanged**, and a green `ok` still says nothing about capability.
7. **The container/networked lane is not covered** (§5.9).

---

## 7. What this unit deliberately does NOT do

- **It does not build the `workspace_patch` arm.** `buildWorkspacePatch` and `createResultCommitter`
  keep their zero production callers, and their gate clauses stay honestly unwired. That arm needs
  Unit E *and* an in-sandbox manifest capture; deferring it is the whole reason Unit F is L.
- **It does not compose `observeRun` and does not make `stdoutRef`/`stderrRef` real.** Both are
  evidence improvements that flip no counter. Composing them would be a second byte channel beside
  the one this unit builds, argued for by a reason string that is itself E7-F016.
- **It does not wire `jobOutputBridge`** (§3.2) — `E3-17-output` stays `unwired` with its reason
  intact, and the sink-cutover owner's decision is untouched.
- **It does not make the artifact downloadable from the task.** The row carries provenance
  (`metadata.jobArtifactId`, `objectKey`, `kind`), not an `assetId` or a URL — a presigned URL in a
  durable row expires into a broken link. A founder-facing download route that mints a fresh grant is
  a follow-up, and the row it would light up already exists after slice E.
- **It does not enforce retention.** `log` maps to the `run` class
  (`services/browser-artifact-retention.ts`), and `artifact-retention-authority.ts` states in terms
  that *"nothing reads the stored column to act"*. A task_output pointing at a swept object is a
  future hazard, not a present one; it belongs with the enforcement follow-up DAT-010 already names.

---

## 8. Findings filed with this design

Both are entered in `scripts/finding-ownership.json` in the same commit as their register blocks.

| id | severity | what |
|---|---|---|
| **E7-F015** | MEDIUM | The capability bar is forgeable: `POST /api/issues/:id/outputs` accepts `createdByRunId` from the request body with only a company-ownership check, and `countProducedOutputs` applies no provenance filter — so one authenticated POST flips `capabilityProven`. Owned by CLI-008; slice A closes it |
| **E7-F016** | LOW | Clause 6's operator-facing failure reason names four unbuilt links, three of which cannot flip either counter, and omits the ones that are decisive — and it produced this unit's XL estimate. Owned by CLI-008; slice A rewrites it |

**Observed, not filed** (each is a candidate for a successor rather than a defect this unit should
carry):

- `AOA_WORKER_S3_ENDPOINT` is documented (`docs/deploy/environment-variables.md:203`), injected by
  both the D1 and staging composes, and **asserted by `scripts/lib/d1-compose-invariants.mjs:80`** —
  with **zero TypeScript readers anywhere in the repo**. A guard asserting a variable nothing
  consumes is this programme's own failure class. It becomes *relevant* at slice C (the PUT dials
  the presign host named in the grant, so the var is still not needed) — which is exactly why it
  should be either read or retired rather than left asserted.
- `packages/worker-daemon/src/supervisor/events.ts:190-192` states *"`createSupervisor` has zero
  production callers"*. `node scripts/check-gate-clause-wiring.mjs --counts` reports **4**, and
  `lifecycle/dispatch-runtime.ts:4` declares itself the first. Slice D edits this file; fix the
  comment there. (The clause's own conclusion survives on `browserObservation`'s separate zero.)
- `canary-terminal-projection.ts:251` cites `worker-protocol/src/events.ts:294` for the
  `artifact_prepared` payload; that line is `serviceInstanceStoppedPayloadV1Schema`. Slice E fixes it.

---

## 9. Open questions the implementer must answer

1. **Does the E2B SDK's `files.read` return bytes for a file written by a redirected `exec`?**
   `#transport.readFile` exists and is uncalled; nothing in this repo has ever exercised it against a
   real sandbox. **Step 0 for slice C:** call it once in the operator-dispatched keyed lane
   (`keyed-real-e2b.test.ts`) before building anything on top of it. If it does not work, slice C's
   shape changes and this design needs a second pass — say so and stop, the way WRK-015 did.
2. **One output path or a list?** The design assumes exactly one (`$3`). A list generalizes the
   supervisor step but multiplies the grant round-trips and needs a per-file failure policy. Start at
   one; the port takes a `path` per call, so widening later is additive.
3. ★ **Is the declared-output pointer `critical`?** Slice B assigns the CHANNEL (a new
   `extensions[]` namespace beside the staged-input one). What it does not assign is the flag, and
   this is a real fork with opposite failure directions: `critical: true` means a worker that does
   not understand the namespace **refuses the offer** (nothing runs, no capacity claimed);
   `critical: false` means it runs and simply exports nothing (the run succeeds and
   `capabilityProven` stays false). **Recommendation: `critical: false`**, because it agrees with
   the export step's own polarity (§4 slice D.5) — losing a transcript must not cost a completed
   run its terminal. Decide it, and write the reason at the constant, **before slice D starts**.
4. **Size ceiling.** A long stream-json transcript can be large; `DEFAULT_MAX_ARTIFACT_BYTES` bounds
   the commit server-side, and the grant carries `maxBytes`. Decide whether the worker refuses before
   the PUT (recommended — a rejected commit wastes the upload) and what the operator sees when it
   does.

---

## 10. Corrections to earlier records

- ★ **`heartbeat.ts` line numbers in circulation are wrong at this tip.** The suppression guard is at
  **5399**, its `return; // CLI-006-SUPPRESSION-RETURN` at **5451**, `adapter.execute` at **5453**,
  the `emitSandboxPreviewTaskOutput` call at **5557**, and the `detected_outputs` write at **5907**;
  `executeRun` spans **3061–6119**. The widely-quoted 5409 / 5411 / 5515 / 5865 are from
  `203853b3a`, seven commits behind `d0b75be19`. The structural conclusion is unchanged: the return
  precedes both sinks, inside one function.
- **`e7-distributed-run-verifier-store.ts:166` is not the capability predicate.** `:165` is the
  clause-4 leak scan and `:216` is `countProducedOutputs`; `:166` is a loop header. Same predicate,
  different function, different verdict.
- **`routes/task-outputs.ts`**: the `svc.upsertForIssue(..., req.body)` call is at **:53** at this
  tip, in the handler registered at **:45**.
- **"the crew path is the template"** — it is a template for the *shape* of a workspace-free
  `task_output` and for nothing else. Crew's run id is minted into `internal_agent_runs`
  (`aoa-agents/runner.ts:231`) while `task_outputs.created_by_run_id` FKs `heartbeat_runs`
  (`packages/db/src/schema/task_outputs.ts:46`), which is why `crew-output-capture.ts:129` writes
  `null` deliberately and why its own negative-control test proves the substitution is rejected. No
  crew row can ever satisfy the counter, and crew never writes a `heartbeat_runs` row at all, so the
  verifier's domain does not contain it.

## 11. Depends on

`CLI-008` Units B and D (the channel and the command line), `CLI-006` (the canary seam and the
terminal projector), `DAT-002` + slice 7 (the grant/commit pipeline and its live-MinIO proof),
`DAT-009` slice 1 (the export port), and the frozen contracts in `packages/worker-protocol` — which
this unit works **within**: no new event type, no new provider operation, no migration.
