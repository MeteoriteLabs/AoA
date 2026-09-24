# DEP-021 — The in-flight window that makes `M1a`'s last two D1 fault cases fire, the fake provider's INBOUND boundary arm, and the correction of clause 5's named remedy — result

**Status:** `gate_review`
**Epic:** E6 · **Plan task:** `M1a` critical path (planning session under F2, 2026-09-24) · **Milestone:** `M1a`
**Date (UTC):** `2026-09-24`
**Implementer:** Claude Opus 5 (M1 build agent)
**Start SHA:** `eb8458bb3538c99ee5cb54b6872202c5f268dd74` (`origin/docs/replatform-program`)
**PR:** #594 (base `docs/replatform-program`)
**Reviewed revision:** *(the final head; §9 names the run it was proven on)*

> `Status` is `gate_review` and may be set to `complete` only by a DISTINCT reviewer, never by this
> author.
>
> **No keyed workflow was dispatched by this session** (founder ruling F8). Everything claimed here
> is proven on the keyless D1 lane or by pure-node tests. §10 names exactly what still awaits a
> keyed run and what awaits a RULING.

---

## 0. What this ticket is

`M1-D1-SPINE` fails on one REQUIRED case, `d1.reconcile.worker_startup_lease_probe`, which `DEP-018`
allocates to it by name and which existed in **no driver**. Until it can fire, freezing a new `M1a`
candidate reproduces the same failure at a new sha and spends a keyed E2B run to discover it. That
is why this was the critical path.

A previous session measured the wall precisely and stopped on budget rather than leaving a
half-edited branch. This ticket starts from that measurement, **re-verifies every pinned fact at
source**, and closes it.

| Deliverable | Where it stands |
|---|---|
| `--aoa-fake-delay` on the reference provider | **DONE** (§1) |
| The boundary guard's INBOUND arm | **DONE** (§2) |
| `d1.reconcile.worker_startup_lease_probe` fires | **DONE** (§3), `pending` → `required` |
| `d1.provider.worker_terminal_mapping` fires | **DONE** (§4), `pending` → `required` — and it needed NO new mechanism |
| `--aoa-fake-echo-env` | **DELIBERATELY NOT ADDED** (§5) — the brief's premise for it is false at `HEAD`, measured at source |
| Clause 5's D1 redaction case → `required` | **NOT DONE, and it cannot be** (§5). Its `pendingReason` named a remedy that does not work; that reason is superseded in place, dated, and the blocker is re-pointed at the ruling that owns it |

---

## 1. `--aoa-fake-delay` — the in-flight window

`packages/sandbox-fake-provider/src/scripted-command.ts`.

### 1.1 Why a delay, and why nothing cheaper works

The reconcile case needs `worker-b` restarted **while** it holds a live lease over an **in-flight**
run. A harness cannot simply plant the lease candidate: `SqliteLeaseCandidateStore.listEntries`
(`packages/worker-daemon/src/lease/lease-candidate-store.ts`) requires each row to `safeParse`
against `leaseOfferV1Schema` **and** to decode to the lease id and Organization its own row is keyed
by — *"otherwise one lease could be probed under another's identity"*. A harness-minted offer
therefore belongs to a HARNESS worker, and `worker-b`'s probe of it is answered `rejected` → `dead`
(`livenessOf`, `startup-reconcile.ts`), which takes the `candidate pruned` arm and **never reaches
the fenced one**.

So the only real route is restarting `worker-b` mid-run — and the reference provider had no way to
be mid-anything: `executeScriptedCommand`'s transcript is *"a pure function of `(args, usage)`"* and
returned immediately. This flag is that window, and the case in §3 is the reason it exists.

### 1.2 The shape, and why it is fail-closed rather than convenient

The flag set is CLOSED and the module's own header says why: *"a scripted control that silently
degraded to the default would make every positive control vacuous"*. `--aoa-fake-delay` is the first
flag the SYNCHRONOUS entry point cannot honour, so:

- `parseScriptedCommand` bounds it at parse time (`SCRIPTED_COMMAND_MAX_DELAY_MS = 600_000`), and
  refuses a repeat, a missing value, a negative, a non-integer, `Infinity` and an over-bound value.
  **A scripted wait is a BOUNDED wait**: unbounded, one job envelope could park a provider worker
  for as long as it liked and the caller's own race would be the only thing that ended it — a bound
  enforced by the wrong half.
- **`executeScriptedCommand` (sync) REFUSES a non-zero delay** rather than returning early. Quietly
  going fast would hand the harness a run that *looks* scripted-to-wait and did not, which from the
  harness's side is indistinguishable from a restart that raced a finished run.
- `executeScriptedCommandAsync` is the entry point that waits, and it waits **BEFORE** the
  transcript. The window the case restarts inside is a window in which **nothing has been written
  yet**; a run whose usage had already streamed is not distinguishable, to a restarted worker's
  probe, from a finished one.
- It does **not** police its own deadline, and that is the correct half: `options.deadlineMs` is the
  budget the CALLER races, and a delay that outlasts it must surface as the caller's
  `execute_timeout`, a real provider-overrun shape. A second deadline here would invent a verdict
  the port has no field for.
- `createFakeSandboxProviderPort.execute` switches to the async entry point. That op was **already**
  `async` for the reason its own header records, so this costs the port nothing.

### 1.3 The probe is untouched, and that ordering is now load-bearing twice

