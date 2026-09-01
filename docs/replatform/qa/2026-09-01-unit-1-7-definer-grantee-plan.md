# Unit 1.7 Implementation Plan — move the definer evidence surface off the tenant pool

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** Stop the shared `aoa_app` pool from being able to read *any* Company's lease ids and
key-generation identifier through owner authority, by moving EXECUTE on the canary preflight's
`SECURITY DEFINER` functions to `aoa_operator` — and make the organization the unit of authority so the
functions can no longer answer laterally.

**Architecture:** Three organization-bound definer functions replace two company-bound ones. The
preflight's `companies` enumeration moves *inside* the definer surface, which is what allows the grantee
to change without granting `aoa_operator` a table it does not have. The preflight store is then
constructed on `operatorDb` instead of `appDb`.

**Tech Stack:** PostgreSQL 18, Drizzle ORM, TypeScript/Node, Vitest (`pool: "forks"`), embedded-postgres
for real-role integration tests.

---

## ⛔ READ THIS FIRST — what this unit does and does not claim

**It is a narrowing of reachability, not an authorization boundary. Do not write it up as one.**

The defect is real and **reproduced against a real database** — see Task 1, which already exists and
already fails:

```
an aoa_app session named a company it has no relationship to and received that company's
lease ids through OWNER authority
  expected [ Array(1) ] to not include 'e1000000-0000-4000-8000-000000000014'
```

State the security argument in exactly these terms, and no stronger:

- **Not an RLS bypass.** `environment_leases`, `environments`, `runtime_provider_keys` and
  `company_secret_versions` carry no RLS at all. The boundary crossed is a plain GRANT boundary.
- **Not a live cross-tenant read path.** Both call sites bind parameters through drizzle's `sql`
  template with a `::uuid` cast; there is no `sql.raw`/`unsafe` on the `appDb` path, and `p_company_id`
  only ever holds a uuid that came out of the gate's own `companies` enumeration.
- **It never leaks secret material.** The return types are `uuid` and
  `secret_id::text || ':' || version::text` — a `company_secrets` row id and an integer.
- **Worth nothing against a credential-holding attacker.** Someone with `AOA_APP_DATABASE_URL` very
  likely also has `AOA_OPERATOR_DATABASE_URL` — same environment. No in-database predicate helps there.

**What it is worth, and why it is worth doing:** against a query-shaped attacker reaching an existing
pool. `appDb` is the tenant-facing pool — the admitted-org enumerator, the outbox worker, the
attempt-terminal projection, `tenantAppDb` handed to `createApp`, the live-event log store, the
admission bridge, placement, capacity release, reconciliation, org resolution, shadow admissibility.
`operatorDb` reaches three control-plane route modules, worker- and operator-facing, not
tenant-request-facing. That is a genuine narrowing of the injection surface.

**★ The binder is the GRANTEE, not the parameter.** Organization-scoping the arguments is *defence in
depth and the enabler*, not the fix. `organizationId` is itself caller-supplied and nothing binds it;
`companies` has no RLS and `aoa_app` holds SELECT on it, so a caller could enumerate orgs exactly as it
enumerates companies today. The only thing a caller cannot forge is **the role it connects as**. Say so
in the manifest rationale and in the commit message.

---

## Constraints — each of these has a failure mode that ships silently

1. **An arity change creates a NEW function; it does not replace the old one.** Without explicit
   `DROP FUNCTION IF EXISTS` for the old signatures, the stale overloads survive **carrying their
   `aoa_app` EXECUTE grant** — the fix looks applied and the hole stays open. They would then also trip
   `assertNoUnmanifestedSecurityDefinerFunctions` on the flag-on path.
2. **★ CORRECTED — edit 0266 in place, and do NOT bump the journal.** An earlier draft of this plan
   told you to bump `when` for idx 266 in `meta/_journal.json`. **That is a no-op**, and I verified it
   rather than reasoning about it: `migrationHistoryEntryExists`
   (`packages/db/src/client.ts:461-477`) builds its predicate as `hash = … OR name = …` and never
   consults `when`. Because the filename is unchanged, `name` always matches and the entry always
   counts as applied — bumping `when` changes nothing.

   Editing in place is nonetheless **correct here**, for a different reason than the draft gave:
   migration `0266` is introduced by this PR (`50bba3e7a`) and is **not on `docs/replatform-program`**,
   so no deployed box has ever run it. Every database holding it is ephemeral — CI, embedded-postgres
   test instances.

   **The moment 0266 merges, this stops being true.** If this unit is ever rebased onto a base that
   already carries 0266, the remedy is a **NEW migration file** (a new `name` makes the predicate miss),
   never a journal edit. Check `git ls-tree <base> -- packages/db/src/migrations/ | grep 0266` before
   assuming.
