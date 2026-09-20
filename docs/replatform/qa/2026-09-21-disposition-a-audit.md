# Disposition A — the per-ticket record-truth audit

**Milestone:** `M0`, unit 7. **Date (UTC):** `2026-09-21`. **Candidate:** `360b2e5d6`.
**Founder decision:** **D6** — *audit all 20; file and execute what is owed*.
**Status:** audit complete; corrections landed in the same commit.

---

## 1. Why this exists

`M0`'s exit criterion 3 is *"disposition-A record corrections landed"*, and disposition A is
**20 tickets**. Before this audit exactly **one** of them (`DAT-008`) had a correction task defined
anywhere in the epic implementation plans. Nineteen had none, so criterion 3 was unsatisfiable as
written: a correction with no task cannot land.

★★★ **The over-broad claims were not where the ticket list pointed.** Disposition A is described
per-ticket, so the obvious reading is that each ticket's own result doc over-claims. Measured, that
is mostly **false** — the ticket ledgers are careful, and several state their limits in their own
titles (*"landed INERT"*, *"Part 1 SHIPPED · Part 2 SPLIT"*, *"wired and provably inert"*). The
over-broad claim lives one level up, in the **epic README range sentences** that flatten those
ledgers into *"all tickets X through Y shipped"*.

That is the promise-truth gap disposition A names: *"reconcile what the program promised with what
the shipped or partially shipped mechanism actually proves."* The promise is the range sentence.

## 2. Method

For each of the 20, read the ticket's own result doc (or record its absence), then compare it with
the claim its epic README makes about it. A correction is owed only where the README asserts more
than the ledger supports. No ticket was re-opened and no result was edited — `DAT-008-A1` and this
audit both correct **forward**, by narrowing the claim and filing a finding.

## 3. The audit — all 20

| # | Ticket | Epic | Ledger says | README claimed | Verdict |
|---|---|---|---|---|---|
| 1 | `PRT-007` | E1 | `complete` | `complete` | **accurate** |
| 2 | `TEN-006` | E2 | split `TEN-006a` + `TEN-006b`, both with results | `complete` | **accurate** |
| 3 | `JOB-009` | E3 | `complete` | range | **accurate** |
| 4 | `JOB-010` | E3 | `Result: pass` — *preserve admission and assignment invariants* | range | **accurate** |
| 5 | `JOB-011` | E3 | `Result: pass` — *preserve approvals and completion policy* | range | **accurate** |
| 6 | `JOB-012` | E3 | `Result: pass` — *preserve budget and authoritative cost policy* | range | **accurate** |
| 7 | `JOB-013` | E3 | `Result: pass` — *preserve transactional activity audit* | range | **accurate** |
| 8 | `JOB-014` | E3 | `Result: pass` — *preserve task outputs and run summaries* | range | **accurate** |
| 9 | `JOB-015` | E3 | *"slices **(a)–(f)** built — the **general delivery channel**"* | range | **narrowed** |
| 10 | `WRK-008` | E4 | *"LANDED. Closes E4-D12's **control-plane half**"* | range | **narrowed** |
| 11 | `WRK-010` | E4 | *"LANDED — **slice 1 (server-side only)**"* | range | **narrowed** |
| 12 | `WRK-011` | E4 | `LANDED` | range | **accurate** |
| 13 | `WRK-014` | E4 | *"container device identity, **landed INERT**"* | range | **narrowed** |
| 14 | `WRK-015` | E4 | *"**Part 1** SHIPPED · Part 2 **SPLIT → WRK-017**"* | range | **narrowed** |
| 15 | `DAT-008` | E5 | slice 6 mint-side only; slice 7 deferred | *"DAT-001 through DAT-011 shipped"* | **narrowed** — `DAT-008-A1`, `E5-F004` |
| 16 | `DEP-009` | E6 | `complete + CI-GREEN`, two-replica boot + `e6f-11` 6/6 on `d1-merge-train` | range | **accurate** ★ |
| 17 | `DEP-010` | E6 | *"the provider seam, **wired and provably inert**"* | range | **narrowed** |
| 18 | `DEP-011` | E6 | **design file only — NO result doc** | range | **FALSE** — `E6-F016` |
| 19 | `DEP-012` | E6 | five unit/wave results (Unit A, B1, B2, β1, β2) | range | **accurate** |
| 20 | `MIG-008` | E10 | `complete + review-fixed (no-key core green)` | epic README says `backlog` | **under-claimed** — see §5 |

★ **`DEP-009` is accurate as a shipment and its promise-truth correction is a different one**, which
the triage already records: proving **two replicas boot in D1** is not proving **production-scale HA
behind a load balancer**. That is D5's bar and `M4`'s work, owned by D5 rather than by this ticket.
Nothing in E6's README claims otherwise, so no README edit is owed.

## 4. Corrections landed

| Artefact | Change |
|---|---|
| `epics/E3-job-control/README.md` | *"all tickets JOB-001 through JOB-015 shipped"* → shipped **to the extent their ticket ledgers support** |
| `epics/E4-worker-daemon/README.md` | same narrowing, **naming** `WRK-008` (control-plane half), `WRK-010` (slice 1, server-side only), `WRK-014` (inert), `WRK-015` (Part 1) |
| `epics/E6-deployment-test-harness/README.md` | same narrowing, and **`DEP-011` explicitly excluded** from the shipped range; `DEP-010` noted as provably inert |
| `epics/E6-deployment-test-harness/findings.md` | **`E6-F016`** — the range claim asserted a shipment with no ledger |
| `epics/E5-workspaces-secrets/README.md`, `findings.md` | `DAT-008-A1` + **`E5-F004`** (landed in the same unit) |

★ **The word "all" is what did the damage**, and it is removed from three sentences rather than
qualified in a footnote. A range sentence with a caveat elsewhere is the shape this programme keeps
finding: the operative text wins, and the operative text said "all".

## 5. Two things this audit found and deliberately did NOT fix

**(a) E10 under-claims.** `epics/E10-desktop-migration-realtime/README.md` says `Status: backlog`
while the epic holds `MIG-008` at `complete` and several other shipped tickets. That is the mirror
error — a record claiming *less* than the ledgers support — and it is **not** a disposition-A
correction, which is about over-broad claims. It is already recorded in
`RECONCILIATION-2026-09-20.md` §4 (*"Every epic from E7 onward self-declares `backlog`"*) as a
record-integrity delta beyond the proposal's scope. Correcting an epic **status** is a gate-owner
act, not a record-truth edit, so this audit names it and stops.

**(b) `epics/README.md`'s ticket ranges and its pinned "Current tip".** Also recorded in the
reconciliation (E3 −1, E4 −10, E5 −5, E6 −4, E7 −2, E9 −2; tip pinned 1,015 commits behind). Same
reason: the index's own disclaimer covers only the status cells, so repairing it is a separate,
larger correction with its own owner.

## 6. What criterion 3 now rests on

Four epic README sentences narrowed, two findings filed and declared (`E5-F004`, `E6-F016`), and a
per-ticket verdict recorded for all twenty so a later reader can check the reasoning rather than
inherit it. Fourteen of the twenty needed no correction, and this record says which fourteen and
why — an audit that only lists what it changed cannot be distinguished from one that stopped early.
