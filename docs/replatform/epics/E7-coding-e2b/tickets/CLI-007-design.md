# CLI-007 — A canary-aware credential path for the coding journey (E7-F001 successor)

**Epic:** E7 · **Plan node:** `docs/replatform/program-design.md`, `#### CLI-007`
**Depends on:** CLI-006, DAT-008 · **Size:** (scope only — write the design at sprint start) · **Status:** scoping
**Owns:** finding **E7-F001** (`epics/E7-coding-e2b/findings.md`)

---

## Why this ticket exists

Sprint 5 (CLI-006 / D2) proved the coding journey's provider primitives on real E2B and mapped
every hop — but found, and filed as **E7-F001**, that the **canary sandbox receives no provider
credential at all**. So the "execute" hop cannot run a real credentialed coding task for the canary,
on real E2B just as on the D1 fake provider. That is the last real blocker between "harness ready"
and a provable full journey, and it is the reason **E7-1-coding-journey stays `unwired`**.

## The mechanism, as filed (verify at sprint start — the tree moves)

E7-F001 in `epics/E7-coding-e2b/findings.md` traces it end to end. In one line: the canary
credential binding is **four explicit nulls** (`canary-credential-binding.ts` `CANARY_CREDENTIAL_BINDING`),
`credentialKind: null` included — deliberately, to keep the placement digest **replay-stable** and to
**structurally exclude** `owner_desktop` routing. A null `credentialKind` makes the DAT-008 mint's
owner-authority gate refuse with `owner_authority_disagreement`
(`execution-secret-handle-mint.ts` `ownerAuthoritiesAgree`), so **no handle is written**, the lease
envelope carries `secretHandles: []`, and the worker redeems nothing.

## What this ticket must NOT do

- **Do NOT just set `credentialKind` to a non-null value on the canary binding.** CLI-006's design
  (`canary-credential-binding.ts` header) forbids it in as many words: it re-opens `owner_desktop`
  routing and **breaks placement-digest replay**. A fix that trips the replay invariant is a
  regression, not a fix.
- **Do NOT weaken the mint's owner-authority gate** to let a null through. The gate is fail-closed on
  purpose; the correct move is to give the canary a *legitimate* owner authority, not to remove the
  check.
- `packages/worker-protocol` is FROZEN.

## The shape of the fix (the sprint decides and justifies it)

A **canary-aware credential path**: a mint that can authorize a **Company-key `provider_key`** handle
for a canary agent run whose owner authority is established **without** a personal-subscription
`credentialKind`. The Company already configures a model-provider key (Decision #104 — the
`cloud_auth` extraction path resolves it and materialises it only inside the isolated sandbox); the
canary should ride that same Company authority rather than a personal one. The freshness of that
credential is stated by CLI-006 to belong to the **preflight** (`canary-preflight.ts`), which is the
natural place to establish the canary's owner authority before placement.

This is a **decision with a blast radius** — it touches placement authority, the mint's owner-agreement
rule, and the canary preflight — which is exactly why E7-F001 was filed rather than absorbed into the
D2 lane. The sprint writes the full design (verified state, architecture, the security argument that
the canary never gets a *personal* key and the Company key never leaves the sandbox, fail-first TDD,
mutation table, acceptance) at Step 1.

## Done when

- A canary placement mints a **Company-key `provider_key`** execution-secret handle (or an explicitly
  reasoned equivalent), so the canary lease envelope carries a non-empty `secretHandles` and the
  worker redeems a real credential inside the sandbox.
- The placement digest **replay invariant still holds** (a canary places to the same digest across
  attempts) — proven by a test, because breaking it is the failure mode this ticket exists to avoid.
- The mint's owner-authority gate is **unchanged in strength** — it still refuses a genuine
  disagreement; the canary now presents a *legitimate* owner authority rather than a null.
- Fail-closed preserved: a canary that cannot establish its owner authority gets **no** handle and
  the run degrades visibly — it never double-executes or leaks a key into a prompt/event/log
  (Decision #104).
- **E7-F001 resolved** (status flip + manifest key delete in the same commit).
- This unblocks — but does **not** itself promote — **E7-1**: promotion still requires a **cited
  dispatched real-E2B run** of the full journey (go-book §4 Sprint 5). CLI-007 makes that run
  *possible*; it does not stand in for it.

## Non-goals

- The real-E2B journey run itself (that is Sprint 5's completion, operator-dispatched, with the
  operator's E2B key).
- Any change to non-canary tenant credential routing (they stay on their existing path).