3. **Do NOT wrap the gate in `runInTenant`.** `legacy_resource_reconciliation` has FORCE RLS whose app
   policy qual is inverted — `current_setting('aoa.organization_id', true) IS NULL`. Wrapping returns
   **zero rows silently**. This unit sidesteps it rather than fixing it: the operator policy
   `legacy_resource_reconciliation_operator_write` is `USING (true)`, so on `operatorDb` `listRecords`
   works in *or* out of tenant context and the inverted qual stops being load-bearing for this path.
4. **Closure cannot be computed inside the function.** `legacy_resource_reconciliation` is
   `ENABLE` + `FORCE ROW LEVEL SECURITY` with exactly two policies — one for `aoa_operator`, one for
   `aoa_app`, **none for the owner**. FORCE removes the owner's exemption, so a definer function running
   as the owner reads zero rows. The lease ids must cross the boundary. Do not "improve" this by
   returning counts.
5. **`listRecords(companyId)` keeps its shape.** It is the read the FORCE-RLS policy governs; do not
   entangle it with the definer surface.
6. **Keep the round-6 split.** Each Company's reads stay independent — no shared snapshot, no
   store-global single-flight. That was a fail-open and it is not to be reintroduced.
7. **Every integration command needs `AOA_RUN_WIN_INTEGRATION=1`**, and you must confirm the summary
   says `passed`/`failed`, not `skipped`. A RED step that skips proves nothing.
8. **Run vitest from the REPO ROOT.** `--project server` silently matches nothing — use a path.

---

## File Structure

| File | Change |
|---|---|
| `server/src/__tests__/canary-preflight-real-role.integration.test.ts` | **Task 1** — the RED positive control (already written, already failing). Then the fixture gains an `aoa_operator` login, and the two existing "positive controls" are **inverted** — today they pin the attack as required behaviour. |
| `packages/db/src/migrations/0266_canary_preflight_evidence_fn.sql` | Drop the two old signatures; create three org-bound functions; `REVOKE` from `aoa_app`, `GRANT` to `aoa_operator`. |
| `server/src/db/security-definer-manifest.ts` | Two entries → three: new `identityArguments`, `executeGrantees: ["aoa_operator"]`, `authorityRelations` + `public.companies`, fresh `bodySha256`. |
| `server/src/services/canary-preflight-evidence.ts` | Add `readCanaryPreflightCompanyIds`; thread `organizationId` into the other two. |
| `server/src/services/canary-preflight.ts` | Three store members gain `organizationId`. `listRecords` unchanged. |
| `server/src/services/canary-preflight-store.ts` | `listOrganizationCompanyIds` delegates to the definer; the `companies`/`eq` drizzle imports go. |
| `server/src/index.ts` | Construct the store on `operatorDb`. |
| `server/src/__tests__/security-definer-manifest.test.ts` | 10 hardcoded `(uuid, uuid)` sites (lines 156, 171, 193-196, 217, 240, 264-265, 283-284, 302, 346, 349). |
| `server/src/__tests__/distributed-execution-db-startup.integration.test.ts` | Lines 2229, 2241. |
| `server/src/__tests__/cli-006-canary-preflight-store.test.ts` | Mock names and the three-argument members. |
| `server/src/__tests__/cli-006-canary-preflight.test.ts` | Fake stores gain the org argument. |
| `docs/architecture/decisions.md` | Only if the amendment's condition wording needs to follow the grantee change. Check; do not assume. |

---

## Task 1: The RED positive control

**It already exists in the PR worktree and already fails.** Re-create it if you are starting clean.

**Files:**
- Modify: `server/src/__tests__/canary-preflight-real-role.integration.test.ts`

- [ ] **Step 1: Confirm the test exists and FAILS**

```bash
cd /c/u16 && AOA_RUN_WIN_INTEGRATION=1 npx vitest run server/src/__tests__/canary-preflight-real-role.integration.test.ts -t "POSITIVE CONTROL"
```

