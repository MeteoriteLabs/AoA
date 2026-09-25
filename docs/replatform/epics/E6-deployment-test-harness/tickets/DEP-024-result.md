# DEP-024 — Wiring clause 5's floor onto the KEYED lane: deployment, producer, driver — result

**Status:** `gate_review`
**Epic:** E6 · **Plan task:** `M1a` critical path (E5 exit-gate clause 5) · **Milestone:** `M1a`
**Date (UTC):** `2026-09-25`
**Implementer:** Claude Opus 5 (M1 build agent)
**Start SHA:** `8fbb532be4` (`origin/docs/replatform-program`)
**PR:** base `docs/replatform-program`

> `Status` is `gate_review` and may be set to `complete` only by a DISTINCT reviewer, never by this
> author.

---

## 0. What this ticket is

`d2m.redaction.planted_canary_scrubbed` — the last declared gap in `M1a-D2-MECHANISM` — stood
`pending`/`structural`. `DEP-023` built the lane-agnostic product surface and proved it on the **D1**
twin; a Codex correction on PR #602 then measured that **three** things, not one, were missing before
the keyed lane could exercise the case. This ticket wires all three, and leaves the case `pending`
with `pendingKind` now **`keyed`**, because the only remaining blocker is one dispatch that ruling F8
reserves to the planning session.

Nothing here is a decision. `DEP-023`'s §7 named the three gaps; this is them, built.

---

## 1. Per gap: what was wired, and how it was verified

### Gap 1 — DEPLOYMENT

`AOA_WORKER_RUN_OUTPUT_PROBE` was set in exactly ONE place in the repo (`docker/d1/m1-spine.override.yml`).

| Change | Where |
|---|---|
| `AOA_WORKER_RUN_OUTPUT_PROBE: "1"` on all three shipped-boot workers, plus the header note that says what rides it and why it is safe | `docker/m1-boot/docker-compose.m1-boot.yml` |
| `SHIPPED_BOOT_RUN_OUTPUT_PROBE_ENV` + the clause in `evaluateShippedBootOverlayInvariants` | `scripts/lib/staging-manifest-invariants.mjs` |
| The flag documented at last (DEP-023 shipped it undocumented) | `docs/deploy/environment-variables.md` |

**Verified (demonstrated, locally):** `node scripts/check-staging-manifest.mjs` green on the real
overlay; three new tests in `scripts/check-staging-manifest.test.mjs` (66 pass, was 63). **Mutation:**
the invariant's comparison short-circuited → the two REJECT tests went red (64 pass / 2 fail) and the
positive test stayed green, which is the right asymmetry. Reverted.

**Verified (argued from source, the whole chain, link by link, on THIS lane rather than inherited
from the D1 twin — E.3.1):** the shipped workers do not run `bin/worker-daemon.js`; their compose
`command` enters `/worker-net-app/dist/bin/networked-host.js`. So the flag only reaches the surface
if that root composes the same things:

| Link | Read at source |
|---|---|
| `networked-host.ts` (invoked directly) | calls `runContainerHost({ env, proc, bootstrap })` |
| `bin/container-host.ts` `runContainerHost` | `const bootstrap = deps.bootstrap ?? bootstrapWorkerDaemon` → the SAME sink |
| `bin/worker-daemon.ts` `bootstrapWorkerDaemon` | `makeLogger({ …, redactionCanaries: () => canaryCoordinator.snapshot() })`, and later `runOutputProbe: config.runOutputProbe, canaryCoordinator` into the dispatch runtime |
| `logging/logger.ts` `createWorkerLogger` | wraps the sink in `createRedactingDestination` **iff** `redactionCanaries !== undefined` — which the line above supplies |

That last row is the one that matters, and it is why the chain was walked rather than assumed: the
`E4-F019` closure is **conditional on an option**, so a composition root that built its logger
without `redactionCanaries` would arm the probe with the collision class wide open. This one does
not.

### Gap 2 — PRODUCER

