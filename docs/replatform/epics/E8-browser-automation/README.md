# E8 — Browser Automation

**Status:** `backlog`
**Depends on:** E7
**Tickets:** BRW-001 through BRW-006
**Exit gate:** sandbox-local browser, evidence, approvals, network/secret policy, cancellation, cleanup, and D3 reconnect journey pass.

## Mandatory planning brief

The E8 plan keeps CDP/browser control inside the job sandbox and treats cookies, storage state, traces, video, and downloads as restricted artifacts. It defines approval command/ACK and timeout semantics through PRT-007, broker-owned connector refresh, fence-bound materialization, bounded payloads, retention, and clean-session versus explicitly approved checkpoint retry. D3 covers metadata/private/control-plane denial, redirects/DNS rebinding, credential rotation/revocation, stale fences, cancellation/cleanup, artifact authorization/digests/order, and MIG-003 reconnect/gap/duplicate behavior.
