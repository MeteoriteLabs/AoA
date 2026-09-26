# DEP-027 — D1 clause-5 nonce attribution and case-scoped withheld-plant control

**Status:** groomed · **Epic:** E6 · **Plan node:** `docs/replatform/program-design.md`, `#### DEP-027`
**Depends on:** `DEP-023`, `DEP-025`, `DEP-026` · **Milestone:** `M1a`
**Owns:** findings **E6-F033** and **E6-F034**
**Filed:** 2026-09-26

## Scope

Repair the required D1 redaction case without widening the worker protocol or touching keyed E2B.
The fake provider gains an inert per-arm nonce on its probe line. The case runs a true unseeded
withheld-plant job and a planted-canary job in one invocation, then attributes both event and log
evidence to each arm's nonce.

The retained row reports per-stream observations for both arms, requires both terminals to be
`succeeded`, and sets `positiveControlPassed` only when every declared withheld stream was observed
and clean. The standalone fault-matrix grader remains authoritative.

## RED / GREEN contract

RED controls must demonstrate all four defects on the pre-fix tree: another arm's nonce is stale
evidence; one missing stream is not a passing control; a failed terminal is broken setup; and a
marker on either withheld stream is a violation. GREEN requires each mutation to red independently.

## Credential safety

The withheld job is genuinely unseeded: it carries no secret handle and emits a nonce-scoped,
fresh inert control canary verbatim. The planted arm continues to use a separate freshly generated
inert canary. No real provider
credential is echoed, retained, or dispatched to a paid provider.

## Closure

After focused and repository verification pass, flip E6-F033 and E6-F034 to `resolved`, delete both
keys from `scripts/finding-ownership.json` in that same commit, replace the D1 declaration's temporary
`none` exemption with `{"scope":"in_run"}`, and append `tickets/DEP-027-result.md`. Historic evidence,
ticket records, and finding rationale remain unchanged.
