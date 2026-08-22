# Wave-3→4 gate, clause 3 — result

**Start SHA** `ad34edab7` (the design commit) ·
**Terrain** [`GATE-clause-3-rollback-terrain.md`](./GATE-clause-3-rollback-terrain.md) ·
**Design** [`GATE-clause-3-rollback-design.md`](./GATE-clause-3-rollback-design.md) ·
**Branch** `docs/replatform-program` (PR #323).

**Status: clause 3 SATISFIED for the org heartbeat. Recorded as NOT ticked on triviality for the
three shadow-only sinks, which must re-satisfy it at activation.**

**5 mutants: 5 killed, 0 survived.**

---

## 1. What was actually wrong

The rollback path a successor would follow was written down in three places and was **incomplete
in all three**: CLI-006's result names it as *"removing the Organization's key … a config edit,
with no code change and no migration"*, and the operator env reference described the variable
without saying when a change takes effect.

`createDistributedExecutionRolloutSource` parses the map — and reads the deployment flag —
**once at construction** (`distributed-execution-rollout-source.ts:159-160`), and `index.ts`
builds the source once at boot. **A live process never sees the edit.**

The test that appears to cover this (`cli-006-canary-rollout-mode.test.ts:121`, *"returns the
next run to legacy when the canary key is removed"*, under the comment *"Invariant 9 — rollback
is a config edit"*) constructs a **fresh** source from a new env bag. A running process cannot do
that. It proves the decision function, not a rollback.

Nobody was careless: each statement is true. The gap is that "config edit" and "takes effect
now" read as the same sentence to an operator in an incident.

## 2. The path, as it now reads

An **ordered pair**, and the order is load-bearing:

1. **Throw the REL-004 kill switch** (`instance_settings.kill_switches`) — **immediate**, read
   from the database on every worker poll; workers stop being offered new leases, in-flight work
   finishes.
2. **Edit `AOA_DISTRIBUTED_EXECUTION_ROLLOUT` and restart** — the durable state change.

Doing 2 without 1 is the hazard: the restart can land while an attempt has already been handed
off (legacy adapter suppressed at `heartbeat.ts:5250`, attempt durably lease-eligible). After a
flag-off restart no worker can lease it, and **neither `createJobControlSweeper` nor
`createJobDistributedDrain` has a production caller** — so the run stays `running` indefinitely.
Step 1 drains that window.

**`AOA_DISTRIBUTED_EXECUTION_ENABLED` is not a master switch**, and the result doc says so: it is
live for new heartbeat conversions (the hook re-reads `process.env` per call) but the worker
control routes sit behind a construction-time `if` (`app.ts:438`), so workers keep polling until
a restart.

**Clause 1 turns out to answer most of clause 3.** REL-004's kill switch is the only genuinely
live lever for the leasing half. The handoff lists the two clauses as unrelated; they are not.

## 3. Acceptance → named executable artifact

| # | Invariant | Artifact | Result |
|---|---|---|---|
| G1 | A constructed rollout source ignores later env mutation — removal, downgrade, and flag-unset | `rollout-rollback-liveness.test.ts` | pass |
| G1b | A freshly constructed source DOES see the edit — i.e. the restart is what applies it | same file | pass |
| G2 | The deployment flag IS live at the heartbeat hook, and flag-first (no Organization resolved when off) | same file | pass |
| G2b | The two levers are not interchangeable — same env bag, same edit shape, different latency | same file | pass |
| G3 | Worker control routes are gated at construction, not per request | same file (source contract) | pass |
| G4 | The operator-facing instruction names both steps and the restart | `docs/deploy/environment-variables.md` § "Rolling distributed execution back"; correction block at the head of `CLI-006-result.md` | done |
| G5 | Clause 3 status recorded per sink | this doc §4 + handoff §4 | done |

## 4. Per-sink status — and what must NOT be read as satisfied

| Sink | Execution can move today? | Clause 3 |
|---|---|---|
| org heartbeat (`task_run`) | **yes** (CLI-006 canary) | **SATISFIED** — path named, limits pinned, in-flight gap stated |
| `commander_turn` | no — shadow only | trivially satisfied; **RE-SATISFY at activation** |
| `crew_run` | no — shadow only | trivially satisfied; **RE-SATISFY at activation** |
| `one_shot` | no — shadow only | trivially satisfied; **RE-SATISFY at activation** |

The three MIG sinks have nothing to roll back because nothing has moved. That is a fact about
today, not a property of the design, and Wave 4 changes it for each sink it activates.

## 5. Mutation ledger

| Mutant | Kills |
|---|---|
| H1 the rollout map becomes LIVE (re-parsed per call) | ✓ |
| H1b the source's captured flag becomes LIVE | ✓ |
| H2 the hook stops re-reading the flag — rollback stops being live anywhere | ✓ |
| H3 the hook resolves an Organization before checking the flag (not flag-first) | ✓ |
| H4 the worker-control gate becomes a per-request env read | ✓ |

**These are PINNING tests, so they passed on first run.** The fail-first evidence is the mutation
pass: each pin was shown to break under the exact change it exists to detect. H1 is the important
one — it is *supposed* to fail the day someone makes the map live, and its failure message names
the two documents that must be corrected in the same change.

## 6. Limits, stated

1. **No live per-Organization rollback exists.** Recommended as a follow-up, with a constraint:
   `index.ts:1162-1163` hands `resolveOrganizationPolicy` / `resolveWorkloadPolicy` to
   `createJobPlacementService`, so the seam and placement share one source. Making the map live
   must make **all** resolvers live together; a version where the seam is live and placement is
   not is worse than both being static. It also changes the canary path CLI-006 validated on the
   live lane, so it needs its own ticket and its own D1 bring-up.
2. **The in-flight strand is a WAVE-4 BLOCKER, not a limit.** `createJobControlSweeper` and
   `createJobDistributedDrain` both have zero production callers (inherited deferral #2 and
   CLI-005 deferral 1), so `assertRollbackSafe` is a guard reachable only through a service
   nothing invokes. Owner MIG-002. Step 1 of §2 mitigates it operationally; it does not fix it.
3. **G3 is a source contract test**, so a refactor of `app.ts`'s composition must carry it along.
4. **Nothing here was validated on a live lane.** The rollback path is named and its limits are
   pinned by unit-level evidence. An actual rehearsal — throw the switch, restart, confirm one
   executor — belongs to the Wave-4 cutover rehearsal.
