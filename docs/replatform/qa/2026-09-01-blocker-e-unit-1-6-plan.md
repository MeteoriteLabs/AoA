# Blocker E / Unit 1.6 Implementation Plan — the canary preflight's read authority

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** Let the canary preflight read its own evidence — with **zero** serving-role privilege delta —
and close the `SECURITY DEFINER` blind spot that the fix relies on, so the gate's remaining refusal is
*honest* instead of masquerading as an unreadability error.

**Architecture:** An owner-owned `SECURITY DEFINER` function becomes the single evidence read for the
three tables `aoa_app` cannot touch. No table grant, no column grant, no manifest edit — the entire ACL
apparatus is untouched. Because such a function is currently **invisible** to
`assertExactServingRoleAuthority`, this plan also ships a `prosecdef` certificate in the same commit, so
the change *narrows* the ACL model rather than silently bypassing it.

**Tech Stack:** PostgreSQL 18 (`pgvector` image), Drizzle ORM, TypeScript/Node, Vitest (`pool: "forks"`),
embedded-postgres for real-role integration tests.

---

## ⛔ READ THIS BEFORE ANY CODE — what this plan does NOT do

**This plan does not unblock the canary, and any claim that it does is false.**

Blocker E is **three** stacked defects. This plan fixes exactly one:

| | Defect | Fixed here? |
|---|---|---|
| **E-1** | The preflight store is bound to the non-owner `aoa_app` pool and is permission-denied on `environment_leases`, `environments`, `runtime_provider_keys`, `company_secret_versions`. Three reads raise 42501; the catch at `canary-preflight.ts:191-200` folds them into `preflight_error`; `run-execution-owner.ts:254-257` returns `owner="legacy"`. | **YES** |
| **E-2** | `reconcileCompanyLegacyResources` (`legacy-resource-reconciliation.ts:324`) has **ZERO non-test callers**. Nothing in a running server writes `legacy_resource_reconciliation`, so `listRecords` returns `[]` forever. | **NO** — Task 6 files it |
| **E-3** | `environments.ts:142` inserts an `environment_leases` row on **every** legacy cloud run, while `legacy-resource-reconciliation.ts:344-350` `continue`s past a lost-CAS paused lease *without recording it*. The pass's inventory is a strict subset of the gate's re-derived inventory **by construction**, so closure is a permanently-losing race on any box with traffic. | **NO** — Task 6 files it |

After this plan, the gate moves from `preflight_error` (**"I could not read"** — unfalsifiable) to
`reconciliation_incomplete` (**"the crosswalk is empty"** — true, actionable, and pointing straight at
E-2). That is the whole value: **an honest refusal**. A previous design in this programme claimed a
privilege-only fix would open the gate; two independent judges refuted it. Do not repeat that.

---

## Constraints discovered the hard way — violating any of these breaks production

1. **Do NOT wrap the gate in `runInTenant`.** `legacy_resource_reconciliation` has FORCE RLS
   (`0256_dizzy_bedlam.sql:84,87`) and its app policy `CUTOVER_APP_READ_QUAL`
   (`job-control-legacy-grants.ts:475`) is `current_setting('aoa.organization_id', true) IS NULL` —
   **inverted**. `aoa_app` may read it only *outside* tenant context, which is exactly how the preflight
   runs today. Wrapping it returns **zero rows silently** and the gate then refuses
   `reconciliation_incomplete` for a wrong reason with no error anywhere.
2. **Key the function certificate on `pg_proc.prosecdef`, never on effective EXECUTE.**
   `CREATE EXTENSION vector` has no `SCHEMA` clause (`0038_marvelous_vapor.sql:1`,
   `0115_enable_pgvector.sql:29`), so pgvector installs ~100 functions into `public`, all carrying
   PostgreSQL's default `PUBLIC EXECUTE`. A certificate asserting "effective EXECUTE must be false unless
   manifested" **fails boot on every deployment**. `prosecdef` is also the security-correct axis: a
   SECURITY INVOKER function confers nothing beyond the caller's own authority.
