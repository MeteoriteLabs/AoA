# WRK-010 — Design: sustained worker authority via device-proof session renewal

**Ticket node:** `docs/replatform/program-design.md` (`#### WRK-010`)
**Closes finding:** `E4-F007` (`epics/E4-worker-daemon/findings.md:130`, open, HIGH)
**Blocker record:** `docs/replatform/WAVE-4-BLOCKER-worker-session-lifetime.md`
**Depends on:** JOB-002 (enrollment + session mint), WRK-002 (daemon session store)
**Size:** M · **server-side only.** The daemon client is WRK-010 slice 2 (§9).
**Sprint:** 1 (see `docs/replatform/GO-BOOK.md`)

---

## ★ 0. Two corrections to the brief, verified at tip before designing around them

**(a) `IdentityLifecycle.acquireSession()` DOES NOT EXIST.** `grep -rn "acquireSession"` and a
repo-wide search for `IdentityLifecycle` return only three *documents*
(`scripts/finding-ownership.json`, `WAVE-4-BLOCKER-worker-session-lifetime.md:73`,
`epics/E10-desktop/tickets/DSK-001-design.md:351`). DSK-001 *said* it was landed as the
successor seam; it was not. The seam that actually exists is `SessionStoreDeps.renew`
(`packages/worker-daemon/src/identity/session.ts:55`), consumed via `createSessionProvider`
(`packages/worker-daemon/src/poll/poll-loop.ts:382`). This plan targets the real seam and
files the discrepancy as a finding (§12).

**(b) `verifyWorkerOperationProof` requires a LIVE session** (`worker-operation-proof.ts` →
`verifyWorkerSessionToken`, which fails `claims.exp <= nowSeconds` at
`worker-session-auth.ts:100`). So renewal is **rolling** — present a live session plus a
fresh proof, receive a new bounded one — not resurrection-from-expired. That satisfies the
acceptance exactly: it says "after the **ten-minute code route** has lapsed", and the session
lives fifteen. See §2.1.

---

## 1. The fact this ticket exists to change

| Fact | Evidence |
|---|---|
| Enrollment code route lives 10 minutes | `server/src/services/worker-enrollment.ts:22` `CODE_TTL_MS` |
| A device session lives 15 minutes | `worker-enrollment.ts:23`; `middleware/worker-session-auth.ts:15` `SESSION_MAX_MS`, asserted at **mint** (`:80`) **and verify** (`:101`) |
| A session is minted only by enrollment | `createWorkerSessionToken` (`worker-session-auth.ts:77`) has exactly two production call sites — `worker-enrollment.ts:369` (replay) and `:489` (fresh) — reachable only from `POST /worker-control/enroll` (`routes/worker-control.ts:205`) |
| The code-route gate precedes `completeEnrollment`, so it gates the replay path too | `worker-enrollment.ts:289-297`, ahead of `completeEnrollment` at `:299` |
| No route renews a device session | the only `renew` on the worker surface is `/worker-control/leases/:leaseId/renew` (`worker-control.ts:407`), a **lease fence**, audience `worker_run` |

**Net:** a worker enrolled at T0 loses its replay path at T0+10min and its authority at
T0+15min, with no path back. That is the steady state of every worker, not an edge case.

## 2. The fix, in one sentence

A worker that still holds a live session **and** can still sign with its enrolled device key
may exchange both for a **new** bounded session, on a route that never touches the enrollment
code table.

### 2.1 Rolling renewal, and why that shape is right

The daemon renews well before expiry (slice 2: at ~⅔ TTL, ≈10 min). The code route dies at
T0+10min and the session lives to T0+15min, so T0+11min is the window this ticket must serve —
and serving it repeatedly is unbounded authority. A worker holds authority *for as long as it
stays healthy*; one that goes dark longer than a full session is, correctly, no longer healthy
and re-enrols.

