# E4 Worker daemon — decisions

Epic-local decisions. Product-wide decisions are promoted to
`docs/architecture/decisions.md` and linked here.

## E4-D10 — Device-key custody and target scope are orthogonal; the worker enforces no config-load coupling

**Date:** 2026-08-12 · **Ticket:** WRK-001 · **Status:** locked.

The WRK-001 implementation plan listed "an inconsistent trust/scope combination
throws in `loadWorkerConfig`" as a failure mode but never defined the coupling.
An initial implementation invented `os_keychain ⟹ owner` and `mounted_secret ⇏
owner` — which the WRK-001 adversarial review (finding S3) showed contradicts the
authoritative model:

- worker-enrollment **scope** is a property of the enrollment CODE (`server/src/
  services/worker-enrollment.ts` — `scope: "organization" | "owner"`), validated
  by the control plane at enrollment/placement;
- `execution_targets` scope is defined purely by organization/owner nullability;
- `workerPlatformSchema` (`packages/worker-protocol/src/capabilities.ts`) carries
  **no** key-custody dimension.

**Decision:** `keyStoreMode` (device-key CUSTODY, a deployment-mode property) and
`targetScope` are ORTHOGONAL. `loadWorkerConfig` validates each field
independently against its own closed enum and enforces **no** custody↔scope
coupling. Every combination (e.g. a desktop `os_keychain` worker enrolling under
`organization` scope, or a container `mounted_secret` worker under `owner` scope)
is accepted at config load; scope validity remains the control plane's
responsibility. Plan §3 step 5 makes a scope-model contradiction a STOP; this
decision resolves it. Enforced by `config.ts` and the rewritten
`config.test.ts` / `config-matrix.test.ts` cases.

## E4-D11 — Replay-enroll is lost-response recovery, not sustained session renewal; enroll-path denials are 401 `unauthorized`

**Date:** 2026-08-12 · **Ticket:** WRK-002 · **Status:** locked. Amends E4-D05.

WRK-002's adversarial review (contract-fidelity, CONFIRMED blocking) proved the as-built JOB-002
enroll contract diverges from E4-D05's "replay-based session renewal" assumption:

- `server/src/services/worker-enrollment.ts:295` gates **every** enroll request — including an
  already-consumed replay — on `route.expiresAt < now()`, where the enrollment CODE ROUTE TTL is
  `CODE_TTL_MS = 10 min` (worker-enrollment.ts:22), set once at `insertCodeRoute` and never
  extended. The session TTL is `SESSION_TTL_MS = 15 min` (:23).
- `/worker-control/poll` and `/worker-control/leases/:leaseId/ack` verify the session JWT via
  `verifyWorkerOperationProof` but **never re-issue** an `aoa-worker-session` header (no sliding
  renewal). Enroll (the only session issuer) **always requires the code header**; there is no
  device-proof-only reauth.
- The enroll route's catch maps every `WorkerEnrollmentError` except `malformed` to
  `unauthorized`, and `sendWorkerProtocolError` emits only `malformed|unauthorized|
  internal_unavailable` (worker-control.ts:132-146). `target_revoked` (409) is a **poll/ack-only**
  signal (`sendWorkerOperationProtocolError`). So on the enroll/renew path, revocation, code
  expiry, proof reuse, and key mismatch are all observably **HTTP 401 `unauthorized`**.

**Decision:**
1. Replay-enroll (same code + retained `idempotencyKey` + unchanged digest + a **fresh** proof) is
   a **lost-response idempotent RECOVERY** mechanism — recover a session after a dropped enroll
   response, only while the code route is live (≤10 min from issuance). It is **NOT** a sustained
   session-renewal mechanism. WRK-002 does not schedule periodic renewal that the real server
   would reject.
2. The worker treats any enroll/renew-path **401** as **terminal**: stop using the identity, back
   off, and surface that operator **re-enrollment (a fresh code) is required** — it does not spin
   retrying a dead identity. It does not depend on distinguishing `target_revoked` on this path.
3. WRK-002 scope = enroll + device identity/key store + device proof + lost-response recovery +
   revocation/terminal-401 handling. **Sustained session renewal past the code-route window is
   OUT of WRK-002** and is escalated as [[E4-F007]].
4. Test doubles MUST model the code-route TTL (a fake that accepts replays the real server rejects
   is a defect). The recovery test proves within-window recovery succeeds and post-window replay
   → 401 → terminal stop.

## E4-D12 — Worker provider-constraint profile is a digest-verified provisioning input; the poll loop stays inert until provisioned + supervised

**Date:** 2026-08-13 · **Ticket:** WRK-003 · **Status:** locked.

The frozen `workerSatisfiesRequirements` capability self-check needs the worker's registered
target profile + a BRANDED full provider-constraint profile
(`verifyAndBrandProviderConstraintProfileV1` digest-verifies a full profile against a ref). But
the as-built JOB-002 enroll response (`enrollmentResponseV1Schema:206`, `job.ts:141`) delivers
`providerConstraints` only as a REF `{profileId, version, digest}`, never the full profile.

The WRK-003 adversarial review (contract-fidelity dimension) examined this and raised **no
defect** — the ref-based design is deliberate: the worker POSSESSES its full provider-constraint
profile (operator provisioning / deployment config) and uses the enroll ref's digest to VERIFY it
is the currently-registered one.

