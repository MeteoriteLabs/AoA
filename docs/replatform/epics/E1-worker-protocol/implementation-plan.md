# Cloud Control Plane Worker E1 Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a versioned, dependency-light worker wire-contract package that defines identities, workload lifecycles, job/lease envelopes, sequenced events, artifact/workspace/secret/network policies, capability negotiation, and frozen conformance vectors.

**Architecture:** `@armyofagents/worker-protocol` is a leaf workspace package shared by future control-plane and worker packages. Runtime source imports only Zod and local modules; it imports no Node APIs and no AoA server, database, adapter, UI, or shared package. Wire objects accept and preserve additive safe fields, reject unknown enum/state values, and recursively reject plaintext credential-bearing keys.

**Tech Stack:** TypeScript 5.7, Zod 3.24, Vitest 3.2, Node.js 24 for tests/contract hashing only, pnpm 9.15.4, JSON conformance vectors.

## Global Constraints

- E0 must be complete on main before E1 begins.
- Canonical source design: `docs/replatform/program-design.md`, tickets PRT-001 through PRT-006.
- Canonical lifecycle values come from `docs/architecture/distributed-execution-lifecycles.md`; do not rename or add states without an E1 decision and Decision #120 update.
- Decisions #118/#119 govern enterprise-memory visibility. Protocol envelopes may carry authorized context artifact references, but never memory-table credentials, unscoped memory dumps, or a replacement memory-visibility model.
- The existing MCP OAuth broker owns connector discovery, refresh leases, token bundles, rotation, and revocation. Protocol envelopes carry opaque secret handles only and never OAuth access or refresh tokens.
- Protocol v1 supports `batch`, `browser_session`, and `service`; provider implementations remain out of scope.
- Every envelope includes Organization, Company, run, job, attempt, lease/fence identity as appropriate.
- Job envelopes contain opaque secret handles only; raw `env`, `apiKey`, `password`, `token`, `accessToken`, `refreshToken`, `cookie`, `authorization`, `credential`, and `secretValue` keys are rejected recursively.
- Unknown enum/state values fail closed. Additive keys with safe names are accepted and preserved for N-1 compatibility.
- Runtime source under `packages/worker-protocol/src/` excluding `*.test.ts` may import only `zod` and relative modules.
- Do not add database schemas, HTTP routes, schedulers, workers, provider SDKs, browser code, or UI.
- Package changes include `package.json` and regenerated `pnpm-lock.yaml` in the same commit.
- Every ticket writes `docs/replatform/epics/E1-worker-protocol/tickets/<TICKET-ID>-result.md` using the repository template.
- Every contract/integration campaign writes an immutable record under `docs/replatform/epics/E1-worker-protocol/qa/`.

---

## File responsibility map

| File | Responsibility |
|---|---|
| `packages/worker-protocol/src/ids.ts` | Branded UUIDs, attempt/sequence integers, fence token, SHA-256 digest. |
| `packages/worker-protocol/src/states.ts` | Workload/state constants and legal transition predicates. |
| `packages/worker-protocol/src/wire-safety.ts` | Recursive rejection of plaintext-credential-bearing keys. |
| `packages/worker-protocol/src/job.ts` | V1 workload-specific job and lease wire envelopes. |
| `packages/worker-protocol/src/events.ts` | V1 event discriminated union, contiguous batches, cumulative ACK. |
| `packages/worker-protocol/src/artifacts.ts` | Workspace/artifact/patch manifests, upload grants, object-prefix fencing. |
| `packages/worker-protocol/src/policy.ts` | Resource, network, secret materialization, retention, and offline policy schemas. |
| `packages/worker-protocol/src/capabilities.ts` | Worker hello/capacity/capabilities and requirement matching. |
| `packages/worker-protocol/src/version.ts` | Current/minimum version constants and overlap negotiation. |
| `packages/worker-protocol/src/index.ts` | Explicit public exports only. |
| `docs/contracts/worker-protocol/v1/conformance.json` | Frozen valid/invalid producer-consumer vectors. |
| `docs/contracts/worker-protocol/v1/manifest.sha256` | Exact contract byte hashes. |
| `scripts/check-worker-protocol-boundary.mjs` | Dependency/import/process-global boundary check for the always-on policy job. |
| `scripts/update-worker-protocol-contract-manifest.mjs` | Deterministically regenerates the hash manifest. |
| `vitest.config.ts` | Registers the package as a root Vitest project. |

---

### Task 1: PRT-001 — Leaf Protocol Package and Boundary Gate

