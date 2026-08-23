# Lane B kickoff — E8 browser (BRW ×6) + E9 service agents (SVC ×7)

**Remote branch:** `docs/replatform-program` (the same single integration branch — PR #323).
**Worktree:** `C:\e8`, on the local branch **`lane-b`** which TRACKS that remote branch.
**NOT** `C:\e3` — that is Lane A's, and git refuses to check one branch out in two worktrees.
**Written from** `C:\e3` at `39fa9fe34`, by the session executing Lane A (DAT-008 → MIG-005/006/007).

This is a **parallel lane**, not a successor. Lane A is running the cutover critical path in its
own worktree at the same time. §5 is the deconfliction contract between you and it; read it before
your first commit, not after.

---

## 0. Start here

**Preflight — it FAILS rather than printing something to eyeball:**

The worktree ALREADY EXISTS. Lane A created it with:

```bash
git -C /c/e3 worktree add -b lane-b /c/e8 origin/docs/replatform-program
```

`git worktree add /c/e8 docs/replatform-program` **fails**: git refuses to check one branch out in
two worktrees, and Lane A holds it. The local branch `lane-b` is the workaround, and it changes
nothing that matters — there is still exactly ONE remote integration branch, and you push to it by
name (§5.2).

```bash
cd /c/e8 \
  && [ "$(git rev-parse --abbrev-ref HEAD)" = "lane-b" ] \
  && [ "$(git rev-parse --show-toplevel)" != "/c/e3" ] \
  && git fetch -q origin docs/replatform-program \
  && git merge-base --is-ancestor e9032408e HEAD \
  && [ -z "$(git status --porcelain)" ] \
  && echo "PREFLIGHT OK" \
  || echo "PREFLIGHT FAILED - wrong worktree, wrong branch, behind, dirty, or you are in Lane A"
```

Then:

1. Read this document end to end.
2. Read [`HANDOFF-wave-3-4.md`](./HANDOFF-wave-3-4.md) **§1** — the binding per-ticket process. It is
   unchanged and it applies to you exactly as written. Do not invent a variant for this lane.
3. Read `program-design.md` §"E8 — Browser automation" and §"E9 — Long-running service agents".
   **Every one of your 13 tickets is already defined there** — outcome, acceptance, test,
   dependencies. That is your specification. You are not inventing it.
4. **Do not re-verify §1 or §2 of this document.** They are checked facts at `39fa9fe34`.

---

## ★ 1. The premise correction that produced this lane

`HANDOFF-wave-3-4.md` §8 says E8/E9 are *"13 tickets, **no designs written**. They need a design
phase of their own."* That is **half right, and the wrong half will cost you a week** if you act on
it literally.

**What is true:** there are no per-ticket implementation designs (`BRW-00N-design.md`). None.
**What is false:** the implication that the architecture is undecided. It is not. Every ticket has a
locked outcome, acceptance clause set, test list and dependency list in `program-design.md`. Several
acceptance clauses are unusually specific — SVC-005 forbids two generations performing external
effects simultaneously *"unless a later approved architecture decision explicitly permits overlap
and defines its fencing and idempotency policy"*. That is a decision already taken, not one waiting
for you.

**So this is NOT a design phase looking for an architecture.** It is 13 ordinary tickets that have
never had their terrain mapped. Run the normal §1 cycle on each. The only thing you are missing is
the same thing every ticket starts without: a terrain map.

## ★ 2. Every external dependency is ALREADY SATISFIED — you are not blocked

Checked ticket by ticket against the epics' result docs at `39fa9fe34`:

| Ticket | External deps | State |
|---|---|---|
| BRW-001 | CLI-006, PRT-006, PRT-007 | ✅ all complete |
| BRW-002 | WRK-004 | ✅ |
| BRW-003 | DAT-002 | ✅ |
| BRW-004 | DAT-004, DAT-005 | ✅ shipped — **but see §3** |
| BRW-005 | DEP-005 | ✅ |
| BRW-006 | JOB-008, `E10-REALTIME-FOUNDATION` | ✅ — the gate is **CLOSED** and names BRW-006 explicitly |
| SVC-001 | CLI-006, TEN-004, PRT-002 | ✅ |
| SVC-002 | JOB-003, JOB-009 | ✅ |
| SVC-003 | JOB-004, PRT-004 | ✅ |
| SVC-004 | DAT-002 | ✅ |
| SVC-005 | JOB-007 | ✅ |
| SVC-006 | DEP-006, DEP-007 | ✅ |
| SVC-007 | JOB-008, `E10-REALTIME-FOUNDATION` | ✅ |

**Nothing in this lane waits on Lane A.** The remaining dependencies are intra-epic only, and both
epics are strict chains:

```
BRW-001 → BRW-002 → BRW-003 ─┬→ BRW-005
                   → BRW-004 ─┘└→ BRW-006

SVC-001 → SVC-002 → SVC-003 → SVC-004 → SVC-005 ─┬→ SVC-006
                                                  └→ SVC-007
```

**BRW and SVC are independent of each other.** If you want a second parallel sub-lane, that is the
seam — never inside one chain.

**Start with BRW-001 and/or SVC-001.** Both are ready now.

## ★ 3. The ONE real cross-lane coupling, and it is not obvious

**BRW-004 depends on DAT-004 + DAT-005, and DAT-008 deliberately left the arm it needs
FAIL-CLOSED.**

DAT-008 (Lane A) wired the value stores for `provider_key` and `company_secret` — the
**sandbox-local** credential class. It left `connector_oauth` throwing **by construction**, because
that arm belongs to the `fence_proxy` class whose value is injected into request headers inside the
egress proxy and must never reach a worker. Wiring it there would have made it reachable from the
sandbox-local redemption route.

BRW-004's outcome is *"materialize scoped session or connector credentials through the
control-plane broker"* — i.e. exactly that fail-closed arm, plus the fence-aware egress proxy.

**What this means for you, concretely.** When you reach BRW-004 you will find:

- `createFenceAwareEgressProxy` (`server/src/services/egress-proxy.ts`) — **built, correct, and
  still with zero production callers.** DAT-008 gave the *sandbox-local* path a boot root; the
  proxy path still has none.
- `resolveConnectorOAuth` in `execution-secret-brokers.ts` — throws, with a comment saying why.
- `resolveNetworkPolicy` — an injected seam with **zero production implementations**. The envelope
  carries only a reference (`policyId: "job-default-deny"`), so with no allow-rule store every
  egress denies `not_allowlisted`.
- The proxy's `egress()` is a GET-only, status-only, `Authorization: Bearer`-hardcoded governed
  fetch. It is shaped for the connector class, **not** for arbitrary browser traffic. Read
  [`DAT-008-terrain.md`](./epics/E5-workspaces-secrets/tickets/DAT-008-terrain.md) §2 M4/M5 before
  designing BRW-004 — those two gaps are named there with evidence.

**Do not treat BRW-004 as blocked.** Treat it as the ticket that *owns* lighting up the
`fence_proxy` path, and terrain-map it early — before you reach it in the chain — so its true size
is known while there is still time to sequence around it.

## 4. Lead-time items — start the clock, do not discover them late

Two of your tickets have acceptance clauses no amount of engineering compresses:

- **SVC-006** requires a deterministic service running **≥72 wall-clock hours** through restart,
  partition, provider pause/resume, drain, generation update, checkpoint restore and budget/TTL
  stop (the D4 canary lane). Three days minimum, and only after SVC-005.
- **BRW-005** wants D1 fake-site plus **D3 real-sandbox nightly**.

Neither is a task you can pull forward at the end. Schedule them backwards from when you want the
epic closed.

## ★ 5. Deconfliction contract with Lane A — read before your first commit

`program-design.md` sets: *one ticket, one worktree, one implementation agent; never run parallel
tickets touching the same migration, state machine, or route module.* You and Lane A are on **one
branch**, so:

1. **Separate worktree.** Non-negotiable, and not for tidiness: two sessions editing one working
   tree corrupt each other's in-progress edits and git index. `C:\e3` is Lane A's; you are `C:\e8`.
2. **Sync then push, every time.** Your local branch is `lane-b`; the shared branch is
   `docs/replatform-program`. The push names both:

   ```bash
   git pull --rebase origin docs/replatform-program && git push origin lane-b:docs/replatform-program
   ```

   Two lanes on one remote branch WILL race on non-fast-forward. This is the only routine friction
   and it is mechanical. **Rebase, never merge** — a merge commit here destroys the attribution the
   integration invariant exists to preserve.
3. **Never force-push.** A red tip must stay attributable to the push that caused it — that is the
   integration invariant this branch exists to preserve.
4. **Migrations are the sharp edge.** If a ticket needs one, the number you generate can collide
   with Lane A's. Lane A has taken **0262** and **0263**. Pull first, generate second, and check the
   number is genuinely free before committing.
5. **Do not touch** `server/src/services/job-leasing.ts`, `job-placement*.ts`,
   `execution-secret-*.ts`, `secret-broker.ts`, `worker-control.ts`, or
   `packages/db/src/schema/job_secret_handles.ts` without coordinating. Lane A is actively editing
   all of them for DAT-008 slices 5–7.
6. **Watch CI on YOUR SHA.** With two lanes pushing, a run you started can be **cancelled by the
   other lane's push** — that reads as `cancelled`, not red, and is not a failure. Re-check against
   the tip rather than assuming your change broke something.
7. **Bump `docker/d1/campaign.env` only if your change alters runtime behaviour on `server/src`,
   and bump AFTER your last such change.** Coordinate — if both lanes bump, the last one wins and
   the other lane's change may go unproven. That trap has bitten this programme four times and me
   once, in this session, hours after I wrote the warning.

## 6. Traps carried forward — these have all drawn blood

- **A caller is not a caller until you trace it to a BOOT ROOT.** Counting one hop is not counting
  callers. `createFenceAwareEgressProxy` looks called; it is not. This exact error was committed
  *inside a document warning about it*.
- **Check what an existing mechanism already computes and discards** before designing a new one.
  This paid out four times in the DAT-008 session alone.
- **A check that nothing runs is not a check** — and its variants: a check that runs but cannot
  fail, and a comparator diffing a value against a copy of itself.
- **Reused a helper by name without reading it.** `gateCodingAdapterDispatch` reads like a
  deployment-mode gate and is not one. Open the callee.
- **Mutation-test every guard.** In this session mutation testing found a real defect *and* refuted
  one of my own explanations of my own fix. Survivors are questions, not verdicts — check the
  harness ran the right thing before believing a kill.
- **Windows:** integration tests need `AOA_RUN_WIN_INTEGRATION=1` or they silently skip, and a
  mutation harness will then report false survivors.
- **`verify` is a ~30–40 minute pole.** Do not push over a running gate you care about.

## 7. Frozen — never edit

`packages/worker-protocol/` (v1, source SHA `b7a842870ce7509d8baa75409e0ab19da375c88a`), the
worker-daemon `SandboxProvider` port, and `docs/architecture/distributed-execution-threat-*`.
Schema is Drizzle-only, C14 the sole hand-edit exception (idempotency guards + data backfills,
always commented, always idempotent).

**BRW-001's outcome says "additive protocol fields".** The protocol package is FROZEN and E4-D02
makes an unavoidable wire change a STOP requiring the Protocol/Schema Custodian's approval plus
D0-T04 evidence. **Resolve that before designing BRW-001**, not during. Note the precedent DAT-008
established: DAT-004, DAT-005 and DAT-008 all declared their request shapes *"Not a frozen wire
op"* and lived control-plane-side, and E4's own WRK-005 non-goals explicitly assign such transport
ops and their server routes to the owning epic. Whether that precedent extends to *capability*
fields is a real question and it is yours to answer first.

## 8. Definition of done — unchanged, and it is the same bar

From `HANDOFF-wave-3-4.md` §1. A ticket is not done until **all** hold:

- The design doc's SHA is recorded as the Start SHA in the result doc.
- **Every acceptance clause maps to a NAMED EXECUTABLE artifact** — a test file, a command, a CI
  step — or is explicitly deferred with its reason. Prose is not evidence.
- Every guard is mutation-tested; survivors fixed or documented as equivalent with the reason.
- The result doc states deferrals honestly, **including anything built but not wired**.
- CI watched to green. `ci-required` is the verdict.
