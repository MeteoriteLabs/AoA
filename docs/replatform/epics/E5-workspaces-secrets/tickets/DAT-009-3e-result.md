# DAT-009-3e Result: the networked-lane export route, and `E5-F002` at the cause

**Status:** `complete` (set 2026-09-23 by the M1 review-batch-3B independent reviewer at attempt 1, revision `60aafb32ec6f8316f92079789cf8814f981f3ed3`)
**Date (UTC):** `2026-09-21`
**Epic:** `E5-workspaces-secrets`
**Plan task:** `E5 implementation-plan DAT-009-3e — the networked-lane export route, and E5-F002 at the cause (M, M1b)`
**Implementer:** `DAT-009-3e build session (Claude Opus 5)`
**Start SHA:** `cec1b48a796f177c6184884dc3c5043f5aa57ea8` (`docs/replatform-program` tip, the `3c` merge)
**Reviewed revision (the code commits):** `b853ff0ffae57966241a7d123df9675eea84dade` (the wire route) + `8849a12066188c79393aa509fbada49d2e6d1328` (the `E5-F002` fix) + `d5e6a3612cd73cca3f6874baefa357a40a1d2e3d` (the Codex P1 grant-binding fix, §1 commit 3) + `ddfa0e61e57214aebda1d8d70b1337b0a7112799` (the second-round Codex P1/P2 fix, §1 commit 4) + `ffd0c65d44e38de2e0367d448378d301982bf6cf` (the third-round Codex P1 fix, §1 commit 5) + `3fd71f2072b6ae358c4f0d7c4f066daf8e669c6c` (the fourth-round Codex P1 fix, §1 commit 6) + `6dbb7ff371b9d60997b5b1427295571f77362b8b` (the fifth-round Codex P1+P2 fix, §1 commit 7) + `3884979efbc59be77279c995ecf51f02f30ec1ca` (the sixth-round Codex P2 fixes, §1 commit 8) + `ed6ba07e1e91d87de8ec490e5a91f5824dbdfc39` (the seventh-round Codex P1 fixes, §1 commit 9) + the eighth-round commit recorded in §1 commit 10.

The implementer leaves `Status` at `gate_review`. Only a distinct reviewer may change it to
`complete`.

## 1. What was built

### Commit 1: `feat(provider-wire): relay digest/export artifact ops to adapter-manager`

- **`NetworkedProviderDriver`** (`packages/provider-wire/src/driver.ts`):
  - `artifactExportMode` is now `"grant_upload"`.
  - `digestArtifact` and `exportArtifact` **read the mode first**. When it is `"none"` they throw
    `UnsupportedProviderOperation` before any RPC is made.
  - Otherwise each call makes **one** POST, to `/op/digest_artifact` or `/op/export_artifact`, and
    carries the owned-labels capability. The driver never retries, prefetches or buffers.
  - `#post`'s op type is widened **locally** to add the two ops, following the `stage_files`
    precedent (`E7-F011`). The frozen `ProviderOperation` vocabulary is unchanged.
- **Grant in, reference out.** The export body carries the grant, and the result is `{objectKey}`.
  - If the returned reference is not the grant's own `objectKey`, or is missing, the driver throws
    `WireProtocolError`. It never hands the commit a reference it cannot vouch for.
  - A malformed digest throws `WireProtocolError` before the sequencer can mint a grant from it.
    Malformed means the sha256 is not 64 lowercase hex characters, or the size is not a
    non-negative safe integer.
- **adapter-manager** (`packages/adapter-manager/src/server.ts`, `createProviderServer`):
  - `digest_artifact` and `export_artifact` join `GATE_REQUIRED_OPS`.
  - `routeGated` sends both through **`gateOwnedOp`**. Each is a single-sandbox owned op, gated
    only, like `stage_files`. An ungated server has no raw handler for them and returns 404.
  - The grant type comes from the port, as `Parameters<SandboxProvider["exportArtifact"]>[2]`, so
    the package still declares exactly its three dependencies (`check-adapter-manager-boundary`).
- **`scripts/gate-clause-wiring.json` `E5-2`:**
  - The provider-wire `providerCapabilityClaims` value moves to `grant_upload`, with a dated
    amendment in the reason. **Positive control:** before this register edit,
    `check-gate-clause-wiring` went red (`driver.ts declares artifactExportMode = "grant_upload",
    register claims "none"`).
  - One 2026-09-06 sentence was put in the past tense, and the amendment says so. The guard's value
    regex reads the present-tense form as a *current* claim, so it went red on the old wording.
  - **`E5-2` stays `unwired`.** Promotion is `CLI-012`'s (E5-D07 ruling 4).

### Commit 2: `fix(sandbox-e2b-provider): derive signed-PUT headers from grantPutHeaders (E5-F002)`

- **`putGrantBytes`** (`packages/sandbox-e2b-provider/src/e2b-provider.ts`) now sends
  `{"content-type": "application/octet-stream", ...grantPutHeaders(grant)}`.
  - `grantPutHeaders` is the single home and now has its **first production caller**.
  - `x-amz-sdk-checksum-algorithm` is now sent.
  - The grant's own headers still win, because `grantPutHeaders` spreads them last.
- **The digest-source decision: the GRANT's `expectedSha256`.**
  - The signer binds the algorithm, not the value (`grantPutHeaders` docstring), so the store checks
    the body against whatever this header says.
  - With the grant's value, the store refuses bytes the grant was not minted for at the PUT.
    Without it, the store would accept them and the fenced commit would refuse `hash_mismatch`
    later, in another process.
  - On `exportArtifact`'s own path the two values are equal, because it re-hashes and refuses a
    mismatch first.
- **Severed PUT.** A transport rejection is re-thrown as a fixed message with **no `cause`**. That
  makes it distinguishable from a status failure, and the transport's error (which may name the url)
  cannot escape (H-04).
