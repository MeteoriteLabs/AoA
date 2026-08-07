# E3 — Durable Job Control

**Status:** `backlog`
**Depends on:** E1 and E2; JOB-004 onward and the exit gate require `E6-D1-FOUNDATION`
**Tickets:** JOB-001 through JOB-009
**Exit gate:** submit, enroll, lease, ACK, renew, fence, event, completion, cancellation, retry, quota, revocation, and operator controls pass in D1.

## Mandatory planning brief

The E3 plan is not approvable until it makes durable hybrid placement authoritative. It must separate server-assigned target scope/class, conditional Organization/owner binding, trust/credential/locality ceilings, provider allowlist and normalized provider-constraint profile, revocation generation, and fallback policy from worker-reported version, health, capacity, and capabilities. Scheduler matching uses the intersection; a worker cannot self-promote. Platform targets are operator-managed global catalog entries, but job details remain tenant-scoped and invisible until the atomic placement/lease transaction authorizes them.

`JOB-009 — Authoritative hybrid target placement` lands before JOB-003. JOB-003 leases only through that decision. The plan must cover platform-managed shared workers, dedicated/Organization workers, owner desktops, personal-credential binding, required/preferred/forbidden targets, data-local work, explicit fallback, target replacement, owner removal, drain/revocation races, and attributable queue reasons.

Focused evidence includes false privileged capability advertisement, owner mismatch/removal, target-generation replacement, shared versus dedicated routing, required target offline, allowed/forbidden fallback, owner-only credential with shared fallback requested, local-only workspace with cloud requested, concurrent compatible/incompatible claims, and revocation during lease/secret/upload/terminal commit.
