# DEP-008-B1 Result - the isolation conformance suite is still exported and still consumed

**Status:** `gate_review`
**Date (UTC):** `2026-09-21`
**Epic:** `E6-deployment-test-harness`
**Plan task:** `E6 implementation-plan DEP-008-B1 - current isolation-conformance evidence on the milestone candidate (M0)`
**Implementer:** `M0 unit 6 (Claude Opus 5) - re-measure only; none of the underlying work is this record's`
**Start SHA:** `8b629fc25ad6471e04f6fe11cecbacde8fb4cedf`

The implementer leaves `Status` at `gate_review`. A separate reviewer completes the review section
and is the only role that may change it to `complete`.

★★★ This is an EVIDENCE-CURRENCY record, not a rebuild and not a re-approval of the original
ticket. `qa-handoff-recovery.md` section 2 forbids treating a prose `complete` header as canonical
ticket approval, so `M0` exit requires a result measured on **this** candidate. The original
[`DEP-008-result.md`](./DEP-008-result.md) is not edited: where a measurement disagrees with it, the
disagreement is recorded here as a **delta**, never repaired in place.

---
## 1. What was measured

| Clause | OBSERVED at `8b629fc25ad6471e04f6fe11cecbacde8fb4cedf` |
|---|---|
| the suite exists | `packages/sandbox-provider-contract/src/isolation-contract.ts:89` - `runSandboxIsolationConformance` |
| exported from the package barrel | `packages/sandbox-provider-contract/src/index.ts:36`, alongside `assertIsolationReport` |
| it has a real consumer | `packages/sandbox-e2b-provider/src/__tests__/conformance.test.ts:6` (import), `:46` (call, with `maxDestroyAttempts: CEIL`) |

★ It is **not a zero-caller suite** - the specific failure this programme keeps finding elsewhere
(`DAT-011`'s sweeper before its fix, `DAT-009`'s export sequencer, three REL-004 verifiers). Checked
by grepping the symbol across `packages/` and `server/` and excluding definitions.

## 2. Deltas against the original result

**None.** The delivered scope - 8 hostile checks, a separate `HostileSandboxProvider` reference
driver, and 9 sabotage tests each asserting the target's failure *reason* - is present.

## 3. The acceptance boundary, restated rather than softened

> E6 certifies **the suite + hostile reference over the frozen invoke-driver port - NOT E2B and NOT
> any real adapter**.

★★★ This record is not isolation proof against a real provider. No evidence here supports that, and
the original result says so at the line. The live `tests/d1/e6f-08-*.mjs` probes need a Docker
compose bring-up on Linux CI and have no Windows-local substitute (DEC-03).

## 4. Not re-run here

Neither the conformance suite nor its 9 sabotage mutants were executed, and the live `e6f-08` probes
were not brought up. All `not re-run`. * Reading a sabotage mutant is not the same as seeing it red.

## Independent review

**Reviewer:** M0 independent reviewer subagent (Claude) — distinct from the M0 implementation session
**Reviewed revision:** 5f3b47556d0df152db0d53d76c304861f30ffd37
**Disposition:** `approved`
**Attempt:** 1
**Review evidence:**
- Measured SHA `8b629fc25` vs reviewed revision: `git diff --stat 8b629fc25 HEAD` touches no file under `packages/sandbox-*`; all citations re-checked at `5f3b47556`.
- `packages/sandbox-provider-contract/src/isolation-contract.ts:89` -> `export async function runSandboxIsolationConformance(` (confirmed); 8 `runCheck(` invariants (`effect-authority-withdrawal`, `effect-ops-unrepresentable-under-cleanup`, `no-existence-oracle`, `monotonic-cleanup-convergence`, `zero-byte-management-projection`, `network-denial-no-bypass`, `no-credential-or-customer-byte-leak`, `bounded-lifecycle-faults`); `assertIsolationReport` at `:498`.
- `packages/sandbox-provider-contract/src/index.ts:36` -> `export { runSandboxIsolationConformance, assertIsolationReport } from "./isolation-contract.js";` (confirmed).
- `packages/sandbox-e2b-provider/src/__tests__/conformance.test.ts` -> symbol imported at `:6` (inside the import block `:3-9`), called at `:46` as `runSandboxIsolationConformance(makeDriver, { maxDestroyAttempts: CEIL })` with `CEIL = 3` (confirmed). Non-zero-caller confirmed by `grep -rl runSandboxIsolationConformance packages server scripts tests`: callers are this consumer and `packages/sandbox-provider-contract/src/__tests__/isolation-contract.test.ts` (other hits are the definition, barrel, and comment references).
- No-delta scope: `HostileSandboxProvider` is a separate driver (`packages/sandbox-fake-provider/src/hostile-driver.ts`, via `createHostileSandboxProvider`), used by `isolation-contract.test.ts`; that file has exactly 9 sabotage `it(` cases under the non-vacuousness `describe`, and each asserts its target check's `.detail` reason via `expect(failDetail(...)).toContain(...)` (9 assertions) (confirmed).
- Rows marked `not re-run`: the suite + 9 sabotages are SATISFIED at the reviewed revision, not merely accepted -- CI run `35561909654` (PR workflow, head `5f3b47556`), job `verify (3)`: `@armyofagents/sandbox-provider-contract src/__tests__/isolation-contract.test.ts (11 tests)` passed; job `verify (2)`: `@armyofagents/sandbox-e2b-provider src/__tests__/conformance.test.ts (2 tests)` passed; all four `verify` shards success. The live `tests/d1/e6f-08-*.test.mjs` probes are honestly unrun and ACCEPTABLE: they SKIP without `AOA_D1_LIVE=1` and are run only by `.github/workflows/d1-merge-train.yml` (`tests/d1/e6f-*.test.mjs`); the record claims nothing from them.
- Section 3 acceptance boundary is correctly stated: the only production-package consumer drives E2B driver logic over `MockE2bTransport` (no key, no network), so nothing here is real-provider isolation proof -- consistent with the record.
- No `cross-platform-weekly` run is cited (the E6-F023 trap is not engaged). `ci-required` in `35561909654` failed solely on the `do-not-merge` label.

For `approved`, verify each OBSERVED value above against the named source at the reviewed revision,
and confirm that every row marked `not re-run` is accepted as such rather than read as passing. Then
change the top-level `Status` to `complete` and commit that disposition separately.

★ `M0` exit criterion 6 requires this result **approved**, not merely committed. It is left at
`gate_review` because its author may not approve it.

## Review attempt history

The implementation author leaves the table body empty. The first independent reviewer appends attempt 1, and later reviewers append monotonically increasing rows without replacing prior attempts. The summary fields above mirror the latest real attempt. No `Review commit` column: a row cannot embed the SHA of the commit that first contains it.

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
| 1 | M0 independent reviewer subagent (Claude) — distinct from the M0 implementation session | `5f3b47556d0df152db0d53d76c304861f30ffd37` | `approved` | All four citations hold at reviewed revision (`isolation-contract.ts:89`, `index.ts:36`, `conformance.test.ts:6`/`:46`). 8 invariants, separate hostile driver, 9 sabotages each asserting `.detail` confirmed. Suite + sabotages passed in CI run `35561909654` (`verify (3)` isolation-contract 11 tests; `verify (2)` e2b conformance 2 tests). Live `e6f-08` probes unrun -- acceptable, boundary stated, run only by `d1-merge-train`. No findings. |
<!-- Later reviewers append attempt 2+ below without rewriting attempt 1. -->