- `putGrantBytes` gains `export`, a module-level export only. It is not re-exported from the package
  index. The test calls it directly because `exportArtifact` never hands it mismatched bytes.
- `scripts/test-inventory.json`: the `packages/sandbox-e2b-provider` pin goes from 19 to 20.
- `docs/architecture/distributed-execution-threat-controls.json`: two `e2b-provider.ts` line
  citations moved down 22 lines and were re-pointed, with the same anchors (`DE-26`'s
  `this.#transport.list`, and the `templateId ?? "base"` line). `check-register-citation-integrity`
  went red on `DE-26` before the re-point.

### Commit 3: `fix(adapter-manager): bind relayed upload grants to the caller's attempt and a configured store` (Codex P1, PR #557)

Codex found that the export route trusted the **worker-supplied** grant. A worker holding a valid
capability for its own sandbox could send a forged grant whose `url` points at any HTTPS endpoint,
and the far provider would read the sandbox file and PUT it there. That turns the adapter-manager
into an egress channel around the sandbox's own network policy. **Verified at source before
fixing:** the new RED case got an `ok` envelope back, and the injected uploader received the bytes.

- `createProviderServer` gains **`artifactUploadOrigins`**. Inside `gateOwnedOp`, after the
  owned-check, `assertUploadGrantBound` runs **before** the provider. It requires all of these:
  - an `upload` / `PUT` grant;
  - an `https:` url whose **origin is configured**;
  - an `objectKey` under the caller's **own** `organizations/<org>/jobs/<job>/attempts/<attempt>/`
    prefix, taken from the owned-checked labels;
  - a url whose decoded path ends with `/<objectKey>`.
- A refusal is a fixed `WireProtocolError` that carries no url, key or labels. Nothing is read or
  uploaded.
- **Fail-closed:** when no origin is configured, every export is refused. Digest is unaffected.
- **Not done here:** the shipped bin (`src/bin/adapter-manager.ts`) does not set
  `artifactUploadOrigins`, so a deployed adapter-manager refuses exports until a deploy ticket adds
  the store origin to its boot config. That is fail-closed and honest, and it is recorded in §8.
- This confines a forged grant; it does not authenticate one. A presigned url carries no
  control-plane signature the adapter-manager could check.

### Commit 4: `fix(adapter-manager,sandbox-e2b-provider): bound the export upload and refuse redirects` (Codex P1 + P2 on `210991f7d`)

- **P1, a stalled upload strands the destroy.** `gateOwnedOp` holds the per-sandbox lock across
  dispatch. The supervisor's window races the export but cannot cancel the RPC, so a hung PUT would
  queue the run's own `destroy` behind it. **Verified by RED:** a stalled uploader held the lock, and
  `destroy` had not settled after 25 s.
  - The route now dispatches with `deadlineMs = min(ctx.deadlineMs, capability.expiresAt − now −
    EXPORT_TEARDOWN_RESERVE_MS)`. That is the supervisor's own export-window clamp
    (`runExportWindow`, 3c), so destroy keeps its 30 s reserve. With no budget left, the route
    refuses before any read.
  - `E2bSandboxProvider.exportArtifact` refuses an exhausted budget before reading. It aborts the
    upload with `AbortSignal.timeout(ctx.deadlineMs)` and settles at that point even if an injected
    uploader ignores the signal.
  - `performUploadGrant` gains an optional `signal` parameter, so existing two-argument uploaders
    still typecheck.
- **P2, redirects.** `putGrantBytes` sends `redirect: "error"`, so a redirect from the store origin
  cannot forward the body past the origin binding. The caller's signal reaches `fetch`, and an abort
  is reported as a timeout, not as "severed".
- Two `e2b-provider.ts` line citations in `distributed-execution-threat-controls.json` moved again
  (+29 lines) and were re-pointed, with the same anchors.

### Commit 5: `fix(...): bound the artifact READ phase too` (Codex P1 on `f34b65a`)

Commit 4 bounded the upload and left the sandbox READ unbounded. The adapter-manager holds its
per-sandbox lock across the whole dispatch, so a stalled `transport.readFile` strands the run's
destroy exactly as a hung PUT would. **Verified by RED:** with a stalling read, the export hung and
`destroy` had not settled after 25 s.

- `#readArtifactBytes` now runs under `boundedBySignal` in **both** `exportArtifact` (the upload's
  own signal) and `digestArtifact` (its own `AbortSignal.timeout(ctx.deadlineMs)`).
  `digestArtifact` takes `ctx` rather than `_ctx` and refuses an exhausted budget before reading.
  `boundedBySignal` takes the fixed timeout message, which carries no path, grant or url.
- `artifactOpBudgetMs` is now the single clamp, applied to `digest_artifact` as well as
  `export_artifact`, on the server's injected clock. With no budget left the route refuses and the
  provider is never called.

### Commit 6: `fix(adapter-manager): make an export redemption one-time per object key` (Codex P1 on `168a540c`)

The grant's INTEGRITY fields (`expectedSha256`, `maxBytes`) are worker-supplied, and no
control-plane signature covers them — the presigned url binds the checksum **algorithm**, never the
value. So a worker that keeps a url it already redeemed can hand in the same url and object key with
a different `expectedSha256` and re-PUT different bytes under the key the fenced commit already
verified. `artifact-transfer-grant.ts` refuses to MINT a second grant for a committed artifact;
replaying the first grant went around that guard. **Verified by RED:** a second export with a
tampered `expectedSha256` succeeded and stored the second bytes.

- The route records an object key on **successful** export and refuses a second redemption of that
  key **before** the provider is called.
- A **failed** export records nothing, so an honest retry still works, and a different key is
  unaffected. Both are asserted, so the refusal is not a blanket "one export per server".