`scriptedPrelude` keeps DEP-019's order: budget short-circuit → probe classification → scripting
flags. The probe's argv is the DAEMON's, so a `--aoa-fake-delay` look-alike inside it must not be
able to delay a control the daemon times independently. Asserted by its own test (§7.3 row 5).

---

## 2. The boundary guard's INBOUND arm

`scripts/check-sandbox-fake-provider-boundary.mjs` + `scripts/lib/sandbox-fake-provider-boundary.mjs`.

### 2.1 The gap, stated as a measurement rather than a worry

The guard was **OUTBOUND ONLY**: it enforces what the two DEP-000 leaf packages may *import* and
says nothing about **who may import them** — which is the direction that decides whether a
FABRICATING provider, and every scripting flag it carries, is reachable from a production build.

**Measured at `eb8458bb3`, the property ALREADY HELD.** No workspace package declares a runtime
dependency on `@armyofagents/sandbox-fake-provider`; the only manifest that names it at all is
`packages/sandbox-provider-contract`, in `devDependencies`. So this arm changes no behaviour today.
It exists because **nothing enforced it**: the property held by accident, and one `dependencies`
line in any of the 34 workspace manifests would have made a fabricating provider
production-reachable with every guard still green — the "a check that nothing runs" class, sitting
on the package whose whole purpose is to fabricate provider results, immediately before that package
grew a new capability.

★ **One correction to the brief, recorded rather than absorbed.** The brief said the fake provider is
named by *"only the root manifest and `packages/sandbox-provider-contract`"*. The root manifest's
mention (`package.json:55`) is a **script name**, `check:sandbox-fake-provider-boundary`, not a
dependency. Root declares no dependency on it.

### 2.2 What already existed, so this is not over-claimed

`docker/worker/Dockerfile` copies the package into its BUILD stage (the 8th manifest —
`sandbox-provider-contract`'s tsconfig lists its conformance suite in `files:`, which is not subject
to `exclude`) and `pnpm deploy --prod` prunes it back out;
`docker/images/__tests__/image-contents.test.mjs:131` asserts an **unscoped**
anti-fake-provider `find`. That control is real, and it is a **different** control:

- it needs the images **BUILT** — it is not pure node and is not in `policy`;
- it covers `/worker-app` and `/worker-net-app` **only**. The control-plane and adapter-manager
  images carry no such assertion, and both have the package in their build closure comments.

This arm is the **dependency-graph** half: pure node, locally runnable, in `policy`, over every
workspace package. **Neither subsumes the other**, and the code says so at the site.

### 2.3 The policy

For every workspace package other than the fake provider itself:

