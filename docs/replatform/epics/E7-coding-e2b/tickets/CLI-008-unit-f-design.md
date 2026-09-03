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

## 0. The bar this unit answers to, and then the answer

★★★ **First, what clause 6 can honestly assert — because everything below follows from it, and an
earlier draft of this document did not pick.** `capabilityProven` is computed from two SQL counts. A
count over rows can assert **provenance** — *these bytes reached durable AoA storage through an
attested path* — and it cannot assert **productivity** — *these bytes are the work the task asked
for*. The two arms of clause 6 fail on **different axes**, and collapsing that into one word
("non-probative") is what let an earlier draft argue both sides of a single principle:

| arm | provenance | productivity |
|---|---|---|
| `task_outputs` where `created_by_run_id = run.id` | **none** — any company-scoped actor can POST it (§1.3, E7-F015) | none |
| a `committed` `job_artifacts` row | **full** — live fence, verified device proof, attempt-scoped object prefix, control-plane `headObject` re-verifying the declared SHA-256 | **none — and this document says so at every point where it matters** |

**Unit F picks provenance, and makes the operator-facing text say so.** That is not retreating to a
weaker bar so something can pass. Provenance is the only axis on which the two arms differ; it is the
axis this whole substrate — leases, fences, device proofs, attested commits — exists to provide; and
it is the only axis a row predicate can read at all, because the verifier reads the control plane's
tables and never the artifact's bytes. Productivity is not abandoned: it moves to the **producer**,
which can inspect content (§3.1's export floor), and the residual weakness is written into acceptance
as an explicit non-claim (§6.6, restated as scope in §7) rather than left for a reader to trip
over.

**Then the answer.** `capabilityProven` turns on those two counters, and **not one of the four links
the verifier's own failure text blames is one of them** (E7-F016). The arm the text is really about —
a committed `workspace_patch` job artifact — is blocked behind Unit E *and* behind an in-sandbox
manifest capture that does not exist, because `buildWorkspaceManifest` walks a **local** filesystem
with `node:fs`. The other arm is reachable today by **a board `curl`**, which makes the programme's
headline gate forgeable (E7-F015). So the cheapest satisfier that is honest **on the provenance
axis** is: **one named file, written by the agent's own process to a fixed absolute path Unit D's
script already owns, exported by the provider under an upload grant the D1 lane has already proven
end to end against real MinIO, committed as a `log` job artifact, and projected onto the task**. That
path needs no workspace, no `buildWorkspacePatch`, no `createResultCommitter`, and no `observeRun` —
and it is **L**.

★★ **Two things a reader of the previous draft must un-learn**, both corrected in place rather than
quietly swapped, because both are the shape the next implementer would reach for anyway:

1. The output path is **not** an argv positional and the redirect is **not** `> "$3"`. Three shipped
   tests catch that shape. §3.1 has the measurement and the shape that survives.
2. The captured bytes are **not** "the thing the agent produced, byte for byte". They are a JSONL
   protocol transcript, non-empty even for a run in which the model never spoke. §3.1 states what
   they are; §6 states what they do not prove.

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

★ **The table's right-hand column is the whole design decision.** The two arms are not
"one strong, one weak" on a single scale — they differ on **who can cause the row to exist**, and on
nothing else. Neither arm reads a byte of the artifact, so neither can say anything about *what* was
produced. §0 names that axis and §3.3 spends it.

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
   particular. There is no agreed absolute path inside the sandbox holding anything this run emitted.
   ★ Closing this is **one constant in an existing fixed script literal**, not a new argv positional
   — see §3.1, which records why the positional shape fails against three shipped tests.
2. **No real `exportArtifact`/`digestArtifact`.** `E2bSandboxProvider` declares
   `artifactExportMode = "none"` and declines both (`e2b-provider.ts:178,391-402`) — honestly, and
   with `#transport.readFile` (`real-transport.ts:196`) sitting one line away, uncalled.
3. **No worker-side consumer.** Nothing sequences digest → mint upload grant → export → commit. This
   is DAT-009 slice 3, chartered on Track B (GO-BOOK §1.9.3) and unbuilt.
4. **No announcement.** `EventSequencer` has no `artifactPrepared` method, so a committed artifact is
   invisible to the control plane's evidence stream. ★ **This blocks slice E's projection and
   acceptance §6.2 — it does NOT block the counter.** `countProducedOutputs` reads `job_artifacts`
   directly and joins no events (§2.1 Q2). Confusing the two is the sweep's error this design
   corrects.
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
**capabilityProven going green after Unit F does NOT close E7-F003**. §6.6 states that as an
acceptance non-criterion so a green cannot be read as more than it is.

★★★ **L is the size of A–E TOGETHER, not of any prefix of them.** The artifact arm has **zero
producers today** (§2.1 Q2), so slice A alone leaves a gate nobody can pass. Anyone scheduling this
unit should read the L as one increment; there is no half-Unit-F that improves anything.

---

## 2.1 ★★★ Two questions answered as MEASUREMENTS, because assuming either would sink the plan

### Q1 — after slice A, what still owns *"a distributed run can produce a `task_output`"*?

**Measured: two owners, and neither of them is a sentence in this document.** Taking the arm out of
the clause-6 predicate does not withdraw the question; here is where it demonstrably still lives.

1. **`gate-clause-wiring.json`'s `E3-17-output`** —
   `{"epic":"E3","status":"unwired","symbol":"jobOutputBridge","reason":"JOB-014 output projection
   has zero callers; task_outputs is still written by the legacy path. Wire at sink cutover
   (Sprint 6)."}` (`scripts/gate-clause-wiring.json:21-26`). That clause owns the **general**
   distributed-job → `task_outputs` projection, it is checked by the **required `policy` job**, and
   Unit F deliberately leaves it alone (§3.2). It was the owner before this design and it is the
   owner after it.
2. **Unit F slice E**, which builds the E7-1-specific projection and carries it as **acceptance
   criterion §6.3**, with three positive controls: §5.10 (replay writes ONE row), §5.11 (a lost
   terminal latch writes NO row), §5.12 (a run with no issue writes NO row).

★ **And here is the cost, stated rather than glossed.** Before slice A the question was enforced by a
clause **a verify run reads and prints**. After slice A it is enforced by **unit tests and an
acceptance criterion**. That is *weaker in a specific way*: a unit test reds in CI, but no
`verify:e7-1-distributed-run` invocation will ever report "the artifact committed and the founder
still cannot see it on the task". Slice A's mitigation is that `taskOutputs` stays in
`E7ProducedOutputCounts` and stays **printed by `formatVerifyResult`**, so the gap between the two
counters is readable off the verdict line by an operator who knows to look. That is a printout, not a
gate, and this document does not dress it up as one.

★★ **What this is NOT: the chartered question deleted.** The wave was convened to answer *what
supplies the output*, and Unit F answers it by **building the supply** — slices B, C, D and E,
including the `task_outputs` row. What slice A removes is that row's standing as a **gate satisfier**,
and the reason is structural rather than presentational: **clause 6 is an OR, and in an OR the
weakest arm sets the bar.** Two different questions had been disjoined into one predicate — *did
attested bytes leave the sandbox* and *can the founder see them* — so a forged answer to the second
was a sufficient answer to the first. Slice A separates them. It drops neither.

### Q2 — is the widened artifact arm actually reachable?

A sweep angle reported that the worker's event-sequence class exposes seven emitters and has **no**
`artifactPrepared` method, so the frozen protocol's one artifact-announcement event is unemittable —
and inferred that after slice A **both** arms of `capabilityProven` may be unreachable, making the
gate unpassable. **I verified it myself. The premise is TRUE. The inference is FALSE. And a
different, sharper problem is true instead, which the sweep was circling and did not name.**

**VERIFIED — the premise.** `packages/worker-daemon/src/supervisor/events.ts` declares exactly seven
emitters — `attemptStarted` (`:147`), `networkDenied` (`:155`), `log` (`:162`), `progress` (`:170`),
`usage` (`:178`), `browserObservation` (`:206`), `terminal` (`:220`) — and no `artifactPrepared`. A
repo-wide grep for `artifact_prepared`/`artifactPrepared` outside tests returns seven hits and
**every one is a declaration, not an emission**: the DB CHECK
(`packages/db/src/schema/job_events.ts:75`), the frozen payload schema, type, vocabulary entry and
variant (`packages/worker-protocol/src/events.ts:92,95,358,387`), the re-export
(`worker-protocol/src/index.ts:324`), and one comment
(`server/src/services/canary-terminal-projection.ts:248`). **Nothing emits it.**

**REFUTED — the inference, and the refutation is one clause of the store.** The artifact arm does not
read events. `countProducedOutputs` queries `job_artifacts` directly —
`and(eq(jobArtifacts.jobId, run.distributedJobId), eq(jobArtifacts.kind, "workspace_patch"),
eq(jobArtifacts.status, "committed"))` (`e7-distributed-run-verifier-store.ts:201-211`) — and the
module contains no `job_events` join anywhere. **A committed artifact counts whether or not anything
announced it.** `artifact_prepared` is needed for slice E's projection and for acceptance §6.2; it is
not on the path to the counter.

★ **And adding the emitter is not blocked either.** `artifact_prepared` is already in the frozen
vocabulary (`worker-protocol/src/events.ts:358`) with a frozen payload (`:92-94`) and is already in
the `job_events` CHECK constraint (`schema/job_events.ts:75`). `EventSequencer` is **daemon** code,
outside the `worker-protocol-contract-bytes` job's freeze. Slice D.3 adds an eighth method: no
protocol change, no migration.

★★★ **THE REAL PROBLEM, STATED CORRECTLY: the artifact arm has ZERO PRODUCERS TODAY, so slice A
shipped ALONE turns a forgeable gate into an unpassable one.** Measured: the daemon's HTTP client
declares `artifactCommit` (`worker-daemon/src/transport/client.ts:266,567`) and **no production code
calls it** — `patch/result-commit.ts:25` names it only in a comment — and both shipped providers
declare `artifactExportMode: "none"` (`e2b-provider.ts:178`, `provider-wire/src/driver.ts:83`). The
mechanism is proven (DAT-002 slice 7 drove the routes 13/13 from the test runner); the **producer**
is absent.

| state | artifact arm | task-output arm | `capabilityProven` |
|---|---|---|---|
| today | 0 producers | forgeable by one authenticated POST (E7-F015) | **passable only by forgery** |
| **after slice A alone** | 0 producers | not in the predicate | ⚠️ **unpassable** |
| after slices A–E | the committed transcript artifact | not in the predicate, still printed | **passable, on provenance** |

**Three consequences, and they bind the plan rather than decorating it:**

1. ★ **A–E land together, or A does not land.** Landing A first *within* Unit F is right (pin the
   defect before the fix, or the anti-regression mutation cannot exist) and it is safe in isolation
   only because `--require-capability` is **off by default**
   (`server/src/cli/verify-e7-1-distributed-run.ts:65`), no workflow runs the verifier, and GO-BOOK
   §9 tells the operator not to pass it. But a Unit F that lands A and stops has shipped a gate
   nobody can pass — which is precisely the precedent CLI-008 Unit A set **against**. This is
   written into acceptance as §6.9.
2. The interim errs in the **safe** direction — an unpassable gate under-reports where a forgeable
   one over-reports — but it is still an interim, and it is named here so that nobody discovers it
   from a red verify run.
3. ★★ **Slice C's open question 1 is therefore a precondition on slice A, not just on slice C.** If
   `#transport.readFile` cannot read a file written by a redirected `exec` (open question 1), the
   producer does not exist and **neither slice may land**. That dependency was implicit in the slice
   ordering before; it is explicit now.

---

## 3. ★★★ WHAT SUPPLIES THE OUTPUT

A composed bridge with nothing to feed it is this programme's most-repeated defect: `job_artifacts`
has RLS, grants, a commit path, an orphan sweeper and DR reconciliation, and **no producer**. So the
producer is named first, concretely, before any consumer is designed.

### 3.1 The producer: the agent's own process output, at a fixed absolute path

Unit D already owns the sandbox command line. It emits a **fixed literal** `sh -c` script per
(adapter, has-bundle) pair, with the binary and the staged paths as separate argv elements
(`CLI-008-design.md` §4a). Unit F adds **one redirection, whose target is a module constant baked
into that same fixed literal**:

```
sh -c 'for f in "$1"; do [ -r "$f" ] || { echo "[cli-008] staged input missing: $f" >&2; exit 78; }; done;
       exec "$0" --print - --output-format stream-json --verbose < "$1" > /home/user/.aoa-run-output.jsonl'
   claude  /home/user/.aoa-run-prompt.md
```

★★★ **THE OUTPUT PATH IS NOT AN ARGV POSITIONAL, AND AN EARLIER DRAFT OF THIS DOCUMENT SAID IT WAS
(`> "$3"`, with the path appended to the argv). That draft was wrong in three independent ways, and
each one is caught by a test that is already shipped.** The correction is recorded rather than
silently swapped, because the broken shape is the *obvious* one — the next implementer will reach for
it too.

| what `> "$3"` assumed | what is measured at `d0b75be19` |
|---|---|
| **`$3` is a stable index** | It is not. `args: ["-c", script, input.binary, ...paths]` (`task-run-sandbox-invocation.ts:212`) makes `$0` the binary and `$1…$n` the staged paths — and the **instructions path is conditional** (`:164`, `:169`), so the no-bundle shape has exactly ONE path. That shape is pinned twice: `emits the codex shape — NOT the claude flags, which are meaningless to it` asserts the argv is exactly `["-c", script, "codex", STAGED_PROMPT_PATH]` (`task-run-batch-workload.test.ts:215-226`), and `stages NO bundle and emits NO bundle flag when it is %s` asserts `stagedFiles` is exactly `[STAGED_PROMPT_PATH]` (`:371-381`). In that shape the output positional is `$2`; a literal `$3` expands to the empty string, and `> ""` is an `sh` redirection failure |
| **the path can ride the `paths` array** | Then it fails on the **happy path**. `readableGuard(paths.length)` (`:176`, defined `:118-124`) derives the guard's arity from the array and emits one `[ -r "$i" ] \|\| exit 78` per element. The output file **does not exist before exec**, so the guard would 78-refuse every run. `guards every staged path it reads, with an attributable exit code` (`:388-406`) asserts that arity in **both** directions — every staged index guarded, and `"$n+1"` absent |
| **the path can ride the argv but skip `paths`** | Then it fails the structural invariant. `every absolute path in the %s argv is staged (instructions: %s)` (`:229-252`) is a non-example-based `it.each` ending in `expect([...stagedPaths].sort()).toEqual([...argvPaths].sort())` — **set equality, not containment**. A fourth argv element nothing stages reds it, on all four (adapter × bundle) rows |

**Three escapes, all closed.** This is the E7-F010 class exactly: grow one side of a seam and the
structures derived from the other side do not follow you.

**The shape that survives all three: a constant in the script text, not in the argv.**
`STAGED_INPUT_DIR` is already a module constant, and `readableGuard(...)`'s output is already
interpolated into the script template — so `> ${DECLARED_OUTPUT_PATH}` is structurally the same move
the module already makes. Measured against each pin, **no test needs editing**:

- `paths` is **unchanged** → the guard's arity is unchanged → `:388` passes untouched, and the guard
  now *structurally cannot* cover the output path rather than merely being instructed not to.
- The argv is **unchanged** (4 elements with a bundle, 3 without) → the two `toEqual` shape
  assertions at `:208` and `:220` pass: both match the script through
  `expect.stringContaining('… < "$1"')`, and appending a redirect leaves that substring intact.
- `argvPaths` is `args.filter((arg) => arg.startsWith("/"))`; `args[1]` is the script and begins
  `for f in`, so it is not an argv path → `:229-252` passes untouched.
- `stdinFromScript` (`:307-312`) matches by `script.includes(...)` and **throws** on a shape it does
  not recognise — its anti-vacuity control still fires, and a trailing redirect does not disturb the
  three matches it knows.

★ **Zero test EDITS is not zero test WORK, and the difference is the whole point.** The invariant at
`:229-252` now has an absolute path it does not see. Leaving that implicit would be *hiding* an
exception behind a filter predicate — this programme's own worst failure class, "a check that nothing
runs". Slice B therefore **adds** an assertion that states the exception instead of relying on it:
the declared output path appears **in the script**, is absent from **`stagedFiles`**, is absent from
the **guard prefix**, and is not an element of **`args`** (slice B point 3 lists all four). A future
change that promotes it to a positional, or that stages it, or that silently drops the redirect, reds
that test.

Four properties of the redirect itself, each deliberate:

- **A redirection, not a pipeline.** `> PATH` preserves `exec`'s exit code exactly. `| tee` would
  replace the agent's exit status with `tee`'s, and POSIX `sh` has no `pipefail` — the run's
  success/failure verdict must not become a property of the capture. (The codex has-bundle shape is
  already a pipeline; the redirect attaches to its **last** command, whose status the pipeline
  already reports, so that shape is unchanged in kind.)
- **Still a fixed literal, and still nothing founder-controlled is interpolated.** Unit D's property
  is that a hostile `adapterConfig.command` cannot close a quote and append a command — and that is a
  property of the **binary**, which remains a separate argv element read back as `$0`. A module
  constant inside the template is the same class as the literal `--append-system-prompt-file`, which
  has been there since Unit D. Unit D's four "interpolate the binary" mutants stay valid untouched.
- **A FLAT sibling in `/home/user`.** Unit D's reason (nothing in this repo has ever exercised a
  nested staging write against a real sandbox) applies here with extra force: `>` creates the *file*
  and never the *directory*, so a nested output path would fail at redirection with nothing having
  created its parent. Flatness is a hard requirement here, not a preference.
