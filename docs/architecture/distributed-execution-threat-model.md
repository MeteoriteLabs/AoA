# Distributed Execution Threat Model

This record locks the trust boundaries, mandatory controls, verification gates,
residual risks, and owning backlog tickets for the Decision #121 fenced outbound
worker protocol. It is the rendered, explained view of the authoritative
machine-readable record
[`distributed-execution-threat-controls.json`](distributed-execution-threat-controls.json):
every control ID (`DE-NN`), severity, control, verification, and owner in the
register below is derived from that JSON, and the structural checker
(`scripts/check-distributed-execution-foundation.mjs`) fails on any drift between
the two in either direction.

It consumes the lifecycle record
([`distributed-execution-lifecycles.md`](distributed-execution-lifecycles.md))
and the authority record
([`distributed-execution-authority.md`](distributed-execution-authority.md)),
and it treats Decision #103 (plugin boundary) and Decision #117
(execution-target/gVisor boundary) as inputs under repair. Distributed execution
is default-off; `AOA_ALLOW_UNSANDBOXED_MULTITENANT` is forbidden at `cloud_auth`
startup (DE-14).

## Trust boundaries

Each row names the trusted side, the less-trusted side, and the primary
authentication at the crossing. The full control set (authentication,
authorization, confidentiality, integrity, revocation, audit, failure mode,
severity, owner tickets, and verification lane) for every crossing lives in the
JSON and is rendered in the register that follows.

| Boundary | Trusted side | Untrusted/less-trusted side | Authentication |
|---|---|---|---|
| Browser/UI → control plane | tenant-scoped API | browser input | Better Auth/session + live membership |
| Worker → control plane | job/lease APIs | enrolled device | device key + short-lived audience-bound session |
| Worker host → sandbox | worker supervisor | tenant workload | provider/sandbox identity + lease fence |
| Provider manager → expired/replaced resource | cleanup-only management boundary | stale tenant effect authority and foreign/sensitive resource data | resource/ownership/generation/deadline-bound monotonic cleanup authority with management-only inspect projection |
| Control plane → object store | artifact broker | object bytes/keys | scoped service identity and presigned grants |
| Control plane → secret store | secret broker | secret material | service identity + tenant/lease authorization |
| Control plane → connector provider | MCP OAuth broker | access/refresh token and remote API | company-scoped grant + fenced refresh lease |
| Worker/sandbox → context APIs | control-plane memory/context service | company memory and actor scope | worker session + tenant/job/lease/fence authorization |
| Sandbox → network | filtered egress | external destinations | destination policy and credential-injecting proxy |
| Legacy → distributed owner | cutover transaction | duplicate executor | single-writer owner and rollout flag |

Additional crossings closed by the register below and mandated by the foundation
hardening amendment — placement/target registry (DE-18), context/memory API
(DE-19), realtime broker (DE-21), telemetry/evidence store (DE-22),
backup/restore (DE-23), desktop installer/updater (DE-24), local folder (DE-25),
real-provider isolation (DE-26), multi-replica coordination (DE-27), quarantine
promotion (DE-28), owner-credential routing (DE-29), and capability-claim
admission (DE-30) — extend the same trusted/less-trusted split. The post-fence
cleanup crossing (DE-17) preserves a cleanup authority that is possible,
least-privilege, ownership-scoped, idempotent, deadline-bounded, and incapable of
restoring effect authority.

## Threat and control register

The register is the rendered view of the `crossings` array in
[`distributed-execution-threat-controls.json`](distributed-execution-threat-controls.json).
Every `DE-NN` control is present in both; the checker enforces exact ID-set
parity (both directions, count included) plus per-ID threat/severity/required
control/verification/owner parity. Owner cells name defined backlog tickets in
[`../replatform/program-design.md`](../replatform/program-design.md); an unknown
owner ticket is rejected. Every Critical/High control carries a release test —
either a `REL-*` owner ticket or a `releaseTest` field in the JSON — and the
verification lane (`D0`–`D6`) names the deployment-progression gate that
exercises it.