**Rejected — proof-only renewal with no bearer session.** It lets a device key alone mint
authority, requiring `deviceThumbprint → organization` resolution with no tenant hint. The
tenant boundary forbids enumerating organizations, so it needs a new thumbprint-routing table,
a migration, and a new standing-credential class — and it converts the device key from *a
proof of possession bound to a session* into *a bearer credential*. Not taken.

**Rejected — slide the session on `poll`** (E4-F007 option b). It couples authority lifetime
to work availability: an idle worker still needs authority, and a worker running a 40-minute
job does not poll at all. It also puts a mint inside the hottest, most rate-limited path
(`worker-control.ts:308`).

**Rejected — unbind the replay path from the code-route TTL** (option a). That makes the
*enrollment code* live forever, the opposite of what a one-time bootstrap credential should do.

### 2.2 The 15-minute ceiling is UNCHANGED

Renewal mints a **new** session; it never extends an old one. `SESSION_MAX_MS` is untouched and
`createWorkerSessionToken` re-asserts it at `:80` — so a defect trying to issue a longer session
**throws at the mint helper** rather than shipping. §7 Step 8 tests exactly that.

The renewal TTL is not a second constant: `SESSION_MAX_MS` becomes `export`ed (one keyword, zero
behaviour change) and the service uses it directly, so drift between "the ceiling" and "what
renewal issues" is impossible by construction.

## 3. Architecture — the house pattern, mirrored

Mirror `server/src/services/worker-self-model-admission.ts`: a **pure decision function** plus a
**thin route** that only resolves facts and renders refusals.

```
POST /api/worker-control/session/renew
  ├─ body-parser (app.ts:371-378, flag-gated at :361)  → size ceiling, inflate:false, rawBody
  ├─ descriptor size gate                              → malformed
  ├─ sessionRenewRequestSchema.safeParse               → malformed
  ├─ verifyWorkerOperationProof                        → JWT + ed25519 + thumbprint↔claim bind
  ├─ runInTenant(appDb, org): cleanupExpiredProofs → recordProof → findSessionAuthority
  ├─ operatorDb: findPlatformPhysicalAuthority (shared platform targets only)
  ├─ admitSessionRenewal(facts)   ◄── PURE. every guard here.
  └─ createWorkerSessionToken(claims from the DECISION, never echoed from the presented session)
```

### 3.1 Files

| Action | Path |
|---|---|
| create | `server/src/services/worker-session-renewal-admission.ts` — the pure decision |
| create | `server/src/services/worker-session-renewal.ts` — schema, local descriptor, fact resolution, mint |
| create | `server/src/__tests__/worker-session-renewal-admission.test.ts` — the unit matrix |
| create | `server/src/__tests__/worker-session-renewal.integration.test.ts` — embedded PostgreSQL |
| modify | `server/src/routes/worker-control.ts` — one route + one service construction |
| modify | `server/src/middleware/worker-session-auth.ts` — `export const SESSION_MAX_MS` |
| modify | `server/src/__tests__/worker-control-body-limits.test.ts` — one parity assertion |
| modify | `epics/E4-worker-daemon/findings.md` — E4-F007 resolved; new finding for the DSK-001 claim |

**No migration. No new table. No new column. No frozen-contract change.**

### 3.2 Dormancy is by absence, not behaviour

`workerControlRoutes` mounts only inside `if (opts.distributedExecutionEnabled)`
(`app.ts:483`, mount `:496-505`), so flag-off the path does not exist and 404s at the
catch-all. The body parser is gated on the same flag at `app.ts:361`, so flag-off the path does
not even buffer.

### 3.3 The route carries no identifier — deliberately

`POST /api/worker-control/session/renew`. No session id, worker id, target id or org id, in URL
**or body**. Identity comes entirely from the authenticated principal — the same construction as
`/execution-targets/self/placement-profile`, for its stated reason
(`execution-targets.ts:349-352`): cross-tenant reach is answered **by construction** rather than
by a check that can drift out of agreement with the middleware.

**Rejected — echoing `workerId`/`targetId` in the body and cross-checking.** It reads like
belt-and-braces but creates a *second* identity source next to the principal — the exact drift
the self-model route exists to avoid. The device proof already signs the body digest, the method
and the path.