- **`sh` creates the file; nothing stages it, and the 78 guard does not grow.**
  `STAGED_INPUT_MISSING_EXIT_CODE = 78` means "an **input** this run needed is unreadable", and it
  fires before the agent starts. An unwritable output target is a different failure with the opposite
  polarity (§4 slice D.5) and gets `sh`'s own redirection status. Widening 78 would make one code
  mean two causes; under the shape above it is not even possible, because the output path is not a
  positional the guard loop can reach.

★★ **WHAT THESE BYTES ARE, STATED WITHOUT INFLATION — an earlier draft called them "the thing the
agent produced, byte for byte", and this document now refuses that claim.** `claude --print -
--output-format stream-json --verbose` emits **JSONL protocol frames**: a `system`/`init` frame, an
`assistant` frame per model turn, `user` frames carrying tool results, and a terminal `result` frame.
The shapes are not guesswork — they are parsed in-repo today at
`packages/adapters/claude-local/src/server/parse.ts:19-45`, and codex's `exec --json` shape at
`packages/adapters/codex-local/src/server/parse.ts:136-238`. So, precisely:

- The transcript **is** attributable to this run's sandbox process, and it reaches AoA through the
  attested path (grant → PUT → fenced commit → `headObject` checksum re-verification). **That is the
  provenance claim, and it is true.**
- The transcript is **not** a deliverable, and **a run in which the model never spoke still emits
  frames** — a CLI that fails to authenticate emits `system` + `result` and nothing else. So its mere
  existence is **not** a productivity claim. §6.6 says so as acceptance; §7 says so as scope.

★★★ **The productivity floor therefore lives in the PRODUCER, not the judge. One half of it is free
today; the other half is NOT BUILDABLE within the existing port, and saying so is the point of this
paragraph.**

**(1) The zero-length floor — MANDATORY, buildable now, no port change.** `ArtifactDigestResult` is
`{sha256, sizeBytes}` (`supervisor/provider.ts:77-80`), so the supervisor can refuse on
`sizeBytes === 0` before minting any grant. A refusal exports nothing, so `capabilityProven` stays
`false` — the true statement for a run that emitted nothing at all. Control §5.16.

★★★ **(2) The model-turn floor — MEASURED AS NOT BUILDABLE AT THE WORKER, and demoted to an open
question rather than asserted.** The obvious form (*"the worker parses the JSONL for an `assistant`
frame"*) requires the worker to hold the bytes, and it cannot: `digestArtifact` is documented
**"Metadata only; never returns content"** (`supervisor/provider.ts:412`), `ArtifactExportResult` is
`{objectKey}` — *"A REFERENCE to what was exported — never the bytes"* (`:82-85`) — and the governing
byte-egress decision is Option D, *"the port carries a grant inbound and a reference outbound, and
**never bytes**"*. An earlier pass of this revision wrote the worker-side predicate as a
recommendation; the port forbids it. Three candidate homes remain, each with a real cost, and
**open question 5 chooses among them before slice C ships**:

| home | cost, measured |
|---|---|
| in the **sandbox script** (slice B) | A post-exec `grep -q '"type":"assistant"'` is impossible after `exec` — `exec` **replaces** the shell, so nothing runs after it. Getting a post-check means dropping `exec`, which forfeits exact exit-code preservation — the first of §3.1's four deliberate properties. A real trade, not a free one |
| in the **provider** (slice C) | `E2bSandboxProvider` does read the file, so it *could* check — but that puts **adapter semantics** (claude/codex frame shapes) inside a sandbox provider shared by every workload, and `provider-wire` would have to diverge or duplicate |
| **widen the non-frozen port** | `digestArtifact` grows an optional caller-supplied `markers: readonly string[]` and returns `matchedMarkers` — literal substrings only, **no content returned**, adapter knowledge stays in the worker. Additive on a non-frozen port, but it is a port change plus a conformance-suite addition, and §5.5's decline test must cover it |

★ **Until that is decided, the floor is the zero-length one alone, and §6.6 states the residual
plainly**: a run whose CLI failed to authenticate emits `system` + `result` frames, is non-empty,
and would clear the bar. That is a measured weakness of this design, written down rather than
designed around. ★★ **Do NOT import the adapter packages wherever the check lands** —
`worker-daemon` does not depend on them and must not start; the frame shapes are re-derived from
`claude-local/src/server/parse.ts:25` and `codex-local/src/server/parse.ts:194`.

★ **This is the whole reason the unit is L.** "What did the agent produce?" is an open question if
you have to *discover* it — walk a tree, diff a repository, ask the provider to enumerate. It is a
**constant** if the command line that starts the agent also decides where its output lands. Unit D
put that command line under our control; Unit F spends it.

**What this does NOT claim.** Capturing the transcript proves the return path carries attested bytes.
It does not prove the agent had tools, identity or a repository — those are E7-F003, and Units C and
E — and it does not prove the agent did the task. §6 and §7 hold both lines, and §6.9 refuses to let
a green be read as either.

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
| what the verdict then means | "output capture works" — a claim neither arm supported | "attested bytes from this run's sandbox reached durable AoA storage" — which the surviving arm does support |

★★★ **The objection this must answer, in its strongest form.** *"Slice A disqualifies the
task-output arm for not proving the agent produced anything — and then proposes a protocol transcript,
which does not prove the agent produced anything either. That is arguing both sides of one
principle."* The objection is correct that a transcript is not a productivity proof. It is wrong that
this is one principle: **the two signals fail on different axes, and slice A discriminates on exactly
one of them.**

| | provenance — *did these bytes leave this run's sandbox through an attested path?* | productivity — *are these bytes the work?* |
|---|---|---|
| a forged `task_output` | **NO.** Any company-scoped actor, one POST, no worker, no fence, no sandbox | no |
| the committed transcript artifact | **YES.** Leased worker, live fence, verified device proof, attempt-scoped object prefix, control-plane `headObject` re-verifying the SHA-256 | **no — and this document never says otherwise** |
| a committed `workspace_patch` (Unit E) | yes | closer, but still a diff, not a judgement of the work |

Slice A does not swap a non-probative signal for another non-probative signal. **It removes an
unattested arm and keeps an attested one, on the only axis a row predicate can read** — and it stops
claiming, anywhere in this document or in the verifier's text, that the remaining arm proves
productivity. E7-F015's own argument was always the provenance one (*"the evidentiary asymmetry is
the point"*); §0 now names the axis so the argument cannot be misread as the weaker "non-probative"
claim.

Three consequences, each strictly more honest than today:

1. It **removes the only forgeable arm.** After slice A a `curl` cannot prove capability at all.
2. The widening it does stays **within one evidentiary class**. Every committed `job_artifacts` row —
   `log` or `workspace_patch` alike — requires a leased worker, a live fence, a verified device
   proof, an object under the attempt-scoped key prefix, and a control-plane `headObject` that
   independently confirms the SHA-256 the worker declared. The per-row provenance strength is
   **identical**; only the `kind` differs.
3. `workspace_patch` was never a discriminator for *"the agent produced something"*. It is a
   discriminator for *"the run had a repository"* — which is Unit E's question, and belongs in a
   clause that says so rather than smuggled into clause 6's `kind` filter.

★ **And the bar does not get the benefit of the doubt.** Because the remaining arm is provenance-only,
the productivity floor is put where content can actually be inspected — the producer refuses to
export an empty transcript or one with no model turn (§3.1) — and the residual is written into
acceptance as a non-claim (§6.6). A gate that under-claims in its own text is the outcome; a gate
that quietly means less than its name is the thing being fixed.

The task-output count stays in `E7ProducedOutputCounts` and stays printed, because the gap between
"an artifact was committed" and "the founder can see it on the task" is exactly the state slice E
closes, and an operator should be able to read that gap off the verdict line. Q1 (§2.1) records what
that costs.

**Unit A's precedent is the template and is respected:** a clause nobody can pass gets bypassed,
argued around, then deleted. Slice A takes an unpassable-but-honest arm and a passable-but-unattested
arm and leaves one arm that is both honest and — **once slices C–E land, and not before** (§2.1 Q2) —
passable. That "and not before" is why §6.9 refuses to let slice A ship alone.

---

## 4. The lettered slice plan

Each slice lands on its own commit with its own tests. **The order is load-bearing:** A before
anything (pin the defect first, or the anti-regression mutation cannot exist); the producer (B, C, D)
before the consumer (E), so no slice ships a composed thing with nothing to feed it.

★★★ **A–E are one release increment, not five.** Per-slice commits, yes — but the artifact arm has
**zero producers today** (§2.1 Q2), so A-without-C-through-E ships a gate nobody can pass. Land them
together, and if open question 1 answers "no", land none of them (§6.9). F and G follow; G is the
operator's.

### Slice A — the judge (S) · `server/src/services/e7-distributed-run-verifier{,-store}.ts`

1. `countProducedOutputs`: drop `eq(jobArtifacts.kind, "workspace_patch")` from the artifact query
   (`store:207`); keep `status = 'committed'` and the `jobId` binding. Rename the field
   `workspacePatchArtifacts` → `committedJobArtifacts` and add `kindsSeen: readonly string[]` to the
   observed shape so the printout says *what* was committed.
2. Clause 6's predicate becomes `produced.committedJobArtifacts < 1`. `taskOutputs` stays in
   `E7ProducedOutputCounts` and in `formatVerifyResult`, and leaves the predicate.
3. Rewrite the reason string to name the real links (§1.4) — the current text is E7-F016.
4. Rewrite the printed verdict label so it states the **provenance** claim, not a productivity one:
   what clause 6 now asserts is *"attested bytes from this run's sandbox reached durable AoA
   storage"*. The `capabilityProven` **symbol name is deliberately NOT changed** — 15 files across
   five epics reference it (`grep -rl capabilityProven`), and a cross-epic rename is churn Unit F has
   no mandate for. Instead the name's overclaim is recorded as part of **E7-F016**, whose subject is
   exactly the operator-facing text around this clause.

**Non-goals:** `ok` is not touched; `--require-capability` stays off by default; the CLI's exit codes
are unchanged; `capabilityProven` is not renamed.

★★★ **Slice A MUST NOT be released without C–E.** Measured in §2.1 Q2: the artifact arm has zero
producers today, so slice A alone converts a forgeable gate into an **unpassable** one — the precise
outcome CLI-008 Unit A's precedent exists to prevent. Landing A first *inside* Unit F is correct and
required (pin the defect before the fix). Landing A and stopping is not. §6.9.

### Slice B — the agent's output has a path (S) · `server/src/services/task-run-sandbox-invocation.ts` + `task-run-batch-workload.ts` + `job-leasing.ts`

**1 — the constant.** Add a fourth exported constant beside `STAGED_PROMPT_PATH` and
`STAGED_INSTRUCTIONS_PATH` (`task-run-sandbox-invocation.ts:60,64`): `DECLARED_OUTPUT_PATH`, built
from the same `STAGED_INPUT_DIR` and resolving to `/home/user/.aoa-run-output.jsonl`.

**2 — the redirect, in the SCRIPT LITERAL, not the argv.** Append `> ${DECLARED_OUTPUT_PATH}` to
each of the four (adapter × has-bundle) script shapes in `buildSandboxInvocation`'s switch
(`:177-206`). **`staged`, `paths`, `readableGuard(paths.length)` and the returned `args` array are
all untouched.** §3.1 records why the `> "$3"` positional shape fails against three shipped tests and
this one does not; do not re-derive it, and do not "tidy" the constant back into the argv.

★ **The four shapes, exactly** (only the tail changes):

| adapter | bundle | tail after the change |
|---|---|---|
| `claude_local` | yes | `… --append-system-prompt-file "$2" < "$1" > /home/user/.aoa-run-output.jsonl` |
| `claude_local` | no | `… --print - --output-format stream-json --verbose < "$1" > /home/user/.aoa-run-output.jsonl` |
| `codex_local` | yes | `{ cat "$2"; echo; cat "$1"; } \| "$0" exec --json - > /home/user/.aoa-run-output.jsonl` |
| `codex_local` | no | `exec "$0" exec --json - < "$1" > /home/user/.aoa-run-output.jsonl` |

**3 — the assertion that states the exception rather than hiding it.** No existing test needs
editing (§3.1 walks each pin), and that is precisely why a **new** one is mandatory: the invariant at
`task-run-batch-workload.test.ts:229-252` now has an absolute path it cannot see, and an unstated
exception behind a filter predicate is this programme's "a check that nothing runs". Add, over all
four shapes:

- `DECLARED_OUTPUT_PATH` **appears in `args[1]`** (the script) — so a shape that silently drops the
  redirect reds;
- `DECLARED_OUTPUT_PATH` is **absent from `stagedFiles`** — so staging it (which would 78-refuse
  every run) reds;
- `DECLARED_OUTPUT_PATH` is **absent from the guard prefix** (`script.slice(0, indexOf("done")+4)`) —
  so folding it into `readableGuard` reds;
- `DECLARED_OUTPUT_PATH` is **not an element of `args`** — so promoting it to a positional reds.

★★ **Slice B also EMITS the pointer the worker will read, and the emit site is NOT the workload
builder.** The control plane knows the declared output path; the worker must be told it, and the only
channel is the frozen envelope's `extensions[]` — the bounded additive container
(`packages/worker-protocol/src/extensions.ts`) that Unit B already uses for exactly this shape. Copy
`stagedInputExtension` (`server/src/services/job-input-staging.ts:481-501`) into a sibling
`declaredOutputExtension` under a new namespace `com.armyofagents.job/declared-output`, carrying
`{path, kind: "log", contentType}`. **No frozen schema change.**

★★★ **The attach point is the LEASE-OFFER builder, `server/src/services/job-leasing.ts:399`, not the
workload builder — and this is the one non-obvious piece of plumbing in slice B.** That line is
`extensions: input.stagedInput.length > 0 ? [stagedInputExtension(input.stagedInput)] : []`, and
`input.stagedInput` is derived at lease time from durable `job_artifacts` rows
(`:628`, `:638`). A declared **output** has no such row — nothing has been produced yet — so it
cannot ride that derivation. Two shapes, and the implementer must pick one **in slice B**, not
discover the fork in slice D:

- **(recommended) Derive it at lease time from the workload type.** The builder already holds
  `input.job.workloadType` (`:400`). The declared output path is a property of the task-run workload
  shape *the control plane itself authored*, so emitting the pointer whenever the workload is the
  coding one needs no new storage and cannot drift from the argv — both read the same constant, and
  the new assertion above keeps them reading it.
- **(alternative) Persist it at submission.** More faithful for a future per-run path, but `workload`
  is the `.strict()` frozen shape, so it needs a column or a job-side blob. Only worth it if open
  question 2 is answered "a list".

See open question 3 for the `critical` flag, which is a real fork and must be decided before slice D
starts.

★ **The in-sandbox guard does NOT grow to cover the output path — and under this shape it cannot.**
`STAGED_INPUT_MISSING_EXIT_CODE = 78` (`:80`) fires when a needed *input* is unreadable, before the
agent starts. An unwritable output path is a different failure with the opposite polarity (§4 slice
D.5) and must not fail the attempt closed; `sh`'s own redirection status is the honest signal, and
the export step's absence of an artifact is what the verdict then reads. Because the path is a script
constant rather than a positional, `readableGuard`'s `for f in "$1" … "$n"` loop has no way to reach
it — the property is structural, and the third bullet of point 3 pins it.

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
- ★★★ **The productivity floor lives here, in the producer — but only HALF of it is buildable within
  this port** (§3.1). Buildable now: `digestArtifact` already returns `{sha256, sizeBytes}`
  (`supervisor/provider.ts:77-80`), so the supervisor refuses on `sizeBytes === 0` before minting a
  grant. **Not buildable at the worker:** a model-turn predicate needs the bytes, and
  `digestArtifact` is *"Metadata only; never returns content"* (`:412`) while `exportArtifact`
  returns `{objectKey}` — the byte-egress decision's "never bytes". **Open question 5 picks its home
  before this slice ships the check**; do not improvise one, and do not import the adapter packages
  wherever it lands (`worker-daemon` does not depend on them).
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
   output path — digest → **floor check** → `artifactTransferGrant(operation:"upload",
   expectedSha256, maxBytes)` over the frozen op → `exportArtifact` → `artifactCommit`
   (`transport/client.ts:567`, whose route is already mounted). ★ **The floor check comes BEFORE the
   grant**, not after: an empty or model-turn-free transcript (§3.1, slice C) must mint no grant,
   issue no PUT and commit nothing — a refusal that costs one `readFile`, not a round trip. It is
   logged and `emitOp(..., "failed")`-ed like any other export refusal, and the terminal is emitted
   anyway (D.5).
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
   `capabilityProven === false` on a run that succeeded, which — read as the provenance verdict it is
   (§0) — is the **true** statement *"no attested bytes from this run's sandbox reached durable AoA
   storage"*. The same is true of a floor refusal (D.2): the run worked, nothing was attested, and
   the verdict says exactly that.
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
6. ★ **The row must be honest about what it is — TWICE OVER.** It carries no `assetId` and no `url`,
   so `OutputsSection`'s field-aware mapping renders it as a non-clickable entry. That is the correct
   v1 rendering of "a committed artifact exists and is not yet downloadable from here" — but the
   title must say `kind` plainly rather than implying a file the founder can open. **And the title
   must not imply a deliverable either**: what this row points at is the run's own JSONL transcript
   (§3.1), so a title like *"agent run transcript (log)"* is honest and *"agent output"* is not. A
   founder who clicks expecting their document and finds protocol frames is the same overclaim §0
   removes from the verifier, re-introduced in the UI. Making it downloadable is §7's named
   follow-up, not a thing to half-build here.

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
| 5.14 | ★★★ **The declared output path is NOT staged and NOT guarded** (slice B) | Over all four (adapter × bundle) shapes: `DECLARED_OUTPUT_PATH` is in `args[1]`, absent from `stagedFiles`, absent from the guard prefix, and absent from `args` as an element | Add it to the `staged` array → the guard 78-refuses the happy path AND this test reds. Promote it to a positional → this test reds. **Without this test the exception at `task-run-batch-workload.test.ts:229-252` is unstated**, which is the failure class §3.1 exists to avoid |
| 5.15 | **The redirect is present in every shape** (slice B) | All four scripts end in `> ${DECLARED_OUTPUT_PATH}`; the existing `:208`/`:220` `toEqual` shape tests and `:229-252` still pass unedited | Drop the redirect from any one shape → 5.14's first bullet reds for that shape (and nothing else does — which is exactly why it is asserted) |
| 5.16 | ★★ **An EMPTY transcript never becomes a committed artifact** (slice C/D) | A run whose declared output file is zero bytes: assert no grant is minted, no PUT is issued, no `job_artifacts` row persists, a `terminal` IS emitted, and `capabilityProven === false` | Remove the zero-length refusal → an empty file commits → `capabilityProven` goes true on a run that produced nothing → red |
| 5.17 | ★★★ **A transcript with NO MODEL TURN never becomes a committed artifact** — **CONDITIONAL on open question 5**, because the check is NOT buildable at the worker as the port stands (`digestArtifact` is "metadata only; never returns content", `supervisor/provider.ts:412`) | Feed a claude transcript of `system` + `result` frames only (the shape a failed CLI login emits): assert no commit, a `terminal`, and `capabilityProven === false` | Remove the model-turn predicate → the gate goes green for a run in which the model never spoke. ★ **If open question 5 declines all three homes, this control is NOT written and §6.6's residual stands unmitigated** — an unwritten control that is named is honest; a control asserted against a port that forbids it is not |

★ **The gate this unit must NOT create.** Unit A faced a clause nobody could pass and the remedy was
a **second verdict computed beside `ok`**, never a fold into `ok`. Unit F does not fold anything into
`ok` either: clause 6 stays in `capabilityFailures`, `--require-capability` stays off by default, and
slice A's change makes the existing second verdict *reachable* rather than adding a third.

★★★ **And the way this unit would MOST easily create it anyway is by shipping slice A alone.** The
artifact arm has zero producers today (§2.1 Q2), so A-without-C-through-E is the unpassable clause
Unit A's precedent exists to prevent — arrived at not by adding a clause but by removing the only
arm anything could satisfy. That is the failure mode to watch for in review, and §6.9 is the check.

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
   `capabilityProven === false` — the true statement, not a masked one;
5. and a run whose transcript was **empty** committing nothing, reaching a durable `terminal`, with
   `capabilityProven === false` (§3.1(1)'s producer-side floor; control §5.16). ★ The **model-turn**
   half of that floor is conditional on open question 5 and is NOT an acceptance criterion — see
   §6.6 for the residual it leaves.

**Explicitly NOT acceptance, and stated so a green cannot be over-read:**

6. ★★★ **`capabilityProven === true` is a PROVENANCE verdict, not a productivity one** (§0). It
   asserts *attested bytes from this run's sandbox reached durable AoA storage*. It does **not**
   assert that the agent did the task, or that the bytes are a deliverable — they are a JSONL
   protocol transcript, and a run in which the model spoke once but did nothing useful clears the bar
   exactly as one that worked well does. The producer-side floor rules out **only the zero-length
   case** (§3.1(1), control §5.16) — that half is buildable within the port and is mandatory. ★ The
   **model-turn** half is measured as **not buildable at the worker** (`digestArtifact` is "metadata
   only; never returns content"), so it is an open question (§9.5), not a commitment. **Residual, in
   plain terms: a run whose CLI failed to authenticate emits `system` + `result` frames, is
   non-empty, and would clear this bar.** That is a weakness of this design, recorded rather than
   designed around. **The symbol's NAME outruns what
   it proves; that is recorded in E7-F016 and is not fixed by a rename here** (§4 slice A.4).
7. **E7-F003 is not closed.** No clause reads the artifact's *content*, so a run that produced a
   transcript and a run that produced a *good* transcript are still indistinguishable to the
   verifier. Tools are Unit C; a repository is Unit E.
8. **`ok` is unchanged**, and a green `ok` still says nothing about capability.
9. ★★★ **Slice A is not independently shippable.** Measured in §2.1 Q2: the artifact arm has zero
   producers today, so A-without-C-through-E leaves a gate **nobody can pass** — Unit A's precedent
   inverted. Unit F is met only when A–E are in the same landed increment, and if open question 1
   answers "no" (`#transport.readFile` cannot read a redirected `exec`'s output) then **no slice
   lands** and the design takes a second pass, the way WRK-015 did.
