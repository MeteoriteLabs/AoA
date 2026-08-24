# WRK-010 — Design: sustained worker authority via device-proof session renewal

**Ticket node:** `docs/replatform/program-design.md` (`#### WRK-010`)
**Closes finding:** `E4-F007` (`epics/E4-worker-daemon/findings.md:130`, open, HIGH)
**Blocker record:** `docs/replatform/WAVE-4-BLOCKER-worker-session-lifetime.md`
**Depends on:** JOB-002 (enrollment + session mint), WRK-002 (daemon session store)
**Size:** M · **server-side only.** The daemon client is WRK-010 slice 2 (§9).
**Sprint:** 1 (see `docs/replatform/GO-BOOK.md`)
**Epic ownership: E4** — see §0(d). Recorded here because it was asked for and never answered.

---

## ★ 0. Corrections verified at tip before designing around them

**(a) `IdentityLifecycle.acquireSession()` DOES NOT EXIST.** `grep -rn "acquireSession"` and a
repo-wide search for `IdentityLifecycle` return only three *documents*
(`scripts/finding-ownership.json:5`, `WAVE-4-BLOCKER-worker-session-lifetime.md:73`,
`epics/E10-desktop/tickets/DSK-001-design.md:351`). DSK-001 *said* it was landed as the
successor seam; it was not. The seam that actually exists is `SessionStoreDeps.renew`
(`packages/worker-daemon/src/identity/session.ts:55`), consumed via `createSessionProvider`
(`packages/worker-daemon/src/poll/poll-loop.ts:382`). This plan targets the real seam and
files the discrepancy as a finding (§7 Step 7).

**(b) A renewal requires a LIVE session.** Both candidate credential paths do: the shipped
authenticator calls `verifyWorkerSessionToken`, which fails `claims.exp <= nowSeconds` at
`worker-session-auth.ts:100`. So renewal is **rolling** — present a live session plus a fresh
proof, receive a new bounded one — not resurrection-from-expired. That satisfies the acceptance
exactly: it says "after the **ten-minute code route** has lapsed", and the session lives fifteen.
See §2.1.

**★ (c) This plan's first draft built a second authenticator. Adversarial review refused it, and
the refusal is adopted here.** The draft routed through `verifyWorkerOperationProof`
(`middleware/worker-operation-proof.ts:34-76`) — a **transport-only** verifier whose own docblock
says so at `:29-33` — and then re-derived every authority guard inside a new pure function. But
the route this plan explicitly mirrors, `/execution-targets/self/placement-profile`, does not use
that verifier. It uses `requireWorkerHeartbeatAuthority` (`routes/execution-targets.ts:67-118`),
which is a thin wrapper over **`createWorkerSessionAuthenticator`**
(`middleware/worker-session-auth.ts:109-210`) — and that authenticator already performs **nine of
the ten guards the draft was about to re-implement**, including a scope check *stronger* than the
one the draft wrote. §3.4 maps them one for one. Building a parallel copy would have created a
second authority surface that can drift out of agreement with the shipped one — the exact failure
mode §3.3 already refuses on the identity question. **This revision adopts the authenticator and
shrinks the pure function to what the authenticator does not decide.** §4, §5 and §7 change
materially as a result, and §10 R6/R7 record what that costs.

**★ (d) The epic-ownership call, recorded.** `scripts/finding-ownership.json:4-5` marks E4-F007
`unowned` and says in as many words: *"AWAITING an ownership call: a server-side ticket in E3
(JOB-002's family, where the escalation was addressed) or E4 (where the finding lives, already
reopened once for WRK-008)."* The finding text itself
(`epics/E4-worker-daemon/findings.md:145`) says "E3/JOB-002 follow-up ticket". The GO-BOOK files
it under E4 (`GO-BOOK.md:125`, `:187`). Nobody reconciled the three.

**Decision: WRK-010 stays in E4.** The finding lives in E4's ledger, the consumer
(`SessionStoreDeps.renew`) is an E4 daemon seam, the blocked work (WRK-008 slice 2b) is E4, and
E3 is closed and CI-green — reopening a closed epic to host a ticket whose only non-server
consumer is E4's daemon buys nothing. E3/JOB-002 remains the *origin* of the defect, which §1
records; origin and ownership are different questions. §7 Step 7 flips
`finding-ownership.json` to `owned` naming this ticket.

---

## 1. The fact this ticket exists to change

| Fact | Evidence |
|---|---|
| Enrollment code route lives 10 minutes | `server/src/services/worker-enrollment.ts:22` `CODE_TTL_MS` |
| A device session lives 15 minutes | `services/worker-enrollment.ts:23` `SESSION_TTL_MS`; `middleware/worker-session-auth.ts:15` `SESSION_MAX_MS`, asserted at **mint** (`:80`) **and verify** (`:101`) |
| A session is minted only by enrollment | `createWorkerSessionToken` (`worker-session-auth.ts:77`) has exactly two production call sites — `services/worker-enrollment.ts:369` (replay) and `:489` (fresh) — reachable only from `POST /worker-control/enroll` (`routes/worker-control.ts:205`) |
| The code-route gate precedes `completeEnrollment`, so it gates the replay path too | `services/worker-enrollment.ts:289-297`, ahead of `completeEnrollment` at `:299` |
| No route renews a device session | the only `renew` on the worker surface is `/worker-control/leases/:leaseId/renew` (`worker-control.ts:407`), a **lease fence**, audience `worker_run` |

**Net:** a worker enrolled at T0 loses its replay path at T0+10min and its authority at
T0+15min, with no path back. That is the steady state of every worker, not an edge case.

## 2. The fix, in one sentence

A worker that still holds a live session **and** can still sign with its enrolled device key
may exchange both for a **new** bounded session, on a route that never touches the enrollment
code table.

### 2.1 Rolling renewal, and why that shape is right

The daemon renews well before expiry (slice 2: at ~⅔ TTL, ≈10 min — and §6 makes that cadence
load-bearing rather than tidy). The code route dies at T0+10min and the session lives to
T0+15min, so T0+11min is the window this ticket must serve — and serving it repeatedly is
unbounded authority. A worker holds authority *for as long as it stays healthy*; one that goes
dark longer than a full session is, correctly, no longer healthy and re-enrols.

**Rejected — proof-only renewal with no bearer session.** It lets a device key alone mint
authority, requiring `deviceThumbprint → organization` resolution with no tenant hint. The
tenant boundary forbids enumerating organizations, so it needs a new thumbprint-routing table,
a migration, and a new standing-credential class — and it converts the device key from *a
proof of possession bound to a session* into *a bearer credential*. Not taken. **But the second
half of that sentence does not survive scrutiny as a security argument** — rolling renewal
reaches the same end state after a single capture. See §10 R5; the structural reasons above are
what actually carry the rejection.

**Rejected — slide the session on `poll`** (E4-F007 option b). It couples authority lifetime
to work availability: an idle worker still needs authority, and a worker running a 40-minute
job does not poll at all. It also puts a mint inside the hottest, most rate-limited path
(`worker-control.ts:308`).

**Rejected — unbind the replay path from the code-route TTL** (option a). That makes the
*enrollment code* live forever, the opposite of what a one-time bootstrap credential should do.

**What is taken is E4-F007 option (c), AMENDED.** The finding's own words are "add a
device-proof-**only** reauth endpoint" (`findings.md:148-149`) — which is precisely the shape
rejected two paragraphs up. This ticket ships **(c), amended: proof PLUS a live session.** §7
Step 7 records the amendment when it resolves the finding, rather than letting "option (c)" read
as if the finding's literal proposal was implemented.