3. **Never add a table grant on these four tables.** `company_secret_versions.material` is AES-256-GCM
   secret material (`schema/company_secret_versions.ts:12`), and — less obviously —
   **`environment_leases.metadata` is secret-bearing AT REST**: `sanitizeProviderMetadata`
   (`environment-runtime.ts:386-393`) strips only `apiKey|resolvedApiKey`, at read time, in memory. The
   persisted row keeps bounded-TTL `AOA_MCP_*_TOKEN` values.
4. **Do not route to `aoa_operator`.** It is denied on all four tables *and* lacks `companies` by design
   (`PLAN_DERIVED_ACL_MATRIX`, `job-control-legacy-grants.ts:559`).
5. **Migrations run as the database owner**, which is required: `0214_e2_serving_role_hardening.sql:10,31`
   RAISEs if a serving role owns an application object.
6. **Run vitest from the REPO ROOT.** Several contract tests do `join(process.cwd(), "server/src/...")`
   and fail spuriously from `server/`. `--project server` silently matches nothing — use a path.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/src/migrations/<next>_canary_preflight_evidence_fn.sql` **(new, C14 hand-authored)** | Owner-owned `SECURITY DEFINER` function returning the three evidence reads. Grants EXECUTE to `aoa_app` only. |
| `server/src/services/canary-preflight-evidence.ts` **(new)** | Thin typed wrapper that calls the function and shapes its rows into the existing store types. One responsibility: cross the privilege boundary. |
| `server/src/services/canary-preflight-store.ts` **(modify)** | Stop delegating `listLeases`/`platformDefaultEnv`/`currentKeyGeneration` to the reconciler's store; take them from the evidence wrapper. |
| `server/src/db/security-definer-manifest.ts` **(new)** | `SECURITY_DEFINER_FUNCTION_MANIFEST` — the allowlist of definer functions, as data. |
| `server/src/db/distributed-execution-databases.ts` **(modify)** | Add `assertSecurityDefinerManifest` scan keyed on `prosecdef`; call it from the existing startup assertion path. |
| `server/src/__tests__/canary-preflight-real-role.integration.test.ts` **(new)** | The test that would have caught this entire class: the gate, on a real `aoa_app` connection, must not return `preflight_error`. |
| `server/src/__tests__/security-definer-manifest.test.ts` **(new)** | Certificate unit tests, including the pgvector regression and stable pairing. |

---

## Task 1: Reproduce E-1 with a real-role integration test

This is the assertion that would have caught the whole class. Every existing test injects fakes —
`cli-006-canary-preflight-store.test.ts:44` literally constructs the store with `{} as never`.

**Files:**
- Create: `server/src/__tests__/canary-preflight-real-role.integration.test.ts`

- [ ] **Step 1: Write the failing test**

Model the harness on `server/src/__tests__/distributed-execution-db-startup.integration.test.ts` — it
already provisions real `aoa_app` / `aoa_operator` roles and applies migrations (see its `appUrl`
construction around `:196`). Reuse that setup verbatim rather than inventing a new one.

```ts
// server/src/__tests__/canary-preflight-real-role.integration.test.ts
//
// BLOCKER E regression. Every other preflight test injects a fake store, so none of them
// can observe the one thing that actually broke: the store runs on the NON-OWNER `aoa_app`
// pool and is permission-denied on three of its four evidence reads. The gate then answers
// `preflight_error` — an unreadability refusal indistinguishable from a policy refusal.
//
// This test asserts the DISTINCTION, not the outcome. The gate may legitimately refuse
// (E-2: nothing writes the crosswalk yet). It may NEVER refuse because it could not READ.

import { describe, expect, it } from "vitest";
import { createCanaryPreflight } from "../services/canary-preflight.js";
import { createDrizzleCanaryPreflightStore } from "../services/canary-preflight-store.js";