1. **No runtime-effective dependency edge, anywhere** — `dependencies`, `optionalDependencies`,
   `peerDependencies`, `bundledDependencies`, `bundleDependencies. This includes the allowlisted
   conformance harness: its allowance is `devDependencies`, not "any field". That is not
   hypothetical — `sandbox-e2b-provider` depends on the contract package in `dependencies`
   (measured), so a runtime edge there is transitive into every closure carrying it.
2. **A `devDependencies` edge only for `@armyofagents/sandbox-provider-contract`.**
3. **No SHIPPED source may import it**, by bare specifier or subpath.
4. **Only the allowlisted harness's TEST source may import it.**

Two things make it non-vacuous by construction:

- the package list is **DERIVED from `pnpm-workspace.yaml`'s own globs**, never a hard-coded root
  list — a constant would silently stop covering a root somebody added later, which is the defect
  class this arm exists to close;
- it **FAILS CLOSED ON AN EMPTY SCAN** and reports its counts. `node
  scripts/check-sandbox-fake-provider-boundary.mjs` prints
  `PASS (outbound: 2 leaf packages; inbound: 34 workspace manifests, 5310 source files)`, and zero
  manifests or zero sources is a REFUSAL. The scan admits `.ts .tsx .mts .cts .js .mjs .cjs .jsx`
  — deliberately wider than `classifyRuntimeSourceFileName`, which admits only `.ts`: `ui` is
  `.tsx`, and a scan that could not see it would be a check that passes by not looking.

---

## 3. `d1.reconcile.worker_startup_lease_probe` — built, keylessly

`tests/d1/m1-fault-matrix.test.mjs`. Restart the deployed worker mid-run; require its WRK-013
startup reconciler to FENCE its own prior lease.

### 3.1 Every precondition verified at source, because a case that cannot fire is worse than an absent one

| Precondition | Verified at |
|---|---|
| dispatch is ON for `worker-b` | `docker/d1/m1-spine.override.yml:137` — `AOA_WORKER_DISPATCH_ENABLED: "1"` |
| the lease-candidate store is CONFIGURED | `config.ts` `leaseCandidatePath` **defaults from** `AOA_WORKER_EVENT_OUTBOX_PATH`, which the override sets to `/worker/event-outbox.db` |
| …and SURVIVES the restart | that path is on the **persistent** volume `d1-spine-worker-state` (override, worker-b `volumes`) |
| it reaches the reconciler | `bootstrapWorkerDaemon` passes `leaseCandidatePath: config.leaseCandidatePath` to `composeRuntime` |
| the LOGGER is composed | `bootstrapWorkerDaemon` builds it (`const logger = makeLogger(...)`) and passes `logger` to `composeRuntime`. `worker-networked-host` never mentions a logger, which is why this was checked rather than assumed |
| the run's budget outlasts the restart | `RUN_OP_DEADLINE_CEILING_MS` = `300_000 − 60_000` = **240 s**, with `maxRuntimeSeconds: 600` on the worker-driven seed |
| the LEASE outlasts the restart | `job-leasing.ts:559` — lease duration defaults to **300 000 ms** |
| the candidate is WRITTEN | `poll-loop.ts` writes it on ACK, and the DEPLOYED worker is what ACKs a worker-driven run |

The window is `RECONCILE_WINDOW_MS = 90_000` — inside both budgets, and far longer than a
`docker compose restart --timeout 30` of a node daemon.

### 3.2 ★★★ The finding that cycle 1 produced: the stop must be a KILL, and the restart becomes the control

**Cycle 1 (`35954159711`) failed this case, and the failure was the most useful thing in the
ticket.** Every conjunct of the injection held — `inFlight.ok: true` on the FIRST poll,
`liveBefore: true`, `restart.requested: true`, `startedAtChanged: true`, `bytesBefore: 3575`,
`bytesAfter: 7034` — and **none of the three arms appeared**, with `expiryMovedForward: false`. So
the probe never ran, and the reason was in the worker's own log, by name:

```
startup-reconcile: the lease-candidate store is empty; this daemon held no lease when it last stopped
```
with `reason: lease_candidate_store_empty`.

**The store was configured, open and readable — and correctly EMPTY.** `docker compose restart`
sends SIGTERM first; the daemon drains, the in-flight handoff settles, and `trackHandoff`'s
`finally` calls `recordCandidate("remove", offer)` (`packages/worker-daemon/src/poll/poll-loop.ts`).
**A cleanly stopped daemon deliberately leaves no candidate.** The WRK-013 store exists for a daemon
that **DIED** holding a lease — which is what the case declares
(`worker.daemon.restart_with_live_lease`) and what `restartComposeService` cannot produce.

So the injection is a **SIGKILL**, not a restart: new harness primitives `killComposeService`
(`docker compose kill -s KILL`) and `startComposeService` (`worker-b` declares no `restart:` policy,
and `start` never recreates, so the container keeps the spine override's config).

★ **And the failed attempt is not discarded — it is promoted to the case's own control.** The
graceful restart is now **ARM 1, a SAME-MECHANISM NEGATIVE CONTROL**: the identical in-flight run,
the identical service, a stop that is *not* a death, which must report
`lease_candidate_store_empty` and produce **no** fence line. That is strictly stronger than the
before/after reading it supplements: a before/after pair alone cannot distinguish *"the fence line
is caused by the daemon dying with the lease"* from *"the fence line is caused by a restart having
happened"*. The pair can. Cycle 1 bought that control, and the declaration's `observedBy` now names
four attribution arms rather than three.

### 3.3 ★ The observable is ATTRIBUTED, not merely present

The fence line is written at `dispatch-runtime.ts:597-601`:

```
startup-reconcile: lease FENCED (F5) — the probe's renewal was its last; the control-plane reaper ends the attempt
```

with `reason: LEASE_CANDIDATE_REASONS.fenced` (`lease_candidate_fenced`). It is one of a **three-way
branch**; its siblings are `candidate pruned` (`ended`) and `nothing renewed` (`unreachable`).

Beyond ARM 1, the case reads `worker-b`'s container log **BEFORE and AFTER** the kill and requires:

1. the fence line is **ABSENT** before the kill — taken AFTER arm 1, so it also records that a
   restart produced none. Without it, a line from any earlier boot satisfies the case, which is a
   control passing on state it did not cause;
2. **PRESENT** after the kill;
3. it carries **THIS run's lease id**;
4. **NEITHER sibling arm** names this lease — which is what distinguishes `fenced` from `dead` and
   from `unreachable`.

The structured reason is asserted beside the message: the prose could be reworded, the token is the
machine-readable half. Both are matched as **ASCII substrings** — the real line carries an em-dash
and a typographic apostrophe, and a literal with either would make a live assertion depend on the
driver file's encoding.

### 3.4 The durable arm, and its honest limit

New harness helper `queryLeaseExpiries` (`tests/d1/lib/e6f-harness.mjs`). `queryLeaseFaultState`
returns `id` + `status` only, so it cannot see a RENEWAL: a renewed lease and an untouched one are
both `active`. `renewLease` (`packages/db/src/repositories/tenant/job-control.ts`) extends
**`leases.expires_at`** and nothing else — *"extended by `renewLease` and by nothing else"* — and the
probe is exactly one `lease_renew`.

★ **Its limit is stated rather than glossed:** the pre-kill renewal loop was moving the same
column, so **movement alone is not attributable to the probe**. It is recorded as corroboration; the
log line is what attributes it. What the expiry *does* prove on its own is that the lease was still
LIVE after the restart — i.e. the probe's `live` arm was the reachable one and the case is not
silently passing through a dead-lease prune.

### 3.5 Placement

Both new cases are **LAST** in the driver. The file's header records that order is load-bearing over
ONE shared stack, and `DEP-020` cycle 2 learned it the expensive way. A `worker-b` restart is the
most disruptive injection on the lane and this case deliberately leaves a parked run in flight, so
nothing may depend on the deployed worker after it.

---

## 4. `d1.provider.worker_terminal_mapping` — and it needed no new mechanism

★ **`DEP-020`'s routing of this case to a keyed lane was one measurement short.**
`--aoa-fake-timeout` has been on the reference provider since DEP-019 and makes `execute` return
`{exitCode: null, signal: "SIGKILL", timedOut: true}` — the shape `E2bSandboxProvider.execute`
returns on an exhausted command budget. Carried through `seedSpineWorkerDrivenJob`'s `workloadArgs`
it reaches `executeScriptedCommand` on the DEPLOYED worker's own provider wire, so the worker's
mapper runs. No flag, no keyed run.

### 4.1 ★ Why it is provably distinct from `d1.provider.execute_deadline_exceeded`

That case derives its terminal with `terminalPayloadFor`, **harness** code, and its own comment says
it proves the INGEST's classification and *"NOT the deployed worker's mapping"*. This case builds no
payload at all. The worker's supervisor does, at `supervisor.ts` §4:

```ts
const status = exec.exitCode === 0 && !exec.timedOut ? "succeeded" : "failed";
const errorCode = exec.timedOut ? "exec_timeout" : exec.signal !== null ? "exec_signalled" : null;
```

★ **And the two mappers DISAGREE on the code**, which is what makes the distinction MEASURABLE
rather than merely asserted: `terminalPayloadFor` emits `provider_timeout`, the worker emits
**`exec_timeout`** (`timedOut` wins over `signal` in that ternary). So this case **cannot pass on a
harness-authored terminal**, and if a future refactor made the harness the author, the code would
change and the case would red.

Asserted field by field: `failed` / `errorCode: "exec_timeout"` / `exitCode: null`.

**Positive control:** the identical worker-driven journey with **no** flag, on its own job, through
the **same** mapper, must land `succeeded` / `exitCode: 0` / `errorCode: null`. Without it, "failed"
would be equally explained by a worker that fails everything — the defect
`d1.provider.execute_deadline_exceeded` had in its own first version.

**Non-vacuity:** both arms must have produced a terminal event at all, asserted first. A case
comparing two absent terminals would "pass" on `null === null`.

---

## 5. ★★★ Clause 5: its `pendingReason` named a remedy that does not work

**This is the sharpest finding in the ticket, and it reverses the brief's premise for one of the
three edits it asked for.**

The brief called `--aoa-fake-echo-env` *"the only way clause 5's redaction control is non-vacuous —
and therefore the sharpest thing in this diff"*, and asked for the same scrutiny the dexec-stream
leak got. It got it, **at source, before any code was written**, and the result is that the flag
cannot work.

### 5.1 The blocker still holds; the FIX was wrong

`DEP-020` proved the blocker live over three campaigns and filed the remedy as *"ONE
`--aoa-fake-echo-env=<NAME>` scripting flag on the reference provider, a provider-package change with
its own typecheck and build."* The blocker is **unchanged and still true**. The remedy is **false**,
and no flag can be true:

| # | Measured at | Consequence |
|---|---|---|
| 1 | the per-op port (`provider.ts`) | an echo's **only** channel is `ExecuteInput.onStdout` |
| 2 | `executeRelayingStdout`, `packages/adapter-manager/src/server.ts` | that callback **is** `createRunOutputCapture`, whose canaries are *"`Object.values(env)`"* — the execute input's env VALUES, so the echoed value is one of them — and which returns **only** the SCRUBBED `stdoutTail`. *"raw output never crosses the wire"*. This server is what `docker/d1/fake-provider-entry.mjs` runs, so the scrub happens inside the provider's own process |
| 3 | `supervisor.ts:952` | the daemon scrubs the tail **again** with the run's own canaries |
| 4 | `createUsageObserver`, `usage-observer.ts:117` | the tail's **only** consumer returns `{ usage }` — four integers — and **never** populates `obs.logs`, which is the one field `supervisor.ts:1035` turns into a log event. Its own docstring: *"usage only (stdout is never re-emitted as log events)"* |
| 5 | `usage-observer.ts` WRK-018 1(b) note + `supervisor.ts:1042-1048` | the log that WOULD have carried it (`PARSED_USAGE_LOG_MESSAGE` / `parsedUsageLogFields`) was built and then **DROPPED by the M1 planning session (F2, 2026-09-23)** after five Codex P1s of one family, filed **`E4-F019`**. The records' own words: *"Redaction wins over diagnostics"*, and *"acceptance 1(b) is not live-provable"* |
| 6 | `envProbeLogMessage` + `envProbeExpectedDigests`, `env-probe.ts` | the DEP-017 probe is no alternative surface: its summary serialises **DIGESTS**, never values, so no canary — and therefore no marker — can appear in it. This was checked because `m1-spine.override.yml:141` DOES arm the probe on this lane (`AOA_WORKER_ENV_PROBE: "1"`), one line from the dispatch flag |

**So the scrubber's marker terminates in an integer parser and reaches NEITHER declared stream.**
The case is blocked one layer **deeper** than an echo flag: it needs an observable channel for
scrubbed run output on a D1 stream, which is **precisely what ruling F2 deleted**.

### 5.2 Why the flag is NOT added

Unblocking this is a **DECISION to revisit F2**, not a build task, and M1-AGENT-RULES is explicit:
*"If you hit something that needs a decision beyond your unit's brief, STOP and report it."*

Adding the flag anyway would ship a **secret-echo capability whose every consumer discards it** — a
new security surface that proves nothing, i.e. the "a check that nothing runs" class with a cost
attached. ★ And it would be that class **inside the diff that names it** (§6, E.1a): this same PR
adds the production-reachability control precisely because the fake provider's capabilities matter.
So the flag is declined, on the record, with the measurement above as the reason.

### 5.3 What was done instead

A `pendingReason` whose named REMEDY is false is the same defect class (`SPINE-MATRIX-3`) as one
whose BLOCKER is false. Both redaction reasons are therefore **superseded in place, dated, kept
verbatim, never deleted**:

- **`d1.redaction.planted_canary_scrubbed`** — a new `pendingReason` carrying the six-step
  measurement; the old text preserved in `$supersededPendingReason`; `pendingOwner` re-pointed to
  **the planning session (F2)**, *"which owns the WRK-018 1(b) ruling that removed the only channel
  this case could be observed on"*, with the old owner in `$supersededPendingOwner`.
- **`d2m.redaction.planted_canary_scrubbed`** — its remedy **for itself** (a keyed run asserting the
  run's own streams) is TRUE and is left standing. Its sentence *"The keyless D1 mirror is blocked on
  a reference-provider echo flag"* is FALSE and is corrected by an appended, dated paragraph.

`DEP-020`'s own §10 line *"Awaits a provider-package change, NOT a keyed run"* is likewise
superseded by this measurement. **That record is not edited by this ticket** — it is cited.

★ The live two-directional blocker proof (the test *"THE CLAUSE-5 BLOCKER, measured live"*) is
**unchanged** and still reds the day either the value or the marker appears, so the corrected
declaration cannot outlive its reason either.

---

## 6. ★ Sweep the class, never the instance

### Class A — *a boundary guard that constrains what a package may IMPORT while saying nothing about who may IMPORT IT.*

**Enumerated by `ls scripts/ | grep -i boundary`: 6 guards. All 6 checked.**

| Guard | Outbound | Inbound | Disposition |
|---|---|---|---|
| `sandbox-fake-provider` | yes | **no → FIXED** | §2 |
| `adapter-manager` | yes | no | **Not a defect, and why.** The inbound direction only matters for a package whose presence in production is itself the hazard. These five are PRODUCTION packages — they exist to be depended on, and an inbound arm would forbid the thing they are for |
| `sandbox-e2b-provider` | yes | no | as above |
| `worker-daemon` | yes | no | as above |
| `worker-keystore` | yes | no | as above |
| `worker-protocol` | yes | no | as above |

**So the class member set is not "all six guards" but "guards over packages that must NOT be
production-reachable", and the tree contains exactly ONE such package.** Checked 6, found 1, fixed 1.

**The DUAL (E.1b) — *a guard that constrains who may import a package while saying nothing about what
it imports* (inbound without outbound): searched, and found ZERO.** All six carry the outbound arm.
Reported even though it found nothing, because a count that silently covers one polarity reads as if
it covered both.

★ **One thing the sweep surfaced and is filed rather than left silent:** `sandbox-e2b-provider`
depends on `sandbox-provider-contract` in **`dependencies`**, so the conformance harness is in a
production runtime closure today. That is plausibly intended (type imports) and is not changed here
— but it is exactly why §2.3 rule 1 forbids a runtime edge on the harness *including for the
harness itself*: it is the one field-change away from the fake. **Owner: unowned; recorded here as a
measurement, not a defect claim.**

### Class B — *a `pendingReason` whose named REMEDY is false* — the DUAL of `DEP-020`'s sweep

`DEP-020` swept for false **BLOCKERS** (every `pendingKind: "structural"` case; checked 3, found 2
false). Nobody swept for false **REMEDIES**. That is the polarity flip, and it is where clause 5 was
found.

Enumerated against the **BASE** tree (`git show origin/docs/replatform-program:tests/d1/fault-matrix.json`),
by regex over every `pending` case's `pendingReason` for language that commits to a specific fix
(`it needs`, `needs ONE`, `blocked on`, `what is still missing`, `--aoa-fake`, `UNBUILT`, …):

**83 cases, 53 pending, 4 naming a remedy. All 4 checked; all 4 wrong in some part; all 4 fixed or
corrected.**

| Case | Its named remedy | Verdict | Disposition |
|---|---|---|---|
| `d1.reconcile.worker_startup_lease_probe` | route to `M1a-D2-MECHANISM` | **FALSE** — buildable here | **BUILT** (§3), `required` |
| `d1.provider.worker_terminal_mapping` | route to `M1a-D2-MECHANISM` | **FALSE** — buildable here, and needed no new mechanism | **BUILT** (§4), `required` |
| `d1.redaction.planted_canary_scrubbed` | *"ONE `--aoa-fake-echo-env` flag"* | **FALSE** — necessary but nowhere near sufficient | **CORRECTED** in place, blocker re-pointed at ruling F2 (§5) |
| `d2m.redaction.planted_canary_scrubbed` | its own: a keyed run asserting the run's streams | **TRUE for itself**; its sentence about the D1 mirror is FALSE | sentence **CORRECTED** in place, own remedy left standing (§5.3) |

### Class C — *a scripting flag the synchronous path silently drops.*

**Enumerated from `parseScriptedCommand`'s closed switch: 4 flags** (`usage`, `exit`, `timeout`,
`delay`). `usage`/`exit`/`timeout` are all expressible synchronously and are honoured. Only `delay`
is not — **checked 4, found 1, fixed 1** with an explicit refusal rather than a silent drop (§1.2).

### Class D — *a `docker compose` subprocess's stderr printed verbatim into a PUBLIC CI assertion message, with no scrubber on the path.*

★ **Found by the M1-BUILD-RULES §A self-audit, in MY OWN DIFF, and it had a pre-existing twin
(E.1a + E.3).** `DEP-020` closed this family at the **dexec** chokepoint — `dexecModule` gained a
`secrets` option that scrubs both streams before `step()` can print them. Nobody swept it to the
**non-dexec** subprocess helpers, and `restartComposeService` is one: it returns raw `stdout`/`stderr`
from `spawnSync("docker", ["compose", ...])`, which no scrubber touches.

Why it is a real channel rather than a worry: this lane **generates a per-run secrets master key and
control-plane keypair into the environment `docker compose` reads** (`m1-fault-matrix` step 7), and
`docker/d1/m1-spine.override.yml:99` gives the control plane a real `AOA_SECRETS_MASTER_KEY`. A
compose error that echoed a rendered value would land in a **public** CI job log. *A channel that
leaks only when the system is broken is still a channel* — this file's own §5 lesson.

**Enumerated by `grep -n "\.stderr\|\.stdout" tests/d1/m1-fault-matrix.test.mjs`: 3 sites.**

| Site | Verdict |
|---|---|
| `step()` (the dexec chokepoint) | **Has its boundary** — `dexecModule`'s `secrets` option, `DEP-020` §5. No change |
| the `control-plane` restart case | **PRE-EXISTING TWIN — fixed.** `truncate(restarted.stderr)` → the exit status |
| my `worker-b` restart case | **MINE — fixed** the same way |

**Checked 3, found 2, fixed 2**, together, in this PR. The fix is the same at both: print the exit
**status**, which is the diagnostic that matters, never the streams — compose's own output is already
in the step's job-log output for a maintainer who needs it. Neither site records the streams in the
retained evidence bundle.

**The DUAL — *a subprocess stream recorded into the retained EVIDENCE BUNDLE* rather than into an
assertion** (the bundle is uploaded as a CI artifact with 14-day retention, which the file's own
`responseFacts` comment calls out): searched every `detail:` block for `.text`, `.stderr` and
`.stdout` — **found ZERO**. Both new cases record only ids, statuses, booleans, poll counts and byte
counts; `composeServiceLogs(...).text` is read and never stored.

### E.1a — my own diff is in the class

The class I am naming in §2 and §5.2 is *a capability whose only consumer discards it*. Walked
against my own diff:

| Thing I added | In the class? |
|---|---|
| `--aoa-fake-delay` | **No.** Its consumer is §3's case, which asserts a real, attributed observable |
| `--aoa-fake-echo-env` | **YES — squarely.** Which is why it is not in the diff (§5.2). This is the E.1a finding, and it is the whole reason the flag was declined rather than written |
| `queryLeaseExpiries` | **No**, but its arm is corroboration, not attribution, and §3.3 says so rather than letting the reader assume otherwise |
| the inbound guard arm | **No.** Its consumer is `policy`, and 16 of its cases are positive controls (§7.2) |
| the `worker-b` restart's assertion message | **A DIFFERENT class, and yes** — it printed compose's stderr into a public job log. Found by the §A self-audit before the first review, fixed with its pre-existing twin (Class D above) |

### E.2 — the shared register

`tests/d1/fault-matrix.json` is written by every branch at once. The clause-5 supersession was
applied as **targeted text deltas, never a whole-file rewrite**, and the script **asserted the diff
was exactly the intended deltas before writing**: it re-parsed both versions, compared the full
`(profile, case)` key sets, and required the changed set to equal exactly
`{d1.redaction.planted_canary_scrubbed, d2m.redaction.planted_canary_scrubbed}` — failing otherwise.
Output: `superseded exactly 2 cases`. The two `required` flips were separate hand edits to
single case blocks. `git fetch` was run before the branch was cut and ids were minted against the
fetched base (`DEP-021`; base max `DEP-020`, verified by a whole-repo grep, and
`check-register-id-uniqueness` is green).

---

## 7. RED and GREEN

### 7.1 The provider package

`pnpm --filter @armyofagents/sandbox-fake-provider`:

- `typecheck` — clean (after `worker-protocol build`, which the package needs for its types)
- `build` — clean
- `test:run` — **102 pass / 0 fail** (was **90**): 12 new cases

★ **One PRE-EXISTING test went RED and was right to.** `"the default plan is canned usage, exit 0,
not timed out"` pins `DEFAULT_SCRIPTED_COMMAND_PLAN` by **exact shape**, and it caught `delayMs: 0`
arriving. That is the pin working: a new plan field defaulting to something other than "behave
exactly as before" must be a decision, not an accident. The pin was updated and its comment now
records why it exists.