Expected: **1 failed**, with `expected [ Array(1) ] to not include 'e1000000-0000-4000-8000-000000000014'`.

If it says `skipped`, **stop** — the gate was not lifted and you have proven nothing.

If the test is absent, add it inside the `describe("the definer function is company-scoped …")` block:

```ts
    it("POSITIVE CONTROL — aoa_app can read ANY company's leases by naming it", async () => {
      const result = await fixture!.appDb.execute(
        sql`SELECT lease_id FROM public.canary_preflight_evidence_leases(${NEIGHBOUR}::uuid)`,
      );
      const rows = (Array.isArray(result)
        ? result
        : ((result as { rows?: unknown[] }).rows ?? [])) as Array<{ lease_id: string | null }>;

      expect(
        rows.map((row) => row.lease_id),
        "an aoa_app session named a company it has no relationship to and received that " +
          "company's lease ids through OWNER authority, bypassing the privilege denial that " +
          "makes environment_leases unreadable to this pool",
      ).not.toContain(NEIGHBOUR_LEASE);
    });
```

- [ ] **Step 2: Commit the RED test on its own**

Committing the failing test alone is deliberate: it makes the defect a reviewable artifact rather than a
claim in a commit message. CI will be red for exactly one commit.

```bash
git add server/src/__tests__/canary-preflight-real-role.integration.test.ts
git commit -m "test(cli-006): reproduce the cross-company definer read (RED)"
```

---

## Task 2: Three organization-bound functions, granted to the operator

**Files:**
- Modify: `packages/db/src/migrations/0266_canary_preflight_evidence_fn.sql`
- Modify: `packages/db/src/migrations/meta/_journal.json`

- [ ] **Step 1: Replace the two function definitions**

Keep the file's existing WHY/WHY-NOT header and extend it. Replace everything from the first
`CREATE OR REPLACE FUNCTION` to the end with:

```sql
-- ROUND-7. An arity change CREATES A NEW FUNCTION; it does not replace the old one. Without
-- these drops the stale one- and two-argument overloads survive WITH their aoa_app EXECUTE
-- grant -- the fix would look applied while the hole stayed open -- and would then trip
-- assertNoUnmanifestedSecurityDefinerFunctions on the flag-on path.
DROP FUNCTION IF EXISTS public.canary_preflight_evidence_leases(uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.canary_preflight_evidence_scalars(uuid, uuid);
--> statement-breakpoint

-- Replaces the direct `companies` read in canary-preflight-store.ts, so the gate's pool needs
-- no `companies` grant. THIS is what lets EXECUTE move to aoa_operator, which holds [] on
-- companies and organizations.
CREATE OR REPLACE FUNCTION public.canary_preflight_evidence_companies(p_organization_id uuid)
RETURNS TABLE (company_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT c.id FROM public.companies c WHERE c.organization_id = p_organization_id;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.canary_preflight_evidence_companies(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.canary_preflight_evidence_companies(uuid) FROM "aoa_app";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.canary_preflight_evidence_companies(uuid) TO "aoa_operator";
--> statement-breakpoint

-- ORGANIZATION-BOUND. p_company_id alone was a lateral read of ANY company's leases through
-- owner authority -- reproduced against a real database, see the Task-1 positive control. The
-- EXISTS clause makes the ORG the unit of authority: a company outside the organization being
-- gated yields zero rows whatever the caller passes.
--
-- ★ This is defence in depth, NOT the boundary. organizationId is caller-supplied too, and
-- `companies` has no RLS. The boundary is the EXECUTE grant below: the one thing a caller
-- cannot forge is the role it connects as.
CREATE OR REPLACE FUNCTION public.canary_preflight_evidence_leases(
  p_organization_id uuid, p_company_id uuid)
RETURNS TABLE (lease_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT l.id FROM public.environment_leases l
  WHERE l.company_id = p_company_id
    AND EXISTS (SELECT 1 FROM public.companies c
                WHERE c.id = p_company_id AND c.organization_id = p_organization_id);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.canary_preflight_evidence_leases(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.canary_preflight_evidence_leases(uuid, uuid) FROM "aoa_app";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.canary_preflight_evidence_leases(uuid, uuid) TO "aoa_operator";
--> statement-breakpoint

-- `scoped` returning no row makes both scalar sub-selects NULL, so the "exactly one row,
-- always" contract holds and an out-of-org company reads as "no evidence", never as an error.
CREATE OR REPLACE FUNCTION public.canary_preflight_evidence_scalars(
  p_organization_id uuid, p_company_id uuid, p_default_env_id uuid)
RETURNS TABLE (
  platform_default_environment_id uuid,
  key_generation text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH scoped AS (
    SELECT c.id FROM public.companies c
    WHERE c.id = p_company_id AND c.organization_id = p_organization_id
  ),
  default_env AS (
    SELECT e.id FROM public.environments e
    WHERE e.id = p_default_env_id
      AND e.company_id = (SELECT id FROM scoped)
    LIMIT 1
  ),
  keygen AS (
    -- INNER JOIN LATERAL is deliberate. A runtime_provider_keys row with no status='current'
    -- version must yield NO keygen row, so key_generation is NULL -- matching
    -- deriveE2bKeyGeneration. A LEFT JOIN would emit `secretId:` with a null version.
    SELECT k.secret_id, v.version
    FROM public.runtime_provider_keys k
    JOIN LATERAL (
      SELECT cv.version FROM public.company_secret_versions cv
      WHERE cv.secret_id = k.secret_id AND cv.status = 'current'
      ORDER BY cv.version DESC LIMIT 1
    ) v ON TRUE
    WHERE k.company_id = (SELECT id FROM scoped)
      AND k.provider = 'e2b' AND k.is_default = TRUE
    LIMIT 1
  )
  SELECT (SELECT id FROM default_env),
         (SELECT secret_id::text || ':' || version::text FROM keygen);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.canary_preflight_evidence_scalars(uuid, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.canary_preflight_evidence_scalars(uuid, uuid, uuid) FROM "aoa_app";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.canary_preflight_evidence_scalars(uuid, uuid, uuid) TO "aoa_operator";
```