Singular `/session/renew` (no id) so it can never be misread as a sibling of
`/leases/:leaseId/renew`, which is a fence and a different thing.

**The path is frozen the moment it ships.** The proof signs the normalized path
(`worker-device-proof.ts:40-56`), so a rename does not 404 — it produces a signature that can
never verify on a request that reached the right handler. When slice 2 lands the daemon
constant, `scripts/check-worker-path-parity.mjs` gains a `PAIRS` entry.

## 4. The pure decision function

### 4.1 The load-bearing property: it returns the claims to mint

`admitSessionRenewal` does not return `boolean`. It returns the **claims**, sourced from the
current authority row — never echoed from the presented session. That is the difference between
*renewing* and *extending*: a session cannot launder a stale fact forward, because the fact that
goes into the new token is read fresh in the same transaction that authorised it.

### 4.2 The ten guards, in order

Order is chosen, not incidental. Every refusal renders the same coarse `unauthorized` on the wire
(§5), so ordering is not observable to a caller — it is observable in the **operator log line**,
and that is what a human reads to decide what to do. A revoked target reported as "stale
generation" sends someone to the wrong place.

| # | Guard | Refusal | Why here |
|---|---|---|---|
| 1 | `!proofRecorded` | `proof_replayed` | A replayed proof means the request is not fresh; nothing it claims can be trusted, including which identity it asserts. |
| 2 | proof thumbprint ≠ session claim | `device_key_mismatch` | Re-checked here so the guard is mutation-testable in a pure function and a transport defect cannot become a mint. |
| 3 | authority row absent | `authority_absent` | Fail closed on an unanswered question. |
| 4 | workerId / targetId / organizationId / profileHash / scope ∉ {organization, owner} | `identity_mismatch` | Parity with `worker-session-auth.ts:165-167`. The scope arm catches a platform *physical* row behind an org-scope session — an inconsistency, not a legal state. |
| 5 | `workerStatus === "revoked"` OR `workerRevokedAt !== null` | `target_revoked` | Two independent columns; a revocation that set only one must still refuse. |
| 6 | `targetStatus === "disabled"` | `target_disabled` | The operator saying "do not use this target". `draining`/`offline` deliberately still renew — §4.3. |
| 7 | `!ownerMembershipActive` | `owner_membership_inactive` | Parity with `worker-session-auth.ts:161`. |
| 8 | target gen ≠ principal gen, OR worker gen ≠ principal gen | `generation_stale` | Three-way agreement. Behind = the session predates a rotation. Ahead = two authorities disagree and neither may be trusted. |
| 9 | stored key/thumbprint null, or ≠ the proof's | `device_key_mismatch` | **The enrolled-key check.** Distinct from #2: #2 proves the proof matches the *token*; this proves it matches the *row*. A key rotated in the DB under a still-consistent session dies here. |
| 10 | shared platform target: physical authority absent or mismatched | `platform_authority_unverified` | For `targetScope === "platform"` the real device lives in the operator DB. Mirrors `worker-session-auth.ts:186-197`. |

### ★ 4.3 `draining` and `offline` still renew, and that is the point

Drain means *take no new work* — the poll response's job. Withholding **authority** from a
draining worker strands one legitimately finishing in-flight work, which is precisely the failure
E4-F007 describes. `offline` is a liveness observation, not an authorization one; refusing there
turns a transient outage into a permanent one. The over-strict direction is a real bug, so §7
mutation-tests it: a mutant widening #6 to `targetStatus !== "active"` must be killed by named
tests.

### 4.4 Source (abridged to the load-bearing lines)