The only producer of a tagged line was the reference provider's `--aoa-fake-echo-env`, which the real
E2B lane does not run. **No product code was added, and none was needed.** The case seeds its own
worker-driven job, so it AUTHORS the tenant command:

```
command: "sh"
args:    ["-c", "printf 'AOA-RUN-OUTPUT-PROBE canary=%s\n' \"$ANTHROPIC_API_KEY\""]
```

Three D1-specific facts were hard-coded in `seedSpineWorkerDrivenJob` and are now **default-identical
parameters** — `targetId`, `policyHash`, `command` — the same shape `DEP-022` used for the stack
binding. Plus a `dexec` render seam (below).

**Verified (demonstrated, locally):** `scripts/lib/__tests__/dep-024-worker-driven-seed.test.mjs`,
5 tests. It asserts the defaults ARE the D1 constants, the overrides take effect, **and that the D1
constants are GONE after an override** — an override that added its value while leaving the default
embedded would place the attempt on the D1 target and pass a one-sided assertion. **Mutation:**
reverting `command: P.command` → `"claude"` and the two id params to their constants turned the
OVERRIDE test red and left the DEFAULT test green. Reverted.

### Gap 3 — DRIVER

| Piece | File |
|---|---|
| The pure judge: two-arm classification + the pair verdict + the matrix row | `scripts/lib/m1a-redaction-probe.mjs` (new) |
| Its control, 17 tests, each green assertion paired with the mutation that breaks it | `scripts/lib/__tests__/m1a-redaction-probe.test.mjs` (new) |
| The observer: seeds both arms, reads both streams, mints and scrubs | `scripts/m1-shipped-boot/redaction.mjs` (new) |
| The KEYED-ONLY `redaction` phase + the conditional fold into the bundle | `scripts/m1-shipped-boot/journey.mjs` |
| The lane step, before `fault-matrix` | `.github/workflows/m1-shipped-boot.yml` |
| `shippedBootPolicyHash` — ONE source for the value that used to be computed inline | `scripts/lib/m1-shipped-boot.mjs` |
| `PHASE_OWNED_CASES`, so the cross-tenant checks do not claim this case | `scripts/lib/d2m-cross-tenant.mjs` |

**Verified (demonstrated, locally):** 256 pure-node tests across every suite this PR touches, 0 fail.

---

## 2. THE SAFETY PROOF

### 2.1 The planted value is never a real provider key — and that is a property of the SEED

The strongest half of the argument is not about the scrubber at all. The case's job carries its own
`job_secret_handles` row pointing at a Company secret the phase wrote seconds earlier, whose value is
a canary minted for that one arm. So the value the sandbox receives as `ANTHROPIC_API_KEY`, and
therefore the value the workload echoes, has **no authority anywhere**: not the Organization's
configured provider key, not the job secret the workflow holds, nothing that outlives the run.

This is deliberate and it is the one place where this lane's design differs from the D1 twin's
*reasoning* (the mechanism is identical — `secret.plant_high_entropy_canary_as_the_redeemed_value` —
but on D1 the redeemed value is a fake either way). **Echoing a live provider key into a third-party
sandbox's stdout would put it into E2B's own service logs, which no scrubber of ours reaches.** No
redaction argument covers that, so the design does not rely on one: it never plants it. The declared
`injection` and `redactionCase` blocks are unchanged, because the seeded canary *is* the redeemed
value.

### 2.2 Nothing unscrubbed can reach either declared stream

Every link read at source in this session, at `8fbb532be4`:

1. the echo's only channel out of the sandbox is `ExecuteInput.onStdout`;
2. on this lane that callback is the adapter-manager's `createRunOutputCapture`, composed by
   `executeRelayingStdout`, whose canaries are `Object.values(env)` — the planted value is one of
   them — and which returns only the scrubbed `stdoutTail`. **The E2B provider runs behind the SAME
   adapter-manager as the reference provider**, so nothing about a keyed run changes this link;