| ID | Threat | Severity | Required control | Verification | Owner |
|---|---|---|---|---|---|
| DE-01 | Cross-tenant database access | Critical | non-owner role, forced RLS, tenant transaction | real PostgreSQL adversarial tests | TEN-002/TEN-003/TEN-005 |
| DE-02 | Mixed-tenant relationships | Critical | composite tenant constraints | negative SQL integration | TEN-004 |
| DE-03 | Worker credential replay | High | one-use enrollment, device key, short sessions | replay/expiry tests | JOB-002/WRK-002 |
| DE-04 | Double execution | Critical | atomic lease and fencing | concurrent claim/stale fence | JOB-003/JOB-004 |
| DE-05 | Late result overwrite | Critical | terminal immutability and quarantine | lost-ACK/replacement tests | JOB-005/JOB-006 |
| DE-06 | Cross-tenant object key | Critical | tenant/job prefixes and fenced commit | MinIO malicious-key tests | DAT-002 |
| DE-07 | Secret or connector-token exfiltration | Critical | existing OAuth broker, opaque execution handles, live lease/fence, broker-owned refresh, audit, redaction | wrong-tenant/fence/refresh/log corpus | DAT-004/DAT-005/REL-001 |
| DE-08 | Metadata/control-plane SSRF | Critical | default-deny egress and blocked ranges | DNS/IP/metadata tests | DAT-005 |
| DE-09 | Sandbox escape/host command | Critical | tenant commands only inside provider sandbox | image/capability/provider tests | WRK-004/REL-004 |
| DE-10 | Worker crash and orphan sandbox | High | restart reconciliation and provider cleanup | crash-point suite | WRK-007/CLI-004 |
| DE-11 | Browser cookie/trace leakage | High | job-scoped sensitive artifacts and TTL | browser retention/authorization | BRW-003/BRW-004/REL-001 |
| DE-12 | Service split brain | Critical | desired-state reconciler, generation, active fence | partition/drain/generation tests | SVC-002/SVC-003/SVC-005 |
| DE-13 | Noisy-neighbor starvation | High | per-Organization quotas/fair scheduling | multi-tenant load | JOB-007/REL-002 |
| DE-14 | Unsafe hosted fallback | Critical | startup rejects process-wide unsafe override | configuration test | FND-005 |
| DE-15 | Supply-chain image compromise | Critical | pinned digest, scan, signature, kill switch | release gate | REL-004 |
| DE-16 | Cloud plugin code escape | Critical | cloud plugins remain disabled pending separate worker | process/composition plus route/dispatcher/UI negatives and release regression | FND-006/FND-008/REL-005 |
| DE-17 | Cleanup is blocked after fence loss or cleanup authority is escalated | Critical | separate resource-bound monotonic cleanup authority with effect operations unrepresentable | post-fence cleanup, cross-resource denial, and escalation corpus | WRK-004/DEP-008/CLI-004/REL-004 |
| DE-18 | Target-generation replacement | Critical | monotonic placement generation and admission fence | target-replacement and stale-generation tests | JOB-004/MIG-004 |
| DE-19 | Context or memory over-scope | Critical | scoped context API, no memory-table access, actor and visibility enforcement | actor-scope and visibility adversarial tests | DAT-007/TEN-005/REL-001 |
| DE-20 | Duplicate executor across the legacy cutover | Critical | single-writer owner and rollout flag | cutover, drain, and rollback rehearsal | MIG-002/MIG-008/REL-003 |
| DE-21 | Cross-tenant realtime fan-out | High | tenant-scoped topics and authorized catch-up | realtime fan-out and catch-up authorization tests | MIG-003 |
| DE-22 | Audit or evidence overwrite | High | append-only evidence with Supersedes and redaction on transmit | append-only evidence and supersede-integrity tests | FND-005/REL-005 |
| DE-23 | Cross-tenant backup or restore | Critical | tenant-scoped encrypted backup and provenance-checked restore | disaster-recovery and migration rehearsal | REL-003/DAT-002 |
| DE-24 | Desktop supply-chain compromise | Critical | signed installers and signed update with drain and rollback | signed-update, drain, and rollback tests | DSK-003/DSK-004 |
| DE-25 | Out-of-grant local folder mutation | High | explicit folder grants and local sandbox capability | folder-grant and offline-policy tests | DSK-002/DAT-006 |
| DE-26 | Real-provider isolation failure | Critical | managed sandbox isolation conformance on the real provider | real-provider isolation conformance suite | DEP-008/REL-004 |
| DE-27 | Multi-replica coordination hazard | High | shared-admission ownership and serialized admission | two-replica admission and partition tests | FND-005/REL-002 |
| DE-28 | Quarantine promotion | Critical | quarantine prefix with no automatic promotion | late-output quarantine and no-auto-promote tests | JOB-005/JOB-006 |
| DE-29 | Owner-credential misrouting | Critical | company-scoped grant and fenced refresh with owner routing | wrong-owner routing and refusal corpus | DAT-004/DAT-005/REL-001 |
| DE-30 | Malicious capability claim | Critical | server-derived capabilities from verified identity and live membership | capability-spoofing and stale-membership tests | JOB-002/TEN-002 |