```ts
// server/src/services/worker-session-renewal-admission.ts
//
// WRK-010 — may this caller mint a FRESH bounded device session for itself?
//
// PURE: no database, no clock, no request, no crypto. The route resolves the facts; this
// decides — and it RETURNS THE CLAIMS TO MINT, sourced from the CURRENT authority row rather
// than echoed from the presented session. That is the difference between renewing and
// extending: a stale fact cannot be laundered forward.
//
// The 15-minute ceiling is deliberately ABSENT here. It is asserted by
// `createWorkerSessionToken` (worker-session-auth.ts:80) at mint, so a defect trying to issue
// a longer session throws there rather than passing here.
//
// Tenancy is also deliberately absent. The route carries no identifier at all, so cross-tenant
// reach is answered by construction at the middleware, not by a check here that could drift.

export type SessionRenewalRefusal =
  | "proof_replayed" | "device_key_mismatch" | "authority_absent" | "identity_mismatch"
  | "target_revoked" | "target_disabled" | "owner_membership_inactive"
  | "generation_stale" | "platform_authority_unverified";

/**
 * Every renewal refusal is TERMINAL, and that is a decision rather than an omission.
 * `unauthorized` is non-retryable; only `throttled`/`internal_unavailable` may carry
 * retryAfterMs. Unlike the self-model read — where "not configured yet" resolves by itself —
 * every refusal here is a credential or lifecycle fact a human must resolve. Making any
 * retryable would put a dead worker in a renewal loop against the control plane. The
 * exhaustiveness test in §7 Step 7 is what enforces it.
 */
export function sessionRenewalRefusalWireCode(_r: SessionRenewalRefusal): "unauthorized" {
  return "unauthorized";
}

export function admitSessionRenewal(input: SessionRenewalInput): SessionRenewalDecision {
  // 1. Freshness first. A spent proof means the request is not this worker's live intent.
  if (!input.proofRecorded) return refuse("proof_replayed");

  // 2. The proof's key must hash to the thumbprint the SESSION carries.
  if (input.proofDeviceThumbprint !== input.principalDeviceThumbprint) {
    return refuse("device_key_mismatch");
  }

  const authority = input.authority;
  if (authority === null) return refuse("authority_absent");

  // 3. Scope, BOUND rather than merely checked, so the minted claim is typed by the ROW.
  const scope = authority.workerScope === "organization" ? authority.workerScope
    : authority.workerScope === "owner" ? authority.workerScope : null;

  // 4. Identity parity with the shipped verifier. `scope === null` is a platform PHYSICAL row
  //    behind an org-scope session: an inconsistency, not a legal state.
  if (scope === null
    || authority.workerId !== input.principalWorkerId
    || authority.targetId !== input.principalTargetId
    || authority.workerOrganizationId !== input.principalOrganizationId
    || authority.workerProfileHash !== input.principalProfileHash) {
    return refuse("identity_mismatch");
  }

  // 5. Revocation ahead of everything else about the target, so a revoked worker is never
  //    reported to an operator as merely stale or disabled. TWO independent columns.
  if (authority.workerStatus === "revoked" || authority.workerRevokedAt !== null) {
    return refuse("target_revoked");
  }

  // 6. `disabled` is the operator saying "do not use this target". `draining`/`offline`
  //    deliberately DO renew — see §4.3.
  if (authority.targetStatus === "disabled") return refuse("target_disabled");

  // 7. An owner-scope worker whose membership lapsed has lost its grant.
  if (!authority.ownerMembershipActive) return refuse("owner_membership_inactive");

  // 8. Three-way generation agreement, BOTH directions.
  if (authority.targetDeviceGeneration !== input.principalGeneration
    || authority.workerDeviceGeneration !== input.principalGeneration) {
    return refuse("generation_stale");
  }

  // 9. THE ENROLLED KEY. Distinct from guard 2: that proves the proof matches the TOKEN,
  //    this proves it matches the ROW. A key rotated in the DB under a still self-consistent
  //    session dies HERE and nowhere else.
  if (authority.workerDevicePublicKey === null || authority.workerDeviceThumbprint === null
    || authority.workerDevicePublicKey !== input.proofPublicKey
    || authority.workerDeviceThumbprint !== input.proofDeviceThumbprint) {
    return refuse("device_key_mismatch");
  }

  // 10. A SHARED PLATFORM target's real device lives in the operator database, which this
  //     tenant transaction cannot see. `platformPhysical === null` refuses, so a route that
  //     forgets to resolve it fails CLOSED rather than minting on unverified authority.
  if (authority.targetScope === "platform") {
    const p = input.platformPhysical;
    if (p === null || p.targetStatus !== "active"
      || p.targetDeviceGeneration !== input.principalGeneration
      || p.workerStatus === "revoked" || p.workerRevokedAt !== null
      || p.workerDeviceGeneration !== input.principalGeneration
      || p.workerDeviceThumbprint !== input.proofDeviceThumbprint
      || p.workerDevicePublicKey !== input.proofPublicKey
      || p.workerProfileHash === null) {
      return refuse("platform_authority_unverified");
    }
  }

  return { admit: true, claims: {
    workerId: authority.workerId, targetId: authority.targetId,
    organizationId: input.principalOrganizationId,
    generation: authority.targetDeviceGeneration, scope,
    deviceThumbprint: authority.workerDeviceThumbprint,
    profileHash: authority.workerProfileHash,
  } };
}
```