### 2.2 The 15-minute ceiling is UNCHANGED

Renewal mints a **new** session; it never extends an old one. `SESSION_MAX_MS` is untouched and
`createWorkerSessionToken` re-asserts it at `:80` — so a defect trying to issue a longer session
**throws at the mint helper** rather than shipping. §7 Step 3 tests exactly that.

The renewal TTL is not a second constant: `SESSION_MAX_MS` becomes `export`ed (one keyword, zero
behaviour change) and the service uses it directly, so drift between "the ceiling" and "what
renewal issues" is impossible by construction.

## 3. Architecture — the house pattern, mirrored properly

Mirror `/execution-targets/self/placement-profile` as it is actually built: the **shipped
authenticator** resolves and proves the caller's authority, a **pure decision function** decides
the route-specific question, and a **thin route** renders refusals.

```
POST /api/worker-control/session/renew
  ├─ body-parser (app.ts:370-377, flag-gated at :361)   → size ceiling, inflate:false, rawBody
  ├─ SESSION_RENEW_DESCRIPTOR.maxRequestBytes gate      → malformed
  ├─ sessionRenewRequestSchema.safeParse                → malformed
  ├─ authorization / proof headers / rawBody present    → unauthorized
  ├─ sessionAuthenticator.authenticate({...})   ◄── NINE guards, already shipped. THROWS.
  │     worker-session-auth.ts:125-207 — see the map in §3.4
  ├─ admitSessionRenewal(facts from the principal)  ◄── PURE. ONLY what the authenticator
  │                                                      does not decide.
  └─ createWorkerSessionToken(identity from the DECISION + iat/exp stamped by the service)
```

### 3.1 Files

| Action | Path |
|---|---|
| create | `server/src/services/worker-session-renewal-admission.ts` — the pure decision |
| create | `server/src/services/worker-session-renewal.ts` — schema, local descriptor, authenticator wiring, mint |
| create | `server/src/__tests__/worker-session-renewal-admission.test.ts` — the (now small) unit matrix |
| create | `server/src/__tests__/worker-session-renewal.integration.test.ts` — embedded PostgreSQL; **carries the authority matrix** (§10 R6) |
| modify | `server/src/routes/worker-control.ts` — one route + one authenticator construction |
| modify | `server/src/middleware/worker-session-auth.ts` — `export const SESSION_MAX_MS`. **Nothing else.** |
| modify | `server/src/__tests__/worker-control-body-limits.test.ts` — one parity assertion for the local descriptor |
| modify | `server/src/__tests__/desktop-disabled.negative.test.ts` — one source-scan clause (§7 Step 4) |
| modify | `epics/E4-worker-daemon/findings.md` — E4-F007 resolved; new finding for the DSK-001 claim |
| modify | `scripts/finding-ownership.json` — E4-F007 `unowned` → `owned`, ticket `WRK-010` (§0d) |

**No migration. No new table. No new column. No frozen-contract change. No change to shared
authentication behaviour** — `export` on a constant is the whole of the middleware diff.

### 3.2 Dormancy is by absence, not behaviour

`workerControlRoutes` mounts only inside `if (opts.distributedExecutionEnabled)`
(`app.ts:483`, mount `:496-505`), so flag-off the path does not exist and 404s at the
catch-all. The worker-control body parsers are gated on the same flag at `app.ts:361`, so
flag-off the path does not even buffer. §7 Step 4 proves this **structurally**, not by asking
express what it does with a router we chose not to mount.

### 3.3 The route carries no identifier — deliberately

`POST /api/worker-control/session/renew`. No session id, worker id, target id or org id, in URL
**or body**. Identity comes entirely from the authenticated principal — the same construction as
`/execution-targets/self/placement-profile`, for its stated reason
(`execution-targets.ts:349-352`): cross-tenant reach is answered **by construction** rather than
by a check that can drift out of agreement with the middleware.

**Rejected — echoing `workerId`/`targetId` in the body and cross-checking.** It reads like
belt-and-braces but creates a *second* identity source next to the principal — the exact drift
the self-model route exists to avoid. The device proof already signs the body digest, the method
and the path (`worker-device-proof.ts:40-56`).

Singular `/session/renew` (no id) so it can never be misread as a sibling of
`/leases/:leaseId/renew`, which is a fence and a different thing.

**The path is frozen the moment it ships.** The proof signs the normalized path
(`worker-device-proof.ts:30-38`, consumed at `:50`), so a rename does not 404 — it produces a
signature that can never verify on a request that reached the right handler. The route passes
`req.originalUrl`, as enroll (`worker-control.ts:240`), poll (`:300`) and the self-model route
(`execution-targets.ts:108`) all do, so the `/api` mount prefix is part of the signed contract.
When slice 2 lands the daemon constant, `scripts/check-worker-path-parity.mjs` gains a `PAIRS`
entry (`:26-35`).

### ★ 3.4 What the shipped authenticator already proves — the map, guard for guard

This is the table that justifies §0(c). Every row was read at tip. `WorkerSessionError`
(`worker-session-auth.ts:47-52`) carries **two** codes; which one a refusal throws is the only
diagnosis the operator log gets, so it is recorded per row (see §5).

**★ Two files are called `worker-enrollment.ts` and this document cites both.** Throughout,
**`services/worker-enrollment.ts`** is the server enrollment service (`CODE_TTL_MS`, the enroll
flow, the mint) and **`tenant/worker-enrollment.ts`** is the Drizzle repository
(`packages/db/src/repositories/tenant/worker-enrollment.ts` — `recordProof`,
`findSessionAuthority`, `cleanupExpiredProofs`). Never write the bare name.

| Draft guard | Where it happens now | Thrown as |
|---|---|---|
| 1 · proof replayed | `cleanupExpiredProofs` + `recordProof` + `if (!recorded) fail()` — `:147-155` | `unauthorized` |
| 2 · proof thumbprint ≠ session claim | `:141` | `unauthorized` |
| 3 · authority row absent | `!current` — `:160` | `target_revoked` |
| 4 · identity — `workerId` / `targetId` | **not compared, and need not be**: `findSessionAuthority` is keyed by exactly `workers.id` + `workers.execution_target_id` (`tenant/worker-enrollment.ts:365-368`) | — |
| 4 · identity — `organizationId` | `:165`, inside `runInTenant` where `workers` is under FORCE RLS (`migrations/0211_tenant_rls_enforcement.sql:50-56`) | `unauthorized` |
| 4 · identity — `profileHash` | `:167` | `unauthorized` |
| 4 · identity — **scope** | `:165` — **`current.worker.scope !== claims.scope`.** STRONGER than the draft, which only asked whether the row's scope was in `{organization, owner}` and never compared it to the token's. A session claiming `organization` over an `owner` row passed the draft and is refused here. | `unauthorized` |
| 5 · revoked (status **or** `revokedAt`) | `:160-161`, both columns | `target_revoked` |
| 6 · target `disabled` | `:160` | `target_revoked` |
| 7 · owner membership inactive | `:161` (resolved at `tenant/worker-enrollment.ts:371-382`) | `target_revoked` |
| 8 · generation, three-way, both directions | `:162` — target gen **and** worker gen vs `claims.generation` | `target_revoked` |
| 9 · the enrolled key on the ROW | `:166-167` — row thumbprint vs claim, row public key vs **the proof's**. A `null` on either column is not a match: `null !== "<hex>"` refuses. | `unauthorized` |
| 10 · shared-platform physical authority, 9 clauses | `:186-197`, mirrored clause for clause from `findPlatformPhysicalAuthority` | `target_revoked` |

