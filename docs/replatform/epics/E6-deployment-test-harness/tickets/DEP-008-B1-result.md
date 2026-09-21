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

**Reviewer:** `pending`
**Reviewed revision:** `pending`
**Disposition:** `pending`
**Attempt:** none recorded

For `approved`, verify each OBSERVED value above against the named source at the reviewed revision,
and confirm that every row marked `not re-run` is accepted as such rather than read as passing. Then
change the top-level `Status` to `complete` and commit that disposition separately.

★ `M0` exit criterion 6 requires this result **approved**, not merely committed. It is left at
`gate_review` because its author may not approve it.
