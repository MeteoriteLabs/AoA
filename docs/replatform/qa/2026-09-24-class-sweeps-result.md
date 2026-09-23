# Class sweeps — three defect FAMILIES closed at every site, not at the instance

**Status:** gate_review
**Branch:** `claude/m1-class-sweeps` · **Base:** `docs/replatform-program` · **Reviewed revision:** see the PR head
**Method:** `M1-BUILD-RULES.md` §E, *SWEEP THE CLASS, NEVER THE INSTANCE*.

★★★ **GitHub Actions is DOWN repo-wide** (no run created since 2026-09-23 17:37 UTC; an
account-level billing failure only the founder can clear). Everything below was verified LOCALLY,
with the executed counts recorded. **No CI green is claimed.** The PR is opened awaiting CI and is
NOT merged.

---

## Class 1 — a refusal that short-circuits a scan that already has a finding

**Definition.** A gate that cannot certify one surface returns before the scans it also owes have
run, so a finding the scan would have named is never reported.

**Governing ruling (unchanged, now applied to the whole family).** Both outcomes delete the bundle,
so ordering cannot change what is PUBLISHED — only what the operator is TOLD, and only a NAMED
finding says *rotate this now*. Every refusal is reported ALONGSIDE the findings, never instead.

| | count | detail |
|---|---|---|
| checked | 5 | the three refusals in `leakScan` (capture-failed marker, TRUNCATED sentinels, ABSENT log) plus the two other accumulate-then-fail sites in the same driver (`assertTenants`, the `dispatch` per-tenant loop) |
| found | 2 | the capture-failed MARKER refusal and the TRUNCATED refusal, both still short-circuiting; the ABSENT arm was already deferred by PR #574 |
| fixed | 2 | both |
| filed | 0 | — |

**The fix.** `leakScan` (`scripts/m1-shipped-boot/journey.mjs`) now keeps a **refusal ledger**: all
three refusals `push` onto `refusals` and NONE returns, the evidence and job-log scans always run,
findings are always named first, and every refusal is printed alongside them. The comment above the
absent-log arm previously claimed *"the scans below always run"* while two siblings short-circuited
— an overclaimed invariant, now true and rewritten to say which arms it covers.

`assertTenants` and the `dispatch` loop were checked and are already correct-by-shape: both
accumulate across every replica/tenant and fail once at the end.

**Proof (and the mutation that reds it).** Four new cases in
`scripts/lib/__tests__/m1-shipped-boot.test.mjs`, all driving the real phase through `journey.mjs`:

| mutation | test that reds |
|---|---|
| **M1** — restore the capture-failed short-circuit (`refusals.push` → `rmSync`+`fail`) | *PRECEDENCE: a planted canary is still NAMED when the job-log capture FAILED* → **RED** |
| **M2** — restore the TRUNCATED short-circuit | *PRECEDENCE: … when the job log is TRUNCATED* → **RED** |

Non-vacuity arms: *with NO refusal in play the same planted canary still reds and no refusal line
appears* (so the canary is not always-found), and *the refusals themselves still fail the run with
NO finding present* (so they are not reduced to decorations on a finding).

**Executed locally:** `node --test scripts/lib/__tests__/m1-shipped-boot.test.mjs` —
**97 tests, 97 pass, 0 fail** (93 before this branch).

---

## Class 2 — a bounded operation that returns at its deadline without aborting the underlying work

**Definition.** A timeout or deadline wrapper bounds the CALLER while the IO, SDK request or child
process it raced keeps running, holding a connection or streaming bytes nobody is waiting for.

| | count | detail |
|---|---|---|
| checked | 46 | every non-test hit of `grep -rn "Promise.race\|AbortSignal.timeout\|withTimeout\|boundedBySignal" --include=*.ts --include=*.mjs server packages scripts ui \| grep -v node_modules`, plus all 5 `boundedBySignal` sites in `E2bSandboxProvider` read individually |
| found | 3 | `Supervisor.withDeadline` over `deps.materializeRunSecrets`, over `deps.resolveStagedFiles`, and over `run.effect.stageFiles` |
| fixed | 0 | see below — none is fixable inside this sweep's mandate |
| filed | 1 | **`E7-F042`**, `unowned`, covering all three |

**Why 0 fixed, stated so it can be overturned on evidence.** The majority of the 46 sites are
`AbortSignal.timeout(…)` passed as a `fetch`/SDK `signal:` option — the signal reaches the
operation, so they are NOT in the class. Of the `Promise.race` wrappers, the `create` and `execute`
races both hand the operation `run.makeCtx()`, whose `deadlineMs` is what the E2B provider turns
into its own `AbortSignal.timeout`, so the inner work IS bounded and the race is a declared
backstop. The three that ARE in the class all need a widened `SupervisorDeps` signature — a
cross-package interface change with its own callers and conformance suites, which is a ticket, not a
sweep. Filed with an honest `unowned` rather than an invented owner (`CLI-012` and `DAT-008` are
shipped; `CLI-017` owns SD-1b and SD-5, neither of which touches these seams).