### 7.2 The boundary guard

- `node scripts/check-sandbox-fake-provider-boundary.mjs` →
  `PASS (outbound: 2 leaf packages; inbound: 34 workspace manifests, 5310 source files)`
- `node --test scripts/check-sandbox-fake-provider-boundary.test.mjs` — **63 pass / 0 fail**
  (was **47**): 16 new cases, **every one a positive control or a fail-closed refusal**, because an
  arm whose reds are not demonstrated is indistinguishable from an arm that evaluates nothing (the
  real tree already satisfied the policy).

### 7.3 The declaration

```
OK: tests/d1/fault-matrix.json declares 3 gate profile(s) and 83 case(s) (32 required, 51 pending)
```

**32 required, up from 30** — the two flips. `node --test scripts/check-campaign-fault-matrix.test.mjs`
— **32 pass / 0 fail**.

### 7.4 Guards

The 38 pure-node `pr.yml` guards plus
`node scripts/check-evidence-immutability.mjs --base origin/docs/replatform-program` —
**`failures: 0`**, before every push.

---

## 8. Mutation and positive-control table

**A control whose red is not demonstrated is a check that evaluates nothing.** Every mutation below
was applied, measured and reverted; the tree is green again after each.

### 8.1 `--aoa-fake-delay` — five mutations, each reds exactly ONE test