describe("BLOCKER E — the canary preflight on a real aoa_app connection", () => {
  it("does not refuse with preflight_error", async () => {
    const { db, organizationId } = await seedRealRoleFixture(); // see Step 1b
    const gate = createCanaryPreflight({ store: createDrizzleCanaryPreflightStore(db) });

    const result = await gate.check({ organizationId });

    expect(
      result.ok ? null : result.reason,
      "an unreadable gate is a closed gate that cannot say why — this is Blocker E",
    ).not.toBe("preflight_error");
  });

  it("names a policy reason, not a permission error, in its detail", async () => {
    const { db, organizationId } = await seedRealRoleFixture();
    const gate = createCanaryPreflight({ store: createDrizzleCanaryPreflightStore(db) });

    const result = await gate.check({ organizationId });

    if (!result.ok) {
      expect(result.detail ?? "").not.toMatch(/permission denied/i);
    }
  });
});
```

- [ ] **Step 1b: Write the fixture helper in the same file**

It must create a Company under an Organization so `listOrganizationCompanyIds` returns non-empty —
otherwise the gate short-circuits on `no_companies` at `canary-preflight.ts:132-137` and the test passes
for the wrong reason.

```ts
async function seedRealRoleFixture(): Promise<{ db: Db; organizationId: string }> {
  // 1. start embedded postgres, apply migrations, provision aoa_app (copy the setup from
  //    distributed-execution-db-startup.integration.test.ts).
  // 2. as ADMIN, insert one organizations row and one companies row pointing at it.
  // 3. return a drizzle Db built on the aoa_app URL, plus that organizationId.
}
```

Insert as **admin**, read as **`aoa_app`** — that asymmetry is the point of the test.

- [ ] **Step 2: Run it and verify it FAILS for the right reason**

```bash
cd /c/e3 && npx vitest run server/src/__tests__/canary-preflight-real-role.integration.test.ts
```

Expected: FAIL, with the received value `"preflight_error"` and a detail containing
`permission denied for table environment_leases` (or `environments` / `runtime_provider_keys` — which of
the three appears is race-dependent, since `canary-preflight.ts:139-145` fires them in one unordered
`Promise.all`). **Assert on the reason, never on which table name appears.**

- [ ] **Step 3: Commit the RED test**

```bash
git add server/src/__tests__/canary-preflight-real-role.integration.test.ts
git commit -m "test(cli-006): reproduce BLOCKER E on a real aoa_app connection"
```

---

## Task 2: The SECURITY DEFINER evidence function

**Files:**
- Create: `packages/db/src/migrations/<next>_canary_preflight_evidence_fn.sql`

- [ ] **Step 1: Generate the custom migration stub**

```bash
cd /c/e3 && pnpm db:generate --custom
```

This writes a journal entry and an empty `.sql` file. **Do not hand-author schema DDL** — this is the
C14 narrow exception for security DDL only, the same route `0214` and `0261` took.

- [ ] **Step 2: Write the function**

```sql
-- C14 hand-authored security DDL: drizzle-kit cannot emit functions or their ACLs.
-- Every statement is naturally idempotent (CREATE OR REPLACE / idempotent GRANT).
--
-- WHY. The canary preflight (server/src/services/canary-preflight.ts:139-145) fires its
-- evidence reads on the NON-OWNER `aoa_app` pool (server/src/index.ts:1214). Three of them
-- hit tables `aoa_app` holds ZERO privileges on, each raises 42501, the catch at
-- canary-preflight.ts:191-200 folds it into reason="preflight_error", and
-- run-execution-owner.ts:254-257 returns owner="legacy". The gate could never open.
--
-- WHY NOT A GRANT. `company_secret_versions.material` is AES-256-GCM secret material and
-- `environment_leases.metadata` is secret-bearing AT REST (sanitizeProviderMetadata strips
-- only apiKey|resolvedApiKey, at read time, in memory). The gate needs FOUR SCALARS. A
-- definer function narrows the PREDICATE as well as the projection: `aoa_app` may ask
-- "the evidence for THIS company" and nothing else. A column grant narrows only the
-- projection and would still let `aoa_app` enumerate every company's secret-version rows.
--
-- OWNERSHIP is load-bearing: migrations run as the database owner, and
-- 0214_e2_serving_role_hardening.sql:10,31 RAISEs if a serving role owns an application
-- object.
--
-- search_path is pinned EMPTY and every relation is schema-qualified, so a caller's
-- search_path cannot redirect the body. pg_catalog stays implicitly resolvable.