One clause-level note, recorded because the draft would have got it subtly wrong and nobody
would have noticed: the shipped ninth clause is **falsy** — `!physical.worker.profileHash`
(`:195`) — where the draft wrote `p.workerProfileHash === null`. They diverge on the empty
string, and the shipped direction is the fail-closed one (an empty profile hash is treated as
absent, which is right; a sha256 hex is never empty). Nothing to change, but the draft's version
was the more permissive of the two, which is the wrong way round for a guard whose whole job is
to refuse on an unanswered question.

**Nine of ten in full; guard 4 in part**, its two unperformed arms being exactly the two the
draft's own reasoning made tautological (§10 R8). The authenticator additionally returns
`scope`, `targetScope` and a resolved `sharedPlatformAuthority` — three facts
`verifyWorkerOperationProof` does not produce at all (its `VerifiedWorkerOperation` at
`worker-operation-proof.ts:5-16` has no `scope` field), and which the draft would have had to
re-read from the database to obtain.

### 3.5 Two known divergences from what the draft wanted

**(i) The proof-replay row expires with the PRESENTED session, not the new one.** The
authenticator writes `expiresAt: new Date(claims.exp * 1000)` (`worker-session-auth.ts:153`).
Enrollment writes `expiresAt: new Date(now().getTime() + SESSION_TTL_MS)`
(`services/worker-enrollment.ts:320`) — the *new* session's window, which is what the draft asked for.
The difference is load-bearing, and precisely bounded: `recordProof` **deletes an expired row
before inserting** (`tenant/worker-enrollment.ts:252-256`), so once the row lapses the same `proofId`
is accepted again. A proof is independently skew-bounded to ±5 min
(`worker-device-proof.ts:4` `DEFAULT_MAX_SKEW_MS`, enforced at `:74`). So:

* renewal with **≥5 min of headroom** (the ⅔-TTL cadence: renew at T0+10min, presented session
  expires T0+15min, the proof is skew-dead at T0+15min) → the row outlives the proof. **No window.**
* renewal **inside the last 5 minutes** (renew at T0+14.9min) → the row lapses at T0+15min while
  the proof stays signature-valid until T0+19.9min. **A ~4.9-minute replay window opens.**

Closing it would mean changing `:153` — shared middleware, on the hot path of ten other
operations, for a window this ticket can instead close by construction. **Taken: leave `:153`
alone, and make slice 2's renewal headroom a stated invariant rather than a scheduling
preference** (§6, §9, §10 R7).

**(ii) Platform PHYSICAL sessions now authenticate.** `verifyWorkerOperationProof` denies them
at the transport (`worker-operation-proof.ts:50`: `if (!claims.organizationId || claims.scope ===
"platform") denied();`). The authenticator does not — `claims.organizationId === null` takes the
operator-DB branch at `:180-182` and returns a valid principal. So the non-goal in §9 that used
to be free is now a **guard we must write**. It is guard R1 in §4.2. A revision that adopted the
authenticator without noticing this would have silently shipped platform-physical renewal.

## 4. The pure decision function

### 4.1 What is left to decide — and why a pure function still earns its place

After §3.4, `admitSessionRenewal` decides two things and produces one:

1. **May this principal class renew at all?** (§3.5(ii): platform physical may not.)
2. **Is the operator-side fact a shared-platform target needs actually present?** (fail closed if
   a future refactor drops it.)
3. **The identity half of the claims to mint**, narrowed to a renewable scope.

That is a small function. Naming it honestly: **the authenticator did the work, and duplicating
it was the defect this revision removes.** The function still earns a file because (a) the
platform-physical refusal is a real, reachable, mutation-testable decision that exists nowhere
else, (b) it types the minted claims from a narrowed scope so an unrenewable scope cannot reach
`createWorkerSessionToken` at all, and (c) it keeps the route thin, which is the house pattern.

**★ The draft's headline property is downgraded, deliberately and on the record.** §4.1 of the
first draft claimed the claims are "sourced from the current authority row — never echoed from
the presented session". Under the authenticator that is **not true and cannot be made true
without a second read**: `VerifiedTargetPrincipal` is built at `worker-session-auth.ts:168-178`
from `claims.sub`, `claims.targetId`, `claims.generation`, `claims.deviceThumbprint`,
`claims.profileHash` — the token's own values. Only `targetScope` (`:177`) comes from the row.

What makes echoing safe is not re-sourcing; it is that `:160-167` **proved every one of those
values equal to the row inside the same transaction that authorised the request**. "Renewing,
not extending" therefore holds by *equality proof* rather than by *provenance*. That is a weaker
sentence and a true one, and it is the same fact that makes six mutants equivalent (§7 Step 6).

### 4.2 The two guards

No ordering rationale accompanies this table, and its absence is deliberate — see §4.4.

| # | Guard | Refusal | Why |
|---|---|---|---|
| R1 | `principalOrganizationId === null` (or `principalScope === "platform"`) | `platform_physical_unsupported` | §3.5(ii) and §9. A platform PHYSICAL identity's authority lives behind `acquirePlatformTargetAuthorityExclusive`, a materially different transaction shape; renewal for it is out of scope and must be refused explicitly now that the transport no longer refuses it for us. |
| R2 | `targetScope === "platform"` and `hasSharedPlatformAuthority === false` | `platform_authority_unresolved` | The authenticator only populates `sharedPlatformAuthority` after `:186-197` passes, so `false` here means the operator-side proof did not happen. Refusing on it makes a future refactor that drops the operator read fail **closed** rather than mint on unverified authority. |

Guard R1's second arm is defence in depth, not reachable coverage: `assertClaims` pins
`(scope === "platform") === (organizationId === null)` at `worker-session-auth.ts:69`, so the two
arms can never disagree in production. It is written because it costs one `||`, and it is
**declared here rather than counted as coverage** — the same discipline §10 R8 applies to guard
4's tautological arms.

### ★ 4.3 `draining` and `offline` still renew, and that is still the point

Drain means *take no new work* — the poll response's job. Withholding **authority** from a
draining worker strands one legitimately finishing in-flight work, which is precisely the failure
E4-F007 describes. `offline` is a liveness observation, not an authorization one; refusing there
turns a transient outage into a permanent one.

This remains true and remains load-bearing — but it is now a property of **shipped middleware**
(`worker-session-auth.ts:160` refuses `disabled` and nothing else), not of code this ticket
writes. The consequence for testing is concrete and is not glossed: the draft mutation-tested it
by widening its own guard to `targetStatus !== "active"`. There is no longer a guard of ours to
widen, and mutating `:160` would kill dozens of unrelated tests, which proves nothing about this
route. **So it is asserted at integration level instead** — a draining target and an offline
target each renew successfully through the real route (§7 Step 5). Weaker evidence than a
mutant, honestly labelled.

### 4.4 The guard-ordering argument is DELETED, and why