★ **Honest limit, and a STOP.** The ledger is per-instance and in-memory: it does not survive a
restart, does not reach a second replica, and two concurrent first-exports of one key can both pass.
It narrows the replay; it does not authenticate the grant. The complete fix is a control-plane
signature over the grant's integrity fields, which is a change to the **frozen** `worker-protocol`
package — named as a STOP in this ticket's own plan text and not taken here. It is carried to the
planning session in §8.

### Commit 7: `fix(adapter-manager): bound the gated section, and replay a lost export response` (Codex P1 + P2 on `16195c55`)

- **P1 — the ownership INSPECTION was the last unbounded step.** It runs inside `gateOwnedOp`'s
  per-sandbox mutex, and `E2bSandboxProvider.inspect` honours no deadline, so a hung `getInfo` held
  the lock for as long as the transport hung: the same strand as the read and the upload, one step
  earlier. **Verified by RED:** the export hung and `destroy` had not settled after 25 s.
  - `gateOwnedOp` gains an **optional** `opBudgetMs` that bounds the locked section (inspect +
    dispatch). When it fires the exclusive section returns — which releases the lock — and the
    caller gets a fixed `WireProtocolError`; the abandoned work is detached and its rejection
    handled.
  - **Omitted ⇒ byte-identical to before**, so `execute`, the four teardown ops, `inspect` and
    `stage_files` are untouched. ★ Positive control for that clause: a mutant that forces the bound
    on **every** op reds 4 unrelated cases in the package.
  - `digest_artifact` and `export_artifact` pass the budget they already compute, so one number
    bounds the inspection, the read and the upload.
- **P2 — a lost response must not become a missing output.** `ProviderOpContext`'s contract is
  "a repeated key returns the recorded result and does not double-apply", and commit 6's one-time
  redemption refused the replay. The ledger now records `{idempotencyKey, result}` per object key:
  the **same** key replays the recorded result and uploads nothing, any **other** key is still
  refused as a re-PUT. Both arms are asserted in one case.

### Commit 8: `fix(adapter-manager): latch the abandoned gated section, and bound the redemption ledger` (two Codex P2s on `2fe65ecd`)

- **(a) The abandoned section could still dispatch.** When the gate budget fired, the locked
  section was detached but still running; an inspection that resolved afterwards went on to
  dispatch, so an export could start reading and PUTting after the caller was told it timed out and
  teardown had taken the lock. **Verified by RED:** one upload landed after the timeout.
  `gateOwnedOp` now sets a `budgetFired` latch from the bound's expiry and re-checks it after the
  awaited inspection, before dispatch — the same shape as the supervisor's export-window latch.
- **(b) The redemption ledger grew forever.** Each record now carries its grant's own `expiresAt`,
  and every export first drops the records that have passed it. `assertUploadGrantBound` gains
  clause 5: an **expired** grant is refused, on the server's injected clock. That is what makes
  expiry-based eviction safe — a record that is gone cannot be replayed, because the grant that
  would replay it is refused.

### Commit 9: `fix(adapter-manager): measure the artifact budget from a deadline, and retain redemptions on the server's clock` (two Codex P1s on `06c5684d`)

- **(a) The budget was a DURATION computed before enqueueing, and the gate's mutex queues.** A
  request could wait behind a predecessor and then start its timer with a full, stale window, so
  **queueing** defeated the teardown reserve without anything hanging at all. **Verified by RED:** a
  queued export uploaded after its predecessor had already burned the window.
  `gateOwnedOp` now takes an **absolute** `opDeadlineAtMs`; the remaining budget is measured after
  the lock is acquired and handed to the dispatch, which passes it to the provider. Waiting for the
  lock is spent budget. `artifactOpBudgetMs` became `artifactOpDeadlineAtMs`.
- **(b) Eviction followed a worker-supplied field.** The retention deadline was copied from the
  grant's own `expiresAt`, so a worker could shorten it, wait for its own record to be evicted, and
  replay the still-live url with different bytes. Retention is now a fixed **server-side** window
  measured from the redemption (`UPLOAD_REDEMPTION_RETENTION_MS`, 24 h), which no worker field can
  shorten; the map stays bounded by one window's exports. The expired-**grant** refusal stays.

★ The test clock gained a real-time term, because a frozen clock cannot express a queue wait at all,
and two exact-equality budget assertions became bounded ranges. ★ One mutant had to be rewritten:
`enqueuedAt = now()` immediately before the same read is a NO-OP mutant and survived; the real one
hoists the measurement outside `runExclusive`, and that goes red.

### The two merges of `origin/docs/replatform-program`

- `f34b65a` merged JOB-016/JOB-017, DAT-009-3d and DEP-015. Conflicts in `driver.ts`, `server.ts`,
  `gate-clause-wiring.json` and the threat-control register were resolved by keeping **both** sides:
  3d's `expectedReferences` with this ticket's `E5-2` amendment re-applied, and WRK-018's
  `executeRelayingStdout` and E6-F024's `onOpFailure` beside this ticket's own additions.
