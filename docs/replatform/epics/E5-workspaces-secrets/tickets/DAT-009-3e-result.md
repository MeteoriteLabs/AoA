# DAT-009-3e Result: the networked-lane export route, and `E5-F002` at the cause

**Status:** `gate_review`
**Date (UTC):** `2026-09-21`
**Epic:** `E5-workspaces-secrets`
**Plan task:** `E5 implementation-plan DAT-009-3e — the networked-lane export route, and E5-F002 at the cause (M, M1b)`
**Implementer:** `DAT-009-3e build session (Claude Opus 5)`
**Start SHA:** `cec1b48a796f177c6184884dc3c5043f5aa57ea8` (`docs/replatform-program` tip, the `3c` merge)
**Reviewed revision (the code commits):** `b853ff0ffae57966241a7d123df9675eea84dade` (the wire route) + `8849a12066188c79393aa509fbada49d2e6d1328` (the `E5-F002` fix) + `d5e6a3612cd73cca3f6874baefa357a40a1d2e3d` (the Codex P1 grant-binding fix, §1 commit 3) + `ddfa0e61e57214aebda1d8d70b1337b0a7112799` (the second-round Codex P1/P2 fix, §1 commit 4) + `ffd0c65d44e38de2e0367d448378d301982bf6cf` (the third-round Codex P1 fix, §1 commit 5) + `3fd71f2072b6ae358c4f0d7c4f066daf8e669c6c` (the fourth-round Codex P1 fix, §1 commit 6). The tree under review is `3fd71f207`.

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

### The two merges of `origin/docs/replatform-program`

- `f34b65a` merged JOB-016/JOB-017, DAT-009-3d and DEP-015. Conflicts in `driver.ts`, `server.ts`,
  `gate-clause-wiring.json` and the threat-control register were resolved by keeping **both** sides:
  3d's `expectedReferences` with this ticket's `E5-2` amendment re-applied, and WRK-018's
  `executeRelayingStdout` and E6-F024's `onOpFailure` beside this ticket's own additions.
- `da4886dc` merged the DEP-015 follow-ups (#561, #563) with no conflicts, **and committed the
  DE-17 citation re-point (`server.ts:122-131`, anchor `ReadonlySet`) that the first merge left
  uncommitted.** That omission is what reddened `policy` on `f34b65a` (§9).

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

**35 of 35 killed.**

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
5. **A stop for the planning session (commit 6).** The relayed upload grant cannot be
   authenticated at the adapter-manager: `ArtifactUploadGrantV1` carries no control-plane signature,
   and adding one is a frozen-`worker-protocol` change, which this ticket's own plan text calls a
   STOP. The one-time redemption above is a per-instance narrowing, not authentication. A durable,
   shared decision (sign the grant, or make redemption durable and cross-replica) is owed.
6. A process note: the session's shared scratchpad held another session's mutation script under a
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

*(The run on the commit-5 head is recorded below once it completes.)*

## 10. Reviewer section

*(Distinct reviewer only.)*