### Hardening-amendment coverage

The register represents every crossing the foundation hardening amendment
requires and adds a threat for each named risk:

- **Malicious capability claims** — DE-30: server-derived capabilities; self-asserted claims are never trusted.
- **Owner-credential misrouting** — DE-29: company-scoped grant and fenced refresh route a credential only to its matching owner.
- **Target-generation replacement** — DE-18: monotonic placement generation and an admission fence stop a replaced target from resurrecting work.
- **Desktop supply chain / local folder mutation** — DE-24 and DE-25: signed installers/updates with drain and rollback, and grant-confined local filesystem effects.
- **Multi-replica coordination** — DE-27: shared-admission ownership serializes admission so two control-plane replicas cannot double-admit work.
- **Real-provider isolation** — DE-26: managed sandbox isolation conformance is proven on the real provider, not only in local mocks.
- **Quarantine promotion** — DE-28: quarantined late output is never auto-applied or auto-selected as a checkpoint.
- **Evidence overwrite** — DE-22: append-only evidence under the Supersedes rule; there is no delete path.

The **post-fence cleanup** crossing (DE-17) keeps cleanup possible after fence
loss while making effect operations unrepresentable: cleanup authority is
resource/ownership/generation/deadline-bound and monotonic, permits only
list/inspect/cancel/kill/destroy/reconcile, is idempotent and deadline-bounded,
and can never create, execute, resume, checkpoint, reveal foreign resources, open
egress, or otherwise restore effect authority.

## Residual risks and release exclusions

The following are explicitly **excluded** from the shipped surface for this
program and are not mitigated by the controls above. Each remains a known
residual risk carried forward to a later epic; none may be silently enabled.

- **Public service ingress.** `service` ships with controlled outbound access and connector/queue consumption only; tenant-defined public service ingress is excluded.
- **Cloud plugins.** Hosted cloud plugins remain disabled (DE-16) pending a separately isolated plugin-worker architecture and its release evidence; FND-006/FND-008 enforce the exclusion.
- **Unvalidated gVisor bridge egress.** The deferred gVisor pool is not implemented; unvalidated gVisor bridge egress is excluded until its isolation and egress controls are validated.
- **Active-active multi-region writes.** DE-27 covers a two-replica shared-admission configuration only; active-active multi-region writes are excluded, and no AoA database is a peer replica of another.
- **Unattended orphan-output application.** Late, replaced, or orphaned output is quarantined (DE-05, DE-28); unattended orphan-output application into authoritative state is excluded and never automatic.