3. `scrubOutputText` is **FAIL-CLOSED**: if any needle survives, the WHOLE tail is dropped to `""`
   and counted. A tail carrying a live canary cannot exist; the failure mode is an empty tail;
4. the daemon's own `createRunOutputCapture` scrubs the returned tail again with the run's LIVE canary
   array, which `synthesiseRunSecrets` seeded with this same value (`runCanaries.push(...mat.canaries)`);
5. `selectRunOutputProbeLines` performs no scrubbing and is documented as a selector; its input is
   `captured?.stdoutTail ?? ""` and nothing else.

### 2.3 The `E4-F019` path, checked rather than inherited

`E4-F019` is about `createWorkerLogger`'s sink adding `msg`/`time`/`level` **below** any caller-side
scrub, so a secret colliding with a structural token is emitted verbatim. Both destinations of this
surface put their scrubber below every key:

- **`events`** — `EventSequencer.#emit` assembles the COMPLETE envelope and only then runs
  `scrubEventStrings` over every string leaf; the single thing added afterwards is `eventDigest`, a
  digest **of the scrubbed bytes**.
- **`logs`** — `createRedactingDestination` scrubs the fully-serialized pino record, after the sink
  has added its keys. That is `E4-F019`'s own closure route 2.

★ And the route is **conditional**, which is exactly why §1's chain walk was not optional:
`createWorkerLogger` wraps the destination only when `redactionCanaries` is passed. On this lane it
is, by `bootstrapWorkerDaemon` — the same sink the networked-host root reaches. Measured, not assumed.

★ **A residual, stated rather than hidden.** `E4-F019` remains **open** (DEP-023 §6.1 reverted its own
closure claim after Codex): the coordinator's snapshot is per-lease and released when a run settles,
so a line written OUTSIDE a live lease is still unprotected. The probe line is written inside
`observeRun`, before the terminal and before the release, so it is always inside the covered window.
The brief's condition — *the class must not be reachable through what you wire* — holds. The finding's
wider exposure is untouched by this ticket and is not claimed closed.

### 2.5 One inherited behaviour that now points at the journey's own target

`seedSpineWorkerDrivenJob` opens with a **seed-hygiene UPDATE** that releases `active` leases of the
seeded target's workers. On D1 that target is a purpose-built test target; on this lane it is
**tenant A's own ratified target**, the one the journey's real worker enrolled on. That is a new
exposure, named here rather than left for a reader to find.

It is nonetheless safe, on three conjuncts read at source:

- it is scoped to `l.worker_id IN (SELECT id FROM workers WHERE execution_target_id = $target)`, so
  it cannot reach another tenant's worker;
- it fires **only** where `a.status IN ('succeeded','failed','cancelled')` — a lease on a RUNNING
  attempt is left exactly as it is, which is the function's own stated invariant;
- the `redaction` phase runs **after** `dispatch`, so tenant A's journey run is already terminal by
  the time it executes. The phase ordering is what makes the second conjunct vacuously satisfied
  rather than merely respected.

Removing the hygiene is not an option: the deployed worker has ONE batch slot and this phase seeds
TWO jobs in sequence, so without it the second arm would never be offered and would red on a timeout
rather than on its assertion — the failure the hygiene exists for.

### 2.4 Belt and braces in the driver

The observer decides `injectionFired` from the scrubber's **own** marker on a line that also carries
this run's probe tag, never from the harness's intent and never from a clean stream. It records only
booleans, counts and ids — asserted, not trusted (`the row NEVER carries a canary or a stream
excerpt`). Every canary the driver mints is registered at a local chokepoint and every refusal message
is scrubbed through it, because `journey.mjs`'s `redactSecrets` knows the JOB's secrets and these are
minted here.

---

## 3. Why this case is PHASE-owned, and why both arms are in ONE run

Neither existing shape fits, and this was measured rather than chosen:

