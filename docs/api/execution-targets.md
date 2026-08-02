---
title: Execution Targets
summary: Organization execution-fleet registration, discovery, and worker heartbeat
---

Execution targets are Organization-scoped fleet inventory used by environment pins and credential-based run routing. A nullable Organization id is reserved for operator-owned system targets and is not exposed by the Organization list endpoint.

## Register a target

```
POST /api/organizations/{organizationId}/execution-targets
```

Requires the Organization owner/admin `execution_target:manage` capability. The body is validated by `createExecutionTargetSchema` and contains:

- `slug`: lowercase letters, digits, and hyphens; 1-64 characters
- `kind`: a supported execution-target kind
- `trustClass`: a supported trust class
- optional `status`, owner, capabilities, and config

Returns `201` with the target plus a one-time `workerToken`. Store that token securely: only its SHA-256 hash is persisted, and later list responses never return it.

## List an Organization's targets

```
GET /api/organizations/{organizationId}/execution-targets
```

Requires the same owner/admin capability. Returns only targets owned by that Organization, with secret fields removed. Operator-owned system targets are used internally for routing and are not included.

## Worker heartbeat

```
POST /api/execution-targets/heartbeat
Authorization: Bearer <workerToken>
```

The token identifies exactly one target; the URL cannot select another Organization or target. The strict optional body may report `status` (`active`, `draining`, or `offline`) and an object-valued `capabilities` map; unknown fields and invalid values return `400`. A disabled target is not reactivated by heartbeat. Returns `204`, `401` for an invalid token, or `404` after the target is removed.

## Isolation status

The registry and hardened `runsc` configuration are present, but the multi-worker gVisor pool transport is a separate follow-up. In `cloud_auth`, registered pooled/dedicated targets and tenant-authored local Docker targets are fail-closed and cannot execute on the control-plane host; a `runtime: "runsc"` string is not proof of worker isolation. Do not deploy a cloud pool until the worker-image Gate-B hardware and egress checkpoints in `docs/aoa/guides/gvisor-worker-image.md` pass.