## 5. Refusals are coarse and non-disclosing

Every refusal renders `unauthorized` → HTTP 401 via `sendWorkerProtocolError`
(`services/worker-protocol-http.ts:93`), the same helper enroll (`worker-control.ts:264`) and the
self-model route (`execution-targets.ts:399`) use. A caller learns the renewal was refused, never
which invariant it tripped — so the route cannot become an oracle for target existence,
generation or revocation state.

The **reason** survives in the operator-only log sink, as enrollment does at
`worker-control.ts:257-263`, with `reasonCode: "worker_session_renewal_<reason>"`.

A `WorkerSessionError` escaping `createWorkerSessionToken` (the ceiling assertion tripping) falls
through to the **generic** catch and answers `internal_unavailable`, not `unauthorized`. That
asymmetry is deliberate: that is a server defect, not a fact about the caller, and telling a
healthy worker "you are unauthorized" for our bug would stop it permanently.

## 6. The service and the route — the decisions inside them

**`WORKER_SESSION_RENEWAL_TTL_MS = SESSION_MAX_MS`.** Not a second constant; binding them makes
the agreement structural instead of coincidental.

**`sessionRenewRequestSchema`** = `{protocolVersion: 1, audience: "device_session", correlationId: uuid}`,
`.strict()`. `correlationId` is a UUID because `workerProtocolErrorV1` only echoes a UUID
(`worker-protocol-http.ts:20-27`); a looser type would silently drop it from refusals.

**`SESSION_RENEW_DESCRIPTOR`** — a **local** descriptor shaped like `OperationDescriptorV1`, the
same choice DAT-008 made at `execution-secret-resolve.ts:78-85` and for the same reason:
`WORKER_PROTOCOL_OPERATIONS` is a closed list of ten and E4-D02 forbids extending it, but a route
with no descriptor silently has no size ceiling, no timeout and no audience declaration.
`maxRequestBytes: 2 * 1024` (a version, an audience literal, one UUID — larger is not one of
ours), `timeoutMs: 10_000`, audience `device_session`.

**One tenant transaction** for the proof burn + authority read, exactly as `verifyCurrent` does at
`worker-session-auth.ts:147-159`. The proof's replay row expires with the **new** session, because
that is the window in which a captured renewal would be useful.

**The operator read runs AFTER the tenant transaction closes**, not nested — the shape
`worker-session-auth.ts:180-197` already ships. Acquiring a second pool connection while holding
a tenant transaction open is how a pool-exhaustion deadlock is built.

**Claims from the DECISION, never from `auth`.** A renewal that re-signed the presented claims
would extend a stale fact instead of re-deriving it.

**Response** sets `WORKER_CONTROL_HEADERS.session` (the same header enrollment uses at
`worker-control.ts:242`) so the daemon transport reads a renewed session exactly as it reads an
enrolled one, plus `{protocolVersion: 1, outcome: "renewed", expiresAt, deviceGeneration, serverTime}`.