**Decision:** WRK-003 consumes a `WorkerSelfModel` (registered target profile + branded provider
constraints) as an explicit **provisioning input**, digest-verified against the enroll ref. It
does NOT fabricate profiles the worker cannot possess, and it does NOT invent a fetch endpoint.
Consequently the poll loop is **composed but not started at runtime** (dispatch stays inert,
matching WRK-001) until the provisioning source and the WRK-004 supervisor land; rollback = omit
the loop. **Forward concern (not a WRK-003 defect):** if the server rotates a target's
provider-constraint digest, a statically-provisioned worker profile goes stale (brand fails →
self-check fails → cannot ACK) until re-provisioned; profile refresh/rotation delivery is a
JOB-002-family provisioning follow-up (relative of [[E4-F007]]), to be handled when the loop is
wired for live dispatch.

## E4-D13 — The `claude_local` usage format is PORTED into the daemon, not imported or injected; the stdout channel is an optional callback on `ExecuteInput`, scrubbed per run

**Date:** 2026-09-21 · **Ticket:** WRK-018 · **Status:** proposed (locks on WRK-018's distinct review).

WRK-018 must turn a distributed run's own report into one `usage` event. The only source is the
agent's stdout: `claude --print - --output-format stream-json --verbose` (the sandbox argv in
`server/src/services/task-run-sandbox-invocation.ts`, and the local adapter's argv in
`packages/adapters/claude-local/src/server/execute.ts`) ends with a `{"type":"result"}` line whose
`usage` object the server parser `parseClaudeStreamJson`
(`packages/adapters/claude-local/src/server/parse.ts`) already reads for heartbeat cost events. The
daemon cannot import that parser: `@armyofagents/adapters` is outside the E4-D01 boundary
(`scripts/check-worker-daemon-boundary.mjs`).

**Decision 1 — port the format, do not inject the parser.** `parseClaudeStreamJsonUsage`
(`packages/worker-daemon/src/supervisor/usage-observer.ts`) re-implements the one thing the daemon
needs — the LAST `type:"result"` line's `usage.{input_tokens, output_tokens,
cache_read_input_tokens}`, with the server's missing-field-is-0 rule — and deliberately returns NO
usage (not zeros) for a result line without a `usage` object or with a count the frozen
`usagePayloadV1Schema` would reject. A PRESENT count that is not a number (a string, `null`, or the redaction marker) and a
final result line the scrubber made unparseable are likewise NO usage - never a silent 0, and never
an earlier result line standing in for the final one (Codex P2, PR #546).
The port reads usage ONLY from the stream's FINAL non-empty line, which must parse as exactly
`type:"result"` with no redaction marker in any `usage` key; this departs from the server's
"last result line anywhere" scan on purpose, because the input is canary-scrubbed and a canary can
overlap structure (a digit, the word `result`, a key) - a trailing non-result line, or any structural
redaction, is therefore no usage (Codex P1, PR #546). Injecting the server parser from a composition root was
rejected: it would make every worker image carry the adapters package (and its transitive server
utilities) to extract four integers, which is exactly the coupling E4-D01 exists to prevent. The
cost of porting is drift; it is paid by a conformance test that reads the REAL captured claude
transcript the server suite already pins (`server/src/__tests__/fixtures/claude-stream-json-tool-call.jsonl`)
by path and asserts the server's field map.

**Decision 2 — the channel is an optional CALLBACK on `ExecuteInput` (`onStdout`), not a sibling op
or a field on `ExecuteResult`.** A callback streams while the command runs (bounded memory), rides
the transport handler the E2B provider already had (`E2bStreamHandlers.onStdout`, CLI-003/D1), and
is ignored by a provider that does not implement it. The supervisor passes it only when an
`observeRun` is composed, so without one the execute input is byte-identical. On the networked lane
a callback cannot cross HTTP: the driver sends an additive `captureStdout: true` flag and the
adapter-manager returns an additive `stdoutTail`; both absent ⇒ both bodies byte-identical, and an
older adapter-manager degrades to "no usage", never a failure. The frozen `ProviderOperation`
vocabulary and the worker protocol are untouched.

**Decision 3 — scrub per run, at read time, over whole lines, fail closed (H-04).** The supervisor's
per-run `createRunOutputCapture` (`supervisor/run-output.ts`) holds a bounded, whole-line stdout
TAIL and scrubs it with the run's OWN live canary array before `observeRun` sees it; a residual
needle drops the whole tail. Whole-line retention is what makes a canary split across chunks
unmissable. The adapter-manager scrubs with the SAME implementation, keyed on that request's env
values — on this lane exactly the run's canaries (`synthesiseRunSecrets` puts every redeemed value
into `env` and nothing else) — so raw output never crosses the wire. The composed observer emits
usage ONLY (four integers); it never re-emits stdout as `log` events.

**Consequence.** A result line longer than the tail bound (1 MiB) yields no usage, which JOB-016's
terminal-without-usage signal reports. `runtimeMillis` is the supervisor's own execute window, not
the agent's `duration_ms`. Usage is agent-reported by definition; a non-claude tenant command that
prints a well-formed result line is priced on what it printed.