| # | Mutation | Test that reds | Result |
|---|---|---|---|
| 1 | the sync entry stops refusing a non-zero delay (`if (false && …)`) | *"the SYNCHRONOUS entry point REFUSES a non-zero delay rather than dropping it"* | **1 failed / 101 passed** |
| 2 | the wait moves AFTER the transcript | *"the delay is WAITED, and it is waited BEFORE any transcript is written"* | **1 failed / 101 passed** |
| 3 | the `SCRIPTED_COMMAND_MAX_DELAY_MS` bound is removed | *"REFUSES a malformed, negative, non-integer or out-of-bounds delay"* | **1 failed / 101 passed** |
| 4 | `defaultSleep` resolves immediately (`setTimeout(resolve, 0)`) | *"the default sleep really waits, and it is the one used when none is injected"* — the injected-sleep cases' own control | **1 failed / 101 passed** |
| 5 | the delay is parsed from raw argv, bypassing the probe prelude | *"the delay does NOT reach a DEP-017 probe invocation"* | **1 failed / 101 passed** |
| — | all reverted | — | **102 passed** |

### 8.2 The inbound arm — the reds, each naming its exact violation

| # | Mutation | Required red | Result |
|---|---|---|---|
| 1 | a production manifest given the fake in `dependencies`, then `optionalDependencies`, then `peerDependencies` | `<pkg>: <field> must not contain … — a runtime edge makes a FABRICATING provider production-reachable` | red, all three |
| 2 | `bundledDependencies`, then `bundleDependencies` | as above, per spelling | red, both |
| 3 | a `devDependencies` edge in a non-allowlisted package | `devDependencies must not contain … — only <harness> may declare it, and only there` | red |
| 4 | **the conformance harness moves its dev edge to `dependencies`** — the edge that would actually reach a shipped image | the runtime-edge red | red |
| 5 | SHIPPED source imports it, in `.ts`, `.tsx`, `.mjs`, `.js`, `.cts` | `shipped source must not import … — a FABRICATING provider must not be production-reachable` | red, all five |
| 6 | a **subpath** import (`…/dist/hostile-driver.js`) | the shipped-source red | red |
| 7 | TEST source imports it in a non-allowlisted package — `.test.ts`, `__tests__/`, `tests/` | `test source in <pkg> must not import … — only the conformance harness may` | red, all three |
| 8 | the allowance map gains a third entry | the closed-map pin reds | red |
| 9 | `packages:` unparseable / empty / absent | `refusing to scan zero packages` | red, all three |
| 10 | zero manifests scanned; zero sources scanned | `refusing to report a pass on an empty scan` | red, both |
| 11 | a missing `pnpm-workspace.yaml`; an unsupported glob (`packages/**/deep`) | `missing or unreadable`; `unsupported package glob` | red, both |
| 12 | a source file unreadable (`EACCES`) | a READ error, and **zero** policy errors — never a silent skip | red |
| — | **negative controls** — the harness's permitted dev edge and test import; the fake's own self-references; a decoy mention in a comment and in a string | clean | pass |
| — | **the REAL repository**, with a non-vacuity floor (`≥ 30` manifests, `≥ 1000` sources) | clean | pass |