**Size check BEFORE the credential read**, matching the nine operation handlers: an oversized body
is refused structurally, not as an identity decision.

## 7. Implementation — bite-sized RED/GREEN steps

Every step: write the failing test → **run it and watch it fail for the stated reason** → minimal
implementation → run it and watch it pass → commit. *A step whose RED does not fail for the
reason written down is a step that proved nothing; stop and find out why.*

```bash
pnpm --filter @armyofagents/server test:run -- src/__tests__/worker-session-renewal-admission.test.ts
pnpm --filter @armyofagents/server test:run -- src/__tests__/worker-session-renewal.integration.test.ts
pnpm --filter @armyofagents/server typecheck && pnpm --filter @armyofagents/server build
node scripts/check-guard-inventory.mjs && node scripts/check-test-inventory.mjs
node scripts/check-worker-protocol-boundary.mjs && node scripts/check-worker-path-parity.mjs
```

`scripts/test-inventory.json` records `server` in **floor** mode at 1467, so adding server tests
needs no manifest bump.

### ★ Step 1 — RED: the POSITIVE CONTROL, first

The suite **opens** with a positive control, and the reason is written into the file:

> E1-F008 found FIVE placement guards whose own named tests still PASSED with the guard deleted:
> every override-based fixture was refusing earlier, for an unrelated reason, and each test
> asserted a bare `toBe(false)` and got it from the wrong refusal. **A refusal suite with no
> positive control cannot tell "correctly refused" from "never got there".**

Two rules follow, enforced by construction: **(1)** the shared `input()` fixture is asserted to
**ADMIT** before any refusal case is built on it; **(2)** every refusal case asserts the
**specific reason**, never a bare `admit: false`.

Cases: the shared fixture admits; a **draining** target admits; an **offline** target admits; a
shared **platform** target whose physical authority agrees admits.

**GREEN:** create the module with types and a body of `return { admit: true, claims: {...} }`.
**Commit:** `WRK-010: pure session-renewal admission skeleton with a positive control`.

### Step 2 — guards 1–2 (freshness, transport key bind)
Refuses a spent `proofRecorded`; refuses it **FIRST** even when everything else is simultaneously
wrong; refuses a proof whose thumbprint is not the session's.

### Step 3 — guards 3–4 (absence, identity)
`authority: null` → `authority_absent`. An `it.each` over worker id / target id / organization id
/ profile hash → `identity_mismatch`. A **platform-scope worker row** behind an org-scope session
→ `identity_mismatch`. **Anti-vacuity:** an **owner**-scope row must still ADMIT, with
`scope: "owner"` in the claims — proving "platform is refused" proves nothing unless the other
arms are shown to pass.

### Step 4 — guards 5–7 (revocation, disablement, membership)
Revoked by status; revoked by `revokedAt` alone (two independent columns); revocation reported
**ahead of** disablement; revocation reported **ahead of** stale generation; disabled refused.
The over-strict direction is covered by Step 1's draining/offline controls.

### Step 5 — guard 8 (generation, both directions)
Behind; **ahead**; worker-row disagrees with target; only the target moved.

### Step 6 — guard 9 (the enrolled key)
A proof signed by a key the row does not carry; a row thumbprint disagreeing with the proof's;
an `it.each` over null public key / null thumbprint — *null is an unanswered question, not a match*.

### Step 7 — guard 10 (platform physical) + the wire code
`platformPhysical === null` → refused (**fail closed by default**: a route that forgets to read
the operator DB gets a refusal, not a mint on unverified authority). An `it.each` over eight
physical clauses, mirroring `worker-session-auth.ts:190-196` clause for clause. **Anti-vacuity:**
physical authority is IGNORED for a non-platform target — a guard that fired for every target
would pass the eight cases above and break every organization-scoped worker in production.
Plus the exhaustiveness test: every refusal maps to `unauthorized`.