**`E7-F040` re-confirmed at source, still correctly scoped.** `scanExportBytes` is still
`(bytes: Uint8Array, sandboxId: string) => void | Promise<void>` — no signal
(`packages/sandbox-e2b-provider/src/e2b-provider.ts`, the `scanExportBytes` option, field and
`#scanExportBytes` read in `exportArtifact`). Owner `CLI-017` is unstarted. Not re-fixed.

**The proof shape any future fix owes** (the one `CLI-012` used, recorded in `E7-F042`): assert the
underlying call RECEIVED an `AbortSignal` (non-vacuity — not `undefined`) and that it FIRED, plus an
anti-vacuity arm where an in-deadline call gets a signal that stays unaborted. A timing-only test
passes against the defect verbatim and is not acceptable.

---

## Class 3 — an unbounded per-item emission past a cap

**Definition.** A loop calls a logging or notification callback once per item, with the only bound
placed somewhere the loop's items do not reach.

| | count | detail |
|---|---|---|
| checked | 14 | `export-request-producer.ts`; every loop adjacent to a `logger`/`logger?` call in `packages/worker-daemon/src`, `packages/adapter-manager/src` and `packages/sandbox-e2b-provider/src` (13 sites, all iterating configured step/offer/stream/summary lists, not tenant-authored listings); and `leakScan`'s two annotation loops |
| found | 2 | the producer's refusal channel (`E7-F041`) and `leakScan`'s per-finding `::error::` emission |
| fixed | 1 | `E7-F041` — **closed** |
| filed | 1 | **`E6-F027`**, `unowned`, for the `leakScan` half |

**The fix (`E7-F041`).** `createExportRequestProducer`
(`packages/worker-daemon/src/lease/export-request-producer.ts`) now bounds the refusal channel ON
ITSELF rather than on acceptance. `MAX_REFUSALS_PER_REASON` (4): the first N refusals of each reason
emit individually; the rest are counted and folded by `flushSuppressed` into ONE aggregated record
per reason carrying its count. Emissions per invocation are at most
`2 × MAX_REFUSALS_PER_REASON × |OutputRefusalReason|`, independent of the listing's length. A
refusal is summarised, never lost.

**Per REASON**, so a single oversized file is still seen behind 100,000 symlinks. **Per
INVOCATION**, not per producer: one producer is built at the composition root and serves every run,
so a factory-closure budget would let one Organization's noisy listing silence the next
Organization's refusals — founder ruling **F10**, and the cross-tenant arm below is its control.

**Proof and mutations** (`packages/worker-daemon/src/__tests__/export-request-producer.test.ts`,
the `E7-F041` describe block — three 100,000-entry all-refused listings, one per refusal reason):

| mutation | result |
|---|---|
| **M3** — remove the per-reason budget (`if (seen < MAX_REFUSALS_PER_REASON)` → `if (true)`) | **3 RED** (all three listings) |
| **M4** — drop the `flushSuppressed()` call | **3 RED** |
| **M5** — hoist the budget out of the invocation into the factory closure | **1 RED** — *the budget is PER INVOCATION: a second run is not silenced by the first (multi-tenant)* |

Non-vacuity, asserted rather than assumed: every arm asserts the produced list is `[]` (so the
ACCEPTED-file cap — the only bound before this fix — is provably never reached), that every record
carries the RIGHT reason, and that the emitted counts sum to exactly 100,000 — so the bound is not
achieved by dropping entries. An under-budget arm proves nothing is aggregated below the cap.

**Executed locally:** `npx vitest run src/__tests__/export-request-producer.test.ts` in
`packages/worker-daemon` — **27 tests, 27 pass**; the whole package, `npx vitest run` —
**166 files, 1268 pass, 1 skipped**; `npm run typecheck` (tsc --noEmit) — clean.

---

## What was verified locally vs what awaits CI

| claim | evidence |
|---|---|
| Class 1 fix + 4 new cases + M1/M2 mutations | `node --test scripts/lib/__tests__/m1-shipped-boot.test.mjs` — 97/97 |
| Class 3 fix + 6 new cases + M3/M4/M5 mutations | `packages/worker-daemon` vitest — 27/27 focused, 1268 pass package-wide |
| `packages/worker-daemon` typecheck | `tsc --noEmit`, clean |
| the guard set (pure-node, no arguments) + `check-evidence-immutability --base origin/docs/replatform-program` + `check-finding-ownership` + `check-register-citation-integrity` | run locally before the push; see the PR body |
| **the required `ci-required` verdict** | **NOT OBTAINED** — Actions is down repo-wide. Locally-unverified: the Linux `verify` shards, `e2e`, `migrations`, `policy` and `brand-check`. |

## Findings filed

- **`E7-F042`** — class 2 residue in `Supervisor.withDeadline`'s dependency seams. `unowned`, LOW.
- **`E6-F027`** — class 3 residue in `leakScan`'s annotation emission. `unowned`, LOW.
- **`E7-F041`** — **resolved**; its ownership key is deleted in the same commit as the code that
  earns it, per the manifest's own convention.