**Files:**
- Create: `packages/worker-protocol/package.json`
- Create: `packages/worker-protocol/tsconfig.json`
- Create: `packages/worker-protocol/vitest.config.ts`
- Create: `packages/worker-protocol/src/version.ts`
- Create: `packages/worker-protocol/src/index.ts`
- Create: `packages/worker-protocol/src/index.test.ts`
- Create: `scripts/check-worker-protocol-boundary.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `vitest.config.ts`
- Modify: `.github/workflows/pr.yml`

**Interfaces:**
- Consumes: pnpm `packages/*` workspace glob and root TS/Vitest conventions.
- Produces: package `@armyofagents/worker-protocol`; `PROTOCOL_VERSION = 1`; `MIN_PROTOCOL_VERSION = 1`; `pnpm check:worker-protocol-boundary`.

- [ ] **Step 1: Add a failing boundary checker**

Add this root package script:

```json
"check:worker-protocol-boundary": "node scripts/check-worker-protocol-boundary.mjs"
```

Create `scripts/check-worker-protocol-boundary.mjs`:

```js
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const packageRoot = path.join(root, "packages", "worker-protocol");
const errors = [];

let manifest;
try {
  manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
} catch {
  errors.push("packages/worker-protocol/package.json: missing or invalid");
}

if (manifest) {
  const runtimeDependencies = Object.keys(manifest.dependencies ?? {}).sort();
  if (JSON.stringify(runtimeDependencies) !== JSON.stringify(["zod"])) {
    errors.push(`runtime dependencies must equal [\"zod\"], got ${JSON.stringify(runtimeDependencies)}`);
  }
  if (manifest.name !== "@armyofagents/worker-protocol") {
    errors.push(`unexpected package name ${JSON.stringify(manifest.name)}`);
  }
}

const forbiddenImport = /(?:from\s+|import\s*)["'](?:node:|@armyofagents\/(?:server|db|adapter-utils|shared|plugin-sdk)|(?:\.\.\/){2,}(?:server|ui|packages\/db))/;
const forbiddenGlobal = /\b(?:process|Buffer)\s*\.|\b(?:__dirname|__filename)\b/;

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(absolute);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      const source = await readFile(absolute, "utf8");
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      if (forbiddenImport.test(source)) errors.push(`${relative}: forbidden runtime import`);
      if (forbiddenGlobal.test(source)) errors.push(`${relative}: forbidden Node process global`);
    }
  }
}

try {
  await walk(path.join(packageRoot, "src"));
} catch {
  errors.push("packages/worker-protocol/src: missing");
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("worker protocol boundary: PASS");
```

- [ ] **Step 2: Run the boundary checker and verify RED**

Run:

```powershell
pnpm check:worker-protocol-boundary
```

Expected: exit 1 naming the missing package manifest and source directory.

- [ ] **Step 3: Add the package manifest and build configuration**

Create `packages/worker-protocol/package.json`:

```json
{
  "name": "@armyofagents/worker-protocol",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*.ts"
  },
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "test:run": "vitest run"
  },
  "dependencies": {
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/node": "^24.6.0",
    "typescript": "^5.7.3",
    "vitest": "^3.2.6"
  }
}
```

Create `packages/worker-protocol/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

Create `packages/worker-protocol/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

Add `"packages/worker-protocol"` to the root `vitest.config.ts` project list.

- [ ] **Step 4: Write a failing public-entry test**

Create `packages/worker-protocol/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MIN_PROTOCOL_VERSION, PROTOCOL_VERSION } from "./index.js";

describe("worker protocol package", () => {
  it("exports the initial version range", () => {
    expect(MIN_PROTOCOL_VERSION).toBe(1);
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
```

Run:

```powershell
pnpm --filter @armyofagents/worker-protocol test:run
```

Expected: FAIL because `src/index.ts` and version exports do not exist.

- [ ] **Step 5: Implement the initial version entrypoint**

Create `packages/worker-protocol/src/version.ts`:

```ts
export const MIN_PROTOCOL_VERSION = 1 as const;
export const PROTOCOL_VERSION = 1 as const;
```

Create `packages/worker-protocol/src/index.ts`:

```ts
export { MIN_PROTOCOL_VERSION, PROTOCOL_VERSION } from "./version.js";
```

- [ ] **Step 6: Regenerate and verify dependency state**

Run:

```powershell
pnpm install --no-frozen-lockfile
pnpm install --frozen-lockfile
pnpm --filter @armyofagents/worker-protocol test:run
pnpm --filter @armyofagents/worker-protocol typecheck
pnpm --filter @armyofagents/worker-protocol build
pnpm check:worker-protocol-boundary
```

Expected: all commands exit 0.

- [ ] **Step 7: Add the always-on policy check**

In `.github/workflows/pr.yml`, after the E0 foundation-contract step in the `policy` job, add:

```yaml
      - name: Worker protocol dependency boundary
        run: node scripts/check-worker-protocol-boundary.mjs
```

This uses no installed dependencies and must remain in the always-on policy job.

- [ ] **Step 8: Record and commit PRT-001**

Create `docs/replatform/epics/E1-worker-protocol/tickets/PRT-001-result.md`. Record the intentional missing-package RED result, manifest/lockfile change, package test/typecheck/build results, boundary result, and policy-job change.

```powershell
git add package.json pnpm-lock.yaml vitest.config.ts .github/workflows/pr.yml scripts/check-worker-protocol-boundary.mjs packages/worker-protocol docs/replatform/epics/E1-worker-protocol/tickets/PRT-001-result.md
git commit -m "feat: scaffold worker protocol package"
```

---

### Task 2: PRT-002 — Branded Identities and Lifecycle State Machines

**Files:**
- Create: `packages/worker-protocol/src/ids.ts`
- Create: `packages/worker-protocol/src/ids.test.ts`
- Create: `packages/worker-protocol/src/states.ts`
- Create: `packages/worker-protocol/src/states.test.ts`
- Modify: `packages/worker-protocol/src/index.ts`

**Interfaces:**
- Consumes: E0 lifecycle status sets.
- Produces: branded ID schemas/types, `attemptNumberSchema`, `eventSequenceSchema`, `fenceTokenSchema`, `sha256DigestSchema`, workload/status schemas, and `canTransition*` functions.

- [ ] **Step 1: Write failing identity tests**

Create `packages/worker-protocol/src/ids.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  attemptNumberSchema,
  eventSequenceSchema,
  fenceTokenSchema,
  jobIdSchema,
  organizationIdSchema,
  sha256DigestSchema,
} from "./ids.js";

describe("wire identities", () => {
  it("accepts UUID identities and positive counters", () => {
    expect(organizationIdSchema.parse("00000000-0000-4000-8000-000000000001")).toBeTruthy();
    expect(jobIdSchema.parse("00000000-0000-4000-8000-000000000002")).toBeTruthy();
    expect(attemptNumberSchema.parse(1)).toBe(1);
    expect(eventSequenceSchema.parse(1)).toBe(1);
  });

  it("rejects malformed identities and non-positive counters", () => {
    expect(jobIdSchema.safeParse("job-1").success).toBe(false);
    expect(attemptNumberSchema.safeParse(0).success).toBe(false);
    expect(eventSequenceSchema.safeParse(-1).success).toBe(false);
  });

  it("accepts only bounded base64url fences and lowercase SHA-256", () => {
    expect(fenceTokenSchema.safeParse("a".repeat(43)).success).toBe(true);
    expect(fenceTokenSchema.safeParse("short").success).toBe(false);
    expect(sha256DigestSchema.safeParse("f".repeat(64)).success).toBe(true);
    expect(sha256DigestSchema.safeParse("F".repeat(64)).success).toBe(false);
  });
});
```

- [ ] **Step 2: Write failing exhaustive transition tests**

Create `packages/worker-protocol/src/states.test.ts`. Define expected transition records matching E0 and assert every Cartesian pair:

```ts
import { describe, expect, it } from "vitest";
import {
  BROWSER_SESSION_STATUSES,
  JOB_STATUSES,
  SERVICE_DESIRED_STATES,
  SERVICE_INSTANCE_STATUSES,
  canTransitionBrowserSessionStatus,
  canTransitionJobStatus,
  canTransitionServiceDesiredState,
  canTransitionServiceInstanceStatus,
  workloadTypeSchema,
} from "./states.js";

const jobExpected = {
  queued: ["leased", "cancelled"],
  leased: ["queued", "running", "cancel_requested", "expired"],
  running: ["cancel_requested", "succeeded", "failed", "expired"],
  cancel_requested: ["cancelled", "failed", "expired"],
  succeeded: [], failed: [], cancelled: [], expired: [], dead_letter: [],
} as const;

describe("protocol state machines", () => {
  it("accepts only the three locked workload types", () => {
    expect(workloadTypeSchema.parse("batch")).toBe("batch");
    expect(workloadTypeSchema.parse("browser_session")).toBe("browser_session");
    expect(workloadTypeSchema.parse("service")).toBe("service");
    expect(workloadTypeSchema.safeParse("daemon").success).toBe(false);
  });

  it("matches every allowed and forbidden job transition", () => {
    for (const from of JOB_STATUSES) {
      for (const to of JOB_STATUSES) {
        expect(canTransitionJobStatus(from, to), `${from} -> ${to}`).toBe(
          (jobExpected[from] as readonly string[]).includes(to),
        );
      }
    }
  });

  it("keeps all terminal states immutable", () => {
    for (const status of ["succeeded", "failed", "cancelled", "expired", "dead_letter"] as const) {
      expect(JOB_STATUSES.every((to) => !canTransitionJobStatus(status, to))).toBe(true);
    }
  });
});
```

In the same file, add explicit expected maps and Cartesian assertions for:

- browser: `queued→leased|cancelled`; `leased→starting|cancel_requested|expired`; `starting→active|cancel_requested|failed|expired`; `active→waiting_approval|cancel_requested|succeeded|failed|expired`; `waiting_approval→active|cancel_requested|failed|expired`; `cancel_requested→cancelled|failed|expired`; terminals immutable;
- service desired: `running→paused|stopped|deleted`; `paused→running|stopped|deleted`; `stopped→running|deleted`; `deleted→[]`;
- service instance: `pending→leased|stopped|failed`; `leased→starting|stopping|lost`; `starting→healthy|unhealthy|stopping|failed|lost`; `healthy→unhealthy|stopping|failed|lost`; `unhealthy→healthy|stopping|failed|lost`; `stopping→stopped|failed|lost`; terminals `stopped|failed|lost` immutable.

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
pnpm --filter @armyofagents/worker-protocol exec vitest run src/ids.test.ts src/states.test.ts
```

Expected: FAIL because identity and state modules do not exist.

- [ ] **Step 4: Implement branded identities**

Create `ids.ts` with a shared UUID schema and these exact exports:

```ts
import { z } from "zod";

const uuidSchema = z.string().uuid();
export const organizationIdSchema = uuidSchema.brand<"OrganizationId">();
export const companyIdSchema = uuidSchema.brand<"CompanyId">();
export const runIdSchema = uuidSchema.brand<"RunId">();
export const issueIdSchema = uuidSchema.brand<"IssueId">();
export const jobIdSchema = uuidSchema.brand<"JobId">();
export const workerIdSchema = uuidSchema.brand<"WorkerId">();
export const targetIdSchema = uuidSchema.brand<"TargetId">();
export const leaseIdSchema = uuidSchema.brand<"LeaseId">();
export const eventIdSchema = uuidSchema.brand<"EventId">();
export const artifactIdSchema = uuidSchema.brand<"ArtifactId">();
export const secretHandleIdSchema = uuidSchema.brand<"SecretHandleId">();
export const serviceIdSchema = uuidSchema.brand<"ServiceId">();
export const serviceInstanceIdSchema = uuidSchema.brand<"ServiceInstanceId">();
export const sandboxIdSchema = z.string().min(1).max(200).brand<"SandboxId">();
export const attemptNumberSchema = z.number().int().positive().max(1_000_000);
export const eventSequenceSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const fenceTokenSchema = z.string().min(32).max(256).regex(/^[A-Za-z0-9_-]+$/).brand<"FenceToken">();
export const sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/).brand<"Sha256Digest">();

export type OrganizationId = z.infer<typeof organizationIdSchema>;
export type CompanyId = z.infer<typeof companyIdSchema>;
export type RunId = z.infer<typeof runIdSchema>;
export type IssueId = z.infer<typeof issueIdSchema>;
export type JobId = z.infer<typeof jobIdSchema>;
export type WorkerId = z.infer<typeof workerIdSchema>;
export type TargetId = z.infer<typeof targetIdSchema>;
export type LeaseId = z.infer<typeof leaseIdSchema>;
export type EventId = z.infer<typeof eventIdSchema>;
export type ArtifactId = z.infer<typeof artifactIdSchema>;
export type SecretHandleId = z.infer<typeof secretHandleIdSchema>;
export type ServiceId = z.infer<typeof serviceIdSchema>;
export type ServiceInstanceId = z.infer<typeof serviceInstanceIdSchema>;
export type SandboxId = z.infer<typeof sandboxIdSchema>;
export type FenceToken = z.infer<typeof fenceTokenSchema>;
export type Sha256Digest = z.infer<typeof sha256DigestSchema>;
```

- [ ] **Step 5: Implement state constants and predicates**

Create `states.ts` with `as const` arrays, Zod enums, inferred types, transition maps, and four named predicates. Use this helper:

```ts
function canTransition<S extends string>(
  transitions: Readonly<Record<S, readonly S[]>>,
  from: S,
  to: S,
): boolean {
  return (transitions[from] as readonly string[]).includes(to);
}
```

Export exactly:

```ts
WORKLOAD_TYPES, workloadTypeSchema, type WorkloadType
JOB_STATUSES, jobStatusSchema, type JobStatus, canTransitionJobStatus
BROWSER_SESSION_STATUSES, browserSessionStatusSchema, type BrowserSessionStatus, canTransitionBrowserSessionStatus
SERVICE_DESIRED_STATES, serviceDesiredStateSchema, type ServiceDesiredState, canTransitionServiceDesiredState
SERVICE_INSTANCE_STATUSES, serviceInstanceStatusSchema, type ServiceInstanceStatus, canTransitionServiceInstanceStatus
```

Populate transition maps with the exact values asserted in Step 2.

- [ ] **Step 6: Export, verify, record, and commit PRT-002**

Export every schema, constant, predicate, and type from `index.ts`. Run:

```powershell
pnpm --filter @armyofagents/worker-protocol exec vitest run src/ids.test.ts src/states.test.ts
pnpm --filter @armyofagents/worker-protocol typecheck
pnpm check:worker-protocol-boundary
```

Expected: PASS.

Create `docs/replatform/epics/E1-worker-protocol/tickets/PRT-002-result.md` with the exhaustive transition counts and identity validation evidence.

```powershell
git add packages/worker-protocol/src docs/replatform/epics/E1-worker-protocol/tickets/PRT-002-result.md
git commit -m "feat: define worker protocol identities and states"
```

---

### Task 3: PRT-003 — Job, Workload, and Lease Envelopes

**Files:**
- Create: `packages/worker-protocol/src/wire-safety.ts`
- Create: `packages/worker-protocol/src/wire-safety.test.ts`
- Create: `packages/worker-protocol/src/job.ts`
- Create: `packages/worker-protocol/src/job.test.ts`
- Modify: `packages/worker-protocol/src/index.ts`

**Interfaces:**
- Consumes: protocol version, branded IDs, workload type.
- Produces: `jobEnvelopeV1Schema`, workload-specific envelopes, `leaseOfferV1Schema`, `leaseAckV1Schema`, `leaseRenewRequestV1Schema`, `leaseRenewResponseV1Schema`, and inferred wire types.

- [ ] **Step 1: Write failing recursive wire-safety tests**

Create `wire-safety.test.ts` asserting:

```ts
import { describe, expect, it } from "vitest";
import { findForbiddenWireKeys } from "./wire-safety.js";

describe("wire safety", () => {
  it("finds credential-bearing keys recursively", () => {
    expect(findForbiddenWireKeys({
      future: { apiKey: "x" },
      oauth: { accessToken: "y", refreshToken: "z" },
      rows: [{ password: "w" }],
    })).toEqual([
      "future.apiKey",
      "oauth.accessToken",
      "oauth.refreshToken",
      "rows.0.password",
    ]);
  });

  it("does not reject opaque handle identifiers", () => {
    expect(findForbiddenWireKeys({ secretHandleIds: ["id"], policyHash: "hash" })).toEqual([]);
  });
});
```

Forbidden keys are compared case-insensitively after removing punctuation and underscores, so camelCase OAuth fields fail too. The normalized forbidden set is exactly:

```ts
["env", "environment", "apikey", "password", "token", "accesstoken", "refreshtoken", "cookie", "authorization", "credential", "credentials", "secretvalue"]
```

- [ ] **Step 2: Write failing job/lease schema tests**

Create `job.test.ts` with one valid envelope per workload. Use fixed UUIDs, RFC3339 timestamps, lowercase 64-character hashes, and a 43-character fence. Assert:

- matching `workloadType`/workload payload parses;
- `batch` with a browser payload fails;
- attempt `0` fails;
- deadline before `createdAt` fails;
- `futureSchedulingHint` is accepted and preserved;
- nested `apiKey`, `env`, `cookie`, `accessToken`, or `refreshToken` fails;
- only handle IDs appear in `secretHandleIds`;
- lease ACK/renew messages require the same job/attempt/lease/fence identity shape;
- ACK deadline must precede lease expiry;
- renewal response contains server-selected `expiresAt` and durable cancellation state.

Use this valid batch fixture in the test:

```ts
const batchJob = {
  protocolVersion: 1,
  jobId: "00000000-0000-4000-8000-000000000010",
  attempt: 1,
  organizationId: "00000000-0000-4000-8000-000000000011",
  companyId: "00000000-0000-4000-8000-000000000012",
  runId: "00000000-0000-4000-8000-000000000013",
  issueId: "00000000-0000-4000-8000-000000000014",
  createdAt: "2026-08-07T00:00:00.000Z",
  notBefore: null,
  deadline: "2026-08-07T01:00:00.000Z",
  inputHash: "a".repeat(64),
  policyHash: "b".repeat(64),
  adapter: { type: "codex_local", version: "0.2.7", configArtifactId: null },
  requiredCapabilities: ["workload.batch", "provider.fake"],
  workspace: {
    manifestArtifactId: "00000000-0000-4000-8000-000000000015",
    baseRevision: "0123456789abcdef0123456789abcdef01234567",
    mode: "read_write",
  },
  secretHandleIds: ["00000000-0000-4000-8000-000000000016"],
  resourceLimits: { cpuMillis: 2000, memoryMiB: 4096, pids: 512, diskMiB: 10240 },
  networkPolicy: { policyId: "provider-only", version: 1, digest: "c".repeat(64) },
  offlinePolicy: "cancel",
  workloadType: "batch",
  workload: {
    command: "codex",
    args: ["exec", "--json"],
    stdinArtifactId: null,
    maxRuntimeSeconds: 3600,
  },
};
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
pnpm --filter @armyofagents/worker-protocol exec vitest run src/wire-safety.test.ts src/job.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement recursive forbidden-key detection**

Create `wire-safety.ts` exporting:

```ts
import { z } from "zod";

export const FORBIDDEN_WIRE_KEYS: ReadonlySet<string>;
export function findForbiddenWireKeys(value: unknown): string[];
export function addForbiddenWireKeyIssues(value: unknown, ctx: z.RefinementCtx): void;
```

Traverse plain objects and arrays, sort object keys for deterministic output, compare normalized keys against the exact Step 1 set, and report `z.ZodIssueCode.custom` at the offending path. Do not inspect string values and do not reject the known key `secretHandleIds`.

- [ ] **Step 5: Implement workload-specific job envelopes**

In `job.ts`, define common passthrough schemas for:

```ts
timestamp: RFC3339 with offset
adapter: { type: non-empty max 100, version: non-empty max 100, configArtifactId: ArtifactId | null }
workspace: { manifestArtifactId: ArtifactId, baseRevision: 40–64 lowercase hex, mode: "read_only" | "read_write" } | null
resourceLimits: { cpuMillis: 100–128000, memoryMiB: 128–1048576, pids: 16–100000, diskMiB: 128–10485760 }
networkPolicy: { policyId: slug, version: positive integer, digest: Sha256Digest }
offlinePolicy: "cancel" | "finish_without_remote_effects" | "continue_until_lease_expiry"
```

Define three `.passthrough()` envelope objects and combine with `z.discriminatedUnion("workloadType", ...)`:

```ts
batch workload: { command, args max 256, stdinArtifactId nullable, maxRuntimeSeconds 1–86400 }
browser workload: { engine: "chromium", viewport width/height, locale, timezone, recordTrace, recordVideo, maxSessionSeconds 1–43200 }
service workload: { serviceId, serviceInstanceId, generation positive, command, args max 256, checkpointArtifactId nullable, gracefulStopSeconds 1–300 }
```

The common envelope contains every field in `batchJob` above. Add a final `superRefine` that:

- calls `addForbiddenWireKeyIssues`;
- rejects `deadline <= createdAt`;
- rejects `notBefore > deadline`;
- rejects duplicate `requiredCapabilities` or `secretHandleIds`.

Export each workload schema, the union, and inferred types.

- [ ] **Step 6: Implement lease messages**

Create passthrough V1 schemas:

```ts
LeaseOfferV1 = { protocolVersion: 1, workerId, leaseId, fenceToken, ackDeadline, expiresAt, job: JobEnvelopeV1 }
LeaseAckV1 = { protocolVersion: 1, workerId, jobId, attempt, leaseId, fenceToken, ackedAt }
LeaseRenewRequestV1 = { protocolVersion: 1, workerId, jobId, attempt, leaseId, fenceToken, observedAt }
LeaseRenewResponseV1 = { protocolVersion: 1, jobId, attempt, leaseId, expiresAt, cancelRequested, cancelReason nullable }
```

`LeaseOfferV1` rejects `ackDeadline >= expiresAt` and recursively forbidden keys. Other messages reject forbidden keys. Export inferred types.

- [ ] **Step 7: Export, verify, record, and commit PRT-003**

Run:

```powershell
pnpm --filter @armyofagents/worker-protocol exec vitest run src/wire-safety.test.ts src/job.test.ts
pnpm --filter @armyofagents/worker-protocol typecheck
pnpm check:worker-protocol-boundary
```

Expected: PASS.

Create `docs/replatform/epics/E1-worker-protocol/tickets/PRT-003-result.md`, recording safe additive-field preservation and every forbidden credential-key test.

```powershell
git add packages/worker-protocol/src docs/replatform/epics/E1-worker-protocol/tickets/PRT-003-result.md
git commit -m "feat: define worker job and lease envelopes"
```

---

### Task 4: PRT-004 — Sequenced Worker Events and Cumulative ACK

**Files:**
- Create: `packages/worker-protocol/src/events.ts`
- Create: `packages/worker-protocol/src/events.test.ts`
- Modify: `packages/worker-protocol/src/index.ts`

**Interfaces:**
- Consumes: job/attempt/lease/fence/event identities and lifecycle states.
- Produces: `workerEventV1Schema`, `workerEventBatchV1Schema`, `workerEventAckV1Schema`, event payload types, and contiguous-sequence validation.

- [ ] **Step 1: Write failing event tests**

Create `events.test.ts` with a helper that fills common event fields:

```ts
const base = {
  protocolVersion: 1,
  eventId: "00000000-0000-4000-8000-000000000021",
  jobId: "00000000-0000-4000-8000-000000000022",
  attempt: 1,
  leaseId: "00000000-0000-4000-8000-000000000023",
  fenceToken: "d".repeat(43),
  seq: 1,
  occurredAt: "2026-08-07T00:00:01.000Z",
};
```

Assert:

- every event type below parses with its required payload;
- unknown event type fails;
- log message over 65,536 characters fails;
- nested credential-bearing key fails;
- safe additive fields survive parsing;
- batch events must be strictly increasing and contiguous;
- duplicate sequence/event ID fails;
- a gap from 1 to 3 fails;
- cumulative ACK requires `expectedNextSeq = acceptedThroughSeq + 1`;
- rejection ACK names the expected sequence and rejects negative values.

- [ ] **Step 2: Run event tests and verify RED**

Run:

```powershell
pnpm --filter @armyofagents/worker-protocol exec vitest run src/events.test.ts
```

Expected: FAIL because `events.ts` does not exist.

- [ ] **Step 3: Implement the event discriminated union**

Define a passthrough base with `protocolVersion`, `eventId`, `jobId`, `attempt`, `leaseId`, `fenceToken`, positive `seq`, and `occurredAt`. Extend it into these exact event/payload pairs:

```ts
attempt_started: { sandboxId }
log: { stream: "stdout" | "stderr" | "system", level: "debug" | "info" | "warn" | "error", message: string max 65536 }
progress: { message: string max 2000, percent: number 0–100 nullable }
usage: { inputTokens, outputTokens, cachedInputTokens, costMicros; all non-negative integers }
artifact_prepared: { artifactId, kind: artifact-kind string }
browser_observation: { artifactIds, url nullable max 4096, title nullable max 1000 }
browser_approval_requested: { approvalId UUID, action max 200, summary max 4000 }
service_health: { serviceId, serviceInstanceId, status: "healthy" | "unhealthy", detail nullable max 4000 }
checkpoint_prepared: { artifactId, serviceId, serviceInstanceId, generation positive }
network_denied: { destinationClass: "metadata" | "private" | "control_plane" | "not_allowlisted", reason max 1000 }
terminal: { status: "succeeded" | "failed" | "cancelled" | "expired", exitCode nullable integer, errorCode nullable max 100, errorMessage nullable max 4000 }
```

Combine them with `z.discriminatedUnion("eventType", ...)`. Apply recursive wire-safety refinement to every event.

- [ ] **Step 4: Implement batch and ACK constraints**

Define:

```ts
WorkerEventBatchV1 = {
  protocolVersion: 1;
  workerId: WorkerId;
  jobId: JobId;
  attempt: number;
  leaseId: LeaseId;
  fenceToken: FenceToken;
  events: WorkerEventV1[]; // 1–500
}

WorkerEventAckV1 = {
  protocolVersion: 1;
  jobId: JobId;
  attempt: number;
  leaseId: LeaseId;
  acceptedThroughSeq: number;
  expectedNextSeq: number;
  status: "accepted" | "gap" | "stale_fence" | "terminal";
}
```

Batch refinement verifies every event repeats the batch job/attempt/lease/fence, event IDs are unique, and sequences are contiguous. ACK refinement verifies `expectedNextSeq === acceptedThroughSeq + 1`. Export schemas and inferred types.

- [ ] **Step 5: Export, verify, record, and commit PRT-004**

Run:

```powershell
pnpm --filter @armyofagents/worker-protocol exec vitest run src/events.test.ts
pnpm --filter @armyofagents/worker-protocol typecheck
pnpm check:worker-protocol-boundary
```

Create `docs/replatform/epics/E1-worker-protocol/tickets/PRT-004-result.md` with event-type coverage, sequence-gap, duplicate, ACK, additive, and forbidden-key evidence.

```powershell
git add packages/worker-protocol/src docs/replatform/epics/E1-worker-protocol/tickets/PRT-004-result.md
git commit -m "feat: define worker event protocol"
```

---

### Task 5: PRT-005 — Workspace, Artifact, Secret, Resource, and Network Contracts

**Files:**
- Create: `packages/worker-protocol/src/policy.ts`
- Create: `packages/worker-protocol/src/policy.test.ts`
- Create: `packages/worker-protocol/src/artifacts.ts`
- Create: `packages/worker-protocol/src/artifacts.test.ts`
- Modify: `packages/worker-protocol/src/index.ts`

**Interfaces:**
- Consumes: branded IDs, digests, fence identity, and wire-safety refinement.
- Produces: validated resource/network/secret/retention/offline policies, workspace/artifact/patch manifests, scoped upload grants, and fenced artifact commit request.

- [ ] **Step 1: Write failing policy tests**

Create `policy.test.ts` asserting:

- default network action must be `deny`;
- `denyPrivateNetworks`, `denyMetadata`, and `denyControlPlane` must all be true in v1;
- allow rules accept HTTPS host/port only, with lowercase DNS names and no IP literals;
- resource limits reject zero, negative, and above-ceiling values;
- secret refs contain handle ID, materialization kind, and target name but reject values/credentials;
- connector OAuth access/refresh tokens and broker token bundles are rejected recursively, while an opaque handle with proxy materialization is accepted;
- env targets match `^[A-Z_][A-Z0-9_]*$`;
- file targets are absolute sandbox paths under `/run/aoa-secrets/` and contain no `..`;
- proxy materialization has no env/file target;
- offline and retention enums contain only locked values.

- [ ] **Step 2: Write failing artifact/workspace tests**

Create `artifacts.test.ts` asserting:

- workspace paths are relative POSIX paths with no empty, `.`, `..`, backslash, absolute, drive, or NUL segment;
- symlink entries are rejected in v1;
- duplicate/case-colliding workspace paths fail;
- object keys must equal `organizations/<org>/jobs/<job>/attempts/<attempt>/...`;
- wrong Organization/job/attempt prefix fails at commit;
- artifact size/hash and active fence fields are required;
- `browser_cookie_state`, `playwright_trace`, `browser_video`, and `service_checkpoint` require `sensitivity: "restricted"`;
- patch manifest requires base/result hashes and describes create/modify/delete/rename operations;
- upload grant expiration is after issuance and headers reject credential-bearing keys.

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
pnpm --filter @armyofagents/worker-protocol exec vitest run src/policy.test.ts src/artifacts.test.ts
```

Expected: FAIL because both modules do not exist.

- [ ] **Step 4: Implement policy schemas**

Create `policy.ts` with passthrough schemas and inferred types:

```ts
resourceLimitsSchema
networkAllowRuleSchema = { scheme: "https", host, port: 443 | positive <= 65535 }
networkPolicyV1Schema = { policyId, version, digest, defaultAction: "deny", allow, denyPrivateNetworks: true, denyMetadata: true, denyControlPlane: true }
secretMaterializationSchema = discriminated union "proxy" | "env" | "file"
secretHandleRefSchema = { handleId, materialization }
artifactRetentionClassSchema = "ephemeral" | "run" | "audit" | "checkpoint"
offlinePolicySchema = "cancel" | "finish_without_remote_effects" | "continue_until_lease_expiry"
```

Every object uses recursive wire-safety. `secretHandleRefSchema` is provider-neutral: connector OAuth discovery, refresh leases, token bundles, rotation, and revocation remain owned by the existing control-plane broker; the wire contract exposes no OAuth token fields. Keep the v1 limits equal to the job envelope limits from PRT-003. Export inferred types.

- [ ] **Step 5: Implement artifact and workspace schemas**

Create `artifacts.ts` exporting:

```ts
WORKSPACE_ENTRY_KINDS = ["file", "directory"]
ARTIFACT_KINDS = ["workspace_snapshot", "workspace_patch", "log", "screenshot", "dom_snapshot", "playwright_trace", "browser_video", "download", "service_checkpoint", "other"]
artifactSensitivitySchema = "normal" | "restricted"
workspaceEntrySchema
workspaceManifestV1Schema
patchOperationSchema
workspacePatchManifestV1Schema
artifactManifestV1Schema
artifactUploadGrantV1Schema
artifactCommitRequestV1Schema
expectedAttemptObjectPrefix(input): string
```

Use these required shapes:

```ts
WorkspaceEntry = { path, kind, sizeBytes, sha256 nullable, executable }
WorkspaceManifestV1 = { protocolVersion: 1, organizationId, companyId, artifactId, baseRevision, entries }
PatchOperation = create/modify/delete with path, or rename with path/fromPath; create/modify/rename include resultSha256 and sizeBytes
WorkspacePatchManifestV1 = { protocolVersion: 1, organizationId, companyId, jobId, attempt, artifactId, baseRevision, baseManifestHash, resultManifestHash, operations }
ArtifactManifestV1 = { protocolVersion: 1, organizationId, companyId, jobId, attempt, artifactId, kind, sensitivity, retention, objectKey, sizeBytes, sha256, contentType, createdAt }
ArtifactUploadGrantV1 = { protocolVersion: 1, artifactId, method: "PUT", url, headers, issuedAt, expiresAt, maxBytes, expectedSha256, objectKey }
ArtifactCommitRequestV1 = { protocolVersion: 1, workerId, jobId, attempt, leaseId, fenceToken, manifest }
```

Add the prefix, path, case-collision, sensitivity, timestamp, and forbidden-key refinements from Step 2.

- [ ] **Step 6: Reuse canonical policy schemas from job envelopes**

Modify `job.ts` to import `resourceLimitsSchema`, `networkPolicyRefSchema`, `secretHandleRefSchema`, and `offlinePolicySchema` from `policy.ts`. Change `secretHandleIds` to `secretHandles: secretHandleRefSchema.array().max(64)`. Update job tests so the batch fixture uses:

```ts
secretHandles: [{
  handleId: "00000000-0000-4000-8000-000000000016",
  materialization: { kind: "proxy" },
}]
```

This is the one planned additive refinement to PRT-003 before the contract is frozen. Do not retain both fields.

- [ ] **Step 7: Export, verify, record, and commit PRT-005**

Run:

```powershell
pnpm --filter @armyofagents/worker-protocol exec vitest run src/job.test.ts src/policy.test.ts src/artifacts.test.ts
pnpm --filter @armyofagents/worker-protocol typecheck
pnpm check:worker-protocol-boundary
```

Create `docs/replatform/epics/E1-worker-protocol/tickets/PRT-005-result.md` with malicious path/prefix, sensitivity, secret materialization, network denial, and canonical job-schema evidence.

```powershell
git add packages/worker-protocol/src docs/replatform/epics/E1-worker-protocol/tickets/PRT-005-result.md
git commit -m "feat: define worker data and policy contracts"
```

---

### Task 6: PRT-006 — Capability Negotiation and Frozen Conformance Corpus

**Files:**
- Create: `packages/worker-protocol/src/capabilities.ts`
- Create: `packages/worker-protocol/src/capabilities.test.ts`
- Modify: `packages/worker-protocol/src/version.ts`
- Create: `packages/worker-protocol/src/version.test.ts`
- Create: `packages/worker-protocol/src/contract.test.ts`
- Create: `packages/worker-protocol/src/golden-journeys.test.ts`
- Modify: `packages/worker-protocol/src/index.ts`
- Create: `docs/contracts/worker-protocol/v1/conformance.json`
- Create: `docs/contracts/worker-protocol/v1/README.md`
- Create: `docs/contracts/worker-protocol/v1/manifest.sha256`
- Create: `scripts/update-worker-protocol-contract-manifest.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: all PRT-001–PRT-005 schemas and E0 golden journeys.
- Produces: worker hello/capacity schemas, capability matching, protocol-range negotiation, frozen v1 vectors/hashes, and final public package exports.

- [ ] **Step 1: Write failing capability and version tests**

Create `capabilities.test.ts` covering:

```ts
capability names: workload.batch, workload.browser_session, workload.service,
provider.fake, provider.e2b, provider.local,
artifact.direct_upload, secret.proxy,
sandbox.nono, sandbox.gvisor
```

Assert worker hello requires worker/target IDs, agent version, protocol min/max, platform OS/arch, capabilities, and non-negative slot counts; min greater than max fails; duplicate capabilities fail; unknown capabilities are accepted only when they match `^[a-z][a-z0-9_.-]{2,100}$`; `workerSatisfiesRequirements` returns false for missing capability, insufficient batch/browser/service slots, or non-overlapping protocol range.

Create `version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { negotiateProtocolVersion } from "./version.js";

describe("protocol version negotiation", () => {
  it("chooses the highest overlapping version", () => {
    expect(negotiateProtocolVersion({ min: 1, max: 3 }, { min: 2, max: 4 })).toBe(3);
  });
  it("supports an N-1 worker through an additive rollout", () => {
    expect(negotiateProtocolVersion({ min: 1, max: 2 }, { min: 1, max: 1 })).toBe(1);
  });
  it("returns null without overlap", () => {
    expect(negotiateProtocolVersion({ min: 2, max: 3 }, { min: 1, max: 1 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
pnpm --filter @armyofagents/worker-protocol exec vitest run src/capabilities.test.ts src/version.test.ts
```

Expected: FAIL because capability schemas and negotiation do not exist.

- [ ] **Step 3: Implement worker hello and requirement matching**

Create `capabilities.ts` exporting:

```ts
KNOWN_WORKER_CAPABILITIES
workerCapabilitySchema
workerCapacitySchema = { batchSlots, browserSessionSlots, serviceSlots }
workerPlatformSchema = { os: "linux" | "darwin" | "windows", arch: "x64" | "arm64", runtime: non-empty max 100 }
workerHelloV1Schema = { protocolVersion: 1, workerId, targetId, agentVersion, supportedProtocol: { min, max }, platform, capabilities, capacity, policyHash }
jobCapabilityRequirementsSchema = { protocol: { min, max }, capabilities, workloadType }
workerSatisfiesRequirements(worker, requirements): boolean
```

The matcher first requires protocol overlap, then all named capabilities, then at least one slot for the workload type.

- [ ] **Step 4: Implement range negotiation**

Extend `version.ts`:

```ts
export interface ProtocolVersionRange { min: number; max: number }

export function negotiateProtocolVersion(
  controlPlane: ProtocolVersionRange,
  worker: ProtocolVersionRange,
): number | null {
  const highest = Math.min(controlPlane.max, worker.max);
  const lowest = Math.max(controlPlane.min, worker.min);
  return highest >= lowest ? highest : null;
}
```

Reject invalid ranges in the Zod schemas that consume them; the pure function assumes validated positive integer ranges.

- [ ] **Step 5: Create the checked-in conformance corpus**

Create `docs/contracts/worker-protocol/v1/conformance.json` with `contractVersion: "1.0.0"` and these named cases:

1. `valid batch job` — full final PRT-005 batch envelope, accepted by `jobEnvelopeV1Schema`.
2. `valid browser job with safe additive field` — accepted, and `futureSchedulingHint` remains in parsed output.
3. `valid service job` — accepted with service/generation/checkpoint fields.
4. `reject unknown workload` — `workloadType: "daemon"`, rejected.
5. `reject nested plaintext api key` — safe batch plus `future.apiKey`, rejected.
6. `valid lease offer` — matching offer/job identity and ACK-before-expiry, accepted.
7. `reject inverted lease times` — ACK deadline equal to or later than expiry, rejected.
8. `valid contiguous event batch` — sequences 1 and 2, accepted.
9. `reject event sequence gap` — sequences 1 and 3, rejected.
10. `valid worker hello` — batch/E2B/direct-upload/proxy capabilities and one batch slot, accepted.
11. `reject unknown job terminal state vector` — a terminal event with status `done`, rejected.

Each case has:

```ts
{
  name: string;
  schema: "job" | "lease_offer" | "event_batch" | "worker_hello";
  valid: boolean;
  preserveKeys?: string[];
  input: unknown;
}
```

Use the fixed UUID/timestamp/hash/fence values from PRT-003 and PRT-004 tests. Do not use real credentials or URLs.

Create `docs/contracts/worker-protocol/v1/README.md` documenting additive-only v1 evolution, unknown enum rejection, manifest regeneration, and Protocol Custodian approval for byte changes.

- [ ] **Step 6: Write failing conformance and E0 golden-journey tests**

Create `contract.test.ts` that loads `conformance.json`, maps `schema` to the four schemas, asserts `safeParse().success === valid`, checks `preserveKeys` on accepted objects, and verifies `manifest.sha256` against exact bytes with `node:crypto`.

Create `golden-journeys.test.ts` that loads all six `tests/fixtures/distributed-execution/*.json` files and asserts:

- schemaVersion is 1;
- ID matches filename;
- workload type parses through `workloadTypeSchema`;
- every `emits` value parses as a known worker event type;
- expected terminal state belongs to the relevant batch/browser/service terminal/status set;
- forbidden effects and audit actions are non-empty.

Run both tests before creating `manifest.sha256`.

Expected: conformance test FAILS because the manifest is missing; golden journeys pass once event-name mapping includes `network_denied`.

- [ ] **Step 7: Add deterministic manifest generation**

Create `scripts/update-worker-protocol-contract-manifest.mjs`:

```js
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const directory = path.join(process.cwd(), "docs", "contracts", "worker-protocol", "v1");
const files = ["conformance.json"];
const lines = [];
for (const file of files) {
  const bytes = await readFile(path.join(directory, file));
  lines.push(`${createHash("sha256").update(bytes).digest("hex")}  ${file}`);
}
await writeFile(path.join(directory, "manifest.sha256"), `${lines.join("\n")}\n`, "utf8");
```

Add:

```json
"gen:worker-protocol-contract": "node scripts/update-worker-protocol-contract-manifest.mjs"
```

Run:

```powershell
pnpm gen:worker-protocol-contract
pnpm --filter @armyofagents/worker-protocol exec vitest run src/capabilities.test.ts src/version.test.ts src/contract.test.ts src/golden-journeys.test.ts
```

Expected: PASS.

- [ ] **Step 8: Export the complete public API and verify the epic**

Update `index.ts` to explicitly export every public constant, schema, predicate, helper, and inferred type from `ids`, `states`, `job`, `events`, `policy`, `artifacts`, `capabilities`, and `version`. Do not use `export *`; explicit exports make review of wire-surface changes visible.

Run:

```powershell
pnpm --filter @armyofagents/worker-protocol test:run
pnpm --filter @armyofagents/worker-protocol typecheck
pnpm --filter @armyofagents/worker-protocol build
pnpm check:worker-protocol-boundary
pnpm check:distributed-foundation
```

Expected: PASS.

- [ ] **Step 9: Record and commit PRT-006**

Create `docs/replatform/epics/E1-worker-protocol/tickets/PRT-006-result.md`. Record protocol/capability matrix, all 11 conformance vectors, manifest digest, E0 fixture compatibility, package build/typecheck/tests, and boundary result.

```powershell
git add packages/worker-protocol/src docs/contracts/worker-protocol/v1 scripts/update-worker-protocol-contract-manifest.mjs package.json docs/replatform/epics/E1-worker-protocol/tickets/PRT-006-result.md
git commit -m "feat: freeze worker protocol v1 contract"
```

---

### Task 7: E1 Integration Gate and Evidence Handoff

**Files:**
- Read: all E1 package, contract, script, plan, and ticket-result files
- Create: date-derived QA result under `docs/replatform/epics/E1-worker-protocol/qa/`
- Create: date-derived completion handoff under `docs/replatform/epics/E1-worker-protocol/handoffs/`
- Modify: `docs/replatform/epics/E1-worker-protocol/README.md`
- Modify: `docs/replatform/epics/README.md`

**Interfaces:**
- Consumes: PRT-001 through PRT-006 and their committed result records.
- Produces: the reviewed protocol artifact that unblocks E2/E3/E4/E6 planning.

- [ ] **Step 1: Verify ticket-result and contract completeness**

Run:

```powershell
Get-ChildItem docs/replatform/epics/E1-worker-protocol/tickets/*-result.md | Select-Object -ExpandProperty Name
Get-Content docs/contracts/worker-protocol/v1/manifest.sha256
git status --short
```

Expected: exactly PRT-001-result.md through PRT-006-result.md, one conformance hash line, and a clean worktree.

- [ ] **Step 2: Run focused and repository gates**

Run:

```powershell
pnpm check:distributed-foundation
pnpm check:worker-protocol-boundary
pnpm --filter @armyofagents/worker-protocol test:run
pnpm --filter @armyofagents/worker-protocol typecheck
pnpm --filter @armyofagents/worker-protocol build
pnpm install --frozen-lockfile
pnpm -r typecheck
pnpm test:run
pnpm build
git diff --check
```

Expected: all commands exit 0. Any repository-baseline failure is recorded without weakening protocol checks or changing the E1 completion decision to pass.

- [ ] **Step 3: Create immutable QA and handoff records**

Create paths with:

```powershell
$utcDate = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
$qaRecord = "docs/replatform/epics/E1-worker-protocol/qa/$utcDate-focused-e1-completion.md"
$handoffRecord = "docs/replatform/epics/E1-worker-protocol/handoffs/$utcDate-epic-completion.md"
```

Populate `$qaRecord` from the QA template with the exact revision, commands, exit codes, test counts, contract hash, and boundary result. Populate `$handoffRecord` from the handoff template, linking all six ticket results and `$qaRecord`.

Set the handoff decision to `pass` only if Step 2 passed on the recorded revision. Otherwise set it to `fail`, keep the epic in `gate_review`, and create stable finding IDs for every blocker.

- [ ] **Step 4: Update status only on a passing gate and commit evidence**

Ticket owners move E1 from `planned` to `in_progress` when execution starts; the Integration Gate Owner moves it to `gate_review` after all six result records exist. For a passing gate, change E1 from `gate_review` to `complete` in its README and the epic index. Leave E2/E3/E4/E6 statuses unchanged; their planning becomes unblocked but their implementation dependencies are not automatically satisfied.

```powershell
git add docs/replatform/epics/E1-worker-protocol docs/replatform/epics/README.md
git commit -m "docs: record E1 protocol completion evidence"
```

- [ ] **Step 5: Report the next planning order**

The completion handoff lists the next plans in this order:

1. E2 tenant kernel.
2. E6 D1 deployment/test foundation portions that do not require the worker daemon.
3. E3 job control after E2’s tenant transaction contract stabilizes.
4. E4 worker daemon against the frozen E1 protocol.

No downstream implementation begins merely because E1 types compile; its dependency epic gates must be green on main.