10. **The container/networked lane is not covered** (§5.9).

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
- **It does not make the artifact downloadable from the task.** The row identifies the artifact by
  id and kind (`metadata.jobArtifactId`, `metadata.kind`) and carries **no** `assetId` and no `url` —
  a presigned URL in a durable row expires into a broken link, and `artifact_prepared` carries no
  object key anyway, so the projector would have to read `job_artifacts` to obtain one. A
  founder-facing download route that mints a fresh grant from the artifact id is the follow-up, and
  the row it would light up already exists after slice E.
- ★★★ **It does not prove the agent did the work, and it does not claim to.** The committed artifact
  is a protocol transcript with full provenance and no productivity content (§0, §3.1). Upgrading the
  bar to productivity means either (a) instructing the agent, in its staged bundle, to write a
  **deliverable** to a declared path and counting only that — which makes the gate depend on model
  compliance and turns a non-complying-but-working run into a red, and which needs Unit C's tools and
  Unit E's repository to be meaningful; or (b) having the control plane read the artifact's bytes,
  which crosses the byte-egress decision's "a reference, never bytes" line at the control plane. Both
  are named successors, not things to half-build here.
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
| **E7-F016** | LOW | Clause 6's operator-facing text misdescribes its own subject, in two ways. (a) The failure reason names four unbuilt links, three of which cannot flip either counter, and omits the ones that are decisive — and it produced this unit's XL estimate. (b) The verdict is named `capabilityProven` while its surviving arm can only assert **provenance** (§0); the name outruns the predicate. Owned by CLI-008; slice A rewrites the reason string and the printed label, and deliberately does **not** rename the symbol (15 files across five epics) |

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
2. **One output path or a list?** The design assumes exactly one (`DECLARED_OUTPUT_PATH`, a script
   constant). A list generalizes the supervisor step but multiplies the grant round-trips and needs a
   per-file failure policy. Start at one; the port takes a `path` per call, so widening later is
   additive. ★ Note that a list re-opens slice B's fork: a per-run list cannot be a script constant,
   so it would have to become positionals — and §3.1's three measurements apply again, in full.
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
5. ★★★ **Where does the model-turn floor live — or does it not get built?** This is the sharpest
   open question in the design, and it exists because the obvious answer is **measurably wrong**: the
   worker cannot parse the transcript, because `digestArtifact` is *"Metadata only; never returns
   content"* (`supervisor/provider.ts:412`) and `exportArtifact` returns `{objectKey}` only (`:82-85`)
   — the byte-egress decision's "never bytes". §3.1(2) tables the three candidate homes with their
   costs (post-exec check → forfeits `exec`'s exit code; provider-side → adapter semantics inside a
   shared provider; a `markers`/`matchedMarkers` widening of the **non-frozen** port → a port change
   plus conformance work). **Decide before slice C ships any content check.** Two sub-questions ride
   on it: (a) if the answer is "none of the three", say so and let §6.6's residual stand — an
   unmitigated weakness that is named beats a mitigation that the port forbids; (b) the **codex**
   marker is additionally unsettled — its stream distinguishes `thread.started` / `response_item` /
   `event_msg` / `item.completed` / `turn.completed` / `turn.failed`
   (`codex-local/src/server/parse.ts:136-238`) and **which is the minimal "the model spoke" marker was
   not established in this pass**. Do not guess: a wrong predicate silently suppresses real runs.