★ `p_default_env_id` stays caller-supplied: PostgreSQL has no builtin SHA-1, so the uuidv5 cannot be
recomputed in the body, and a natural-key lookup would be a second derivation that drifts silently. It
is now a pure **filter** — `e.company_id` is bound to `scoped`, so an env id from another org matches
nothing.

- [ ] **Step 2: Confirm 0266 is still unmerged, then do nothing to the journal**

```bash
cd /c/u16 && git ls-tree origin/docs/replatform-program --name-only packages/db/src/migrations/ | grep 0266 || echo "not on base — editing in place is correct"
```

Expected: `not on base`. If 0266 **is** on the base, stop and read Constraint 2 — you need a new
migration file, not an edit, and this plan's Task 2 must be re-cut.

Do **not** touch `meta/_journal.json`. The migrator keys on `hash OR name`, never `when`.

- [ ] **Step 3: Apply and verify the grant actually moved**

```bash
cd /c/u16 && pnpm db:migrate
```

Then, as `aoa_app`, all three must raise 42501; as `aoa_operator`, all three must work.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/migrations/
git commit -m "feat(cli-006): organization-bound definer functions, granted to the operator pool"
```

---

## Task 3: Manifest — three entries, new grantee, new hashes

**Files:**
- Modify: `server/src/db/security-definer-manifest.ts`

- [ ] **Step 1: Write the three entries**

For each: the new `identityArguments`, `executeGrantees: ["aoa_operator"]`, `authorityRelations`
extended with `"public.companies"` for `_leases` and `_scalars` (the `EXISTS`/`scoped` clause reads it,
and the owner-pin walks every declared relation), and a fresh `bodySha256`.

★ **Do not let the rationale overclaim.** After this change `p_company_id` is still caller-controlled
and `aoa_operator` can still name any Company under any Organization. Write it as a reduction in
*reachable-by*, not as an authorization boundary. Example for `_leases`:

```ts
    rationale:
      "BLOCKER E / round 7. Returns lease ids for one Company from a table the serving roles hold " +
      "zero privileges on. EXECUTE is granted to aoa_operator ONLY: aoa_app is the tenant-facing " +
      "pool (HTTP requests, outbox worker, admission bridge, live-event log), so moving the grant " +
      "narrows which injection surface can reach owner authority. The organization predicate is " +
      "defence in depth, NOT a boundary -- p_organization_id is caller-supplied and companies " +
      "carries no RLS. The binder is the grantee.",