- **DRIVER-owned** (the fourteen `cross-tenant.mjs` cases) is impossible. `runCrossTenantCases`' own
  verdict refuses any row whose `injectionFired !== true`, and that phase runs in **both** modes.
  This case cannot fire in `keyless`: `bootWorkers` never starts the adapter-manager there, so no
  sandbox exists and nothing can echo anything. Folding it in would make the free keyless rehearsal
  permanently red for a reason that says nothing about redaction.
- **JOURNEY-owned** (the three `d2m.tenant.*` cases) would leave it with no suppressed arm at all,
  which is what those three have.

So it gets its own keyed-only phase carrying **both** arms: a withheld-plant job first, then the
planted job. That is **stronger** than the cross-tenant phase's arrangement, where graded and
suppressed are two separate invocations and a stale control bundle cannot be told from a fresh one.

Order is load-bearing twice: the container log is shared by every run on the stack, so a marked line
found during the graded arm can only have come from the graded job — and the suppressed arm's log
check would not be attributable at all, which is why it grades the **per-job event stream only**. That
limit is in the code, in the record, and in a test, rather than glossed.

### 3.1 On the brief's "must appear in the suppressed-injection reds"

Stated plainly, because it is the one requirement this ticket satisfies **differently** rather than
literally. The lane's existing suppressed arm is the `--suppress-injection` re-run of `cross-tenant`,
which this case cannot join (above). Its suppression control is therefore **inside its own phase**,
and `evaluateRedactionProbeEvidence` refuses unless the withheld arm is present AND reports
`injectionFired: false` AND is shown to have actually run (non-empty own event stream — otherwise
"no marker" is indistinguishable from "never ran"). The property the requirement exists for is met,
by a mechanism that cannot be satisfied by a stale bundle; the *location* differs, and a reviewer
should hold me to that distinction rather than to the word.

---

## 4. The class sweep, with its dual

**THE CLASS, in one sentence:** *a flag-gated diagnostic surface that a declared case depends on, but
which is armed on one lane's manifest and not on the sibling lane whose case needs it.*

**THE DUAL (E.1b):** *a flag armed on a lane where nothing asserts what it produces* — a probe
deployed with no observation, which reads as coverage and proves nothing.

**Enumeration, quoted not remembered.** `grep -rn "AOA_WORKER_ENV_PROBE:\|AOA_WORKER_RUN_OUTPUT_PROBE:" docker/`
→ 8 hits. Two diagnostic switches × the two EVIDENCE-lane manifests (`docker/d1/m1-spine.override.yml`,
`docker/m1-boot/docker-compose.m1-boot.yml`) = **4 (switch, lane) pairs checked**. Before this ticket
3 were armed and **1 was the defect**. After it, 4/4. The other six worker-bearing manifests
(`docker-compose.{d1,staging,quickstart,research}.yml`, `docker-compose.yml`,
`docker/campaign/docker-compose.campaign.yml`) must NOT arm either, and `grep -rln` confirms neither
switch appears in any of them.

**The dual, searched and reported:** for each of the 4 armings, an assertion exists — D1 env probe
(`m1-spine-assertions` + the profile's summary read), m1-boot env probe (`dispatch`'s per-tenant
`envProbe`), D1 run-output probe (the `required` D1 case), m1-boot run-output probe (this ticket's
phase, which refuses on its own two arms whether or not the matrix case is flipped). **0 unasserted
armings.**

### 4.1 ★ The twin DEP-023 left standing, found by the sweep and fixed in the same PR

A second, narrower class fell out of it: *a flag-gated surface whose DROP is not a free pre-boot red,
although a `required` case depends on it.* The D1 override's `AOA_WORKER_DISPATCH_ENABLED` and
`AOA_WORKER_ENV_PROBE` are both held by `evaluateM1SpineOverride`; **`AOA_WORKER_RUN_OUTPUT_PROBE`,
which DEP-023 armed on that very file seven lines below them, was not.** Drop it and
`d1.redaction.planted_canary_scrubbed` — declared `required` — reds MID-CAMPAIGN as
`no_scrubber_marker_observed`, a failure whose text names redaction while the cause is one missing
line of configuration.