6. ★★ **Does the deliverable-directive route belong to Unit C or Unit E?** §7 names it as the
   successor that would upgrade the bar from provenance to productivity: instruct the agent, in its
   staged bundle, to write a deliverable to a declared path, and count only that. It is deliberately
   out of scope here (it makes the gate depend on model compliance, and a directive is only
   meaningful once the agent has tools and a repository). It needs an owner before someone assumes
   Unit F left it done.

---

## 10. Corrections to earlier records

★★★ **Including this document's own first draft (`419a94afd`…`c28631e33`), corrected in place on
review rather than quietly swapped.** Both errors were the *obvious* shape, which is why they are
recorded instead of erased:

| the first draft said | measured, and where the correction lives |
|---|---|
| the redirect is `> "$3"`, with the output path appended to the argv | Wrong three ways, each caught by a shipped test: `$3` is not a stable index (the instructions path is conditional, `task-run-sandbox-invocation.ts:164,169`, and the no-bundle argv is pinned at `task-run-batch-workload.test.ts:215,371`); routing it through `paths` makes `readableGuard` 78-refuse the happy path (`:176`, pinned `:388`); routing it around `paths` breaks the set-equality invariant (`:229-252`). **§3.1** has the shape that survives — a constant in the script literal, no argv change, no test edits, plus one new assertion that states the exception |
| the captured bytes are "the thing the agent produced, byte for byte" | They are JSONL **protocol frames** (shapes at `claude-local/src/server/parse.ts:19-45`), non-empty even when the model never spoke. **§0** picks provenance over productivity and follows it through §3.1, §3.3, §5.16 (and §5.17, conditional — the model-turn check is measured as not buildable at the worker), §6.6 and §7 |

★★ **And a third correction of altitude rather than fact:** the first draft removed the task-output
arm without saying where its question then lived, or measuring whether the surviving arm was
reachable. **§2.1** answers both as measurements — the question keeps two owners
(`gate-clause-wiring.json`'s `E3-17-output` and slice E's own acceptance), and the surviving arm has
**zero producers today**, which makes slice A non-shippable alone (§6.9).

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