```

- [ ] **Step 2: Compute the hashes the way the scan does**

```bash
cd /c/u16 && node -e "
const fs=require('fs'),c=require('crypto');
const m=fs.readFileSync('packages/db/src/migrations/0266_canary_preflight_evidence_fn.sql','utf8');
for(const [,n,b] of m.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\([\s\S]*?\nAS \\\$\\\$([\s\S]*?)\\\$\\\$;/g))
  console.log(n, c.createHash('sha256').update(b.replace(/\r/g,'')).digest('hex'));
"
```

The scan computes `sha256(convert_to(replace(prosrc, chr(13), ''), 'UTF8'))`. **Do not hand-verify these
— Task 6's certificate suite is what proves them against real `pg_proc`.**

- [ ] **Step 3: Commit**

```bash
git add server/src/db/security-definer-manifest.ts
git commit -m "feat(e2): certificate the three org-bound definer functions"
```

---

## Task 4: Thread the organization through the read path

**Files:**
- Modify: `server/src/services/canary-preflight-evidence.ts`
- Modify: `server/src/services/canary-preflight.ts`
- Modify: `server/src/services/canary-preflight-store.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Add the companies read and thread the org**

```ts
/** Company ids for one Organization, read through owner authority so the gate's pool needs no
 *  `companies` grant. That absence is what lets EXECUTE live on aoa_operator. */
export async function readCanaryPreflightCompanyIds(
  db: Db,
  organizationId: string,
): Promise<readonly string[]> {
  const result = await db.execute(
    sql`SELECT company_id FROM public.canary_preflight_evidence_companies(${organizationId}::uuid)`,
  );
  return rowsOf<{ company_id: string | null }>(result)
    .map((row) => row.company_id)
    .filter((id): id is string => id !== null);
}
```

and in the other two:

```ts
sql`SELECT lease_id FROM public.canary_preflight_evidence_leases(
      ${organizationId}::uuid, ${companyId}::uuid)`

sql`SELECT platform_default_environment_id, key_generation
      FROM public.canary_preflight_evidence_scalars(
        ${organizationId}::uuid, ${companyId}::uuid, ${defaultEnvId}::uuid)`
```

`derivePlatformDefaultEnvironmentId(companyId)` stays where it is.

- [ ] **Step 2: Widen three store members in the interface**

`listLeases(organizationId, companyId)`, `platformDefaultEnv(organizationId, companyId)`,
`currentKeyGeneration(organizationId, companyId)`. **`listRecords(companyId)` is unchanged** —
Constraint 5. `organizationId` is already in scope at the `check()` loop, so each call site gains one
argument.

- [ ] **Step 3: Point the composition at the operator pool**

```ts
preflight: createCanaryPreflight({
  store: createDrizzleCanaryPreflightStore(distributedExecutionDatabases.operatorDb),
}),
```

`operatorDb` is already in scope two lines above.

- [ ] **Step 4: Build**

```bash
cd /c/u16 && pnpm --filter "@armyofagents/server" build
```

- [ ] **Step 5: Commit**

```bash
git add server/src/services/ server/src/index.ts
git commit -m "fix(cli-006): read canary evidence on the operator pool, bound to the organization"
```

---

## Task 5: Invert the tests that currently pin the attack

**Files:**
- Modify: `server/src/__tests__/canary-preflight-real-role.integration.test.ts`

★ The suite's two existing "positive controls" **assert the attack as required behaviour** — `ORG`'s
fixture calls the function with `NEIGHBOUR`, a company in `OTHER_ORG`, and expects `[NEIGHBOUR_LEASE]`.
They must be **inverted**, not supplemented.

- [ ] **Step 1: Give the fixture an operator login**

`startMigratedDatabase` gains `operatorDb` the same way it builds `appDb`.
`provisionTenantAppRoleLoginSql` is role-generic with `assertSafeRoleName` and is already used for the
operator elsewhere. The two existing behaviour tests then run against `operatorDb`.

- [ ] **Step 2: The cross-org read, and an honest positive control**

```ts
it("does not answer about a Company outside the Organization being gated", async () => {
  const rows = await leases(fixture!.organizationId /* ORG */, NEIGHBOUR);
  expect(
    rows.map((r) => r.lease_id),
    "an owner-authority function must not return another Organization's lease ids",
  ).toEqual([]);
});

// The control must use OTHER_ORG, so NO test in this suite asserts that one org can read
// another's evidence.
it("returns the neighbour's lease when asked as the neighbour's own Organization", async () => {
  const rows = await leases(OTHER_ORG, NEIGHBOUR);
  expect(rows.map((r) => r.lease_id)).toEqual([NEIGHBOUR_LEASE]);
});
```

