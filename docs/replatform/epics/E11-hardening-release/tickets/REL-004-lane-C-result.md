# REL-004 Lane C — wire the kill switch (clause 3a) · result

**Start SHA** `db08fba1e` (the design commit) · **Design**
[`REL-004-lane-C-design.md`](./REL-004-lane-C-design.md) · **Branch** `docs/replatform-program`
(PR #323) · **Parent** [`REL-004-result.md`](./REL-004-result.md) §4.

**Status: clause 3a COMPLETE and WIRED.** The decision function that had zero callers now
decides whether a worker gets a lease, proven on the real poll path. Clause 3b (reconcile active
provider resources) is Lane D and is untouched.

| # | Commit | Scope |
|---|---|---|
| 1 | `f5e1f911d` | `EXECUTION_TARGET_KINDS`, derived from the class map |
| 2 | `bf5da42e8` | D2 + D6 precision in `evaluateKillSwitches` |
| 3 | `7779c18d9` | `instance_settings.kill_switches` (migration 0260) |
| 4 | `edec8eb66` | `aoa_app` SELECT grant + 5 manifest couplings (migration 0261) |
| 5 | `c476af0c2` | the policy reader, fail-closed |
| 6 | `451db1b11` | the poll answers `drain` |
| 7 | `94fd1c6f1` | the daemon's resumable drain |
| 8 | this commit | separation guard, D1 nonce, test-inventory pin, this doc |

**43 mutants: 41 killed, 1 documented equivalent, 1 intentional negative control.**

---

## 1. What was actually wrong

Clause 3a reads like a request to wire a decision function that was already built and
mutation-tested 18/18. Three things had to be fixed before it could be wired at all, and each
was found by trying rather than by reading.

### 1.1 The template axis is not knowable in the control plane

The parent result doc and the Wave-3 handoff both say the template axis is "the pinned E2B alias
in `packages/sandbox-e2b-provider`'s capability matrix". The pin is real
(`capability-matrix.ts:63`) and it is **worker-side**;
`scripts/check-sandbox-e2b-provider-boundary.mjs` keeps that package out of `server/src`. Nothing
the control plane holds carries a template: not the frozen `workerHelloV1Schema` (a desktop
worker's `policyHash` is all zeros), not `providerConstraintProfileV1Schema` (expressed "WITHOUT
provider-specific field names" by design), not `registeredTargetProfileV1Schema`, not
`execution_targets`. The one place a template IS known server-side is the **legacy** sandbox path
(`sandbox-provider-runtime.ts:530`, from `environments.config`), which creates no `leases` row.

That matters because `evaluateKillSwitches` separates `template: null` (DEFINITELY NONE) from
`template: undefined` (UNKNOWN, fail-closed). Wiring with `null` would make every template switch
a **silent no-op** — the exact hazard the module's own header refuses for a mistyped `dimension`,
and the exact failure class Lane A was written to kill. Wiring with `undefined` under the original
contract made *any* document unreadable, so killing `pooled_gvisor` would have drained the e2b
fleet too.

So the function gained one precision fix (D2): an unknown template refuses **only** a switch that
actually names the template dimension, with its own reason, `placement_unknown`. The consequence
is stated rather than hidden: **a template kill switch drains the entire fleet.** Over-broad and
loud beats narrow and false.

### 1.2 `instance_settings.general` silently erases unknown keys

The parent result doc specified `instance_settings.general.killSwitches`.
`instanceSettingsService.updateGeneral` writes `{ ...nextGeneral, ...operationalMetadata }`, where
`nextGeneral` is the **fixed four-field** output of `normalizeGeneralSettings` and the metadata
carve-out covers only `migrationSnapshots`. A `killSwitches` key there is deleted by the next
Settings PATCH: an operator throws a kill switch, someone toggles a checkbox, the switch
evaporates with no error. The switch got its own column instead.

**And the column is nullable with NO default**, which is the part that would have hurt. A
`DEFAULT '{}'::jsonb` is a document that EXISTS and cannot be understood, which the evaluator
correctly refuses — the default alone would have drained every fleet on every install. That is
integration case 4 and schema test I3.

### 1.3 A poll `drain` was a ONE-WAY fleet stop

`poll-loop.ts` set `drainRequested = true; stopLeasingRequested = true` for every drain, the loop
condition is `while (… && !stopLeasingRequested)`, and the protocol's `retryAfterMs` was parsed
and read by nothing. A drained worker never polled again.

The handoff's stated reason for building this before Wave 4 is that "a bad cutover is reversible
in seconds". With a one-way drain, lifting a kill switch meant restarting every worker process.
That is a grenade, not a switch — so `retryAfterMs: null` stays terminal and a hint now means
*pause*: finish in-flight work, wait the server's cadence, resume.

---

## 2. Two guards caught the plan, and both were right

This is the part worth reading.

### 2.1 `candidate:canonical-chain-dominates-return`

The plan put the kill check before `normalizePlacementRegistryTarget`, to save a candidate scan
for a killed provider. The JOB-003 contract guard refuses **any** return from the poll's tenant
transaction before the canonical authority chain has run, so that every poll outcome is provably
derived from the validated context.

The check moved to after `metrics.certificateScan(...)`. A drained poll now costs one extra
already-indexed query. The invariant is worth more than the query.

### 2.2 `service:no-context-or-guard-injection` — the one that mattered

The plan added `killSwitches?: KillSwitchPolicyReader` to `createJobLeasingService`. The guard
refuses it: service options are a closed allow-list (`ackTimeoutMs`, `appDb`, `leaseDurationMs`,
`maxHeartbeatAgeMs`, `metrics`, `operatorDb`, `scheduler`).

The tempting move was to add an eighth key — to widen a guard *named for exactly the thing I was
doing*. Its objection is substantive: **a reader the caller supplies is a reader the caller can
substitute**, and a substituted reader reporting "no policy" turns the stop button off for the
whole fleet with no trace. That is strictly worse than the hazard the option was meant to avoid,
and it would have been introduced by disabling the check that named it.

The reader is now built inside `createJobLeasingService` from the same `input.appDb` the authority
chain runs on. A permissive override is unrepresentable, the "composition root forgot to wire it"
hole is gone, `worker-control.ts` is unchanged, and the frozen service-option set stays frozen.

**The guard is still live after the one widening it did get.** `evaluateKillSwitches` is
registered as a reviewed call in `auditedProtectedCallPath` and `approvedContainer`, so mutant
M33 inserts an *unreviewed* call over a protected value into the same body — and
`binding:protected-value-escape` still fails. Registering a reviewed call did not retire the
guard.

---

## 3. Acceptance → named executable artifact

| Clause / invariant | Artifact | Result |
|---|---|---|
| **3a — a kill switch stops new leases** | `execution-kill-switch-poll.integration.test.ts` cases 1–6, 10 (real `poll()`, embedded PostgreSQL, non-owner `aoa_app`, asserts the `leases` table) | 10/10 |
| I2 — an absent document permits | same, case 1; `execution-kill-switch-policy.test.ts` | pass |
| I3 — the column default cannot kill | `instance-settings-kill-switches-schema.test.ts`; integration case 4 | pass |
| I4 — a failed read refuses, and is never an absent document | `execution-kill-switch-policy.test.ts` (symbol identity, not just the verdict) | pass |
| I5 — a template switch refuses rather than no-ops | `execution-kill-switches.test.ts` D2 block; integration case 5 | pass |
| I6 — a mistyped provider value refuses | `execution-kill-switches.test.ts` D6 block | pass |
| I7 — separation from JOB-007, both directions | integration case 7 (live: no status/generation change, no revocation row) + `job-leasing-kill-switch-wiring.test.ts` I7 block (structural, both directions) | pass |
| I8 — the switch is reversible without a fleet restart | `poll-drain-resumable.component.test.ts` | 5/5 |
| I9 — no repository selection added to the frozen chain | `job-leasing-contract.test.ts` | 20/20 |
| I10 — the widened guard still refuses an unreviewed call | mutant **M33** | killed |
| I11 — `aoa_app` can actually read the document | integration **case 0** (`has_table_privilege` asserted by name) + `job-control-legacy-grants.contract.test.ts` + `distributed-execution-db-startup.integration.test.ts` | pass |
| I12 — in-flight work finishes | integration cases 8–10 (ack + renew succeed under a thrown switch; the same worker's next poll drains) | pass |
| every guard mutation-tested | §4 | 41 killed / 43 |

Neighbouring suites re-run: `job-leasing.integration` 39/39, whole `worker-daemon` 669/669,
`tenant-app-db-startup` + `job-control-runtime` + `job-source-governance-matrix` +
`job-fence-surface.contract` + `job-lease-eligibility` 65/65, `pnpm tsc --noEmit` clean,
`check-guard-inventory` / `check-test-inventory` / `check-d1-compose` /
`check-forbidden-tokens` / `check-worker-daemon-boundary` /
`check-frozen-worker-protocol-consumer` all OK.

---

## 4. Mutation ledger

| Group | Mutants | Killed | Notes |
|---|---|---|---|
| Decision function (M1–M12) | 12 | 11 | M11 equivalent, documented in source |
| Grant manifest (M13–M19) | 7 | 7 | each of the 5 registration surfaces individually load-bearing |
| Policy reader (M20–M25) | 6 | 6 | incl. turning the sentinel into a plain object |
| Poll wiring (M26–M32) | 7 | 7 | incl. replacing the reader with a permissive stub |
| Frozen guard (M33–M35) | 3 | 1 | M33 killed = the point; M34/M35 explained below |
| Daemon drain (M36–M42) | 7 | 7 | incl. a pause silently becoming terminal |
| Comment-stripping separation guard | 1 | 1 | a real code reference fails it; prose does not |

**Survivors, honestly:**

- **M11** — dropping `template !== null` is an **equivalent mutant**: `value` is already
  guaranteed a non-empty string, so `null === value` can never hold. Kept and commented as
  defence-in-depth; it becomes load-bearing the moment the value check changes.
- **M34** — an extra return placed *after* the candidate binding survives. That is the guard's
  actual contract: it requires returns to be **dominated by** the canonical chain, not to be
  unique. It is why the drain return is admissible at all. Not a defect; recorded so the next
  reader does not mistake it for one.
- **M35** — an intentional **negative control**: a harmless statement must NOT trip the contract
  guard. "Survived" is the desired outcome.

**Three survivors in the first decision-function run were defects in MY OWN tests**, all closed:

1. the empty-vocabulary guard was untested because a provider switch refuses via the per-value
   check anyway — only a **template-only** document reaches the up-front guard;
2. no execution-target kind is a prefix of another, so `===` and `startsWith` were
   indistinguishable until a case used an **observed** provider outside the vocabulary
   (`e2b-staging`);
3. the value type check was **masked** by D6 on the provider dimension, so it needed a
   template-dimension case. (Lane B hit this same masking shape.)

**One harness defect, recorded because it is the recurring lesson.** The first mutation run over
the poll wiring reported M28 and M31 as survivors. Both were false: the harness did not set
`AOA_RUN_WIN_INTEGRATION=1`, so the integration suite was **skipped** and only the structural
wiring test ran. A skipped suite kills nothing. With the env var set, 7/7 died. *A kill — or a
survival — proves nothing until you have checked which tests actually ran.*

---

## 5. Deferrals, stated plainly

1. **Clause 3b — reconcile active provider resources on kill.** Lane D, next in Wave 3. It builds
   on MIG-008's `legacy-resource-reconciliation.ts` seam.

2. **There is no write path or UI for throwing a switch.** Parent design §5 puts it in
   REL-001/005. Today an operator sets `instance_settings.kill_switches` directly, e.g.
   ```sql
   UPDATE instance_settings SET kill_switches =
     '{"schema":1,"switches":[{"dimension":"provider","value":"e2b","reason":"provider incident"}]}'
     WHERE singleton_key = 'default';
   ```
   and lifts it with `SET kill_switches = NULL`. **`NULL`, not `'{}'`** — an empty object is an
   unreadable document and drains.

3. **The template axis is NOT enforceable at the poll.** It refuses loudly instead of no-opping
   silently (§1.1). Closing it properly needs a control-plane template fact; the natural home is
   an operator-declared pin in `execution_targets.config`, bound the way `registeredProfileHash`
   binds the rest of the placement profile. That is a placement-registry change, not a
   kill-switch change, and is out of scope here.

4. **The legacy sandbox seam is untouched.** `sandbox-provider-runtime.acquire` creates E2B
   sandboxes today from `environments.config.template`. That is correct for the Wave-4 gate — the
   switch exists to stop placement on the platform being cut over TO, with legacy as the fallback
   — but if a later ticket wants to kill legacy placement as well, that is a second seam and must
   be stated as such rather than assumed covered.

5. **No caching.** One indexed single-row read per poll, against a poll that already issues
   eight-plus statements. A cache would add per-replica staleness for a negligible saving.
   Revisit only with a measurement.

6. **The switch is instance-wide, not per-organization.** MIG-002's per-org dial is the other
   control and is deliberately separate (handoff §5).

---

## 6. What this unblocks, and what it does not

Wave-4 gate clause 1 — "REL-004 clause 3 is complete and wired: a kill switch can actually stop
new leases, **proven by a test that exercises the poll path, not only the decision function**" —
is satisfied for **3a** by `execution-kill-switch-poll.integration.test.ts`. Clause 3 as a whole
is not complete until Lane D lands 3b.

The gate's other four clauses are untouched by this lane: shadow-comparison evidence for
MIG-005/006/007, a named rollback path per sink, D1 green on the candidate SHA, and the
provider-credential deferral (§6.1 of the handoff — a worker still receives no credential, and
that blocks ACTIVE cutover, not shadow).
