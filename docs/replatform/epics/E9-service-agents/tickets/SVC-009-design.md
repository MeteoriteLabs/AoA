# SVC-009 — re-mint the run's effect authority on lease renewal (E9-F002 option b) — DESIGN

**Epic:** E9 · **Lane:** B · **Base:** `77f4bf98b` · **Owns:** the residual of **E9-F002** (the never-re-minted 240-second effect-authority ceiling) after the founder ruled **option (b)** in `docs/replatform/DECISION-REQUEST-e9-f002-service-run-ceiling.md`.

> **Why a NEW ticket number rather than SVC-003.** E9-F002 §1.6 and the decision paper name **SVC-003** (Long-session lease and health semantics → *bounded lease renewal*) as the natural inheritor. But SVC-003 shipped incrementally as SVC-003a/SVC-003b, both of which have `-result.md` files on disk — so `scripts/check-finding-ownership.mjs` `findCompletedTicketIds` (regex `/^([A-Z]+-\d+).*-result\.md$/`) resolves `SVC-003a-result.md` → `SVC-003` into the **completed** set, and naming SVC-003 as E9-F002's `successor` fails `successor_already_complete`. No new `SVC-003x` ticket can undo that (any `SVC-003*-result.md` keeps SVC-003 "completed"). So this residual is carved into a **distinct, open** number. SVC-003a-design.md §8.7's claim that "SVC-003 now has a file, so the guard's existence bar no longer blocks naming it as a successor" saw the existence half and missed the `successor_already_complete` half.

---

## 1. The finding this owns, stated as the mechanism

E9-F002: a `service` (and any long batch) run is capped at **~240 s** because the control-plane-minted, Ed25519-signed `OwnedLabelsCapability` — which gates a networked `create` at the adapter-manager and whose expiry drives the worker's teardown window — is minted **once** on the secret-resolve route (`server/src/services/secret-broker.ts` → `applyOwnedLabelsCapability`) with a 5-minute lease-clamped TTL, and is **never re-minted on renewal**. Past its TTL the worker cannot tear its own sandbox down and leaves a billable orphan, so the run-op-deadline sits one teardown-headroom under the cap window: `RUN_OP_DEADLINE_CEILING_MS = OWNED_LABELS_CAPABILITY_TTL_MS − RUN_TEARDOWN_HEADROOM_MS = 240 s` (`packages/worker-daemon/src/lifecycle/run-op-deadline.ts:45-46`).

**Ruled fix — option (b):** re-issue the capability on the already-shipped renewal path (`POST /worker-control/leases/:leaseId/renew`, `worker-control.ts:516` → `createJobLeaseRenewalService.renew`, `job-fencing.ts`). The cap is *already* lease-clamped (`min(now + TTL, leaseDeadline)`), and this path already re-verifies the fence and extends the lease, so refreshing the cap here costs **nothing new in blast radius** — unlike the rejected option (a) (re-resolve secrets on a timer, 1→N materialization). It also repairs the identical long-batch orphan.

---

## 2. Delivery mechanism — verified frozen-wire-CLEAN

The renew reply (`leaseRenewOperationResponseV1Schema`, `transport.ts:292`) is `.strict()` + `forbiddenKeyRefine` — a frozen op response. A new top-level `ownedLabelsCapability` field would be a **Protocol Custodian STOP**. It is not needed: the reply `body` (`leaseRenewResponseV1Schema`, `job.ts:452`) already carries `extensions: optionalExtensions`, the **bounded namespaced extension container** (`extensions.ts`). A `critical: false` extension under a fresh reverse-DNS namespace is *safe additive data* — an older worker **ignores** an unknown non-critical extension; only unknown `critical: true` fails closed.

Verified the signed capability rides it cleanly:
- **Keys:** `{v, audience, ownedLabels{organizationId,targetId,workerId,jobId,attempt,leaseId,deviceGeneration}, expiresAt, signature}` — NONE normalize into `FORBIDDEN_WIRE_KEYS` (`wire-safety.ts:18`); `signature`→`signature`, `audience`→`audience` are not members.
- **Structure:** all numbers finite integers (`expiresAt` ms-epoch, `attempt`/`deviceGeneration` small ints), `signature` base64url — canonicalizable via the RFC-8785 subset; well under the 16 KiB per-value and 64 KiB combined budgets.
- **Namespace** `aoa.dev/owned-labels-capability` matches the container's reverse-DNS regex and ≤100 UTF-8 bytes.