### Step 8 — the service, and the ceiling that is not this ticket's to change
`WORKER_SESSION_RENEWAL_TTL_MS === SESSION_MAX_MS === 15 * 60_000`. **★ A renewal that tried to
exceed the ceiling is refused BY THE MINT HELPER** — `createWorkerSessionToken` throws
`WorkerSessionError` at `exp = iat + 901` and does not at `+900`. The falsifiable claim is that a
longer session cannot be issued *at all, by anyone*. Plus: the descriptor's `maxRequestBytes` is
**strictly below** `WORKER_CONTROL_BODY_LIMIT_BYTES` — with mount == contract, express refuses
first, the handler's guard stays dead, and the refusal keeps the wrong (non-protocol) shape.

### Step 9 — the route, and dormancy
404 with the flag OFF; 404 with the flag OFF **even for a malformed body** (absence precedes
validation).

### ★ Step 10 — the embedded-PostgreSQL integration test (the whole point)

Harness copied from `worker-enrollment.integration.test.ts:196-250` + its `deviceProof` signer at
`:173-194`, generalised to take a path. **Do NOT reuse `helpers/job-control-fixture.ts`**: its
worker row carries `device_public_key: 'job-006-public-key'`, not a real ed25519 SPKI, so a
genuine proof could never match. This suite enrols a **real** keypair through the **real** enroll
route — which is also what makes the code-route lapse real rather than mocked. One mutable
`let clock = NOW` passed as `now: () => clock` so `CODE_TTL_MS`, `SESSION_TTL_MS`,
`verifyWorkerSessionToken` and `verifyDeviceProof` all move together.

