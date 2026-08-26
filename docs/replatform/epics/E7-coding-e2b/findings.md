# E7 — Coding/CLI on E2B — findings

## E7-F001 — The canary mints no execution-secret handle, so the canary sandbox receives no provider credential

**Status:** open
**Severity:** HIGH
**Filed:** Sprint 5 (CLI-006/D2 execution), 2026-08-26, by terrain re-verification of the CLI-006 ↔ DAT-008 seam.

**What.** The composed canary placement path **never mints an execution-secret handle**, so the
canary lease envelope carries `secretHandles: []`, the worker redeems nothing, and a coding CLI
inside the canary sandbox has **no provider credential to authenticate with** — on real E2B just as
on the D1 fake provider.

**The mechanism (source-traced at tip `88c6a8b66`).**
- CLI-006 wires the canary credential binding to `resolveCanaryCredentialBinding`
  (`server/src/index.ts:1182`), which returns **four explicit nulls** — `credentialKind: null`
  (`server/src/services/canary-credential-binding.ts:59-64`), deliberately, to keep the placement
  digest replay-stable and to structurally exclude `owner_desktop` routing.
- That binding flows into the placement authority (`server/src/services/job-placement.ts:455-461`)
  and thence to the DAT-008 mint as `credentialKind: authority.credentialBinding.credentialKind`
  (`server/src/services/job-placement-transaction.ts:377`), on the canary `selected/active/
  lease-eligible` path (`:363-365`).
- The mint's step 4 requires **both** owner authorities to exist and agree:
  `ownerAuthoritiesAgree(placementOwner, credentialKind)` returns `false` whenever `credentialKind
  === null` (`server/src/services/execution-secret-handle-mint.ts:122-127`), so
  `decideExecutionSecretHandle` refuses with `owner_authority_disagreement`
  (`:149-151`). No handle is written.
- `owner_authority_disagreement` is an **actionable** refusal
  (`isActionableMintRefusal`, `execution-secret-handle-mint.ts:104-106`), so every canary placement
  also emits a `job.execution_secret_mint.refused` warning
  (`job-placement-transaction.ts:385-393`) — a "should be impossible" owner-disagreement signal
  firing as the steady state of the canary.

**Consequence for the journey (hop 5 / E7-1).** The "execute" hop cannot run a real credentialed
coding task for the canary: the CLI in the sandbox has no key. This is the same bound
`CLI-006-result.md` deferral 2 records, but its stated mechanism there
(`secretHandles: []` hardcoded at `job-leasing.ts:349`; "no production writer") is **stale** — DAT-008
now advertises handles from `listActiveExecutionSecretHandles` (`job-leasing.ts:601-613`) and mints
via `mintExecutionSecretHandleForPlacement` (`job-placement-transaction.ts:367`). The delivery gap is
real; the reason moved. **E7-1 stays `unwired` for this reason too**, independent of the
provider-vs-fake and control-plane-reach reasons.

**Why it is not fixed here.** Making the canary mint a credential is architectural, not a line in the
D2 lane: enriching the four-null binding with a non-null `credentialKind` is **explicitly forbidden**
by CLI-006's design (`canary-credential-binding.ts:39-47` — it re-opens owner routing and breaks
placement-digest replay), and credential-generation freshness is stated to belong to the preflight
(`canary-preflight.ts`). The fix is a **canary-aware credential path** (a mint that can authorize a
Company-key `provider_key` handle for a canary agent run whose owner authority is established without
a personal-subscription `credentialKind`), which is a decision with a blast radius and its own ticket.

**Scope note.** This does not change any shipped behaviour and is fail-closed (no credential ⇒ the
canary coding CLI cannot authenticate ⇒ the run degrades visibly, never double-executes or leaks). It
bounds what a real-E2B canary campaign can prove until it is owned.