So the cap is delivered under `body.extensions[]` with **no wire change**.

---

## 3. What SVC-009 slice 1 (b1) delivers, and what stays open

**b1 — SHIPPED (this design's first slice): the SERVER re-mint + delivery, INERT.** `createJobLeaseRenewalService` gains an optional `controlPlaneSigningKey` (the same composition-root key the resolve route already receives, wired at `worker-control.ts`). On a fresh (non-replay) renewal it mints a capability over the renew's already-resolved `renewFence` identity + the DB clock + the **new** lease deadline, and appends it to `body.extensions[]`. **INERT** on two counts, exactly like DEP-011 Slice 1's mint: (a) absent a signing key (the default today) the reply is byte-identical to pre-E9-F002; (b) no worker consumes the extension yet.

**b2 — NOT built here: the WORKER consumption + teardown-window recompute.** `resolveRunOpDeadlineMs` (`run-op-deadline.ts:84-91`) computes the deadline from **constants** (the service arm returns `Math.max(floor, ceiling)` = 240 s), set once at run start — it never reads the held capability's expiry. b2 must (i) read the re-minted capability from the renew reply's extensions[] (vendoring `OWNED_LABELS_CAPABILITY_EXTENSION_NAMESPACE` across the E4-D01 boundary, like `PROVIDER_AUTH_ENV_TARGETS`), and (ii) extend the run's teardown window to the **new** cap expiry − headroom rather than the stale one.

**Replay path:** a lost-response renew retry returns the stored `prior.outcome` body, which carries no fresh cap. This is benign: renewals are periodic, so the next one delivers a cap. Recorded, not papered over.

---

## 4. ★ Re-mint ALONE does not lift the observable ceiling — the sequencing the ruling carries

Per the decision paper's **Rider** (§2), which the founder accepted with the ruling: re-mint is the **first** wall, not the only one. The service run-op deadline (= the E2B sandbox TTL at `create`) is **240 s**, and the E2B sandbox TTL is **fixed at create with no extension operation** (§9.4, `e2b-provider.ts:419`). So even with a re-minted cap and a recomputed teardown window, the sandbox still dies at its create-time TTL. Lifting the observable ceiling additionally needs a longer create-time deadline (§9.2/§3.3 — a runtime field the worker side of the wire does not carry today) and a sandbox-TTL-extension primitive (§9.4) — **both owned outside E9**. Therefore:

**E9-F002 CANNOT be closed by SVC-009 alone.** Its close criterion — *"a service run observed past 240 s"* — requires §9.4 too. SVC-009 lays the **necessary** effect-authority half; the finding stays `open` until the sandbox-TTL walls also fall. This is not a defect in the ruling — the Rider says exactly this — but it means SVC-009's b2 should sequence **with** the §9.4 work, since in isolation neither changes an observed service duration.

---

## 5. Acceptance (for the whole ticket, across b1+b2)

- **b1:** with a test signing key injected, a fresh renewal's reply carries EXACTLY one `aoa.dev/owned-labels-capability` non-critical extension whose signed `expiresAt = min(authorityNow + TTL, newLeaseDeadline)` and whose `ownedLabels` equal the renew fence's 7-field tuple; absent a key the reply is byte-identical (no extension). The replay path adds no cap. Mutation: dropping the mint, or minting over the OLD deadline, reds a named case.
- **b2:** a run whose lease renews past the initial 240 s recomputes its teardown deadline from the re-minted cap; a mutant that ignores the renewed cap reds it. (Gated with §9.4 for an end-to-end "service past 240 s".)
- **On close of E9-F002:** flip `findings.md` Status + DELETE the `scripts/finding-ownership.json` E9-F002 key in the SAME commit, only when a service run is observed past 240 s (b1 + b2 + §9.4).

---

## 6. Records touched

- `scripts/finding-ownership.json` E9-F002: `unowned` → `owned`, `ticket: SVC-008` (the shipped owner), `successor: SVC-009` (this ticket, open on disk), with `ownerStillOpen` recording that the residual is the re-mint and that closing also needs §9.4. This is the E11-F002-shaped "owner shipped, successor named, finding stays open" entry the guard's calibration allows.
- The two stale records the decision paper §6 flagged (`server/src/index.ts:1463-1469` SVC-002 reconciler premise; the "SVC-003 missing" framing) are **not** touched here — they are their own follow-up.