- `da4886dc` merged the DEP-015 follow-ups (#561, #563) with no conflicts, **and committed the
  DE-17 citation re-point (`server.ts:122-131`, anchor `ReadonlySet`) that the first merge left
  uncommitted.** That omission is what reddened `policy` on `f34b65a` (§9).

### Commit 10: the dispatch budget is re-measured after the inspection (Codex P1 on `41db573d`)

`remainingMs` was captured before the ownership inspection and passed unchanged to the provider, so
a slow inspect left the provider a timer LONGER than the gate's own remaining bound — its detached
PUT could outlive the section that was supposed to contain it. **Verified by RED:** with an
inspection that took ~250 ms of an 800 ms window, the provider received 793 ms. The dispatch's
budget is now re-measured from the absolute deadline at the moment of dispatch. Mutant M48 (hand the
pre-inspection figure back) goes red.

### Scope boundary (planning session, founder delegation F2)

Codex raised eight distinct findings on this PR and all were real. The line the planning session
drew, and this ticket followed:

**Built here — a real defect in code this PR introduces.** Each is a property the relay itself owes:
a field a caller controls that nothing checked (the forged upload grant, the worker-supplied
eviction deadline), a lock held with no bound (the upload, the sandbox read, the ownership
inspection, and the mutex queue in front of them), a timeout that did not cover the operation it
named (the read; the queued request's stale window), and a contract the relay broke (the
lost-response replay).

**Filed, not built — hardening of the guard rather than a defect in the relay.**
- **`E5-F006`** — the relayed grant cannot be AUTHENTICATED at the adapter-manager, because
  `ArtifactUploadGrantV1` carries no control-plane signature. The redemption guard narrows the
  replay; it is per-instance, in-memory, races on two concurrent first exports, and retains on a
  fixed 24 h constant rather than a configured policy. The complete fix is a signature over the
  grant's integrity fields, i.e. a change to the **frozen** `worker-protocol` — which this ticket's
  own plan text names as a STOP.
- **`E5-F007`** — the shipped adapter-manager bin configures no store origin, so a deployed export
  fails closed until a deploy ticket supplies one.
- **`E5-F008`** — the supervisor hands each export RPC the RUN's budget rather than its own
  export-window budget, so an RPC's ctx can outlast the window racing it. The fix belongs in
  `runExportWindow` (`supervisor.ts`, `DAT-009-3c`'s file), and the adapter-manager cannot clamp to a
  window nothing on the wire carries.
- **`E5-F009`** — an artifact is read whole into memory before any size check, which the wire route
  makes the SHARED adapter-manager's memory as well as the worker's. A pre-read refusal needs a
  stat-shaped or streaming op on `E2bTransport`, a port outside this ticket's files.

**Why this is the right line.** The relay is what the ticket owes, and a guard that refuses honestly
plus a filed residual is truthful; a redemption subsystem with its own durability and eviction
policy is a second ticket, and building it here would have made this PR the owner of a capability
nobody chartered. Both findings are `unowned` with a reason, so the residual is visible rather than
implied.

## 2. RED → GREEN

RED runs used unchanged behaviour. The only source change made before the `put-grant-bytes` RED was
adding the `export` keyword to `putGrantBytes`, which changes no behaviour, so each failure below is
an assertion failure, not a missing import.

| Suite | RED | Green-at-RED cases, and why | GREEN |
|---|---|---|---|
| `provider-wire` `driver-artifact-export.test.ts` | **11 failed / 3 passed (14)** | the mode-`"none"` case passed **vacuously**, because the old code threw without reading the mode (the exact defect the task names; mutants M1/M2 now kill it); far-side refusal and H-04 were true by construction | **14 passed** |
| `adapter-manager` `server-artifact-export.test.ts` | **7 failed / 2 passed (9)** | ungated-404 was true by construction; the far-`"none"` case passed vacuously through the driver's unconditional throw | **9 passed** |
| `adapter-manager` grant-binding cases (commit 3) | **5 failed / 9 passed (14)**: the forged-origin case got an `ok` and the bytes were uploaded | the 9 were the commit-1 cases | **14 passed** (full package 169) |
| commit 4 (`put-grant-bytes` + `server-artifact-export`) | **4 failed / 8 passed (12)** and **3 failed / 14 passed (17)**; the stall case timed out, which is the strand itself | — | **12 passed** and **17 passed** (full packages: e2b 151 passed / 31 skipped; adapter-manager 172) |
| commit 10 (re-measured dispatch budget) | **1 failed / 28 passed (29)**: the provider received 793 ms of an 800 ms window after a ~250 ms inspection | — | **29 passed** (full package 198) |
| commit 9 (deadline + server retention) | **3 failed / 25 passed (28)**: the queued export uploaded on a stale window, the shortened-expiry replay was allowed, and the retention constant did not exist | — | **28 passed** (full package 197) |
| commit 8 (latch + ledger TTL) | **2 failed / 24 passed (26)**: an upload landed after the timeout, and an expired grant was accepted | — | **26 passed** (full package 195) |
| commit 7 (inspect bound + replay) | **3 failed / 21 passed (24)**: both stalled-inspection cases timed out, and the replay was refused | — | **24 passed** (full package 193) |
| commit 6 (replay) | **1 failed / 20 passed (21)**: the tampered re-PUT succeeded and was stored | — | **21 passed** (full package 190) |
| commit 5 (read phase) | **3 failed / 12 passed (15)** and **2 failed / 17 passed (19)**; both stall cases timed out | — | **15 passed** and **19 passed** (full packages: e2b 157 passed / 31 skipped; adapter-manager 188) |
| `sandbox-e2b-provider` `put-grant-bytes.test.ts` | **4 failed / 4 passed (8)** | failed: both header names (`expected undefined to be 'SHA256'`), the digest source, one home, severed PUT (the raw transport message escaped). Passed: base64 encoding, header precedence, body and non-2xx were already correct | **8 passed** |

**The task's focused verify command at `8849a1206` (Windows, local):** wire build OK; driver suite
14/14; adapter-manager suite 9/9; e2b headers suite 8/8; `check-adapter-manager-boundary` PASS;
`check-sandbox-e2b-provider-boundary` PASS; wire typecheck OK; wire build OK.

**Wider runs:**
- Full `provider-wire`: 77 passed, 1 skipped.
- Full `adapter-manager`: 18 files, 164 passed.
- Full `sandbox-e2b-provider`: 147 passed, 31 skipped. The skips are the keyed suites, with no key
  present.
- `worker-networked-host`: 6 passed.
- Typecheck and build exit 0 for `provider-wire`, `adapter-manager` and `sandbox-e2b-provider`.
- `check:frozen-worker-protocol-v1`: OK.
- The full `pr.yml` guard set plus `check-evidence-immutability --base origin/docs/replatform-program`:
  **0 failures**.

## 3. Mutation table (each applied alone, suite rerun, source restored)

| # | Mutant | Result |
|---|---|---|
| M1 | `digestArtifact` does not read the mode | 1 red (mode-`none`) |
| M2 | `exportArtifact` does not read the mode | 1 red (mode-`none`) |
| M3 | no reference check (any `objectKey` returned) | 3 red |
| M4 | no digest-shape validation | 5 red |
| M5 | export sent without the capability | 1 red |
| M6 | the unconditional throw restored | 6 red |
| M7 | `digest_artifact` dispatched raw, bypassing `gateOwnedOp` | 4 red (**incl. F10 cross-Organization**) |
| M8 | `export_artifact` dispatched raw, bypassing `gateOwnedOp` | 4 red (**incl. F10 cross-Organization**) |
| M9 | owned-check weakened (Organization-blind, lease-only) | 3 red |
| M10 | both ops dropped from `GATE_REQUIRED_OPS` | 7 red |
| M11 | the old derivation (bytes digest, no algorithm header) | 3 red |
| M12 | digest source = bytes uploaded (**the opposite decision**) | 2 red |
| M13 | hex forwarded instead of base64 | 5 red |
| M14 | algorithm header dropped | 2 red |
| M15 | severed PUT re-thrown raw | 1 red |
| M16 | the `content-type` default overrides the grant | 1 red |
| M17 | no origin check | 2 red |
| M18 | an absent allowlist allows every origin (fail-open) | 1 red |
| M19 | no attempt-prefix binding on `objectKey` | 2 red (**incl. F10 foreign-Organization key**) |
| M20 | no url-targets-key binding | 1 red |
| M21 | the binding is never called | 5 red |
| M22 | the PUT follows redirects | 1 red |
| M23 | the signal is not passed to `fetch` | 1 red |
| M24 | no exhausted-budget check | 1 red |
| M25 | no signal-bounded race (unbounded uploader call) | 1 red |
| M26 | the route passes the caller's unclamped ctx | 2 red (incl. the stall/strand case) |
| M27 | clamp without the teardown reserve | 3 red |
| M28 | the export READ is unbounded | 1 red |
| M29 | the digest READ is unbounded | 1 red |
| M30 | no exhausted-budget check on digest | 1 red |
| M31 | the digest route passes the unclamped ctx | 1 red |
| M32 | the digest route does not refuse inside the reserve | 1 red |
| M33 | the shared clamp drops the teardown reserve | 5 red |
| M34 | no one-time-redemption check | 1 red |
| M35 | the key is recorded before the export, so a failure also burns it | 1 red |
| M36 | `export_artifact` passes no gate budget | 1 red |
| M37 | `digest_artifact` passes no gate budget | 1 red |
| M38 | the gate ignores the budget it is given | 2 red |
| M39 | the replay ignores the idempotency key (any retry replays) | 2 red |
| M40 | no replay record is consulted | 2 red |
| M41 | no budget latch before dispatch (the abandoned section dispatches) | 1 red |
| M42 | no grant-expiry clause | 1 red |
| M43 | no eviction of expired redemption records | 1 red |
| M44 | the budget is measured BEFORE the mutex queue | 1 red |
| M45 | the dispatch gets the caller's original budget, not the remaining one | 1 red |
| M46 | retention driven by the grant's own `expiresAt` | 2 red |
| M47 | no retention eviction at all | 1 red |
| M48 | the dispatch gets the pre-inspection budget | 1 red |

**48 of 48 killed.** ★ And one deliberate ANTI-mutant: forcing the gate bound onto every op (not
just the two that pass one) reds 4 unrelated cases, which is the positive control for
"omitted ⇒ unchanged".

★ **M31 and M32 first SURVIVED, and the test was the problem.** The digest case asserted only that
the call rejected, which an *unclamped* route still produces via the provider's own budget check —
a check that could not tell where the refusal came from. The case now records the `ctx` the provider
receives, so it asserts the clamped value AND that the route's own refusal never calls the provider.
A case that survives its own mutant is a check that evaluates nothing.

## 4. Multi-tenant (F10)

The adapter-manager serves every Organization's workers from one process. The component suite
creates sandboxes for **Organization A**, **Organization B** and **A under another lease** on one
server.
- **Same-tenant positive control:** A digests and exports its own sandbox's output. The far uploader
  receives A's bytes under A's own key.
- **A's capability aimed at B's sandbox:** digest and export are both refused with the uniform
  `ResourceNotAvailableError`. `transport.readFile` is never called and nothing is uploaded. For
  export, that holds even with a grant naming B's own key.
- **A under another lease:** refused the same way, with no read and no upload.
- The cross-Organization refusal body is **byte-identical** to not-found, for both ops.
- A missing capability is refused, and an ungated server returns 404.
- Mutants M7/M8/M9 turn the cross-Organization cases red.

## 5. The supervisor window (3c) and the wire

The export window latch is the supervisor's (`runExportWindow`, DAT-009-3c). It re-checks after
every awaited provider call, so a late digest mints nothing and a late upload is never committed.
The relay respects it by adding no behaviour of its own:
- each port call is exactly one RPC, made only when invoked (`one call is ONE RPC`);
- there is no retry and no prefetch;
- the driver returns what came back or throws.

An in-flight export whose window has already closed can still complete its PUT on the far side,
because a redeemed grant cannot be recalled. That object is never committed and is left to the
orphan sweep, as in 3c.

## 6. `E5-F002`: decided and built, NOT closed (a stop)

The brief handed to this session said to flip `E5-F002` to resolved and delete its ownership key in
the same commit. **This was not done.** The task section itself says (RED → GREEN, keyed lane):
*"Until that run exists, the result records the header decision as decided but not live-proven, and
`E5-F002` stays open."* No keyed run exists at this revision.

★ **Verified at source: the named keyed lane cannot supply that proof.**
`keyed-dat-009-artifact-export.test.ts` injects its uploader, so no real PUT happens. Its header and
the `keyed-e2b-dat-009-export.yml` header both say so. A re-run re-proves the sandbox half and does
not execute `putGrantBytes`. So the plan's closing condition ("re-run
`keyed-e2b-dat-009-export.yml`") would not re-prove the header decision.

`findings.md` `E5-F002` carries a dated progress note, and its `finding-ownership.json` reason
carries an amendment. **Status stays `open`.** Closing it needs a live PUT through the default
uploader against a real store, which is the planning session's decision. One option is the D1
MinIO lane using `putGrantBytes`.

## 7. Keyed-workflow trigger note

Commit 2 edits `packages/sandbox-e2b-provider/src/e2b-provider.ts`. That file is in the
`push`-trigger `paths` of **`keyed-e2b-dat-009-export.yml`**, on branch `docs/replatform-program`.
**Merging this PR will auto-fire that lane.** The founder has authorized that under F8. Nothing was
dispatched by this session. Per §6, that run proves the sandbox half only. No other `keyed-e2b-*`
workflow's `paths` names a file this PR touches. `keyed-e2b-unit-d.yml` watches `real-transport.ts`,
which this PR does not touch.

## 8. Findings and plan deltas

1. The `E5-F002` close condition is unsatisfiable by the named lane (§6).
2. **Merge-order note for `CLI-012` and `3d`.** `CLI-012` edits the same `driver.ts` and `server.ts`.
   This PR's changes to both are confined to the artifact pair and one `#post` type widening. `3d`
   edits the same `E5-2` entry in `scripts/gate-clause-wiring.json` (`expectedReferences`). This PR
   changes that entry's `reason` and one `providerCapabilityClaims` value, so a textual conflict on
   the one-line `reason` string is possible. Whichever merges second rebases.
3. **Deploy follow-up (commit 3):** the adapter-manager bin does not yet configure
   `artifactUploadOrigins`, so a deployed networked lane refuses every export (fail-closed) until
   the store origin reaches its boot env.
4. **The same class, pre-existing and not fixed here:** `stage_files` (E7-F011) relays a
   worker-supplied **download** grant, and `fetchGrantBytes` (`e2b-provider.ts`) GETs any
   `grant.url`. A forged download grant would therefore make the adapter-manager fetch an arbitrary
   HTTPS url and write the response into the caller's own sandbox, which is an SSRF read from the
   adapter-manager's network position. It is outside this ticket's files and is reported to the
   planning session rather than filed with a newly minted id.
5. **Filed rather than built (see the scope boundary in §1):** `E5-F006` (the grant cannot be
   authenticated; the redemption guard's per-instance limits and its retention constant) and
   `E5-F007` (the bin configures no store origin). Both are `unowned` with reasons in
   `scripts/finding-ownership.json`.
6. **A stop for the planning session (commit 6).** The relayed upload grant cannot be
   authenticated at the adapter-manager: `ArtifactUploadGrantV1` carries no control-plane signature,
   and adding one is a frozen-`worker-protocol` change, which this ticket's own plan text calls a
   STOP. The one-time redemption above is a per-instance narrowing, not authentication. A durable,
   shared decision (sign the grant, or make redemption durable and cross-replica) is owed.
7. A process note: the session's shared scratchpad held another session's mutation script under a
   generic name. One of this session's runs executed that script, and it overwrote
   `packages/worker-daemon/src/lifecycle/dispatch-runtime.ts` in this worktree with a `3d` draft.
   The file was restored with `git checkout` before any commit. It is in neither commit, and the
   mutation runs above were redone with a uniquely named script.

## 9. CI

★ *Superseded by the round after it: this section records the CI on `7f7bf5317`. Commit 4 followed,
and its CI is recorded in the addendum below.*

Measured on head `7f7bf5317` (which carries the reviewed code tree `d5e6a3612`), `pr.yml` run
`35596023016`:
- **`ci-required`** (job `106326177981`): **success**.
- **`verify (3)`** (job `106321019295`): ran `adapter-manager` `server-artifact-export.test.ts`,
  **14 tests**, and `provider-wire` `driver-artifact-export.test.ts`, **14 tests**, all passed. The
  shard total was 5937 passed and 29 skipped (5966).
- **`verify (2)`** (job `106321019189`): ran `sandbox-e2b-provider` `put-grant-bytes.test.ts`,
  **8 tests**, all passed. The shard total was 6239 passed and 33 skipped (6272).
- `verify (1)`, `verify (4)`, `policy`, `e2e`, `migrations` and `lint`: success.

Codex on `7f7bf5317` reported "Didn't find any major issues". Its one earlier P1, on `d2fc689ac`
(forged upload grants), is fixed in `d5e6a3612`, replied to and resolved.

This section was added in a docs-only commit after that run, so the final head differs from
`7f7bf5317` by this file only.

### CI addendum (commits 4 and 5)

**The `f34b65a` run (`35617140536`) FAILED, and one failure was real.**
- **`policy`** — the citation-integrity guard's own positive control (`the migrated tree passes with
  zero errors`) went red. Cause: the DE-17 re-point was made while resolving that merge and never
  staged, so the committed tree still cited `server.ts:101-110`. Committed in `da4886dc`; the guard
  is green locally on the merged tree.
- **`verify (1)`** — one file failed,
  `server/src/__tests__/distributed-execution-db-startup.integration.test.ts`, on the
  *"promptly settles operator-negative-pending after the exact startup controller is externally
  aborted"* case (4 soft assertions: `kind: "watchdog"` instead of `"settled"`, and an unsettled
  transaction against a ~143 s deadline). It is a deadline-shaped case in a suite this ticket does
  not touch: nothing in this PR reaches `server/`, the startup gate or PostgreSQL. It is recorded
  here as observed-and-not-diagnosed rather than asserted to be a flake; the next run is the
  evidence.

**The `168a540c` and `16195c55` runs FAILED for an INFRASTRUCTURE reason, not a code one.** On runs
`35796527264` and `35797318829` the failing jobs (`changes`, `policy`, both
`worker-protocol-contract-bytes` and `ci-required`) each report **zero steps** and a ~3-second
lifetime, i.e. no runner was ever assigned; every open PR shows the same shape at the same time.
No test or guard verdict exists in those runs. The planning session re-runs CI once runners return.

**Local evidence on the final tree (`6dbb7ff37`), in place of that run:**
- the task's focused command: wire build OK, `driver-artifact-export` 14, `server-artifact-export`
  29, `put-grant-bytes` 15, both boundary checkers PASS, wire typecheck + build OK;
- full packages: `provider-wire` 82 passed / 1 skipped, `adapter-manager` 198 passed,
  `sandbox-e2b-provider` 157 passed / 31 skipped, `worker-networked-host` 6 passed,
  `worker-daemon` 1107 passed / 1 skipped; all five typecheck and build clean;
- the full `pr.yml` guard set plus `check-evidence-immutability --base origin/docs/replatform-program`:
  **0 failures**.

## 10. Reviewer section

*(Distinct reviewer only.)*

**Reviewer:** M1 review-batch-3B independent reviewer (Claude Opus 5) — distinct from the DAT-009-3e build session and the planning session
**Reviewed revision:** `60aafb32ec6f8316f92079789cf8814f981f3ed3`
**Disposition:** `approved`
**Attempt:** 1

### Independent review — attempt 1

**Disposition: `approved`.** Reviewed at the `docs/replatform-program` tip (the merge of PR #565).
Every commit the record names — `b853ff0ff`, `8849a1206`, `d5e6a3612`, `ddfa0e61e`, `ffd0c65d4`,
`3fd71f207`, `6dbb7ff37`, `3884979ef`, `ed6ba07e1` and the final head `f2041e74d6` — is an ancestor
of it.

**The wire route, at source.**

- `NetworkedProviderDriver.artifactExportMode` is `"grant_upload"`, and `digestArtifact` reads it
  first (`if (this.artifactExportMode === "none") throw new UnsupportedProviderOperation(…)`), which
  is the exact defect the task names. `check-gate-clause-wiring` cross-checks that declared value
  against the register's `providerCapabilityClaims` and is OK at the tip, so the record's claim and
  the source cannot drift apart silently.
- `createProviderServer` runs `assertUploadGrantBound(grant, detail.resourceLabels,
  artifactUploadOrigins, now())` inside `gateOwnedOp`, before the budget check and before the
  provider. `UPLOAD_REDEMPTION_RETENTION_MS` is a server-side `24 * 60 * 60 * 1000`, and eviction
  compares `nowMs - record.recordedAtMs` against it — no worker field can shorten it, which is
  commit 9(b)'s claim.
- `gateOwnedOp` takes an **absolute** `opDeadlineAtMs`; `remainingMs` is measured after the mutex is
  acquired, a `budgetFired` latch is re-checked after the awaited inspection and before dispatch,
  and the dispatch's own budget is **re-measured** at the moment of dispatch
  (`opDeadlineAtMs - now()`), which is commit 10. Omitting `opDeadlineAtMs` leaves the path
  byte-identical, so the untouched ops really are untouched.
- `packages/adapter-manager/src/bin/adapter-manager.ts` contains no `artifactUploadOrigins`. The
  deployed adapter-manager therefore refuses every export. That is fail-closed and it is exactly
  what `E5-F007` says.

**Suites, rerun locally (Windows) at the reviewed tip.** After building `worker-protocol`,
`worker-daemon`, `sandbox-provider-contract`, `sandbox-e2b-provider` and `provider-wire`:
`server-artifact-export.test.ts` **29 passed**, `driver-artifact-export.test.ts` **14 passed**,
`put-grant-bytes.test.ts` **15 passed**. These match §9's local evidence for the final tree, with
the server suite at the post-commit-10 figure of 29.

**Mutation reproduced by me, and reverted.** **M48**: handing `dispatch` the pre-inspection
`remainingMs` instead of re-measuring gives **1 failed** — *★ the provider's budget is recomputed
AFTER the ownership inspection* — and 28 passed. That is exactly the table's row. The other
forty-seven I checked by reading the tests and the code each one targets.

**F10 is real.** `server-artifact-export.test.ts` builds sandboxes for `org-a`, `org-b` and a second
lease of `org-a` on one server, and asserts that A's capability can neither digest nor export B's
sandbox (uniform `ResourceNotAvailableError`, `transport.readFile` never called, nothing uploaded),
that a grant naming another Organization's object key is refused on the caller's own sandbox, and
that the cross-Organization refusal body is byte-identical to not-found. M7/M8/M9/M19 are the
mutants that red those cases.

**The scope boundary is honest.** I read all four filed findings at source rather than taking the
boundary section's word for it, and each states a property with symbol-level citations rather than
concealing a defect this PR introduced:

- `E5-F006` names the missing control-plane signature over `ArtifactUploadGrantV1`'s integrity
  fields and then enumerates, without softening, the four limits of the guard this PR *did* build:
  per-instance, in-memory, a race on two concurrent first redemptions, and a fixed 24 h constant
  rather than a policy. That is the honest form — the partial mitigation ships, and its exact
  residual is written down. The complete fix is a change to the frozen `worker-protocol`, which this
  ticket's own plan text names as a STOP, so declining it here is correct rather than convenient.
- `E5-F007` is a deploy-owed gap whose current behaviour is refusal, which I confirmed at the bin.
- `E5-F008` is a defect whose fix site is `supervisor.ts`, i.e. `DAT-009-3c`'s file and outside this
  ticket's Files list. It is newly *reachable* because of this PR, and the finding says so; the
  adapter-manager's own `capExpiresAt − reserve` clamp limits the exposure meanwhile. Filing it
  rather than reaching into a sibling ticket's file is the right call.
- `E5-F009` is a pre-existing whole-file read whose blast radius this PR genuinely widens, from the
  worker to the shared adapter-manager. The finding states that widening explicitly instead of
  presenting the issue as purely inherited, and the fix needs a stat-shaped or streaming op on
  `E2bTransport` — a port outside these files.

All four are `unowned` **with reasons** in `scripts/finding-ownership.json`, so the residual is
visible rather than implied. Both of the two structural excuses this programme watches for — "it was
already broken" and "it is someone else's file" — are used here only where they are true, and each is
paired with a filed id.

**Codex, and the eight rounds.** On PR #557, `chatgpt-codex-connector` raised findings on
`d2fc689ac`, `210991f7d`, `f34b65a0da`, `168a540c0f`, `16195c5533`, `2fe65ecd0c`, `06c5684d42` and
`41db573dae` — eight rounds, matching the record — and reported no major issues on `7f7bf5317a` and
`6ece122ad3`. **All fourteen review threads are resolved.** Each finding is answered by a named
commit in §1, and I verified the last two at source (the re-measured dispatch budget, and the
server-side retention window).

**CI on the FINAL head, which the record's §9 addendum does not reach.** Run `35801313227`
(`pull_request`, headSha `f2041e74d679030502317fd0fc80a9fb753d0750`, conclusion `success`): all
sixteen jobs `success`, including `ci-required` `107054016317`, `policy`, `lint`, `verify (1..4)`,
`migrations`, `e2e`, `e2e-pgvector`, `distributed-contract`, `browser`, `brand-check` and both
`worker-protocol-contract-bytes` lanes. That supersedes the two infrastructure-failed runs §9's
addendum records as having no verdict, and the record was right not to claim a verdict from them.

**`E5-F002` stays open, correctly.** The plan's own RED → GREEN says so: *"Until that run exists,
the result records the header decision as decided but not live-proven, and `E5-F002` stays open."*
§6 goes further and shows at source that the named lane cannot supply the proof, because
`keyed-dat-009-artifact-export.test.ts` injects its uploader and never executes `putGrantBytes`. The
finding is `open` with a dated progress note and its ownership key intact — the brief said to delete
that key, and **not** deleting it was the right refusal.

**The predicted keyed auto-fire happened, and corroborates §6.** §7 says merging would fire
`keyed-e2b-dat-009-export.yml` under F8. It did: run `35821678446`, `push` on `1bd5c8bbca` (the #557
merge), conclusion `success`. Per §6 that re-proves the sandbox half only and is **not** evidence for
the header decision. Nothing was dispatched by this review.

**Acceptance items.** Outcome (a) the relayed routes and (b) `E5-F002` resolved at the cause are both
met; the mode is read, grants go in and references come out, the frozen vocabulary is untouched
(`check:frozen-worker-protocol-v1` is in the green guard set), both boundary checkers pass, the
digest-source decision is pinned by an assertion whose opposite reds (M12), and no thrown message,
returned value or logged field carries `grant.url` (M15, M6, M17). The one conditional item — the
keyed re-run — resolves to the plan's own "stays open" branch. **Every acceptance item is met in the
form the plan allows.**

**Not blocking, noted.**

1. **No Codex round ran on the final head.** `f2041e74d6` *is* the fix for the P1 Codex raised on
   `41db573dae`, so the last round's finding is answered but not re-reviewed. The record does not
   claim otherwise, and the merge decision was the planning session's. Recording it so the next
   reader does not infer a clean Codex verdict on the merged tree.
2. §8 item 5 says "filed rather than built: `E5-F006` … and `E5-F007`" — two of the four. §1's scope
   boundary, written later, lists all four including `E5-F008` and `E5-F009`. §8 is not marked
   superseded, so a reader who stops there undercounts the residual by half.
3. `Start SHA` is a bare 40-hex here, which is the protocol; the record is unusually good on this.
4. The plan asks for two commits. There are ten, eight of which answer a Codex round. The record
   enumerates each with its finding, which is the honest handling.

## Review attempt history

Later reviewers append rows with increasing attempt numbers without replacing earlier ones. Do not include a `Review commit` column: a row cannot embed the SHA of the commit that first contains it.

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
| 1 | M1 review-batch-3B independent reviewer (Claude Opus 5) | `60aafb32ec` (program tip, the #565 merge) | `approved` | Verified at source: the driver reads `artifactExportMode` before the RPC; `assertUploadGrantBound` runs inside the gate before the provider; `UPLOAD_REDEMPTION_RETENTION_MS` is a fixed server-side 24 h; `gateOwnedOp` takes an absolute deadline, latches `budgetFired` after the inspection and re-measures the dispatch budget; the bin sets no `artifactUploadOrigins`, so a deployed export is fail-closed exactly as `E5-F007` says. Suites rerun locally: 29 / 14 / 15. **M48 reproduced** (1 failed, the re-measured-budget case). F10 real across `org-a`, `org-b` and a second `org-a` lease, with a byte-identical cross-Organization refusal. The scope boundary is honest: all four filed findings state properties with symbol citations, `E5-F006` enumerates its own guard's four limits rather than hiding them, and all four are `unowned` with reasons. Eight Codex rounds confirmed at source, all fourteen threads resolved. CI on the FINAL head `f2041e74d6`, run `35801313227`, all sixteen jobs green including `ci-required` `107054016317`. `E5-F002` correctly stays open, and the auto-fired keyed run `35821678446` (success) re-proves the sandbox half only. Noted, non-blocking: no Codex round ran on the final head (which is itself the last fix), and §8 item 5 lists two of the four filed findings while §1 lists four. |
