# E4 — Worker Daemon

**Status:** `backlog`
**Depends on:** E1 plus ticket-level E3 core dependencies; WRK-005 onward and the exit gate require `E6-D1-FOUNDATION`
**Tickets:** WRK-001 through WRK-007
**Exit gate:** separate worker image leases through the protocol, supervises only sandboxes, survives restart, and replays its encrypted event outbox.

## Mandatory planning brief

The E4 plan must consume PRT-007 operations/errors and the server-registered target profile. WorkerHello reports only dynamic version/health/capacity/capabilities and cannot set trust, owner, provider, credential, locality, or fallback policy. Lease loss disables ordinary commit, secrets, completion, and governed egress; only the explicit quarantine operation may carry orphan output. Supervisor tests cover complete process trees, deadlines, force kill, crash/restart, full disk/corrupt outbox, target-generation replacement, sleep/resume, clock bounds, revocation, and provider cleanup without executing tenant commands in the worker process.