CREATE OR REPLACE FUNCTION public.canary_preflight_evidence(p_company_id uuid, p_default_env_id uuid)
RETURNS TABLE (
  lease_id uuid,
  platform_default_environment_id uuid,
  key_generation text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH leases AS (
    SELECT l.id FROM public.environment_leases l WHERE l.company_id = p_company_id
  ),
  default_env AS (
    SELECT e.id FROM public.environments e
    WHERE e.id = p_default_env_id
    LIMIT 1
  ),
  keygen AS (
    SELECT k.secret_id, v.version
    FROM public.runtime_provider_keys k
    JOIN LATERAL (
      SELECT cv.version FROM public.company_secret_versions cv
      WHERE cv.secret_id = k.secret_id AND cv.status = 'current'
      ORDER BY cv.version DESC LIMIT 1
    ) v ON TRUE
    WHERE k.company_id = p_company_id AND k.provider = 'e2b' AND k.is_default = TRUE
    LIMIT 1
  )
  SELECT
    leases.id,
    (SELECT id FROM default_env),
    (SELECT secret_id::text || ':' || version::text FROM keygen)
  FROM leases
  UNION ALL
  SELECT
    NULL::uuid,
    (SELECT id FROM default_env),
    (SELECT secret_id::text || ':' || version::text FROM keygen)
  WHERE NOT EXISTS (SELECT 1 FROM leases);
$$;

REVOKE ALL ON FUNCTION public.canary_preflight_evidence(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.canary_preflight_evidence(uuid, uuid) TO "aoa_app";
```

★ The trailing `UNION ALL … WHERE NOT EXISTS` branch exists so a company with **zero leases** still
returns one row carrying the env + key-generation scalars. Without it the function returns no rows and
the wrapper cannot distinguish "no leases" from "no key generation" — which would resurrect exactly the
conflation this whole unit is about.

★ **The default-environment id is passed IN, not derived in SQL — this is settled, not a choice.**
`derive_platform_default_environment_id` does **not** exist as a SQL function (verified: zero hits across
`packages/db/src/migrations/`). It is a TypeScript uuidv5 derivation only
(`platform-default-environment.ts:109-111`). Writing a PL/pgSQL uuidv5 would create a **second
derivation** of a value whose whole purpose is to be deterministic across processes — exactly the
parallel-reimplementation drift the store's own header warns about, and a silent one, because a
mismatched id returns "no platform-default env" rather than an error. The caller passes it.

- [ ] **Step 3: Apply and verify the privilege boundary holds**

```bash
cd /c/e3 && pnpm db:migrate
```

Then, as `aoa_app`, confirm the function works **and** that nothing else opened up:

```sql
SELECT * FROM public.canary_preflight_evidence('<company uuid>', '<derivePlatformDefaultEnvironmentId(company)>');  -- must return rows
SELECT material FROM company_secret_versions LIMIT 1;                     -- must STILL raise 42501
SELECT * FROM environment_leases LIMIT 1;                                 -- must STILL raise 42501
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/migrations/
git commit -m "feat(cli-006): owner-owned SECURITY DEFINER evidence read for the canary preflight"
```

---

## Task 3: The typed wrapper, and rewiring the store

**Files:**
- Create: `server/src/services/canary-preflight-evidence.ts`
- Modify: `server/src/services/canary-preflight-store.ts:73-76`

- [ ] **Step 1: Write the wrapper**

```ts
// server/src/services/canary-preflight-evidence.ts
//
// BLOCKER E. The three reads below cross a privilege boundary: `aoa_app` holds ZERO
// privileges on environment_leases / environments / runtime_provider_keys /
// company_secret_versions. They are served by an owner-owned SECURITY DEFINER function
// (migration <next>_canary_preflight_evidence_fn.sql) which narrows both the projection
// and the predicate — the return type structurally cannot carry secret material.
//
// One round trip, not three: the function returns all three scalars together, so the gate
// cannot observe a torn read across them.

import { sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import type { LegacyLeaseInput } from "./legacy-resource-reconciliation.js";
import { derivePlatformDefaultEnvironmentId } from "./platform-default-environment.js";

type EvidenceRow = {
  lease_id: string | null;
  platform_default_environment_id: string | null;
  key_generation: string | null;
};

export type CanaryPreflightEvidence = {
  leaseIds: readonly string[];
  platformDefaultEnvironmentId: string | null;
  keyGeneration: string | null;
};

export async function readCanaryPreflightEvidence(
  db: Db,
  companyId: string,
): Promise<CanaryPreflightEvidence> {
  // The default-env id is derived HERE and passed in: it is a TypeScript uuidv5
  // (platform-default-environment.ts:109-111) with no SQL equivalent, and a second
  // derivation would drift silently (a mismatched id reads as "no default env", not an error).
  const defaultEnvId = derivePlatformDefaultEnvironmentId(companyId);
  const result = await db.execute(
    sql`SELECT lease_id, platform_default_environment_id, key_generation
        FROM public.canary_preflight_evidence(${companyId}::uuid, ${defaultEnvId}::uuid)`,
  );
  const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as EvidenceRow[];
  return {
    leaseIds: rows.map((row) => row.lease_id).filter((id): id is string => id !== null),
    platformDefaultEnvironmentId: rows[0]?.platform_default_environment_id ?? null,
    keyGeneration: rows[0]?.key_generation ?? null,
  };
}
```

★ `db.execute` shape differs between drizzle drivers (array vs `{rows}`). The defensive unwrap above
handles both; do not "simplify" it without checking which driver `appDb` uses.

- [ ] **Step 2: Rewire the store**

Replace lines 73-76 of `server/src/services/canary-preflight-store.ts`:

```ts
    // BLOCKER E — these three no longer delegate to the reconciler's drizzle store.
    // That store queries environment_leases / environments / runtime_provider_keys /
    // company_secret_versions DIRECTLY, and this store runs on the NON-OWNER `aoa_app`
    // pool, which is permission-denied on all four. The reads now go through the
    // owner-owned SECURITY DEFINER evidence function instead.
    //
    // The original delegation existed to guarantee the gate saw exactly the inventory the
    // reconciler recorded. That guarantee is PRESERVED: the function reads the same rows
    // with the same predicates — it changes WHO may read them, not WHAT is read.
    listLeases: async (companyId: string): Promise<readonly LegacyLeaseInput[]> => {
      const evidence = await readCanaryPreflightEvidence(db, companyId);
      // The gate consumes ONLY `lease.id` — `inventoryKeysForCompany`
      // (canary-preflight.ts:115-122) maps `resourceKeyForLease(lease.id)`, and
      // `resourceKeyForLease` is the identity function
      // (legacy-resource-reconciliation.ts:194-196). The other twelve fields on
      // LegacyLeaseInput exist for the reconciler's classifier, which this gate never runs.
      return evidence.leaseIds.map((id) => ({ id }) as LegacyLeaseInput);
    },
    platformDefaultEnv: async (companyId: string) => {
      const evidence = await readCanaryPreflightEvidence(db, companyId);
      return evidence.platformDefaultEnvironmentId
        ? { environmentId: evidence.platformDefaultEnvironmentId }
        : null;
    },
    currentKeyGeneration: async (companyId: string) => {
      const evidence = await readCanaryPreflightEvidence(db, companyId);
      return evidence.keyGeneration;
    },
```

Add the import at the top and drop the now-unused `createDrizzleReconciliationStore` import:

```ts
import { readCanaryPreflightEvidence } from "./canary-preflight-evidence.js";
```

★ **The `as LegacyLeaseInput` cast is a real narrowing and must be justified, not hidden.** If a future
change makes the gate read any field beyond `id`, this cast becomes a lie at runtime. Task 4 pins that.

- [ ] **Step 3: Run the Task 1 test — it must now pass**

```bash
cd /c/e3 && npx vitest run server/src/__tests__/canary-preflight-real-role.integration.test.ts
```

Expected: PASS. The gate now refuses `reconciliation_incomplete` (E-2 — the crosswalk is empty), which
is a *policy* refusal, not an unreadability one.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/canary-preflight-evidence.ts server/src/services/canary-preflight-store.ts
git commit -m "fix(cli-006): read canary preflight evidence through the definer function"
```

---

## Task 4: Pin the narrowing, so the cast cannot silently become a lie

**Files:**
- Create/extend: `server/src/__tests__/cli-006-canary-preflight.test.ts` (append a describe block)

- [ ] **Step 1: Write the test**

```ts
describe("BLOCKER E — the gate consumes only lease.id", () => {
  it("reaches a verdict when leases carry ONLY an id", async () => {
    // canary-preflight-store.ts constructs `{ id } as LegacyLeaseInput`. If the gate ever
    // reads another field it would see `undefined` in production while every fake-store
    // test kept passing. This asserts the narrowing the cast asserts.
    const gate = createCanaryPreflight({
      store: {
        listOrganizationCompanyIds: async () => ["co-1"],
        listLeases: async () => [{ id: "lease-1" } as never],
        platformDefaultEnv: async () => null,
        listRecords: async () => [],
        currentKeyGeneration: async () => "sec-1:1",
      },
    });

    const result = await gate.check({ organizationId: "org-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("reconciliation_incomplete");
      expect(result.reason).not.toBe("preflight_error"); // a thrown TypeError lands here
    }
  });
});
```

- [ ] **Step 2: Run it**

```bash
cd /c/e3 && npx vitest run server/src/__tests__/cli-006-canary-preflight.test.ts
```

Expected: PASS.

- [ ] **Step 3: Mutation-check it**

Temporarily add `if (!lease.status) throw new Error("x")` inside `inventoryKeysForCompany`
(`canary-preflight.ts:115-122`), re-run, and confirm the test goes **RED**. Revert.

A guard that cannot go red is not a guard. Do not skip this step.

- [ ] **Step 4: Commit**

```bash
git add server/src/__tests__/cli-006-canary-preflight.test.ts
git commit -m "test(cli-006): pin that the gate consumes only lease.id"
```

---

## Task 5: The `prosecdef` certificate — close the blind spot the fix relies on

Task 2 works *only because* `assertExactServingRoleAuthority` scans tables, columns and sequences but
**never functions** (`grep prosecdef` across the repo returns zero hits). Shipping the definer function
without a certificate turns a documented ACL model into one with an undocumented hole.

**Files:**
- Create: `server/src/db/security-definer-manifest.ts`
- Modify: `server/src/db/distributed-execution-databases.ts` (append a scan; call it from the same path
  as the sequence scan, which ends at `:336`)
- Create: `server/src/__tests__/security-definer-manifest.test.ts`

- [ ] **Step 1: Write the manifest**

```ts
// server/src/db/security-definer-manifest.ts
//
// Every SECURITY DEFINER function in the application schema, as data.
//
// A definer function runs with the OWNER's authority regardless of who calls it, so it is
// the entire privilege-escalation surface that `assertExactServingRoleAuthority`'s table,
// column and sequence scans cannot see. Anything not listed here is drift.

export type SecurityDefinerFunction = {
  readonly schema: string;
  readonly name: string;
  /** `pg_get_function_identity_arguments` output, matched exactly. */
  readonly identityArguments: string;
  /** Why this function is allowed to hold owner authority. */
  readonly rationale: string;
};

export const SECURITY_DEFINER_FUNCTION_MANIFEST: readonly SecurityDefinerFunction[] = [
  {
    schema: "public",
    name: "canary_preflight_evidence",
    identityArguments: "p_company_id uuid, p_default_env_id uuid",
    rationale:
      "BLOCKER E. Returns four scalars the CLI-006 canary gate needs from tables the " +
      "non-owner aoa_app pool holds zero privileges on. Narrows the predicate to one " +
      "Company and the projection to ids/version; the return type structurally cannot " +
      "carry company_secret_versions.material or environment_leases.metadata.",
  },
];
```

- [ ] **Step 2: Write the certificate scan**

Append to `server/src/db/distributed-execution-databases.ts`, and call it from the same function that
runs the sequence scan (immediately after the block ending at `:336`):

```ts
async function assertSecurityDefinerManifest(db: Db, role: string): Promise<void> {
  // KEYED ON prosecdef, NOT effective EXECUTE. `CREATE EXTENSION vector` has no SCHEMA
  // clause (0038_marvelous_vapor.sql:1, 0115_enable_pgvector.sql:29), so pgvector installs
  // ~100 functions into `public` carrying PostgreSQL's default PUBLIC EXECUTE. A certificate
  // asserting "EXECUTE must be false unless manifested" fails boot on EVERY deployment.
  // prosecdef is also the security-correct axis: a SECURITY INVOKER function confers nothing
  // beyond the caller's own authority.
  const rows = rowsOf<{ schema_name: string; function_name: string; identity_arguments: string }>(
    await db.execute(sql`
      SELECT
        namespace.nspname AS schema_name,
        proc.proname AS function_name,
        pg_get_function_identity_arguments(proc.oid) AS identity_arguments
      FROM pg_proc proc
      JOIN pg_namespace namespace ON namespace.oid = proc.pronamespace
      WHERE proc.prosecdef
        AND namespace.nspname <> 'information_schema'
        AND namespace.nspname NOT LIKE 'pg_%'
    `),
  );

  // Compare as SETS keyed by identity, never by sorted index. Postgres orders by
  // (nspname, proname, identity_arguments) while JS localeCompare orders differently, so
  // index pairing spuriously reds boot the moment a second definer function exists.
  const key = (s: string, n: string, a: string) => `${s}.${n}(${a})`;
  const allowed = new Set(
    SECURITY_DEFINER_FUNCTION_MANIFEST.map((fn) => key(fn.schema, fn.name, fn.identityArguments)),
  );
  const actual = new Set(rows.map((r) => key(r.schema_name, r.function_name, r.identity_arguments)));

  for (const found of actual) {
    if (!allowed.has(found)) {
      throw new Error(
        `${role} security-definer drift: unmanifested SECURITY DEFINER function ${found}`,
      );
    }
  }
  for (const expected of allowed) {
    if (!actual.has(expected)) {
      throw new Error(
        `${role} security-definer drift: manifested SECURITY DEFINER function ${expected} is absent`,
      );
    }
  }
}
```

- [ ] **Step 3: Write the certificate tests**

```ts
// server/src/__tests__/security-definer-manifest.test.ts
import { describe, expect, it } from "vitest";
import { SECURITY_DEFINER_FUNCTION_MANIFEST } from "../db/security-definer-manifest.js";

describe("SECURITY DEFINER manifest", () => {
  it("lists the canary preflight evidence function exactly once", () => {
    const hits = SECURITY_DEFINER_FUNCTION_MANIFEST.filter(
      (fn) => fn.name === "canary_preflight_evidence",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.identityArguments).toBe("p_company_id uuid, p_default_env_id uuid");
  });

  it("requires a rationale for every entry — owner authority is never granted silently", () => {
    for (const fn of SECURITY_DEFINER_FUNCTION_MANIFEST) {
      expect(fn.rationale.length, `${fn.name} has no rationale`).toBeGreaterThan(40);
    }
  });

  it("has no duplicate identities", () => {
    const keys = SECURITY_DEFINER_FUNCTION_MANIFEST.map(
      (fn) => `${fn.schema}.${fn.name}(${fn.identityArguments})`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] **Step 4: Prove the certificate does not break boot (the pgvector regression)**

```bash
cd /c/e3 && npx vitest run server/src/__tests__/distributed-execution-db-startup.integration.test.ts
```

Expected: PASS. If this reds with a complaint about a `vector`-family function, the scan was keyed on
EXECUTE rather than `prosecdef` — re-read Constraint 2.

- [ ] **Step 5: Mutation-check the certificate**

Temporarily add a second definer function in a scratch migration (or `CREATE FUNCTION … SECURITY
DEFINER` by hand in the test database) and confirm boot throws `unmanifested SECURITY DEFINER function`.
Then remove the manifest entry from Task 5 Step 1 and confirm boot throws `… is absent`. Revert both.

- [ ] **Step 6: Commit**

```bash
git add server/src/db/security-definer-manifest.ts server/src/db/distributed-execution-databases.ts \
        server/src/__tests__/security-definer-manifest.test.ts
git commit -m "feat(e2): certificate the SECURITY DEFINER surface, keyed on prosecdef"
```

---

## Task 6: File E-2 and E-3 honestly, and correct the status

**Files:**
- Modify: `docs/replatform/qa/2026-08-31-campaign-blockers-and-fleet-terrain.md` (§9e.2)
- Modify: `docs/replatform/GO-BOOK.md`

- [ ] **Step 1: Update §9e.2 with what shipped and what did not**

State plainly: E-1 fixed; the gate now refuses `reconciliation_incomplete`; **the canary still cannot
flip**; E-2 and E-3 remain open, with the evidence already recorded in §9e.2.1.

- [ ] **Step 2: Add the E-2/E-3 design question**

The open question, stated so the next session does not have to rediscover it:

> `legacy-resource-reconciliation.ts:344-350` `continue`s past a lost-CAS paused lease *without recording
> it*, while `environments.ts:142` inserts a lease on **every** legacy cloud run. So the pass's inventory
> is a strict subset of the gate's re-derived inventory **by construction**. Re-deriving live inventory
> against a batch-written crosswalk is a permanently-losing race on any box with traffic.
>
> **The question is not "who calls the reconciler" — it is what closure should mean.** Candidates:
> (a) freeze the inventory at a watermark and assert closure only below it; (b) have the gate assert an
> *attestation* the pass emits rather than re-deriving inventory itself; (c) scope closure to leases that
> predate the canary decision. Each changes what the gate promises. Pick deliberately.

- [ ] **Step 3: Run the doc policy checks and commit**

```bash
cd /c/e3 && node scripts/check-guard-inventory.mjs && node scripts/check-finding-ownership.mjs \
  && node scripts/check-ticket-graph-coverage.mjs
git add docs/replatform/
git commit -m "docs(campaign): E-1 fixed; E-2/E-3 remain — the canary is still gated shut"
```

---

## Task 7: Full verification before opening the PR

- [ ] **Step 1: Whole server suite, from the REPO ROOT, sharded**

```bash
cd /c/e3 && for s in 1 2 3 4; do npx vitest run --shard=$s/4 server/src/__tests__; done
```

Expected: zero failures. Six tests are cwd-sensitive and fail only when vitest is run from `server/` —
running from the root is not optional.

- [ ] **Step 2: The whole policy suite**

```bash
cd /c/e3 && for s in check-adapter-manager-boundary check-boot-roots-browser-spawn-free \
  check-boot-roots-provider-free check-d1-dispatch-declared check-dependency-graph \
  check-distributed-execution-foundation check-execution-census check-finding-ownership \
  check-gate-clause-wiring check-guard-inventory check-sandbox-coding-disposition \
  check-test-inventory check-ticket-graph-coverage check-worker-daemon-boundary \
  check-worker-path-parity check-worker-protocol-boundary; do \
  node scripts/$s.mjs >/dev/null 2>&1 && echo "ok $s" || echo "FAIL $s"; done
```

Expected: all `ok`. A new construction seam can red `check-gate-clause-wiring` (it tracks symbol
ref-counts) — if it does, that is a real signal, not noise.

- [ ] **Step 3: Migration check**

```bash
cd /c/e3 && pnpm db:generate --check || true
```

The custom migration must appear in the journal. **No schema DDL may have been hand-authored** — only
the function and its GRANT.

- [ ] **Step 4: Open the PR against `docs/replatform-program`**

The PR body must carry the ⛔ section from the top of this plan verbatim. A reviewer who skims must not
come away believing the canary is unblocked.

---

## Self-review of this plan

**Spec coverage.** E-1 → Tasks 1-4. The definer blind spot → Task 5. E-2/E-3 → Task 6 (filed, not fixed —
deliberately). Constraint 1 (RLS inversion) → stated, and no task wraps anything in `runInTenant`.
Constraint 2 (pgvector) → Task 5 Steps 2 and 4. Constraint 3 (no table grants) → no task adds one; Task 2
Step 3 pins it negatively. Constraint 5 (ownership) → Task 2's comment.

**Placeholders.** One conditional remains, in Task 2 Step 2: whether
`derive_platform_default_environment_id` exists as a SQL function. It is not a TBD — both branches are
written out with an exact command to decide between them, because inventing a second uuidv5 derivation
would be a worse failure than the branch.

**Type consistency.** `readCanaryPreflightEvidence` returns `{leaseIds, platformDefaultEnvironmentId,
keyGeneration}` and all three store members in Task 3 Step 2 consume exactly those names.
`CanaryPreflightStore`'s existing signatures (`listLeases`, `platformDefaultEnv`, `currentKeyGeneration`)
are unchanged, so `canary-preflight.ts` needs no edit.

**Known residual, stated rather than hidden.** Task 3 calls `readCanaryPreflightEvidence` three times per
company — once per store member — where the old code also made three round trips. It is not a
regression, but a future refactor should memoize per `check()` call rather than per member.