★ **Row 4 and the mutations I ran against the LIVE tree agree.** Before fixturising them I mutated
`server/package.json` and `packages/sandbox-provider-contract/package.json` and planted probe files
in `server/src`, and each reded with the exact message; all were reverted. The fixtures make those
reds permanent in CI.

### 8.3 The two new D1 cases

Their control is the lane's own **suppressed-injection** arm, which the workflow runs and **fails if
it passes**. Under `AOA_M1_FAULT_MATRIX_SUPPRESS_INJECTION=1`:

- the reconcile case scripts **no delay** and performs **no restart**, so `injectionFired: false`;
- the provider case **withholds `--aoa-fake-timeout`**, so its run succeeds and no timeout is mapped.

Each therefore records the non-injected outcome and reds on `evidence:injection_did_not_fire` and
`evidence:classification_mismatch`. **Neither new case can pass vacuously.** See §9 for the measured
reds.

---

## 9. CI jobs, with executed counts

*(Filled from the live runs; `ci-required` and the accepting `m1-fault-matrix` run are named here.
Per-step conclusions are read from the jobs API and never from the run conclusion — `E6-F023`.)*

| Lane / job | Run | Result | Executed |
|---|---|---|---|
| `d1-merge-train` / `m1-fault-matrix` | `35954159711` | *see §9.1* | live matrix + the suppressed-injection control; `m1-spine` and `d1-merge-train` **`skipped`** (the `lanes` selector's negative arm, which is the selector's own control) |
| `pr.yml` / `policy` → boundary + fault-matrix declaration | *see §9.1* | — | `check-sandbox-fake-provider-boundary.mjs` + **63** unit tests; `check-campaign-fault-matrix.mjs` + **32** unit tests |
| `pr.yml` / `ci-required` | *see §9.1* | — | aggregator over the gate suite |