- [ ] **Step 3 ★: The assertion that IS the fix — `aoa_app` denied EXECUTE**

Put it beside the existing `FORBIDDEN_TABLES` loop; that loop already pins "the fix must widen nothing"
for the four tables, and this extends the pin to the function surface created to bypass them.

```ts
const DEFINER_FUNCTIONS = [
  "public.canary_preflight_evidence_companies($1::uuid)",
  "public.canary_preflight_evidence_leases($1::uuid, $1::uuid)",
  "public.canary_preflight_evidence_scalars($1::uuid, $1::uuid, $1::uuid)",
] as const;

it.each(DEFINER_FUNCTIONS)("still denies `aoa_app` EXECUTE on %s", async (fn) => {
  let raised: unknown;
  try {
    await fixture!.appDb.execute(sql.raw(`SELECT * FROM ${fn.replace(/\$1/g, `'${NEIGHBOUR}'`)}`));
  } catch (error) { raised = error; }
  expect(raised, `${fn} is executable by aoa_app — a grant crept in`).toBeDefined();
  const cause = (raised as { cause?: unknown }).cause ?? raised;
  expect((cause as { code?: string }).code, fn).toBe("42501");
});
```

- [ ] **Step 4 ★: Pin the premise the security argument rests on**

The argument depends on the operator policy being `USING(true)` and the app policy being company-blind.
Pin both, or the argument rots silently:

```ts
it("pins the policy shapes this unit's security argument depends on", async () => {
  const rows = await fixture!.adminDb.execute(sql`
    SELECT polname, pg_get_expr(polqual, polrelid) AS qual
    FROM pg_policy WHERE polrelid = 'public.legacy_resource_reconciliation'::regclass
    ORDER BY polname`);
  const byName = new Map(rowsOf<{ polname: string; qual: string }>(rows).map((r) => [r.polname, r.qual]));
  // operator: unconditional, which is why the gate works in or out of tenant context there.
  expect(byName.get("legacy_resource_reconciliation_operator_write")).toBe("true");
  // app: the INVERTED qual. If this ever becomes company-scoped, revisit the whole design.
  expect(byName.get("legacy_resource_reconciliation_app_read")).toContain("aoa.organization_id");
});
```

- [ ] **Step 5: Delete the Task-1 positive control**

Its job is done: it proved the defect. `aoa_app` no longer holds EXECUTE, so it would now fail for the
wrong reason (a permission error rather than a leak). Step 3's loop is its successor and asserts the
stronger property. Say that in the commit message.

- [ ] **Step 6: Run**

```bash
cd /c/u16 && AOA_RUN_WIN_INTEGRATION=1 npx vitest run server/src/__tests__/canary-preflight-real-role.integration.test.ts
```

Confirm `passed`, not `skipped`.

- [ ] **Step 7: Commit**

```bash
git add server/src/__tests__/canary-preflight-real-role.integration.test.ts
git commit -m "test(cli-006): invert the probes that pinned the cross-org read as expected"
```

---

## Task 6: The call sites the design missed

**Files:**
- Modify: `server/src/__tests__/security-definer-manifest.test.ts` — **10** hardcoded `(uuid, uuid)`
  sites: lines 156, 171, 193-196, 217, 240, 264-265, 283-284, 302, 346, 349.
- Modify: `server/src/__tests__/distributed-execution-db-startup.integration.test.ts` — lines 2229, 2241.
- Modify: `server/src/__tests__/cli-006-canary-preflight-store.test.ts` — mock names, three-arg members.
- Modify: `server/src/__tests__/cli-006-canary-preflight.test.ts` — fake stores gain the org argument.

- [ ] **Step 1: Retarget them at the new signatures**

The negative fixtures in the certificate suite should target `_scalars`, which has the richest body.
Replacement fixtures must match its **two-column** return shape — `CREATE OR REPLACE` cannot change a
return type.

- [ ] **Step 2: Run all four**

```bash
cd /c/u16 && AOA_RUN_WIN_INTEGRATION=1 npx vitest run \
  server/src/__tests__/security-definer-manifest.test.ts \
  server/src/__tests__/distributed-execution-db-startup.integration.test.ts \
  server/src/__tests__/cli-006-canary-preflight-store.test.ts \
  server/src/__tests__/cli-006-canary-preflight.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add server/src/__tests__/
git commit -m "test(e2): retarget the definer fixtures at the org-bound signatures"
```

