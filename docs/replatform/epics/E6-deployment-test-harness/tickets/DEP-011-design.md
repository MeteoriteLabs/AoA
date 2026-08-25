# DEP-011 — The containerized worker→provider networked wire (E6-F003 successor)

**Epic:** E6 · **Plan node:** `docs/replatform/program-design.md`, `#### DEP-011`
**Depends on:** DEP-010 · **Size:** (scope only) · **Status:** scoping
**Owns:** finding **E6-F003** (`epics/E6-deployment-test-harness/findings.md`)

---

## Why this ticket exists

DEP-010 (Sprint 2) named the authoritative provider **port** (the per-op `SandboxProvider`) and
gave the **desktop/self-hosted** lane a real provider via `worker-keystore/src/bin/sandbox-provider.ts`.
It **deferred** the other half of E6-F003: the networked **wire** a *containerized* worker's provider
driver speaks to `adapter-manager`. This ticket is that successor. It is filed **now**, at DEP-010's
completion, so E6-F003 is not left `owned` by a shipped ticket — which reads as owned by nobody and
fails nothing (finding **E4-F013**). DEP-010 repoints E6-F003's manifest `ticket` to this id.

## What it must build (design written at sprint start, against the tree as it exists then)

The request/response shapes and client a container worker's provider driver speaks to
`adapter-manager` over **`control-net`** (NOT `provider-ctl-net`, which is adapter-manager-only and a
hard `PROVIDER-CONTROL VIOLATION` for a worker — and note `docker-compose.d1.yml` overloads that name
to mean the opposite; DEP-010 design §2.1). A container worker cannot use the desktop provider path,
because `E2B_API_KEY` on a worker is forbidden (§2.5), so its provider must be networked, not
key-backed.

## Precondition — when this becomes REQUIRED, not before

The moment a containerized worker under `docker-compose.staging.yml` must dispatch. Today there is no
consumer: `adapter-manager` has **zero implementation**
(`DECISION-byte-egress-and-provider-topology.md` §4 residual 4.2), and no worker dispatches (flag
default-off, no `compose:true` branch). Specifying a wire against an unimplemented peer for an unbuilt
caller is the failure this programme keeps re-learning — hence the deferral. E6-F003 stays **open**
(HIGH; a HIGH may never be `accepted`) and this ticket owns it until the wire is built.

## Status

Scoping stub. No design steps and no result doc yet — deliberately. Sequence it after the
containerized dispatch lane exists (post-Sprint-5). Its full design (terrain, TDD steps, mutation
table, acceptance mapping) is written at that sprint's start, per the go-book's "write the plan at
sprint start" rule for work that would go stale if planned five sprints early.