Fixed: `override:run_output_probe_not_armed` in `scripts/lib/m1-spine-assertions.mjs`, beside its two
neighbours, with its positive control next to theirs (126 tests, was 125). **Mutation:** the clause
short-circuited → that one test red, everything else green. Reverted. **Checked 3 clauses in that
block, found 1 missing, fixed 1.**

### 4.2 My own diff is in the class (E.1a)

The first place I looked once the class had a sentence. The m1-boot arming I ADDED is the newest
member of the class, and the dual's question — "does anything assert what it produces?" — is what
forced the `redaction` phase to refuse on its own arms independently of whether the matrix case is
`required`. An earlier draft folded the row unconditionally and gated the *assertion* on the flip;
that would have armed a probe on a paid lane with nothing grading it until someone else flipped a
field.

---

## 5. A record that disagrees with the code

`DEP-023-result.md` §5.1 states, of the newline-in-a-string-literal defect that cost it a cycle:

> *"the harness function's template is now rendered locally with a stubbed `dexecModule` and put
> through `node --check`, which reproduces the old red and passes the new text. That check cost two
> minutes and would have saved the cycle"*

**No such control exists in the tree at `8fbb532be4`.** `git grep -n 'node --check\|"--check"' scripts tests`
returns exactly one hit, `scripts/update-worker-protocol-contract-manifest.mjs:110`, which is an
unrelated CLI flag; nothing renders a harness template and nothing parses one. A false claim of
enforcement is worse than a missing check, and this ticket depends on exactly that template family,
so rather than only filing it the check is **built**: the `dexec` seam plus
`dep-024-worker-driven-seed.test.mjs`'s `RENDER + PARSE` test, whose own positive control feeds it
`const x = "a<newline>b";` and asserts the parse fails. Not filed as a numbered finding because it is
remedied in the same commit that reports it.

---

## 5.1 Codex round 1 — two findings, both real, both verified at source before acceptance

**P1 — `reject candidates that predate the redaction phase`.** Right, and the same class DEP-020's
preflight already guards. Verified at source: the new `redaction` step is MODE-gated, not
CANDIDATE-gated, and `actions/checkout` uses `ref: ${{ inputs.candidate }}` — so a candidate older
than this ticket reaches that step with a driver that has no such phase and dies on `unknown phase`
**after** the images are built, the stack is booted and the keyed journey has already spent. Fixed:
four pre-spend greps in the candidate preflight, in DEP-020's own style — the phase name, **both**
modules it dispatches into (a candidate may carry the phase and not the modules), and the overlay's
`AOA_WORKER_RUN_OUTPUT_PROBE`, because a candidate that predates the DEPLOYMENT half would run the
phase and observe no marker on either stream. All four greps were checked against this tree (each
matches), so the preflight is not one that can never pass.

**P2 — `register the planted canary with the lane leak scanner`.** Right, and it is the more serious
of the two. Verified at source: `collect` and `leak-scan` run in **separate processes** that read
`state.secrets` / `state.redact` off the state file; `collect` copies the worker container logs into
the evidence bundle under `if: always()`; `leak-scan` searches for NAMED secrets plus key material
BY SHAPE, and `d2mcanary…` matches neither. So on **the one run that matters most** — the run where
the redaction mechanism under test FAILED and the raw canary reached the worker log — the bundle
would have been uploaded carrying the exact value the case was testing. The module's process-local
`minted` chokepoint covers its own refusal text and nothing else.

Fixed: the driver now takes a **required** `registerSecret` ledger (the journey's `trackSecret` +
`saveState`) and registers each canary **before the seed writes it as a Company secret** and long
before any sandbox can echo it — so it lands in `state.redact` (every retained log scrubbed), in
`state.secrets` (the pre-upload scan searches both surfaces in raw, base64 and base64url form) and
behind an `::add-mask::` directive. Absent ledger ⇒ the phase refuses, rather than proceeding with a
canary known only to one process.

### 5.2 The P2 class, swept in both directions