- **★ THE POINT: renews AFTER the ten-minute code route has lapsed.** T0 enrol for real; T0+11min;
  **★ POSITIVE CONTROL FOR THE PRECONDITION** — replaying the same code now 401s, proving the code
  route really lapsed rather than assuming it (without this, "renewal works after the code route
  lapsed" could pass with a code route that never expired); then renew with a live session + fresh
  proof and **no code header**. Assert `s1 !== s0`, `exp - iat === 900`, `iat` and `exp` both
  greater than `s0`'s, generation and thumbprint preserved. **★ POSITIVE CONTROL FOR THE PRODUCT:**
  a token that parses is not a token that WORKS — spend `s1` on a real worker route (200).
- **★ SUSTAINS authority past the original session's hard expiry.** At T0+20min renew again *from
  the renewed session*; and the dead `s0` **stays dead** (401) — renewal did not resurrect it.
- **★ POSITIVE CONTROL: the SAME request is refused once the target is revoked.** Because the
  identical shape succeeded above, the 401 is attributable to the revocation and not a broken
  fixture. Assert the envelope names no target, worker, generation or reason.
- Disabled target; generation moved ahead/behind; row-key rotated (guard 9 isolated from guard 2);
  foreign key (guard 2); proof outside the skew window **with an anti-vacuity 4-minute case that
  must still succeed**; replayed proof id.
- **★ never consults the enrollment code table:** delete every code and route row, then renew →
  200. The acceptance clause made mechanical rather than argued.

### Step 11 — the mutation sweep

Not optional and not a formality: **for every guard, flip it, run the named test, watch it die,
restore.** Full matrix in the result doc — 30+ mutants covering every guard, both directions of
guard 8, each of the eight physical clauses, every ordering claim, the TTL, and the claims source.

**★ Documented EQUIVALENT mutant — declared, not claimed as killed.** Replacing
`generation: authority.targetDeviceGeneration` with `generation: input.principalGeneration`
**survives**, because guard 8 has already proven them equal. The sourcing is a defence-in-depth
property, not an independently observable one. Say so in the result rather than reporting a false
kill — the precedent is `E1-F008`'s "6 of 9 die; the other 3 are documented equivalents".

### Step 12 — docs
E4-F007 → `resolved`, naming which of its three options was taken (option **c**) and why (a)/(b)
were not. **New finding (LOW):** DSK-001's `IdentityLifecycle.acquireSession()` claim has no code
behind it (§0a) — the fourth time this programme has found a documented fact that no code backs.
Result doc per the template. A status line in the blocker record — **do not rewrite it**; it is a
dated record.

## 8. Acceptance mapping

| Acceptance clause | Test |
|---|---|
| valid device proof → fresh session, no code, no human | integration `★ THE POINT` |
| revoked target refused, same coarse code | integration `★ POSITIVE CONTROL: refused once revoked`; unit guard 5 |
| disabled target refused, same coarse code | integration `refuses a DISABLED target`; unit guard 6 |
| generation-superseded refused, same coarse code | integration ahead/behind; unit guard 8 both directions |
| not mounted when distributed execution is off | `404s when the flag is OFF` (+ malformed-body variant) |
| the ten-minute code route is never consulted | integration `★ never consults the enrollment code table` |
| the 15-minute ceiling is unchanged | Step 8 + integration `exp - iat === 900` |
| renewal issues a NEW session, not an extension | integration `iat >`, `s1 !== s0`, `the DEAD one stays dead` |
| **Test:** unit admission matrix | all ten guards, both generation directions |
| **Test:** embedded-PG proof mints after the code route lapsed | the integration suite |
| **Test:** positive control proving the same proof is refused once revoked | two `★ POSITIVE CONTROL` cases + the precondition control |

## 9. Non-goals, named with owners

| Not delivered | Owner | Why |
|---|---|---|
| **The daemon client** — `SESSION_RENEW_PATH`, `renewSession()` on the transport, wiring `SessionStoreDeps.renew` to it in place of the enroll replay, and a near-expiry schedule | **WRK-010 slice 2** | The acceptance is entirely server-side, and E4 already splits this way (WRK-008 1/2). Slice 2 must also add the `PAIRS` entry in `check-worker-path-parity.mjs` and bump `packages/worker-daemon` in `test-inventory.json` (**pinned**). Until it lands, this route exists and nothing calls it — which is the rollback unit. |
| **Renewal for a platform PHYSICAL session** | follow-up / DEP-00x | `verifyWorkerOperationProof` denies it at the transport by design; its authority lives behind `acquirePlatformTargetAuthorityExclusive`, a materially different transaction shape. Shared-platform TENANT workers **are** covered (guard 10). |
| **Resurrecting a fully expired session** | not planned | §2.1. |
| **Any change to enrollment or `CODE_TTL_MS`** | — | Untouched on purpose. The bug was never that the code expires; it was that nothing else could mint. |
| **Rate limiting the renewal route** | DEP-009 follow-up | Once per ~10 min per worker, authenticated *and* proof-replay-bounded; an attacker who can call it already holds a live session. Named so it is a decision rather than an oversight. |

## 10. Risks

**R1 — proof burn on a refused renewal.** `recordProof` runs before the decision, so a refused
renewal has already spent its `proofId`. Every worker operation behaves this way
(`worker-session-auth.ts:148`). Slice 2 must generate a fresh `proofId` per attempt; if it
retries with the same one, the retry dies at guard 1 and reads as a revocation.

**R2 — the renewal window is the daemon's to respect.** No grace past `exp`. Slice 2 renews at
~⅔ TTL, and `SessionStore.ensureFresh` (`identity/session.ts:103-107`) currently refreshes only
when **already** expired — that needs a near-expiry threshold, and its docblock at `:5-12` (which
states as fact that no sustained renewal exists) needs rewriting.

**R3 — the path is frozen at merge.** §3.3. Between now and slice 2 it is protected by that
sentence and nothing else.

**R4 — nine refusals collapse to one wire code**, so the operator log is the only diagnosis. That
is the intended trade, but it makes `worker.session.renewal_denied` and its `reasonCode`
load-bearing operational surface, not debug noise. They belong in the runbook.

## 11. Rollback

Delete the route registration in `worker-control.ts`. The services and their tests are inert
without it; nothing calls the route until slice 2; there is no migration, no table and no data to
unwind. Reverting `export` on `SESSION_MAX_MS` is optional and changes no behaviour.