The draft carried an explicit ordering rationale ("a revoked target reported as 'stale
generation' sends someone to the wrong place") and mutation tests for it — cases asserting that
revocation is reported *ahead of* disablement and *ahead of* stale generation.

**All of it is removed.** Not because ordering stopped mattering, but because **its only
observable consumer was untested.** The ordering was never visible on the wire (§5), only in the
operator log line; and once the authority guards live in the authenticator, seven distinct
conditions arrive as one `WorkerSessionError("target_revoked")` with no discriminator at all
(§3.4). An assertion that nothing can observe is an assertion nothing can falsify, and this
programme has a standing rule about guards that pass because they could not evaluate anything
(`scripts/check-guard-inventory.mjs`).

If operator diagnosis proves painful in practice — a real incident where "target_revoked" sent
someone to the wrong place — that is a **follow-up ticket with evidence**, and its scope is the
shared authenticator's error taxonomy, not this route.

### 4.5 Source (abridged to the load-bearing lines)

```ts
// server/src/services/worker-session-renewal-admission.ts
//
// WRK-010 — may this ALREADY-AUTHENTICATED principal mint a fresh bounded device session?
//
// ★ READ THIS BEFORE ADDING A GUARD. The caller has already been through
// `createWorkerSessionAuthenticator` (worker-session-auth.ts:109-210), which proved: the
// session's HMAC and expiry, the device proof's signature/skew/path/body binding, that the
// proof's key is the session's, that the proof is not a replay (it BURNS it), that the
// authority row exists and is not revoked/disabled, that the owner membership is live, that
// both generations agree with the token, that the row's scope, org, profile hash, thumbprint
// and PUBLIC KEY match, and — for a shared platform target — that the operator-side physical
// authority agrees. Re-checking any of that here would create a second authority surface that
// can drift out of agreement with the first. That was the defect this file was rewritten to
// remove; see the design doc §0(c).
//
// PURE: no database, no clock, no request, no crypto.
//
// The 15-minute ceiling is deliberately ABSENT: `createWorkerSessionToken`
// (worker-session-auth.ts:80) asserts it at mint, so a defect trying to issue a longer session
// throws there rather than passing here. iat/exp are likewise absent — they need a clock, and
// this function does not have one. It returns the IDENTITY half; the service stamps the window.
//
// Tenancy is deliberately absent too. The route carries no identifier at all, so cross-tenant
// reach is answered by construction at the authenticator, not by a check here that could drift.

export type SessionRenewalRefusal =
  | "platform_physical_unsupported"
  | "platform_authority_unresolved";

export interface SessionRenewalInput {
  /** `VerifiedTargetPrincipal.organizationId` — null ONLY for a platform PHYSICAL session. */
  readonly principalOrganizationId: string | null;
  /** The WORKER's scope, bound to the row by worker-session-auth.ts:165. */
  readonly principalScope: "platform" | "organization" | "owner";
  /** The TARGET's scope, read from the row at worker-session-auth.ts:177. */
  readonly principalTargetScope: "platform" | "organization" | "owner";
  /** `principal.sharedPlatformAuthority !== undefined` (worker-session-auth.ts:198-205). */
  readonly hasSharedPlatformAuthority: boolean;
  readonly workerId: string;
  readonly targetId: string;
  readonly generation: number;
  readonly deviceThumbprint: string;
  readonly profileHash: string;
}

/**
 * Every renewal refusal is TERMINAL, and that is a decision rather than an omission.
 * `unauthorized` is non-retryable; only `throttled`/`internal_unavailable` may carry
 * retryAfterMs. Unlike the self-model read — where "not configured yet" resolves by itself —
 * both refusals here are structural facts about the caller's identity class that no amount of
 * waiting changes. Making either retryable would put a worker that can never renew into a loop
 * against the control plane. The exhaustiveness test in §7 Step 2 is what enforces it.
 */
export function sessionRenewalRefusalWireCode(_r: SessionRenewalRefusal): "unauthorized" {
  return "unauthorized";
}

export function admitSessionRenewal(input: SessionRenewalInput): SessionRenewalDecision {
  // R1. A platform PHYSICAL identity may not renew here (design §3.5(ii), §9). This USED to be
  //     free: verifyWorkerOperationProof denies it at the transport (worker-operation-proof.ts:50).
  //     The authenticator does NOT — it serves platform physical via the operator DB at
  //     worker-session-auth.ts:180-182 — so the refusal has to be written down.
  //
  //     Narrowing here is what types the mint: `scope` below cannot be "platform".
  if (input.principalOrganizationId === null || input.principalScope === "platform") {
    return refuse("platform_physical_unsupported");
  }
  const scope: "organization" | "owner" = input.principalScope;

  // R2. A SHARED platform target's real device lives in the operator database. The
  //     authenticator only attaches `sharedPlatformAuthority` AFTER proving it
  //     (worker-session-auth.ts:186-205). Absent here means that proof did not run, so refuse
  //     rather than mint on unverified authority.
  if (input.principalTargetScope === "platform" && !input.hasSharedPlatformAuthority) {
    return refuse("platform_authority_unresolved");
  }

  return { admit: true, identity: {
    aud: "device_session",
    sub: input.workerId,
    organizationId: input.principalOrganizationId,
    targetId: input.targetId,
    generation: input.generation,
    scope,
    deviceThumbprint: input.deviceThumbprint,
    profileHash: input.profileHash,
  } };
}
```

## 5. Refusals are coarse on the wire, and two-valued in the log

Every refusal renders `unauthorized` → HTTP 401 via `sendWorkerProtocolError`
(`services/worker-protocol-http.ts:95-103`), the same helper enroll (`worker-control.ts:264-269`)
and the self-model route (`execution-targets.ts:398-400`) use. A caller learns the renewal was
refused, never which invariant it tripped — so the route cannot become an oracle for target
existence, generation or revocation state.

**What the operator log actually carries, stated without inflation.** The draft promised nine
distinct `reasonCode`s. It cannot deliver them any more, and pretending otherwise would be the
worse failure. What ships is:

| Source | Log `reasonCode` | Covers |
|---|---|---|
| `WorkerSessionError.code === "target_revoked"` (`worker-session-auth.ts:48`, thrown at `:163` and `:196`) | `worker_session_renewal_target_revoked` | seven conditions: row absent, target disabled, worker revoked by status, worker revoked by `revokedAt`, owner membership inactive, target generation stale, worker generation stale — **plus** any of nine shared-platform physical clauses |
| `WorkerSessionError.code === "unauthorized"` (every `fail()`) | `worker_session_renewal_unauthorized` | nine conditions: bearer malformed, HMAC/claim-shape/expiry, device proof invalid or outside skew, proof thumbprint ≠ session claim, **proof replayed**, org mismatch, row scope ≠ claim scope, row thumbprint or public key mismatch, profile hash mismatch |
| `admitSessionRenewal` refusal | `worker_session_renewal_platform_physical_unsupported` / `..._platform_authority_unresolved` | exactly one condition each |

So: **two coarse classes plus two precise ones**, not nine and not one. The two-way split is
free — `WorkerSessionError` already carries the code, the route need only read `error.code`
before mapping to the wire — and it is worth having, because "revoked/stale/disabled" and
"credential mismatch" send an operator to genuinely different places. Both still render 401
`unauthorized` on the wire; the split is log-only and stays that way.

A `WorkerSessionError` escaping `createWorkerSessionToken` (the ceiling assertion tripping) is
**not** one of these. It is caught separately and answers `internal_unavailable`, not
`unauthorized` — that is a server defect, not a fact about the caller, and telling a healthy
worker "you are unauthorized" for our bug would stop it permanently. §7 Step 3 pins the
distinction; the route must not catch `WorkerSessionError` in one place for both purposes.

## 6. The service and the route — the decisions inside them

**One authenticator, constructed once per router**, mirroring `requireWorkerHeartbeatAuthority`
(`execution-targets.ts:73-75`) and `createWorkerEnrollmentService` (`worker-control.ts:97-102`):
`createWorkerSessionAuthenticator({ appDb, operatorDb, sessionSigningKey, now })` — all four
already on `workerControlRoutes`' opts (`worker-control.ts:84-94`, `now` at `:91`).

**The route calls the authenticator DIRECTLY, not `requireWorkerHeartbeatAuthority`.** That
middleware is module-private to `execution-targets.ts`, and — more to the point — it admits a
**second, weaker credential**: a legacy bearer worker token resolved by
`resolveWorkerHeartbeatAuthority` (`:86-95`), which the self-model route then has to refuse by
hand (`execution-targets.ts:406-409`, and again inside `admitSelfModelRead` at
`worker-self-model-admission.ts:91`). A route whose product is a **freshly minted device
session** must never be reachable by the credential class that predates device proofs. Going
straight to the authenticator makes that true by construction instead of by a guard — one fewer
refusal to write, and one fewer to forget.

**Set `res.locals.workerProtocolV1 = true` at the top of the handler.** `requireWorkerHeartbeatAuthority`
does it at `:77` and it is not decoration: `isEnrollmentWorkerControlPath`
(`worker-protocol-http.ts:135-137`) matches **only** `/worker-control/enroll`, so without the
flag an error escaping this handler renders the generic AoA error shape instead of the worker
protocol envelope (`error-handler.ts:34-48`). One line; it makes the fallthrough shape correct
even for a defect nobody predicted.

**`WORKER_SESSION_RENEWAL_TTL_MS = SESSION_MAX_MS`.** Not a second constant; binding them makes
the agreement structural instead of coincidental.

**`sessionRenewRequestSchema`** = `{protocolVersion: 1, audience: "device_session", correlationId: uuid}`,
`.strict()`. `correlationId` is a UUID because `workerProtocolErrorV1` only echoes a UUID
(`worker-protocol-http.ts:20-27`); a looser type would silently drop it from refusals. The parsed
`correlationId` is what the route hands the authenticator, exactly as poll does at
`worker-control.ts:301` — the proof signs it, so it cannot be a second, unsigned identity source.

**`SESSION_RENEW_DESCRIPTOR`** — a **local** descriptor shaped like `OperationDescriptorV1`, the
same choice DAT-008 made at `execution-secret-resolve.ts:78-85` and for the same reason, spelled
out in its docblock at `:74-76`: `WORKER_PROTOCOL_OPERATIONS` is a closed list of ten and E4-D02
forbids extending it, but a route with no descriptor silently has no size ceiling, no timeout and
no audience declaration. `maxRequestBytes: 2 * 1024` (a version, an audience literal, one UUID —
larger is not one of ours), `timeoutMs: 10_000`, audience `device_session`.

**No second transaction, and no second read.** The authenticator's own `runInTenant`
(`worker-session-auth.ts:184-185`) and its post-transaction operator read (`:187-189`) are the
whole database interaction. The draft added a `findSessionAuthority` of its own on top; that is
gone. The shape at `:180-206` — operator read strictly **after** the tenant transaction closes,
never nested — is the shipped answer to "acquiring a second pool connection while holding a
tenant transaction open is how a pool-exhaustion deadlock is built", and this route inherits it
rather than re-deciding it.

**Identity from the DECISION; `iat`/`exp` from the service clock.** `iat = floor(now/1000)`,
`exp = floor((now + SESSION_MAX_MS)/1000)`. The identity fields are whatever
`admitSessionRenewal` returned, which is the principal, which — per §4.1 — the authenticator
proved equal to the authority row.

**Renewal headroom is an invariant, not a preference.** Per §3.5(i), a renewal performed within
five minutes of the presented session's expiry leaves its own device proof replayable after the
replay row is swept. The server cannot enforce headroom without either changing shared middleware
or reading `claims.iat`/`exp` a second time; **slice 2 owns it**, and §9 pins it there as a
delivered requirement rather than a scheduling detail.

**Response** sets `WORKER_CONTROL_HEADERS.session` (the same header enrollment uses at
`worker-control.ts:242`) so the daemon transport reads a renewed session exactly as it reads an
enrolled one, plus `{protocolVersion: 1, outcome: "renewed", expiresAt, deviceGeneration, serverTime}`.

**Size check BEFORE the credential read**, matching the nine operation handlers (e.g. poll at
`worker-control.ts:286-289` ahead of `:290-293`): an oversized body is refused structurally, not
as an identity decision.

## 7. Implementation — bite-sized RED/GREEN steps

Every step: write the failing test → **run it and watch it fail for the stated reason** → minimal
implementation → run it and watch it pass → commit. *A step whose RED does not fail for the
reason written down is a step that proved nothing; stop and find out why.*

```bash
pnpm --filter @armyofagents/server test:run -- src/__tests__/worker-session-renewal-admission.test.ts
pnpm --filter @armyofagents/server test:run -- src/__tests__/worker-session-renewal.integration.test.ts
pnpm --filter @armyofagents/server test:run -- src/__tests__/desktop-disabled.negative.test.ts
pnpm --filter @armyofagents/server typecheck && pnpm --filter @armyofagents/server build
node scripts/check-guard-inventory.mjs && node scripts/check-test-inventory.mjs
node scripts/check-finding-ownership.mjs
```

`scripts/test-inventory.json` records `server` in **floor** mode at 1467
(`scripts/test-inventory.json:63-66`), so adding server tests needs no manifest bump.

`check-worker-path-parity.mjs` is worth running but proves nothing for this ticket: its `PAIRS`
list (`:26-35`) contains only the WRK-008 self-model pair until slice 2 adds ours. It becomes
load-bearing then, not now. **`check-worker-protocol-boundary.mjs` is NOT in this list** — it
validates the import graph of `packages/worker-protocol` only (`:1-28`), which this ticket does
not touch. The draft listed it; running a checker that cannot fail for your change is the
"green means nothing" pattern this programme has already been bitten by four times.

### ★ Step 1 — RED: the POSITIVE CONTROL, first

The suite **opens** with a positive control, and the reason is written into the file:

> E1-F008 found FIVE placement guards whose own named tests still PASSED with the guard deleted:
> every override-based fixture was refusing earlier, for an unrelated reason, and each test
> asserted a bare `toBe(false)` and got it from the wrong refusal. **A refusal suite with no
> positive control cannot tell "correctly refused" from "never got there".**

Two rules follow, enforced by construction: **(1)** the shared `input()` fixture is asserted to
**ADMIT** before any refusal case is built on it; **(2)** every refusal case asserts the
**specific reason**, never a bare `admit: false`.

Cases: an **organization**-scope principal admits with `scope: "organization"` in the identity;
an **owner**-scope principal admits with `scope: "owner"`; a **shared platform** target
(`principalTargetScope: "platform"`, org-scoped worker) with `hasSharedPlatformAuthority: true`
admits.

**GREEN:** create the module with types and a body of `return { admit: true, identity: {...} }`.
**Commit:** `WRK-010: pure session-renewal admission skeleton with a positive control`.

### Step 2 — the two guards + the wire mapping

R1: `principalOrganizationId: null` → `platform_physical_unsupported`; `principalScope:
"platform"` → same. R2: `principalTargetScope: "platform"` with `hasSharedPlatformAuthority:
false` → `platform_authority_unresolved`. **Anti-vacuity:** `hasSharedPlatformAuthority: false`
is IGNORED for a non-platform target — a guard that fired for every target would pass the case
above and break every organization-scoped worker in production. Plus the exhaustiveness test:
every refusal in the union maps to `unauthorized`.

This is the whole unit matrix. It is small because §3.4 is true; §10 R6 records what that costs.

### Step 3 — the service, and the ceiling that is not this ticket's to change

`WORKER_SESSION_RENEWAL_TTL_MS === SESSION_MAX_MS === 15 * 60_000`. **★ A renewal that tried to
exceed the ceiling is refused BY THE MINT HELPER** — `createWorkerSessionToken` throws
`WorkerSessionError` at `exp = iat + 901` and does not at `+900` (`worker-session-auth.ts:80`,
where `900 * 1000 > 900_000` is false and `901 * 1000 > 900_000` is true). The falsifiable claim
is that a longer session cannot be issued *at all, by anyone*.

Also here: a `WorkerSessionError` from the **mint** must answer `internal_unavailable`, while one
from the **authenticator** answers `unauthorized`. Same class, opposite handling — so the test
that pins it must construct both, or the route's single `catch (err instanceof
WorkerSessionError)` will look correct while collapsing them.

Plus: the descriptor's `maxRequestBytes` is **strictly below** `WORKER_CONTROL_BODY_LIMIT_BYTES`
— with mount == contract, express refuses first, the handler's guard stays dead, and the refusal
keeps the wrong (non-protocol) shape. The parity assertion goes next to the existing loop in
`worker-control-body-limits.test.ts:23-39`, which iterates `WORKER_PROTOCOL_OPERATIONS` and
therefore cannot see a local descriptor.

### ★ Step 4 — the route, and dormancy proved STRUCTURALLY

**The draft's dormancy test was vacuous and is replaced.** It built an express app, declined to
mount `workerControlRoutes`, and asserted a 404 — which proves that express 404s a router you
chose not to mount. It could not do better: `createApp` does not pass `now`
(`app.ts:497-505` has no such field), so an integration harness that needs a controllable clock
must hand-mount the router, and a hand-mounted router says nothing about `app.ts`.

**Use the house pattern instead** — the source scan in
`server/src/__tests__/desktop-disabled.negative.test.ts`: `flagBlocks` (`:82-93`) enumerates every
`if (opts.distributedExecutionEnabled) {` block, and `mountedInsideAFlagBlock` (`:102-113`)
asserts that **every** occurrence of a needle sits inside one. `workerControlRoutes(` is already
asserted this way at `:233`; the new clause asserts the same for the renewal route's own
registration string, so a future edit that mounts it outside the flag fails a named test. Note
the file's two standing traps, both documented in place: `readSource` normalises CRLF (`:62-63`),
and the enumeration exists because a first-occurrence scan silently measured the wrong block once
already (`:70-81`).

**The "malformed body" variant is DROPPED.** If it meant invalid JSON, the assertion is simply
false: `app.use(express.json({ verify: captureRawBody }))` at `app.ts:385` is mounted
**unconditionally**, ahead of route matching, so unparseable JSON on a flag-off deployment is a
**400 from the body parser**, not a 404 — for this path and every other. Keeping it would have
been a test that fails for a true reason and gets "fixed" by weakening the assertion.

Route behaviour itself (headers present, schema, descriptor size gate, the deny mapping) is
covered by Step 5 against a real database, because everything upstream of the decision now needs
a real authenticator to reach.

### ★ Step 5 — the embedded-PostgreSQL integration test (the whole point, and now the whole matrix)

Harness copied from `worker-enrollment.integration.test.ts` — `beforeAll` at `:197-247`, and the
`deviceProof` signer at `:173-194`, which already takes `proofNow` (`:178`) and needs only
generalising from its hard-coded `"/api/worker-control/enroll"` (`:184`) to a path parameter.
**Do NOT reuse `helpers/job-control-fixture.ts`**: its worker row carries
`device_public_key: 'job-006-public-key'` (`:207`), not a real ed25519 SPKI, so a genuine proof
could never match. This suite enrols a **real** keypair through the **real** enroll route — which
is also what makes the code-route lapse real rather than mocked. One mutable `let clock = NOW`
passed as `now: () => clock` so `CODE_TTL_MS`, `SESSION_TTL_MS`, `verifyWorkerSessionToken` and
`verifyDeviceProof` all move together.

**★ THE POINT: renews AFTER the ten-minute code route has lapsed.**

* **★ POSITIVE CONTROL FOR THE PRECONDITION — a PAIR, not a single 401.** The draft replayed the
  T0 enrollment at T0+11min and read the 401 as "the code route lapsed". It does not prove that:
  `verifyDeviceProof` runs at `services/worker-enrollment.ts:277-284`, **before** the code-route read at
  `:289-294` and its expiry test at `:295`, and `DEFAULT_MAX_SKEW_MS` is **five** minutes
  (`worker-device-proof.ts:4`, enforced `:74`). A T0 proof replayed at T0+11min dies on SKEW and
  the code table is never touched. So both halves mint a **FRESH** proof at the current clock
  (`deviceProof(body, priv, pub, freshProofId, new Date(clock))` — a new `proofId` each time, or
  the replay table refuses it for an unrelated reason), and the control is a **pair**:
  - **T0+4min**, same code, fresh proof → **200** with a session header. The code route is alive
    and the replay path works. *(This is also the anti-vacuity half: without it, a code route
    that never worked at all would satisfy the T0+11min assertion.)*
  - **T0+11min**, same code, fresh proof → **401**. The code route has lapsed.
  Only the pair isolates `CODE_TTL_MS`.
* Then, still at T0+11min: renew with a live session + a fresh proof and **no code header**.
  Assert `s1 !== s0`, `exp - iat === 900`, `iat` and `exp` both greater than `s0`'s, generation
  and thumbprint preserved. **★ POSITIVE CONTROL FOR THE PRODUCT:** a token that parses is not a
  token that WORKS — spend `s1` on a real worker route and get a **200**. Name it rather than
  leaving it to the implementer: `POST /worker-control/poll`, which answers 200 with
  `outcome: "no_work"` when the queue is empty (`packages/worker-protocol/src/transport.ts:238`,
  `:243`) — a real authority check with no fixture setup beyond what is already here. Note it
  routes through `verifyWorkerOperationProof`, not the authenticator, which is exactly why it is
  a good control: it proves the minted token satisfies the **other** verifier too.

**★ SUSTAINS authority past the original session's hard expiry.** At T0+20min renew again *from
the renewed session* and get a third. (The draft also asserted "the dead `s0` stays dead"; that
is demoted — see §8.)

**★ POSITIVE CONTROL: the SAME request is refused once the target is revoked.** Because the
identical shape succeeded above, the 401 is attributable to the revocation and not a broken
fixture. Assert the envelope names no target, worker, generation or reason.

**The authority matrix, which now lives HERE and only here** (§10 R6). Each case renews through
the real route and asserts 401 plus the operator-log class from §5:

* target `disabled` → `target_revoked` class.
* worker revoked by `status`; worker revoked by `revoked_at` alone — two independent columns
  (`worker-session-auth.ts:160-161`).
* owner-scope worker whose organization membership is set inactive → `target_revoked` class.
* target generation moved ahead; moved behind; worker row's generation moved while the target's
  did not — three-way agreement, both directions (`:162`).
* **row key rotated:** update `workers.device_public_key` to a different real SPKI while session
  and proof stay mutually consistent → refused at `:167`, `unauthorized` class. This is the case
  that distinguishes "the proof matches the TOKEN" from "the proof matches the ROW".
* **a proof signed by a foreign key** → refused at `worker-session-auth.ts:141`, before the
  tenant transaction opens. *(The draft labelled this "guard 2" and mapped it to the decision
  function; under either design it never reaches a decision function — `verifyWorkerOperationProof`
  refuses the same thing at `worker-operation-proof.ts:59`. It is a transport refusal and is
  labelled as one; §8 drops the corresponding acceptance row.)*
* **proof outside the skew window**, with an **anti-vacuity 4-minute case that must still
  succeed** — otherwise "outside the window is refused" is satisfied by a proof path that never
  accepts anything.
* **replayed `proofId`** → refused at `:155`, `unauthorized` class. Pair it with a fresh
  `proofId` at the same clock that succeeds.
* **★ draining and offline still RENEW** (§4.3) — the over-strict direction is the real bug, and
  with the guard living in shared middleware this integration pair is the only evidence
  available. Label it as such in the test file so nobody later reads it as mutation-proven.
* **platform PHYSICAL session is refused** (`platform_physical_unsupported`) — the guard §3.5(ii)
  says the authenticator no longer gives us for free. Enrol a platform physical identity through
  the real route, present its session, assert 401.
* **shared-platform TENANT worker renews** — the positive control for R2's other arm, and the
  case that proves R1 did not accidentally refuse every platform-associated target.

**★ never consults the enrollment code table:** delete every code and route row, then renew →
200. The acceptance clause made mechanical rather than argued.

### Step 6 — the mutation sweep

Not optional and not a formality: **for every guard, flip it, run the named test, watch it die,
restore.** The matrix is far smaller than the draft's "30+", because §3.4 is true — the guards it
would have covered are shipped middleware with their own suites, and mutating them would kill
unrelated tests without saying anything about this route. What this ticket owns:

* R1, both arms (`organizationId === null`; `scope === "platform"`) — note the second arm is
  expected to be **equivalent** (pinned at `worker-session-auth.ts:69`); declare it, do not
  report a kill.
* R2, and R2's target-scope condition (a mutant firing R2 for every target must be killed by the
  organization-scope positive control).
* The narrowed `scope` in the returned identity.
* `WORKER_SESSION_RENEWAL_TTL_MS` (`SESSION_MAX_MS` → `SESSION_MAX_MS + 1000` must die at the
  mint helper).
* The `internal_unavailable` / `unauthorized` split in the route's `WorkerSessionError` handling.
* The descriptor's `maxRequestBytes`.

**★ Documented EQUIVALENT mutants — declared, not claimed as killed.** The draft declared one.
By its own reasoning there are **six**, and reporting kills for any of them would be a false
kill. Every field the decision function copies out of `VerifiedTargetPrincipal` was already
proved equal to the authority row by the authenticator (§4.1), so substituting the other source
cannot change an observable outcome:

| Mutant | Survives because |
|---|---|
| `generation: input.generation` → the row's `targetDeviceGeneration` | `worker-session-auth.ts:162` proved them equal, in both directions and for both rows |
| `sub: input.workerId` → the row's worker id | `findSessionAuthority` is keyed by it (`tenant/worker-enrollment.ts:366`) |
| `targetId: input.targetId` → the row's target id | keyed by it too (`tenant/worker-enrollment.ts:367`) |
| `profileHash` → the row's | `:167` proved them equal |
| `deviceThumbprint` → the row's | `:166` proved them equal (and `:141` chained it to the proof) |
| `scope` → the row's `worker.scope` | `:165` proved them equal — **note this one is only equivalent because the authenticator's scope check is the strong one** (§3.4); it would NOT have been equivalent under the draft's weaker `∈ {organization, owner}` test |

The precedent is `E1-F008`'s "6 of 9 die; the other 3 are documented equivalents". Say so in the
result rather than inflating the kill count.

### Step 7 — docs

E4-F007 → `resolved`, naming the option taken as **(c), amended: proof PLUS a live session**, and
why the finding's literal "proof-only" wording was not implemented (§2.1) and why (a)/(b) were
not. `scripts/finding-ownership.json` → `owned`, ticket `WRK-010`, and delete the sentence
claiming `IdentityLifecycle.acquireSession()` "already landed as the drop-in seam" — leaving it
there while resolving the finding would propagate the false fact one more hop
(`check-finding-ownership.mjs` verifies the ticket exists; it cannot verify the prose).

**New finding (LOW):** DSK-001's `IdentityLifecycle.acquireSession()` claim has no code behind it
(§0a) — the fourth time this programme has found a documented fact that no code backs.

Result doc per the template, and it must carry §0(c) explicitly: *the first design of this ticket
would have shipped a duplicate authority surface, and an adversarial review caught it before
code.* A result doc that only describes what shipped loses the finding.

A status line in the blocker record — **do not rewrite it**; it is a dated record.

## 8. Acceptance mapping

| Acceptance clause | Test |
|---|---|
| valid device proof → fresh session, no code, no human | integration `★ THE POINT` |
| revoked target refused, same coarse code | integration `★ POSITIVE CONTROL: refused once revoked` + the two revocation-column cases |
| disabled target refused, same coarse code | integration `refuses a DISABLED target` |
| generation-superseded refused, same coarse code | integration ahead / behind / worker-row-only |
| not mounted when distributed execution is off | `desktop-disabled.negative.test.ts` source scan — `mountedInsideAFlagBlock` |
| the ten-minute code route is never consulted | integration `★ never consults the enrollment code table` |
| the 15-minute ceiling is unchanged | Step 3 + integration `exp - iat === 900` |
| renewal issues a NEW session, not an extension | integration `iat >`, `s1 !== s0` |
| platform PHYSICAL renewal is refused (§9 non-goal, enforced not inherited) | unit R1 + integration `platform physical is refused` |
| **Test:** unit admission matrix | R1 (both arms), R2, the anti-vacuity non-platform case, exhaustiveness |
| **Test:** embedded-PG proof mints after the code route lapsed | the integration suite, with the **paired** precondition control |
| **Test:** positive control proving the same proof is refused once revoked | two `★ POSITIVE CONTROL` cases + the paired precondition control |

**Demoted, not deleted — "the DEAD `s0` stays dead".** The draft mapped it to "renewal issues a
new session, not an extension". It cannot serve as evidence for that or anything else: `s0`'s
expiry is asserted by `verifyWorkerSessionToken` (`worker-session-auth.ts:100`) against a clock
this route never touches, and **no mutation of any code this ticket writes can make it pass or
fail.** An assertion no mutant can move is not coverage. It stays in the suite as a cheap
regression net against a future change to the mint or the verifier, labelled as such, and it
backs no acceptance clause.

**Removed — "foreign key (guard 2)".** The draft's acceptance mapping counted a decision-function
guard for a condition refused at the transport (`worker-session-auth.ts:141` in this design,
`worker-operation-proof.ts:59` in the draft's). The integration case stays (Step 5) and is
labelled a transport refusal; the guard-2 acceptance row is gone.

## 9. Non-goals, named with owners

| Not delivered | Owner | Why |
|---|---|---|
| **The daemon client** — `SESSION_RENEW_PATH`, `renewSession()` on the transport, wiring `SessionStoreDeps.renew` (`identity/session.ts:55`) to it in place of the enroll replay, and a near-expiry schedule | **WRK-010 slice 2** | The acceptance is entirely server-side, and E4 already splits this way (WRK-008 1/2). Slice 2 must also add the `PAIRS` entry in `check-worker-path-parity.mjs` and bump `packages/worker-daemon` in `test-inventory.json` (**pinned**). Until it lands, this route exists and nothing calls it — which is the rollback unit. |
| **Renewal HEADROOM ≥ 5 minutes before the presented session's expiry** | **WRK-010 slice 2 — a requirement, not a preference** | §3.5(i): the authenticator expires the proof-replay row with the PRESENTED session (`worker-session-auth.ts:153`), so a renewal inside the last five minutes leaves its own proof replayable for up to ~4.9 min after the row is swept. The ⅔-TTL cadence satisfies it with margin; slice 2 must state the bound and test it, not merely happen to meet it. |
| **Renewal for a platform PHYSICAL session** | follow-up / DEP-00x | Its authority lives behind `acquirePlatformTargetAuthorityExclusive`, a materially different transaction shape. **This is now an enforced refusal (guard R1), not an inherited one** — §3.5(ii). Shared-platform TENANT workers **are** covered. |
| **Resurrecting a fully expired session** | not planned | §2.1. |
| **Any change to enrollment, `CODE_TTL_MS`, or the shared authenticator's behaviour** | — | Untouched on purpose. The bug was never that the code expires; it was that nothing else could mint. The middleware diff is one `export` keyword. |
| **Rate limiting the renewal route** | **DEP-009 follow-up — and the shape matters** | Named so it is a decision rather than an oversight, but the draft's reasoning ("an attacker who can call it already holds a live session") understated the cost, so record it properly: **every attempt runs a WRITE transaction before any decision is reached** — `cleanupExpiredProofs` issues a `SELECT … LIMIT 100` plus a `DELETE … RETURNING` (`tenant/worker-enrollment.ts:385-397`), and `recordProof` issues a `DELETE` plus an `INSERT … ON CONFLICT DO NOTHING` (`tenant/worker-enrollment.ts:251-261`). That is reachable by **any** holder of a live session, at any rate, on a route with **no** limiter — contrast `poll`, which admits through the shared per-org DB counter *before* touching authority (`worker-control.ts:304-312`). DEP-009 should therefore treat this as a **pre-authority admission** problem shaped like poll's, not as a per-worker call-frequency cap applied after the fact. |

## 10. Risks

**R1 — proof burn on a refused renewal.** `recordProof` runs before any authority decision
(`worker-session-auth.ts:148`), so a refused renewal has already spent its `proofId`. Every
worker operation behaves this way. Slice 2 must generate a fresh `proofId` per attempt; if it
retries with the same one, the retry dies as a replay and reads as a revocation.

**R2 — the renewal window is the daemon's to respect.** No grace past `exp`. Slice 2 renews at
~⅔ TTL, and `SessionStore.ensureFresh` (`identity/session.ts:103-107`) currently refreshes only
when **already** expired — that needs a near-expiry threshold, and its docblock at `:1-12` (which
states as fact that no sustained renewal exists) needs rewriting.

**R3 — the path is frozen at merge.** §3.3. Between now and slice 2 it is protected by that
sentence and nothing else.

**R4 — refusals collapse to two operator classes, not nine.** §5 states exactly what survives.
`worker.session.renewal_denied` and its `reasonCode` are load-bearing operational surface, not
debug noise, and they belong in the runbook — but the runbook must say what the two classes
actually cover, because `target_revoked` spans seven conditions plus nine platform clauses. If a
real incident shows that is not enough to diagnose from, the follow-up is the shared
authenticator's error taxonomy (§4.4), not a second authority surface here.

**★ R5 — this ticket ends the unconditional 15-minute decay of stolen authority, and §2.1's
security argument does not survive that.** §2.1 rejects proof-only renewal partly on the grounds
that it would turn the device key into a bearer credential. Rolling renewal reaches the **same
end state after one bootstrap capture**: an attacker holding a live session *and* the device key
renews indefinitely, and worker sessions are stateless HMAC JWTs with **no `jti`**
(`assertClaims` fixes the key set at `worker-session-auth.ts:62`) and **no denylist** — nothing
can revoke an individual token. Today authority decays in 15 minutes no matter what. After this
ticket it does not.

Stated fairly, in both directions:
* the attacker needs the **device private key**, which lives in the host keystore — a capture
  implies host compromise, at which point they can run the daemon anyway;
* revocation still bites, and quickly: **every renewal re-reads the authority row**, so revoking
  the worker or target, or bumping the device generation, refuses the next renewal and expires
  the attacker's authority within at most one session lifetime (§3.4 guards 5/6/8);
* what is genuinely lost is the *unconditional* bound — before, an operator who noticed nothing
  still got safety in 15 minutes; after, safety requires someone to act.

That is a real trade and it is the right one (a platform whose workers die every 15 minutes is
not a platform), but it must be **written down where the threat model lives**, not left implicit
in a rejected alternative. The mitigation to carry into the runbook: revocation is now the only
bound, so revocation latency is a security property.

**★ R6 — guard coverage MOVES from unit to integration, and that is slower and thinner.** The
draft's ten-guard matrix ran in the plain unit tier: fast, hermetic, mutation-testable, green on
every platform. Adopting the authenticator (correctly) means those guards are shipped middleware,
and the only way to exercise them **through this route** is the embedded-PostgreSQL suite — which
is slower, and which `describe.skipIf(win32 && !AOA_RUN_WIN_INTEGRATION)` skips on a Windows
developer's machine by default (the pattern `worker-control-body-limits.test.ts:18-21` warns
about). The trade is still right — a duplicate authority surface is worse than a slower suite —
but the cost is real: **a Windows-local `pnpm test` will not run the authority matrix at all.**
Mitigation: the unit tier keeps the two guards this ticket owns plus the exhaustiveness test, and
the integration file's header says in one sentence that it is the sole home of the authority
matrix, so a future author does not delete a case thinking it is covered elsewhere.

**R7 — the replay-row expiry divergence is closed by cadence, not by code.** §3.5(i). The window
is zero at the intended ⅔-TTL cadence and up to ~4.9 minutes at the worst legal cadence. Nothing
server-side enforces it; §9 pins it on slice 2 as a requirement. If slice 2 cannot guarantee it,
the alternative is a change to `worker-session-auth.ts:153` with its own review — not silence.

**R8 — two of guard 4's arms are tautological, and are not counted as coverage.**
`authority.workerId !== principalWorkerId` and `authority.targetId !== principalTargetId` cannot
fail in production: `findSessionAuthority` is keyed by exactly those two columns
(`tenant/worker-enrollment.ts:365-368`) and the query runs inside `runInTenant`, where `workers` is
under FORCE RLS (`migrations/0211_tenant_rls_enforcement.sql:50-56`). The authenticator does not
write them and neither does this design. Recorded because the draft listed them among ten guards
and would have reported unit cases for them as coverage of a reachable failure. Defence in depth
is a legitimate reason to write a check; it is not a reason to count it.

## 11. Rollback

Delete the route registration in `worker-control.ts`. The services and their tests are inert
without it; nothing calls the route until slice 2; there is no migration, no table and no data to
unwind. Reverting `export` on `SESSION_MAX_MS` is optional and changes no behaviour. Reverting
the `finding-ownership.json` and `findings.md` edits is a docs-only revert, and
`check-finding-ownership.mjs` will fail loudly if the ticket is removed while the finding still
claims it — which is the correct failure.
