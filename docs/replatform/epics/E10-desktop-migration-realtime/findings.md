# E10 — Desktop migration / realtime — findings

## E10-F001 — The Commander sink has no credential path, so it cannot cut over — and its blast-radius ordering is backwards

**Status:** open · Severity: HIGH · Source: MIG-005 cutover design + adversarial review, 2026-08-27 (3 reviewers; verified against source).

The go-book ordered Sprint 6's sink cutovers by **blast radius** — MIG-005 (Commander) →
MIG-006 (crew) → MIG-007 (extraction). The MIG-005 design and its review established that
**credential-readiness, not blast radius, is the binding constraint**, and by that axis the order is
**reversed**:

- **Extraction (`one_shot`, MIG-007) is the only sink whose cutover is buildable today.** It already
  resolves the **Company's** model-provider key and executes inside an E2B sandbox on cloud
  (`server/src/services/one-shot-sandbox-cli.ts:1-19`) — the same `company_api_key` class CLI-007's
  mint produces. In the shadow evidence it was the **only admissible sink** (`commander_turn` and
  `crew_run` were both refused `source_not_admitted`; `one_shot` had 3 admissible).
- **Crew (`crew_run`, MIG-006)** reads `provider_connections` first and falls back to the Company key
  "exactly like heartbeat" (`internal-agent/aoa-agents/runner.ts:554-577`) — it rides the same
  credential ladder CLI-007 credentialed. More complex than extraction, not a dead end.
- **Commander (`commander_turn`) is the ONLY sink with no mint path.** It runs on a per-user
  `provider_connection` / ambient host login (`internal-agent/cli-mode.ts:834-849`); the mint
  *actively refuses* a `commander_turn` (`server/src/services/execution-secret-handle-mint.ts:122`).
  Its transfer routing (convert/placement/ownership) does not exist either — only shadow observation.

**Consequence / disposition.**
- **Sprint 6 leads with MIG-007 (extraction), then MIG-006 (crew), then MIG-005 (Commander) last.**
  The go-book order is corrected (§4 Sprint 6).
- **The drain fix is a separate, sink-agnostic, unblocked item** and should ship on its own regardless
  of sink order (the go-book already scopes it separately). The MIG-005 design's drain analysis is
  sound (reviewer-verified) and carries forward to that ticket.
- **The Commander flip is blocked on a `commander_turn` per-user credential mint** that does not exist
  and is Decision #117 (route-by-credential) territory. That work shares the general
  envelope/worker-resolution/fence-proxy wiring already owned by **E5 `DEFERRAL-1-credential`**
  (`epics/E5-workspaces-secrets/tickets/DEFERRAL-1-credential-terrain.md`), plus a Commander-specific
  per-user mint that is genuinely net-new.

**Owner:** none yet — a Commander-credential ticket (a real MIG node, not a `DEFERRAL-*` name, which
the coverage checker cannot see) should be filed when Commander is next in sequence. Filed `unowned`
because no ticket in the graph fixes it today and force-fitting it onto an extraction/crew cutover
would be false ownership.

**Blocks:** MIG-005 (Commander) going active/canary. Does **not** block MIG-007 (extraction) or
MIG-006 (crew).
