# E8 — Browser Automation — Implementation Plan (SCOPED, milestone **M3**)

**Plan status:** `scoped` — **deliberately not a ticket plan.** This document fixes the
epic's *boundary*: what is already built, what is consumed, what is locked, what is
measurably blocked, and what would have to be true to pass the gate. It does **not**
contain per-ticket implementation tasks, and adding them here would be the failure the
re-grooming audit exists to fix. See [§8](#8-ticket-implementation-tasks--written-at-step-0).

> **Doctrine, cited rather than asserted.** `GO-BOOK.md:1906-1908` §7: *"Sprints 6–9 have
> scope and sequence, not implementation plans. Deliberate: they depend on what dispatch
> looks like once live, and a plan written five sprints early goes stale — which is the
> exact failure this audit exists to fix. Step 1 of each is 'write the plan'."* The
> milestone sequence restates it at
> [`../../epic-regrooming/scope-triage.md`](../../epic-regrooming/scope-triage.md).

---

## 1. Status and milestone position

| Item | Recorded value |
|---|---|
| Epic status | `backlog` (`README.md:3`) |
| Milestone | **M3 — workload breadth** (`scope-triage.md` §*The milestone sequence*) |
| Milestone scope | **`BRW-003c`, `BRW-004`, `BRW-005`, `BRW-006`, `BRW-007`, `BRW-008`** (`scope-triage.md`) — ★ *`BRW-003c` (retention/purge/audit, the HIGH `E8-F011` resolution condition) and `BRW-007`/`BRW-008` (authorized by the scope addendum) are all M3; the last three are **TO FILE at M3 Step 0**. ★★★ **`BRW-007` and `BRW-008` ARE M3 SCOPE — RETRACTING AN EARLIER CORRECTION OF MINE.** *Corrected 2026-09-20 (fifth round): this wrote the range “`BRW-004`…`BRW-008`”. The companion change is explicit that those two have **no program-design node and no ticket file**, and must not be implied into M3 without a programme-owner decision — scheduling M3 on them would make the milestone depend on two unchartered units.* |
| Entry | **M2 passed AND `E10-REALTIME-FOUNDATION` passed** — ★ *corrected eleventh round: the triage's M3 row requires both, and this entry row named only M2* (`scope-triage.md`). M2 needs M1b; M1b needs M1a; M1a needs M0. Four milestones sit between HEAD and E8 entry. |
| Named exit gate | **full D3** (`scope-triage.md`), whose clauses are `test-gates.md:124-131` (D3-01…D3-06). |
| Epic exit gate | `README.md:7` — sandbox-local browser, evidence, approvals, network/secret policy, cancellation, cleanup, and the D3 reconnect journey pass; agents can request a session and Commander runs on the governed path with **no host-side browser spawn reachable from a boot root**. |
| Dependencies | E7; `BRW-006` additionally requires `E10-REALTIME-FOUNDATION` (`README.md:4`). |
| Release coupling | Browser is a **mandatory** private-beta workload: E8/D3 blocks `REL-005` even with its exposure flag off (`README.md:11`). |

**M3 does not begin with a campaign.** The triage states the entry condition literally:
*"M3 begins by fixing that, not by writing a campaign"* (`scope-triage.md §*`M3` — workload breadth*`) — "that"
being §5 below.

---

## 2. What is ALREADY BUILT

The README says `backlog`; the tickets say otherwise. Eight units have shipped. This is the
section a Step-0 planner should read before assuming anything is missing.

| Unit | State | Evidence |
|---|---|---|
| **BRW-001** — browser-session job + policy extensions | **COMPLETE** | `tickets/BRW-001-result.md:6`. Terrain established it is **not a protocol ticket**: every field is already in frozen v1, so no custodian STOP fires. The real defect was `buildJobEnvelope` passing the raw submission blob through, so a browser job was accepted at submit and then **silently never leased**. Closed by three lane-owned modules + one wiring block; no frozen-package edit, no migration. |
| **BRW-002** — sandbox-local Playwright runtime | **COMPLETE — CI GREEN** at `e974364d2` | `tickets/BRW-002-result.md:3-4`. Ships `packages/browser-runtime`: `launch-guard.ts` (`public_cdp_endpoint` allow-list), `listening-ports.ts` (containment measured from `/proc/net/tcp` + `tcp6`), `path-adapter.ts` (download confinement via `realpath`, not string logic), `run-session.ts`, `playwright-driver.ts`. Registered in the root vitest project list. **Declared deferrals in its own §6.** |
| **BRW-003a** — split `findCommitted` | **COMPLETE — CI-VALIDATED** | `tickets/BRW-003a-result.md:3-5`. One predicate, two names; two callers wanted opposite answers about expiry. |
| **BRW-003b** — capture + producer half | **complete (producer slice)** | `tickets/BRW-003b-result.md:3`. Video/trace ordering is an invariant, not a preference: `saveAs` deadlocks against `close()` if the natural order is used, and `tracing.flush()` discards a trace not stopped before close. |
| **BRW-003d-1…5** — payload bounding, redaction, stream metadata, ordering + response bounding, grant-time ceiling | **complete** | `tickets/BRW-003d-{1..5}-result.md`. Collectively discharge BRW-003's "payloads bounded", "redaction is explicit", "stream metadata", "order tied to event sequence", "large download". d-2 fixed a **live** redaction defect (a secret in an array element was not redacted at all). d-5 closed a false claim of enforcement (the grant enforced nothing; only commit did, and only after the bytes were already stored). |
| **BRW-003c** | **DESIGN ONLY** | `tickets/BRW-003c-design.md` exists; there is **no** `BRW-003c-result.md`. Named as design-only in `E8-F011`'s ownership disposition. |
| **BRW-004** — browser secrets, network, human approval, slices (a)–(d) | **`gate_review`** | `tickets/BRW-004-result.md:3`. Slice **(e) is chartered as `JOB-015`** and was not built here; slices (f)–(h) not attempted. It resolved its two escalations, one of them by handing the control-command delivery hop **back** (answer: E8 does **not** own it). It closed `E8-F002` and opened/repointed several others. |
| **BRW-hostspawn-gate** | **SHIPPED** (`eed9fdd35`) | `tickets/BRW-hostspawn-gate-result.md`. A guard-only, graph-inert unit: `scripts/check-boot-roots-browser-spawn-free.mjs` + `scripts/lib/boot-roots-browser-spawn-free.mjs` + `scripts/browser-spawn-expectation.json`, wired as a `policy`-job step in `.github/workflows/pr.yml`. It makes the gate's "no host-side browser spawn reachable from a boot root" clause **catchable and regression-proof while the spawn legitimately still exists** (declared: `cli-mode.ts`, owner `BRW-008`, `signatureOccurrences: 3`). A 3-agent adversarial pass found a real evasion — a spawn relocated into `packages/adapter-utils` — and the scan was widened to the whole `packages/` surface minus `browser-runtime`. **It does not close the spawn.** |

**Gate-clause register state** (`scripts/gate-clause-wiring.json`):

| Clause | Status | Symbol |
|---|---|---|
| `E8-1-sandbox-local-browser` | **`unwired`**, `expectedReferences: 1` | `runBrowserSession` |
| `E8-w10c-internal-range-deny-set` | `wired` (promoted from `unwired` by W13) | `INTERNAL_RANGE_DENY_CIDRS` (`server/src/services/w10c-internal-range-deny-set.ts`, consumed at `server/src/services/mcp-connector-oauth.ts:6,42`) |

**Not built, no ticket file:** `BRW-005`, `BRW-006`, `BRW-007`, `BRW-008`. `BRW-005`/`BRW-006`
have program-design nodes only (`program-design.md:1007`, `:1014`). `BRW-007`/`BRW-008` have
no program-design node either — their scope lives in
[`scope-addendum-agent-and-commander.md:46,67`](./scope-addendum-agent-and-commander.md),
recorded as a programme-owner decision.

---

## 3. Consumed as-built interfaces — import, do not edit

| Interface | Location | E8 use |
|---|---|---|
| Frozen browser workload arm | `packages/worker-protocol/src/job.ts:299` `browserWorkloadV1Schema`, union arm `:354` | The job shape. Frozen v1 — every BRW-001 field is already here. |
| Frozen browser observation payload | `packages/worker-protocol/src/events.ts:97`, event variant `:388` | `.strict()` with exactly three fields (`artifactIds`, `url`, `title`). Console lines and network summaries have **nowhere in it to go**; they ride `extensions[]` (BRW-003d-3). |
| Capability vocabulary | `packages/worker-protocol/src/capabilities.ts:49` `workload.browser_session` | A closed enum; unknown names fail closed. |
| Placement matcher | `packages/worker-protocol/src/capabilities.ts:475-490` (capability intersection), `:524-531` (slot table) | Server ceiling ∩ worker report; `workload.browser_session` must be in the intersection **and** `browserSessionSlots ≥ 1`. |
| Workload-type advertisement | `server/src/services/job-leasing.ts:658` | Adds `browser_session` to the offered workload types when the capacity permits. |
| Byte egress for artifacts | `DECISION-REQUEST-byte-egress.md` — **RESOLVED, Option D** | Provider → S3-compatible object storage via a short-lived prefix-scoped presigned grant; the port carries only a **reference**. Bytes never touch the worker daemon or the provider port. |
| Boot-root spawn guard | `scripts/check-boot-roots-browser-spawn-free.mjs`, `scripts/browser-spawn-expectation.json` | BRW-008's removal proof already exists as a guard. Closing the spawn means **decrementing the declared expectation**, not writing a new check. |
| Runtime-decision aggregate | `server/src/services/agent-runtime-decisions.ts` | BRW-004 slice (d) made `agent_runtime_decisions` able to hold a `browser_request` row (closing `E8-F002`). |

---

## 4. Shared decisions and locked contracts

E8 has **no `decisions.md`**. Its locked decisions live in three places, and a Step-0
planner must read all three:

1. **Byte egress — Option D** (`DECISION-REQUEST-byte-egress.md`, resolved). Option B was
   rejected because bypassing the cleanup-authority guarantee leaves it *stated and no
   longer true*. The obligation lives in `packages/sandbox-provider-contract` as a
   capability, implemented per provider.
2. **The host-side browser path is retired *after* the governed path is proven, not
   before** (`scope-addendum-agent-and-commander.md:36-42`). Keeping both permanently was
   explicitly rejected: it leaves an unsandboxed Chromium on the control-plane host with no
   tenant boundary — *"the configuration most likely to be selected by accident."*
3. **The 2026-09-11 DE-08 founder ruling** (`docs/replatform/DECISION-REQUEST-de08-sandbox-egress.md`,
   options 1 + 3 + 4). It relocated DE-08's confidentiality guarantee from provider egress
   denial onto the **credential taxonomy**. `E8-F012` is the recorded consequence.
4. **Frozen wire.** `packages/worker-protocol` is frozen v1. Any additive browser field is a
   Protocol Custodian STOP plus D0-T04 evidence. BRW-001 established none is needed.
5. **The dormant default-deny egress qualification** (`scope-triage.md`): *"no
   document may say sandbox egress denial passed merely because a policy object or allowlist
   was constructed"*, and *"browser, service, and external beta claims remain blocked"*
   while the provider path does not enforce.

---

## 5. Known blockers, measured

### 5.1 ★★★ THE BLOCKER — three facts, each independently fatal

This leads because the triage says M3 starts here (`scope-triage.md`).

**(a) `packages/browser-runtime` has zero importers anywhere in the tree.**
The only occurrences of `@armyofagents/browser-runtime` outside the package itself are three
CI workflow steps that build and test it **in isolation** — `.github/workflows/pr.yml:1656`
(`playwright install`), `:1686` (`build`), `:1703` (`vitest run`) — plus `Dockerfile:66`,
which copies only the package's `package.json` for the workspace install. No source file
outside the package imports it. Inside it, `runBrowserSession` is defined at
`src/run-session.ts:139`, re-exported at `src/index.ts:35`, imported at `src/runner.ts:43`
and called at `src/runner.ts:65` — and `runner.ts` is the **in-guest entrypoint**, which
nothing stages. The gate clause records exactly this:
`gate-clause-wiring.json` → `E8-1-sandbox-local-browser`, `status: "unwired"`,
`expectedReferences: 1`, reason *"the capability is unreachable despite the non-zero count."*

**(b) ★★★ WITHDRAWN — the `playwright` devDependency is the STAGED architecture working as
designed, not a blocker.** *Corrected 2026-09-20 (seventh round), verified at source.* An earlier
revision said the package is *“unshippable as written”* because `playwright` sits under
`devDependencies`. That reasoning assumed a **production install**, and the runtime does not use
one: `packages/browser-runtime/src/runner.ts` is **staged into the sandbox** — the host writes the
runner plus `session.json` and then execs it — and `e2b/e2b.Dockerfile:44-50` installs Playwright
**globally** and sets `NODE_PATH` for precisely that reason. The Dockerfile says so itself:
*“Installed GLOBALLY with NODE_PATH set, because the runner is STAGED, not installed … so the guest
has no node_modules of its own to resolve `import { chromium } from "playwright"` against.”*
`runtime-dependency.test.ts` documents and tests that architecture.

★ **Treating it as fatal would have made M3 require an unnecessary manifest change** and would have
propagated a false prerequisite into the triage and the E11 plan. The blocker list is therefore
**(a) reachability/staging** and **(c) capability advertisement** — both still real and both
unchanged.

**(c) `workload.browser_session` is filtered out of the worker hello, so a browser job can
be submitted and placed-for but never leased.**
`packages/worker-daemon/src/enrollment/hello-provisioning.ts:59`:

```ts
export const SUPERVISABLE_WORKLOAD_CAPABILITIES: readonly WorkerCapability[] = [
  "workload.batch",
  "workload.service",
];
```

`deriveHelloProvisioning` (`:63-88`) builds `deviceCanProvide` from that constant and
**intersects** it with the admin-ratified ceiling, so widening the ceiling alone changes
nothing. The file's own docstring states it: *"`workload.browser_session` remains absent and
is still filtered out"* (`:44`). Downstream, `packages/worker-protocol/src/capabilities.ts:485-486`
requires `workload.${workloadType}` to be in the ceiling ∩ report intersection, so placement
refuses before the slot test at `:525-530` is ever reached. The unprovisioned path
hardcodes `browserSessionSlots: 0` (`packages/worker-daemon/src/enrollment/desktop-hello.ts:182`),
while the provisioned path does report `config.concurrency.browser`
(`packages/worker-daemon/src/bin/worker-daemon.ts:535`) — **the slot is not the binding
constraint; the capability is.** Both arms are pinned by
`server/src/__tests__/browser-capability-rejection.test.ts:170` (slot free, capability
missing) and `:186` (capability present, slot missing).

**Consequence, stated plainly:** there is today no path by which a browser job runs. Fixing
(a)+(b)+(c) is *necessary and not sufficient* — it makes `BRW-005`…`BRW-008` buildable; it
proves nothing about D3.

### 5.2 Open findings — nine, measured at HEAD

`E8-F002`, `E8-F009` (`resolved_by_w13`) and `E8-F010` (`resolved_by_w17`) are closed. The
remaining nine are open; five are HIGH.

| Finding | Sev | What it blocks |
|---|---|---|
| **`E8-F001`** | MED | A frozen golden-journey fixture and shipped `JOB-011` code name **different approval authorities** for `browser_request` (fixture: product-approval; code: `"none"` + a runtime permission decision). BRW-004 slice (b) made the disagreement *visible* and pinned the one known divergence by value tuple; the resolution needs a **v2 fixture directory**, which `tests/fixtures/distributed-execution/README.md` forbids doing in place and for which **no ticket in the 94-ticket programme owns the fixture corpus**. Blocks any D3 approval claim that cites the fixture as authority. MUST NOT be closed by deleting the pin or weakening the gate. |
| **`E8-F003`** | **HIGH** | A **Critical** threat control (DE-08) recorded owned-and-delivered while its enforcement **exists nowhere**: sandbox egress is filtered at none of the three candidate points and the cloud metadata endpoint answers from inside the guest. Measured against real E2B in workflow run `33857218680`. Blocks D3-02's private/metadata denial and H-06. |
| **`E8-F004`** | LOW | `listStrandedAnswers` (`server/src/services/agent-runtime-decisions.ts`) is an INNER JOIN on `run_id`; now that `run_id` is nullable every distributed decision is silently excluded. **The exclusion is correct** — a distributed decision has no heartbeat run — but the equivalent sweep does not exist and cannot yet, because **no control-plane hop delivers a control command to a running worker at all**. ★★★ **FALSE — corrected 2026-09-20 (ninth round), verified at source.** The delivery hop **ships**: `listPendingControlCommands` returns pending controls on the renewal response (`packages/db/src/repositories/tenant/job-control.ts:4113`), `applyOneControlCommand` applies them worker-side (`packages/worker-daemon/src/lease/lease-renewal.ts:650`), and `dispatch-runtime.ts:241` wires drain to `stopLeasing()`. What is actually missing is narrower and must not be stated as the whole: the **result-command applier** and the **stranded-answer sweep**. Booking a shipped hop as absent is how a programme rebuilds what it already has. Belongs beside `JOB-015`. Do not close it by deleting the join. |
| **`E8-F005`** | MED (NARROWED) | The schema↔migration drift gate now covers the schema-vs-snapshot direction (`scripts/check-schema-migration-drift.mjs`, in the `migrations` job). The **SQL-file-tampering** direction is still undetected: an edited or gutted committed migration passes (measured: emptying `0279_*.sql` → exit 0), because `drizzle-kit generate` diffs against the meta snapshot, not the committed SQL. Catching it requires a DB-backed check. |
| **`E8-F006`** | MED | **E8-1's own promotion check cannot detect E8-1's promotion.** The evaluator's only `unwired` signal is `count > expectedReferences` (`scripts/lib/gate-clause-wiring.mjs:105-106`), and the live delivery route is **stage-a-file-and-exec**, which adds no reference. Any stage-and-exec wiring leaves the count at exactly 1 and the check stays silent. Error direction is **pessimistic** (over-reports dormancy), which is why it is MED. Choosing E8-1's promotion observable is an E8 gate decision and is owed at M3. |
| **`E8-F007`** | **HIGH** | The programme booked *"managed-E2B egress is not fully lockable"* as fact for a year; the installed SDK exposes the surface. That false premise is what wrote off the only enforcement layer **outside** the guest. Blocks any argument that provider-side filtering is unavailable. |
| **`E8-F008`** | **HIGH** | The provider **accepts, validates, stores and reads back verbatim** a deny set — and routes the denied traffic anyway. The `getInfo()` read-back that six records name as the mandatory safeguard **passes** on that unpoliced sandbox. The allowlist arm placed at last on 2026-09-11 (CIDR-only) and is **fully inert**: no destination's egress was blocked. A read-back verifies what was *declared*, not what is *enforced*. |
| **`E8-F011`** | **HIGH** | DE-11 asserts four controls over sensitive browser artifacts (cookies, trace, video, downloads) and **all four are absent**, one structurally excluded rather than merely missing. Unowned: `BRW-003c` is design-only and `REL-001` is unwritten. This is squarely D3-04/D3-06 and blocks the browser-artifact half of the exit gate. |
| **`E8-F012`** | **HIGH** | The 2026-09-11 ruling relocated DE-08's confidentiality onto the **credential taxonomy** — that no host or cross-tenant secret ever reaches a sandbox. That property is now load-bearing for a Critical control and is **not verified as an enforced, CI-run invariant across every sandbox stage-in path**. Unowned; the decision paper flagged it as its own strongest counter-argument. |

### 5.3 Other measured blockers

- **The host-side spawn is still live.** `cli-mode.ts` spawns `npx @playwright/mcp
  --headless` when `browser_use` is enabled, with three declared signature occurrences in
  `scripts/browser-spawn-expectation.json`, owner `BRW-008`. The epic's gate clause asserts
  the opposite. Today that is an **owned deferral with a green guard**, not a lie — but it
  is a gate-blocking one.
- **`BRW-006` additionally requires `E10-REALTIME-FOUNDATION`** (`README.md:4`), which is
  not in M3's scope list. Entry must confirm it.
- **BRW-004 slice (e)** is `JOB-015`, i.e. outside E8. BRW-004 explicitly **handed back**
  the control-command delivery hop.
- **BRW-004 is `gate_review`, not `complete`.** It is the only E8 ticket in that state and
  M3's scope list opens with it (`scope-triage.md`).

---

## 6. Exit gate

**Normative gate (the only one that completes E8):** `README.md:7` —
sandbox-local browser, evidence, approvals, network/secret policy, cancellation, cleanup,
and the D3 reconnect journey pass; agents can request a session and Commander runs on the
governed path with no host-side browser spawn reachable from a boot root. Its test authority
is **full D3** (`test-gates.md:124-131`): D3-01 ≥100 journeys over three consecutive passing
runs; D3-02 coverage including private/metadata denial and stale fence; D3-03 zero public or
cross-tenant CDP/control endpoints; D3-04 zero cookie/token/storage-state value in
events or logs; D3-05 cancellation ≤60s and session cleanup ≤5min; D3-06 artifact order tied
to event sequence and digest-matched.

**Named partial gates that may SUPPORT but never COMPLETE it:** none exist for E8.
`M1-D1-SPINE`, `M1a-D2-MECHANISM` and `M1-D2-CODING` are the only named partial gates in the triage
(`scope-triage.md` §*Normative-gate boundary*) and **all three** are `task_run`-scoped; that same section makes
**all three** **non-promoting** ★ *Re-pointed 2026-09-20 from a bare line number to the owning heading: this sentence is quoted verbatim by more than one plan, and editing it in the companion change moved every line citation to it.* and bars them from an epic-completion handoff. `BRW-hostspawn-gate`
is a *guard*, not a gate: it proves the clause is watched, never that it is satisfied. ★ *Corrected 2026-09-20 (third round): this said `M1-D1-SPINE` and `M1-D2-CODING` were the only named partial gates. The companion regrooming change adds **`M1a-D2-MECHANISM`**, the pre-capability mechanism gate, so there are three — and this epic's later-milestone framing depends on naming them correctly.*

**Two standing non-certifications a Step-0 planner must carry forward:**

- The accepted DE-08 managed-shared residual leaves **H-06 unsatisfied**
  (`scope-triage.md`). A campaign record must observe the residual and may **not** mark
  H-06 passed.
- Browser is a **mandatory** private-beta workload; E8/D3 blocks `REL-005` even when its
  exposure flag is off (`README.md:11`).

---

## 7. NOT in scope

- **No frozen-protocol edit.** BRW-001 established every browser field is already in v1; an
  additive field is a Protocol Custodian STOP plus D0-T04 evidence, not E8 work.
- **The control-command delivery hop** — handed back by BRW-004 and chartered as `JOB-015`.
  `E8-F004`'s missing sweep belongs *beside* it, not in front of it.
- **A v2 golden-journey fixture directory** (`E8-F001`) — a fixture-owner / Protocol
  Custodian authorisation, and no ticket in the programme owns the corpus.
- **Building egress enforcement.** `E8-F003`/`F007`/`F008` measure its absence; none of them
  proposes an implementation, and the W10B unit explicitly *"built and proposed no
  enforcement of any kind."* Whether and where to enforce is a founder/provider decision.
- **Tenant-defined public ingress** — a programme exclusion (`scope-triage.md`).
- **Re-opening BRW-001/002/003's acceptance.** They are complete and CI-validated; their
  declared deferrals are recorded in their own result docs.
- **Any claim that egress denial passed because a policy object or allowlist was
  constructed** (`scope-triage.md`). `E8-F008` is the measured case where exactly that
  read-back passes on an unpoliced sandbox.

---

## 8. Ticket implementation tasks — WRITTEN AT STEP 0

**There are none here, by design.** Per-ticket tasks for this epic are authored
**just-in-time at M3's Step 0, against HEAD** — not now. The doctrine is `GO-BOOK.md:1906-1908`
§7, restated at `scope-triage.md`: *"a plan written five sprints early goes stale —
which is the exact failure this audit exists to fix."* Four milestones (M0, M1a, M1b, M2)
sit between HEAD and E8's entry; every blocker in §5 is measured **at HEAD** and must be
**re-measured** at Step 0 rather than inherited from this document.

Tickets that will need tasks, with their disposition as measured for this plan:

| Ticket | Disposition today | What Step 0 must resolve first |
|---|---|---|
| `BRW-004` | `gate_review`, slices (a)–(d) shipped, (e)→`JOB-015`, (f)–(h) unattempted | Whether (f)–(h) are still the right shape after §5.1 is fixed; slice (f) is *"materially affected by slice (a)'s measurement"* per the result doc §1. |
| `BRW-005` — browser golden journey | **no ticket file**; node at `program-design.md:1007` | Blocked on §5.1 entirely: there is no leasable browser job to run a journey against. Also needs `DEP-005`. |
| `BRW-006` — evidence + approval experience | **no ticket file**; node at `program-design.md:1014` | `E10-REALTIME-FOUNDATION` must have passed (`README.md:4`); it is not in M3's scope list. |
| `BRW-007` — agent-facing session request ★★★ **RETRACTED thirteenth round — they ARE M3 scope.** The E8 scope addendum is titled for these two tickets and records *“Authority: programme owner decision”*; E8's README lists *“BRW-001 through BRW-008”* and its exit gate includes their work. Absence of a design NODE is not absence of AUTHORITY. They are **TO FILE at M3 Step 0** — the graph node and ticket files are the filing, not a new decision. | **no ticket file, no program-design node**; scope only in `scope-addendum-agent-and-commander.md:46` | Needs BRW-002 + BRW-004 + BRW-006. The `ask_human` precedent is the named authorization model. |
| `BRW-008` — Commander on the governed path; retire the host spawn ★★★ **RETRACTED thirteenth round — they ARE M3 scope.** The E8 scope addendum is titled for these two tickets and records *“Authority: programme owner decision”*; E8's README lists *“BRW-001 through BRW-008”* and its exit gate includes their work. Absence of a design NODE is not absence of AUTHORITY. They are **TO FILE at M3 Step 0** — the graph node and ticket files are the filing, not a new decision. | **no ticket file, no program-design node**; scope in `scope-addendum-agent-and-commander.md:67` | Its removal proof already exists (`scripts/browser-spawn-expectation.json`). Closing the spawn is a **decrement of the declared expectation**, and the guard must stay red-when-broken across it. |
| `BRW-003c` | design-only, no result | Named in `E8-F011`'s disposition as one reason that finding is unowned. Decide at Step 0 whether it is revived or superseded. |
| *(unfiled)* — the §5.1 enablement | no ticket at all | **This is M3's first unit and it has no id.** Step 0 must charter it: ★★★ **NOT a manifest change — that item was WITHDRAWN** *(corrected 2026-09-20, ninth round: the runner is staged and `e2b/e2b.Dockerfile:44-50` installs Playwright globally with `NODE_PATH`, so real `dependencies` are unnecessary; ordering them here would have re-imposed the withdrawn blocker from the task list after the contract above retired it)*. Charter **staging/reachability and capability advertisement** instead. Superseded text: real `dependencies` for `browser-runtime`, a stage-and-exec (or import) delivery path, the `SUPERVISABLE_WORKLOAD_CAPABILITIES` widening landed **in the same commit** as the supervisor branch that makes it true (the SVC-008b precedent, `hello-provisioning.ts:27-36`), and a replacement promotion observable for `E8-1` (`E8-F006`). |

---

## 9. Reopen triggers

Re-open and re-measure this plan — do not execute it — if any of the following becomes true:

1. **Any of §5.1's three facts changes.** Specifically: a non-CI, non-`Dockerfile` reference
   to `@armyofagents/browser-runtime` appears; `packages/browser-runtime/package.json` gains
   a `dependencies` key; or `SUPERVISABLE_WORKLOAD_CAPABILITIES`
   (`hello-provisioning.ts:59`) gains `workload.browser_session`.
2. **`E8-1-sandbox-local-browser` moves off `unwired`**, or its `expectedReferences` changes
   — *and* note `E8-F006`: the register may **not** notice this on its own.
3. **Any HIGH finding closes or is repointed** — `E8-F003`, `E8-F007`, `E8-F008`, `E8-F011`,
   `E8-F012`. Four of the five are `unowned`; an owner being named is itself a trigger.
4. **A fixture owner or Protocol Custodian is named** for the golden-journey corpus
   (`E8-F001`), or a v2 fixture directory is authorised.
5. **`JOB-015` lands the REMAINING control-command work** — ★ *the delivery hop itself already ships (see the correction above); what JOB-015 owes is the result-command applier and the stranded-answer sweep* — `E8-F004` repoints to it and
   BRW-004 slice (e) re-enters the epic's dependency surface.
6. **`E10-REALTIME-FOUNDATION` passes or is rescoped** — `BRW-006`'s dependency.
7. **The DE-08 ruling is amended, or H-06 is normatively amended** — §6's two standing
   non-certifications change shape.
8. **`scripts/browser-spawn-expectation.json`'s declared occurrence count changes** without
   a `BRW-008` result — that is either the retirement landing early or the guard rotting.
9. **M2 passes**, which is E8's actual entry condition (`scope-triage.md`). That is the
   trigger to write the real ticket plans, not to run this one.