---

## Task 7: The free narrowing nobody spotted

**Files:**
- Modify: `server/src/services/canary-preflight.ts`

- [ ] **Step 1: Stop putting a secret row id in a refusal detail**

The `credential_authority_not_moved` detail interpolates `(current ${keyGeneration})`, which places a
`company_secrets` row id into a refusal string that reaches logs via `run-execution-owner.ts`. It is a
different sink from the definer surface and costs nothing to close. Drop the interpolated value; keep
the count and the Company id.

- [ ] **Step 2: Run the gate suite and commit**

```bash
cd /c/u16 && npx vitest run server/src/__tests__/cli-006-canary-preflight.test.ts
git add server/src/services/canary-preflight.ts
git commit -m "fix(cli-006): keep the key-generation id out of the refusal detail"
```

---

## Task 8: Full verification before pushing

- [ ] **Step 1: Sharded suite, from the REPO ROOT, gated on exit code**

```bash
cd /c/u16 && rc=0; for s in 1 2 3 4; do npx vitest run --shard=$s/4 server/src/__tests__ || rc=1; done; echo "SUITE_RC=$rc"
```

- [ ] **Step 2: The policy suite — 23 scripts plus the two extras**

```bash
cd /c/u16 && for s in check-adapter-manager-boundary check-artifact-commit-vectors \
  check-boot-roots-browser-spawn-free check-boot-roots-provider-free check-d1-dispatch-declared \
  check-dependency-graph check-device-proof-vectors check-distributed-execution-foundation \
  check-execution-census check-finding-ownership check-gate-clause-wiring check-guard-inventory \
  check-sandbox-coding-disposition check-sandbox-e2b-provider-boundary check-sandbox-fake-provider-boundary \
  check-test-inventory check-ticket-graph-coverage check-worker-daemon-boundary check-worker-keystore-boundary \
  check-worker-path-parity check-worker-protocol-boundary check-workspace-patch-vectors \
  check-workspace-snapshot-vectors; do \
  node scripts/$s.mjs >/dev/null 2>&1 && echo "ok   $s" || echo "FAIL $s"; done
cd /c/u16 && pnpm check:frozen-worker-protocol-v1 && node scripts/check-forbidden-tokens.mjs
```

- [ ] **Step 3 ★: Mutation-check the boundary**

A guard that cannot go red is not a guard. Temporarily
`GRANT EXECUTE ON FUNCTION public.canary_preflight_evidence_leases(uuid, uuid) TO "aoa_app";`
in the test database and confirm Task 5 Step 3 goes **RED** with 42501 missing. Revert.

- [ ] **Step 4: Push and answer the thread**

The PR comment must state the security argument in the ⛔ section's terms — a narrowing of
reachable-by, not an authorization boundary — and must say plainly that the previous probes pinned the
attack as expected behaviour.

---

## Self-review

**Scope coverage.** The finding's two halves are Task 2 (org binding) and Task 4 Step 3 + Task 5 Step 3
(the grantee move, which is the actual fix). The six mandatory corrections from the design judging map
to: Constraint 2 + Task 2 Step 2 (the journal bump, which I verified is a NO-OP and removed), Task 6 (the two omitted test files), Task 5 Step 4
(pin the premise), Task 7 (the refusal-detail sink), Task 5 Step 3 (the denied-EXECUTE loop), and the
rationale wording in Task 3 Step 1 (do not overclaim).

**Placeholders.** None. Every code step carries the code. The one judgement call left open is whether
`decisions.md` condition wording needs to follow the grantee change — the plan says *check, do not
assume*, because asserting either way without reading it is the exact failure this PR has produced eight
times.

**Type consistency.** `readCanaryPreflightCompanyIds` / `readCanaryPreflightLeaseIds` /
`readCanaryPreflightScalars` all take `(db, organizationId, …)`; the three widened store members take
`(organizationId, companyId)`; `listRecords(companyId)` is unchanged throughout.

**Known residual, stated rather than hidden.** `aoa_operator` can still name any Company under any
Organization, and `organizationId` is caller-supplied. This unit does not close that and does not claim
to — no in-database predicate closes it while the role is shared. What it closes is *which pool* can
reach owner authority at all.