**THE CLASS:** *a value this lane mints that is never registered with the journey's secret ledger,
yet has a path to a RETAINED surface.*
**THE DUAL:** *a value the journey registers that a module then puts somewhere the ledger does not
reach* — searched; the ledger's two consumers are `redactSecrets` (every retained log) and
`leak-scan` (both surfaces), and nothing in this diff writes outside them.

**Enumeration:** `grep -rn "const minted = new Set\|function mint(" scripts/m1-shipped-boot/` → **2
sites**, `cross-tenant.mjs` and `redaction.mjs`. Neither registered with the journey's ledger.
**2 checked, 1 reachable, 1 fixed.**

`cross-tenant.mjs` is **not** reachable, and this was measured rather than assumed: its minted values
are resolved over HTTP by the harness, its `record(…)` details carry only `responseFacts`
(status/outcome/code/reason), counts and ids — never a body — and its only path to a retained surface
is its own `fail()` text, which its local chokepoint already scrubs. Nothing there routes a minted
value into a container log, which is precisely what makes `redaction.mjs` the reachable member: it
**deliberately** echoes its value into a sandbox whose output crosses into the worker log. Left
unchanged, with the reason stated rather than silent: threading the ledger through that phase would
change the signature of the driver whose two invocations are the lane's own positive control, for a
path that does not exist. If the control plane ever begins logging a resolved value, that site joins
this one.

## 6. Register deltas (two-sided, against the MERGE REF)

Taken against the fetched `origin/docs/replatform-program`, as key-set diffs, printing both
directions (E.2/E.2.1):

```
scripts/test-execution-census.json
  ADDED  : ['scripts/lib/__tests__/dep-024-worker-driven-seed.test.mjs',
            'scripts/lib/__tests__/m1a-redaction-probe.test.mjs']
  DROPPED: []
  CHANGED: []
  base 99 keys, head 101

scripts/test-inventory.json
  ADDED  : []
  DROPPED: []
  CHANGED: [('scripts', {mode: pinned, count: 75} -> {mode: pinned, count: 77})]
```

Both new suites are declared **`runs`**, with the `pr.yml` step that now runs them (the same step that
already runs their neighbours `e6f-harness-binding` and `d2m-cross-tenant-coverage`) — the scaffolded
`unrun`/TODO stubs were replaced, not committed. `finding-ownership.json`,
`gate-clause-wiring.json` and `distributed-execution-threat-controls.json` were **not touched**;
`check-register-citation-integrity` is green.

`tests/d1/fault-matrix.json` was edited as a delta on the parsed document after asserting that a
`json.dumps(indent=2)` round-trip of the base is **byte-identical** (it is), and the change asserted
two-sided on the case's own key set:

```
ADDED  : ['$supersededPendingOwner_DEP023', '$supersededPendingReason_DEP023']
DROPPED: []
CHANGED: ['pendingKind', 'pendingOwner', 'pendingReason']
```

`injection` and `redactionCase` are **unchanged** — asserted in the edit script, because the planted
canary really is the redeemed value on this lane and the declaration did not need to move.
DEP-023's `pendingReason` and `pendingOwner` are kept verbatim under the two `$superseded…_DEP023`
keys; nothing earlier was rewritten.

---

## 7. Demonstrated vs argued — the honest split

| Claim | Status |
|---|---|
| The overlay invariant reds on a dropped/malformed flag | **Demonstrated** (local, mutation-proven) |
| The seeder's parameters are default-identical and the overrides take effect | **Demonstrated** (local, mutation-proven) |
| The rendered seed script parses on both lanes' parameters | **Demonstrated** (local; the check's own positive control reds) |
| The judge refuses each of: missing arm, still-firing suppressed arm, never-ran suppressed arm, scrubber removed, zero-byte stream, drifted stream list | **Demonstrated** (local, 17 controls) |
| The D1 twin still passes with the parameterised seeder | **Demonstrated** — see §8 |
| The shipped worker's logger is wrapped in `createRedactingDestination`, so `E4-F019` is not reachable | **Argued from source**, whole chain, 4 links each read |
| A canary cannot reach either stream unscrubbed | **Argued from source** (fail-closed capture ×2, envelope-level event scrub, transport-level log scrub) |
| The candidate preflight greps match a current tree (so the gate can pass) | **Demonstrated** (each grep run against this tree) |
| The probe line actually appears on both streams of a REAL E2B run | **NOT demonstrated.** This is the keyed run owed (§9) |
| `sh` exists on the `aoa-canary-e2b` template | **Argued** — `ENV_PROBE_SH_WRAPPER` runs `sh` in that same sandbox on this same lane today |

