# `E7-1-JOURNEY-ARM` — result

**Status:** `gate_review`
**Ticket:** `E7-1-JOURNEY-ARM` (E7, S, `M1a`) — promote the coding-journey clause when its two preconditions ship
**Implementer:** M1 planning session (Claude Opus 5), under founder delegation F2
**Reviewed revision:** `dd839129bf82347867180133029f242a0b4c9ed5` (the candidate the keyed run tested)
**Filed:** 2026-09-23

> ★★★ **This is an `M1a-D2-MECHANISM` record, not an `M1-D2-CODING` one.** Its verdict is the
> mechanism verdict. It never contributes to the capability gate, which a `capabilityProven=false`
> run **fails**. `capabilityProven=false` is a **PASS** for `M1a`: *"`M1a` explicitly does NOT claim
> useful agent capability, and a record that reports `capabilityProven=false` satisfies it."*

## 1. Both preconditions have committed passing evidence

The ticket may not be assigned until both do. They do:

| Precondition | Ticket | Evidence |
|---|---|---|
| The adapter-manager image built, signed and admitted in CI | **`DEP-014`** | `DEP-014-result.md`, `Status: complete` (independent review, PR #550). The D1 train builds, SBOMs, signs and admits all three images, with refusal controls. |
| The shipped CI boot lane that boots it and runs the journey (ruling F3) | **`DEP-015`** | `DEP-015-result.md` §12 — the keyed journey **run `35619555883`** on this candidate is green. |

The daemon consumer was already built and shipped inert
(`packages/worker-networked-host/src/bin/networked-host.ts`, DEP-011 Slice 2b-ii). This ticket built
neither precondition.

## 2. The register flip, with evidence

`scripts/gate-clause-wiring.json` → `E7-1-coding-journey`: `unwired` → **`wired`**, cited by symbol
`E2bSandboxProvider`, `expectedReferences: 4` **unchanged**.

`node scripts/check-gate-clause-wiring.mjs` after the flip:

```
gate-clause-wiring: OK (26 wired clause(s), 8 declared dormant, 2 provider-capability claim(s) matched to source)
```

The count the ticket typed out (4) is the count the checker found; nothing was edited to make it
agree. The clause left the dormant list, which now names 8 instead of 9.

## 3. The verifier's verdict on the milestone candidate

The lane runs `dist/cli/verify-e7-1-distributed-run.js` per enabled tenant inside the booted control
plane, which is `pnpm verify:e7-1-distributed-run`'s entry point.

| Tenant | Role | `execution_owner` | Run status | Verifier exit | `capabilityProven` | Real E2B sandbox |
|---|---|---|---|---:|---|---|
| a | enabled | `distributed` | `succeeded` | **0** | `false` | `iofom0nu25ztf3kc5tte1` |
| b | enabled | `distributed` | `succeeded` | **0** | `false` | `isqx7nvhgf40txm5vc4b6` |
| c | control | `null` — refused the distributed path | `failed` | — | — | none |

`journey.json`: `"passed": true`, mode `keyed`, template `aoa-base`.

**Verdict: PASS (mechanism).** Exit `0` is the corroborated mechanism, and `capabilityProven=false`
is expected and required to be read as a pass here, because `M1b` has not landed.

## 4. What this record does NOT say

- **Not a capability claim.** Nothing the agent produced reached AoA; Unit F's emit half is unbuilt.
- **Not legacy health.** Tenant c's own run `failed`; it evidences **refusal** of distributed routing
  (the F10 control), nothing more.
- **Not pricing.** `usage_json.costUsd` is `null` on both enabled tenants. No `cost_events` row is
  evidenced; that is `DEP-016`'s assertion and `E3-F037`'s remaining half.
- **Not tools.** `CLI-016`'s per-Organization tool surface is off in this lane.
- **Not the `M1a` gate record.** The `M1a-D2-MECHANISM` campaign is a separate record on the frozen
  `M1a` candidate; this is one ticket's evidence, filed under that gate.

## 5. Non-goals honoured

Built no image (`DEP-014`) and no boot (`DEP-015`); flipped no other clause; dispatched no keyed lane
outside the F8 envelope — the run cited here is F8's named `E7-1-JOURNEY-ARM` run, dispatched by the
planning session.

## 6. Commands

```
node scripts/check-gate-clause-wiring.mjs      # OK, 26 wired / 8 dormant (above)
pnpm verify:cp-am-keypair                      # run inside the lane: step "Verify the control-plane / adapter-manager keypair" = success (run 35619555883)
verify:e7-1-distributed-run                    # run inside the lane per tenant: exit 0 for a and b (above)
```

The full pure-node guard set and `check-evidence-immutability --base origin/docs/replatform-program`
are green on the commit that carries this record.

## 7. Reviewer section

**Pending.** A **distinct reviewer** must check this record against source and the cited run, and is
the only one who may set `Status: complete`.

## Review attempt history

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
| — | *(pending)* | — | — | — |