### 9.1 The live cycles, because each one found something real

| Cycle | Run | What it found |
|---|---|---|
| 1 | **`35954159711`** | **`d1.provider.worker_terminal_mapping` PASSED on its first live attempt** — `injectionFired: true`, `observedClassification: "worker_maps_provider_timeout_to_failed_terminal"` (the declared string, exactly), `positiveControlPassed: true`, 120.6 s. ★ And the reconcile case failed with the finding in §3.2: a GRACEFUL restart PRUNES the candidate, so the stop must be a SIGKILL — and the graceful arm becomes the case's own negative control. Every other case on the profile stayed green (23 tests, 1 failing), so the finding is localised to this case and is not a lane regression |
| 2 | **`35956091950`** | **ARM 1, the graceful negative control, PASSED IN FULL** — `inFlight: true`, `restartStatus: 0`, `startedAtChanged: true`, `reportedStoreEmpty: true`. So the control half is proven live. ★ ARM 2 then failed with its job still `attemptStatus: "pending"`, `events: []`, `leaseWorkerIds: []` after 45 polls — **not a broken worker but a BUSY one**: ARM 1 abandons an attempt mid-run and this worker runs ONE job at a time, so until that attempt terminalises the restarted daemon has no slot. ARM 2's wait had silently assumed otherwise |
| 3 | **`35957846155`** | ARM 1 passed in full AGAIN, and the new slot precondition timed out: `settledAttemptStatus: "running"` after 200 s, with `attempt_started` and the env-probe log event present. ★ **An interrupted run is RE-LEASED and RE-RUN, so its window is paid TWICE.** Waiting longer is the fragile fix; the CONTROL's window only has to outlive `attempt_started` long enough for the restart to land (~10 s), so `RECONCILE_CONTROL_WINDOW_MS` is 30 s while the injection keeps 90 s |
| 4 | **`35960080927`** | **the slot precondition went GREEN** — `settledAttemptStatus: "succeeded"`, `slotFree: true` — and the injection arm's job was STILL never leased in 150 s, on an IDLE worker that had just finished another job of the same tenant. ★ The only difference between the two jobs is WHEN THEY WERE PLACED: a placement carries the target's `registered_profile_hash` and provider `digest`, the control arm's job was placed before any restart, and the injection arm's used a target captured at the top of the case and TWO restarts stale. `DEP-020` cycle 2 recorded the same family from the other side. The target is now re-read PER SEED, and what was read is recorded so a cycle that still fails is distinguishable without a second run |
| 5 | *see the table above* | the per-seed target re-read |