★ **What I did NOT dispatch, and why.** `m1-shipped-boot` in `keyless` mode would have been free, and
it was the obvious thing to reach for. It would have proved **nothing about this branch**: that
workflow's `actions/checkout` uses `ref: ${{ inputs.candidate }}`, and the candidate must be a 40-hex
ancestor of `docs/replatform-program` — which this branch is not. The workspace would have been the
old tree, my compose change would not have been rendered, and the `redaction` phase does not run in
keyless anyway. Reading such a run as verification is `E6-F031`, and a run that cannot distinguish my
change from its absence is not a hypothesis test (E.3.2).

---

## 8. The free run that DOES test this branch

`d1-merge-train` checks out the dispatched ref, so my code runs.

**Hypothesis:** the seeder's three new parameters are default-identical, so the D1 lane's
`M1-D1-SPINE` profile — including the `required`
`d1.redaction.planted_canary_scrubbed`, which calls `seedSpineWorkerDrivenJob` with none of them —
behaves exactly as before.

- **If right:** `m1-fault-matrix` green, the live profile executing its full case count with the
  redaction case among the passes, and the suppressed-injection control still red.
- **If wrong:** the redaction case (and every other worker-driven case) reds on a TIMEOUT rather than
  on its assertion, because the seeded job's `policy_hash` or placement target no longer matches the
  deployed worker's and the attempt is never offered. That shape is specific, and it is the precise
  regression a default-identical refactor introduces — the one the unit tests can only *argue*.

**Result:** recorded in §8.1 below.

### 8.1 The run

*(filled in from the dispatch; see the final report for the run id, the job and its executed count.)*

---

## 9. What is outstanding

1. **ONE keyed `m1-shipped-boot` dispatch** — ruling F8's, and now the WHOLE blocker. The case's
   `pendingKind` is `keyed` accordingly. What each red shape would mean is written into the
   declaration's own `pendingReason` rather than only here, so the next reader finds it where they
   are already looking:
   - `scrubberMarkerObservedOnStream.events=false` ⇒ the `log` EVENT never reached `job_events`;
   - `…logs=false` ⇒ the probe line never reached the container log (flag unread, or the transport
     scrubber refused the record);
   - a `failed` terminal with no events ⇒ the seeded handle does not materialise as
     `ANTHROPIC_API_KEY` in a real sandbox, or `sh` is not on the template;
   - the withheld-plant arm reporting `injectionFired: true` ⇒ the marker is produced by something
     other than this case's injection, and the case proves nothing;
   - `redactedOnAllStreams=false` ⇒ a REAL leak; revert the surface, do not debug it.
2. **The flip itself.** `faultMatrix` reads the declaration to decide whether to fold the row, so the
   row enters the graded bundle on the SAME commit that flips `evidence` to `required` and not a
   moment before — a bundle reporting evidence for a `pending` case is refused by the matrix's own
   verdict. The flip is one field plus the run id in this record.
3. **`d2c.redaction.planted_canary_scrubbed`** (`M1-D2-CODING`) is untouched and is not made stale by
   this ticket: that profile is the same shipped-boot lane on the M1b candidate and is unscheduled at
   M1a, so the wiring here serves it when it is scheduled.
4. **`E4-F019`** stays open, at its narrowed exposure. §2.3 states what this ticket does and does not
   claim about it.