★ **Each cycle cost ONE cycle and not three because every case records every conjunct of its
injection separately.** Cycle 1's retained bundle answered *"which half did not happen"* — the
injection had fired in full and the reconciler had simply found nothing — cycle 2's answered *"the kill arm never got a
lease"*, cycle 3's *"the abandoned attempt is still running"* and cycle 4's *"the slot was free and it
STILL was not leased"* — each without a second run to narrow it. A case recording only a
pass/fail boolean would have needed a run per hypothesis. That is the practical argument for the
per-conjunct `detail` block, recorded here rather than left as style.

★ **And each failure was promoted rather than patched around.** Cycle 1's graceful restart became
the case's same-mechanism negative control; cycle 2's scheduling discovery became an explicit
slot-free precondition with its own assertion; cycle 3's re-run discovery became a deliberately
short control window with the reason recorded at the constant; cycle 4's became a per-seed target
re-read. None is a workaround: each is a statement about the system that the case now encodes.

★★★ **The four findings are one family, and naming it is the point:** *a precondition the case
assumed and did not assert*. It assumed the stop would leave a candidate (it does not, if graceful);
that the worker would be free (it is not, while an abandoned attempt holds the slot); that an
abandoned attempt would end (it is re-run first); and that a placement stays valid across a restart
(it does not). Each cycle converted one assumption into an assertion, which is why the case now
fails LOUDLY and specifically rather than timing out.

---

## 10. What awaits what, exactly

- **Firing keylessly on `M1-D1-SPINE` as of this ticket:**
  `d1.reconcile.worker_startup_lease_probe`, `d1.provider.worker_terminal_mapping`.
- **Awaits a RULING, not code — `d1.redaction.planted_canary_scrubbed`.** It needs an observable
  channel for scrubbed run output on a D1 stream, which ruling F2 (2026-09-23, `E4-F019`) removed.
  Owner: the planning session, which owns that ruling. **No provider flag unblocks it** (§5).
- **Awaits a keyed run, mechanism already present on that lane:**
  `d2m.redaction.planted_canary_scrubbed` — the DEP-017 planted execute is the echo; the case
  asserting the run's own streams is what is missing.
- **Awaits a keyed run AND further harness work:** the remaining `M1a-D2-MECHANISM` cases, now two
  fewer than `DEP-020` left them, since the pair it routed there are fired keylessly here.
- **Not scheduled at `M1a`:** every `M1-D2-CODING` case.

---

## 11. What this ticket does NOT do

1. **It does not add `--aoa-fake-echo-env`**, and §5 is the measured reason rather than a preference.
2. **It writes no QA record and no milestone handoff**, and edits none. `DEP-020`'s result record and
   the two `M1a` QA records are **cited, never modified**.
3. **It does not make `M1a` pass.** It makes one REQUIRED case able to fire, which is what a new
   candidate was blocked on.
4. **It does not close the E5 clause-5 grade** — that clause is still `not_proven` on D1, now with a
   correct blocker and a correct owner.
5. **It runs no keyed workflow and spends nothing on E2B.**
6. **It adds no inbound arm to the other five boundary guards**, and §6 Class A says why rather than
   leaving the reader to wonder.
