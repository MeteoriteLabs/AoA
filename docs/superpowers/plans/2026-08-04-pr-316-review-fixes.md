# PR 316 Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three actionable PR 316 review findings with regression coverage and Docker-only validation.

**Architecture:** Company import will resolve an explicit create-capable Organization and carry it through preview and import; the Organization membership projection will include a scoped display name for the picker. Plugin lifecycle mutations will share one company-scoped cache invalidation helper. The cloud verification wrapper will compose the existing provider-key notice into its reachable deferred step.

**Tech Stack:** React 19, TypeScript, TanStack Query, Vitest/Testing Library, Express 5, Drizzle ORM, Docker/BuildKit, pnpm inside Docker only.

## Global Constraints

- Run every red/green test, typecheck, and build inside Docker; do not run host `pnpm`.
- No package manifest, lockfile, database schema, migration, authorization-rule, or extraction-engine changes.
- The server remains authoritative for `company:create` on the exact supplied Organization and must never guess among multiple Organizations.
- The import picker is local to `CompanyImport`; do not alter the separate create-another-company beta flow.
- Provider-key copy must remain non-blocking and must not claim that provider keys enable extraction.
- Plugin invalidations must remain company-scoped and cover Settings, Marketplace, and UI-contribution query keys.
- Preserve all deferred PR 316 scope listed in the design spec.

---

### Task 0: Docker Working-Tree Test Layer

**Files:**
- Create outside product diff: `../.tmp-pr316-docker-harness/Dockerfile.workspace`
- Read: `../.tmp-pr316-docker-harness/Dockerfile`
- Read: `../.tmp-pr316-docker-harness/RESULTS.md`

**Interfaces:**
- Consumes: `aoa-pr316-7c5fa9e-ci-normalized:latest`, the previously validated dependency image.
- Produces: `aoa-pr316-working-tree-fast:latest`, containing the current worktree source over the baked dependencies.

- [ ] **Step 1: Add the fast working-tree Dockerfile**

```dockerfile
ARG BASE_IMAGE=aoa-pr316-7c5fa9e-ci-normalized:latest
FROM ${BASE_IMAGE}

USER root
COPY --chown=node:node . /app

RUN sed -i 's/\r$//' \
      /app/scripts/provision-worktree.sh \
      /app/scripts/deploy/verify-testing-revision.sh
```

- [ ] **Step 2: Build the layer from the current checkout**

Run from `C:\Users\Dell\Desktop\aoa`:

```powershell
docker buildx build --progress=plain --load `
  --file C:\Users\Dell\Desktop\aoa\.tmp-pr316-docker-harness\Dockerfile.workspace `
  --tag aoa-pr316-working-tree-fast `
  C:\Users\Dell\Desktop\aoa\AoA
```

Expected: exit 0; the source-copy layer rebuilds without reinstalling dependencies.

- [ ] **Step 3: Prove the container sees the current commit and test runner**

```powershell
docker run --rm --user node --entrypoint bash aoa-pr316-working-tree-fast:latest `
  -lc "git rev-parse HEAD && pnpm exec vitest --version"
```

Expected: exit 0 and Vitest prints its version. The Git commit is the current worktree HEAD; uncommitted files are also present because BuildKit copied the working tree.

### Task 1: Organization-Aware Company Import

**Files:**
- Modify: `server/src/services/organization-access.ts`
- Modify: `packages/shared/src/types/company-portability.ts`
- Modify: `docs/api/organizations.md`
- Modify: `ui/src/api/organizations.ts`
- Modify: `ui/src/pages/CompanyImport.tsx`
- Test: `packages/shared/src/validators/company-portability-import-target.test.ts`
- Test: `server/src/__tests__/organization-access.test.ts`
- Test: `server/src/__tests__/organizations-route-contract.test.ts`
- Test: `server/src/__tests__/organizations-transaction.integration.test.ts`
- Test: `ui/src/__tests__/CompanyImport.test.tsx`
- Test: `ui/src/onboarding/__tests__/resolveCreateCompanyOrg.test.ts`
- Test: `ui/src/onboarding/__tests__/CreateAnotherCompany.test.tsx`

**Interfaces:**
- Consumes: `organizationsApi.list(): Promise<OrganizationMembership[]>`, `queryKeys.organizations.list`, and `CompanyPortabilityImportRequest.target.organizationId`.
- Produces: membership rows with `organizationName: string` and `organizationSlug: string`; an explicit selected Organization ID in both portability requests when tenant isolation requires one.

- [ ] **Step 1: Write failing server projection tests**

First add `organizationId?: string | null` to a compile-time `CompanyPortabilityImportTarget` fixture in `company-portability-import-target.test.ts`; it must fail until the handwritten shared type matches the Zod schema.

Add a `listOrgMemberships` test whose fake Drizzle chain exposes `select().from().innerJoin().where()` and returns:

```ts
[
  {
    id: "membership-1",
    organizationId: "org-1",
    organizationName: "Acme Holdings",
    organizationSlug: "acme-holdings",
    userId: "user-1",
    role: "owner",
    status: "active",
  },
]
```

Assert that `organizationAccessService(db).listOrgMemberships("user-1")` returns the named row and that the query joins the Organizations table. Update the route contract fixture to include both display fields and assert the JSON response preserves them. In `organizations-transaction.integration.test.ts`, create an Organization and assert the real joined membership returns its exact name and slug.

- [ ] **Step 2: Write failing UI destination tests**

Mock `@/api/organizations` in `CompanyImport.test.tsx`:

```ts
const organizationsListMock = vi.fn();

vi.mock("@/api/organizations", () => ({
  organizationsApi: {
    list: (...args: unknown[]) => organizationsListMock(...args),
  },
}));
```

Mock deployment health as `local_trusted` and Organization memberships as `[]` by default so existing self-hosted tests retain their behavior:

```ts
const healthGetMock = vi.fn();

vi.mock("@/api/health", () => ({
  healthApi: { get: (...args: unknown[]) => healthGetMock(...args) },
}));
```

Add separate `cloud_auth` tests that assert:

```ts
expect(previewImport).toHaveBeenCalledWith(
  expect.objectContaining({
    target: { mode: "new_company", organizationId: "org-1" },
  }),
);
```

Also add tests for:

- two active owner/admin memberships render a `Destination organization` selector with names and slugs and keep Preview disabled until one is selected;
- selecting `org-2` sends `org-2` to preview and final import;
- changing the destination after a successful preview removes the preview and disables Import until preview runs again;
- member/billing-only cloud memberships show an owner/admin access message and keep both actions disabled;
- an Organization-list rejection surfaces an inline error and keeps both actions disabled.
- unresolved or failed deployment health keeps both actions disabled so an unknown deployment mode cannot take the self-hosted fallback.

Add one self-hosted compatibility assertion that an empty membership list still previews with `{ mode: "new_company" }` and no `organizationId`.

- [ ] **Step 3: Build the Docker working-tree layer and verify RED**

Re-run the Task 0 build command, then:

```powershell
docker run --rm --user node --entrypoint bash aoa-pr316-working-tree-fast:latest `
  -lc "pnpm --filter @armyofagents/shared typecheck"

docker run --rm --user node --entrypoint bash aoa-pr316-working-tree-fast:latest `
  -lc "pnpm test:run -- packages/shared/src/validators/company-portability-import-target.test.ts server/src/__tests__/organization-access.test.ts server/src/__tests__/organizations-route-contract.test.ts server/src/__tests__/organizations-transaction.integration.test.ts server/src/__tests__/companies-import-authz-route.test.ts ui/src/__tests__/CompanyImport.test.tsx ui/src/onboarding/__tests__/resolveCreateCompanyOrg.test.ts ui/src/onboarding/__tests__/CreateAnotherCompany.test.tsx"
```

Expected: shared typecheck fails because the handwritten target type omits `organizationId`; the focused tests fail because membership names/slugs are not projected and cloud import requests omit `organizationId`.

- [ ] **Step 4: Add the scoped Organization display projection**

In `organization-access.ts`, import `getTableColumns`, `organizations`, and use the existing active-user predicate with an inner join:

```ts
return db
  .select({
    ...getTableColumns(organizationMemberships),
    organizationName: organizations.name,
    organizationSlug: organizations.slug,
  })
  .from(organizationMemberships)
  .innerJoin(
    organizations,
    eq(organizations.id, organizationMemberships.organizationId),
  )
  .where(
    and(
      eq(organizationMemberships.userId, userId),
      eq(organizationMemberships.status, "active"),
    ),
  );
```

Add `organizationName: string` and `organizationSlug: string` to the UI membership response interface, add `organizationId?: string | null` to the `new_company` branch of `CompanyPortabilityImportTarget`, and document the two membership display fields in `docs/api/organizations.md`. Do not add a new endpoint or loosen membership filtering.

- [ ] **Step 5: Implement import destination resolution**

In `CompanyImport`, load `healthApi.get()` with `queryKeys.health` and `organizationsApi.list()` with `queryKeys.organizations.list`, filter active `owner`/`admin` memberships, and maintain a selected Organization ID. Use these exact states:

```ts
const eligibleOrganizations = memberships.filter(
  (membership) =>
    membership.status === "active" &&
    (membership.role === "owner" || membership.role === "admin"),
);
```

- exactly one: auto-select it;
- more than one: render the named selector with an empty `Select an organization` option;
- zero eligible rows on `cloud_auth`, unresolved/failed deployment health, or any Organization load error: render the matching inline message and keep actions disabled;
- an empty list outside `cloud_auth`: preserve the server's self-hosted fallback by allowing an omitted `organizationId`.

Build requests with:

```ts
target: {
  mode: "new_company",
  ...(selectedOrganizationId
    ? { organizationId: selectedOrganizationId }
    : {}),
},
```

When selection changes, call `setPreview(null)` and `setImportResult(null)`. Include successful deployment health, a resolved cloud selection (or the self-hosted empty-list fallback), a completed membership query, and no membership error in `canPreview`; retain the existing preview-error gate for `canImport`. Extend onboarding membership factories with the new required display fields without changing resolver behavior.

- [ ] **Step 6: Verify GREEN in Docker**

Rebuild `aoa-pr316-working-tree-fast`, then run both focused commands from Step 3.

Expected: shared typecheck and all focused test files pass with no unhandled errors or warnings.

- [ ] **Step 7: Commit**

```powershell
git add packages/shared/src/types/company-portability.ts packages/shared/src/validators/company-portability-import-target.test.ts server/src/services/organization-access.ts server/src/__tests__/organization-access.test.ts server/src/__tests__/organizations-route-contract.test.ts server/src/__tests__/organizations-transaction.integration.test.ts docs/api/organizations.md ui/src/api/organizations.ts ui/src/pages/CompanyImport.tsx ui/src/__tests__/CompanyImport.test.tsx ui/src/onboarding/__tests__/resolveCreateCompanyOrg.test.ts ui/src/onboarding/__tests__/CreateAnotherCompany.test.tsx
git commit -m "fix: select organization for company imports"
```

### Task 2: Plugin Lifecycle Cache Coherence

**Files:**
- Modify: `ui/src/components/settings/PluginDetailSlideOver.tsx`
- Test: `ui/src/components/settings/__tests__/PluginDetailSlideOver.test.tsx`

**Interfaces:**
- Consumes: legacy Settings key `["company-plugins", companyId]`, `queryKeys.plugins.companyList(companyId)`, and `queryKeys.plugins.uiContributions(companyId)`.
- Produces: `invalidateCompanyPluginState(): Promise<void>` used by every completed lifecycle transition.

- [ ] **Step 1: Write failing lifecycle invalidation tests**

Return the `QueryClient` from the test `wrap()` helper and spy on `invalidateQueries`. Replace the no-op capability modal mock with buttons that invoke `onApproved` and `onCancelled`. Add or extend tests for:

- enable/disable success;
- retry activation success;
- ready upgrade success;
- cloud-block reconciliation after a lifecycle error;
- capability upgrade approval;
- capability upgrade rollback/cancel success.

Each completed path must contain all three calls:

```ts
expect(invalidateQueries).toHaveBeenCalledWith({
  queryKey: ["company-plugins", "company-1"],
});
expect(invalidateQueries).toHaveBeenCalledWith({
  queryKey: queryKeys.plugins.companyList("company-1"),
});
expect(invalidateQueries).toHaveBeenCalledWith({
  queryKey: queryKeys.plugins.uiContributions("company-1"),
});
```

Do not assert exact call counts because the child modal may also invalidate an installed-list key.

- [ ] **Step 2: Verify RED in Docker**

Rebuild `aoa-pr316-working-tree-fast`, then:

```powershell
docker run --rm --user node --entrypoint bash aoa-pr316-working-tree-fast:latest `
  -lc "pnpm --filter @armyofagents/ui exec vitest run src/components/settings/__tests__/PluginDetailSlideOver.test.tsx"
```

Expected: new assertions fail because only the legacy Settings key is invalidated.

- [ ] **Step 3: Implement one shared invalidation helper**

Import `queryKeys` and add:

```ts
const invalidateCompanyPluginState = async () => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["company-plugins", companyId] }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.plugins.companyList(companyId),
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.plugins.uiContributions(companyId),
    }),
  ]);
};
```

Use it for cloud-block reconciliation, ready upgrade, toggle success, retry success, capability approval, and capability cancellation after rollback. Keep the `upgrade_pending` response itself local until the modal resolves it.

- [ ] **Step 4: Verify GREEN in Docker**

Rebuild and rerun the focused command from Step 2.

Expected: the test file passes.

- [ ] **Step 5: Commit**

```powershell
git add ui/src/components/settings/PluginDetailSlideOver.tsx ui/src/components/settings/__tests__/PluginDetailSlideOver.test.tsx
git commit -m "fix: refresh plugin contributions after lifecycle changes"
```

### Task 3: Reachable Cloud Provider-Key Notice

**Files:**
- Modify: `ui/src/onboarding/steps/CloudDeferredStep.tsx`
- Test: `ui/src/onboarding/steps/__tests__/CloudDeferredStep.test.tsx`

**Interfaces:**
- Consumes: `CloudProviderKeyNotice({ deploymentMode })` and `StepProps.ctx.deploymentMode`.
- Produces: optional `supportingContent?: ReactNode` on the private `CloudDeferredStep` component.

- [ ] **Step 1: Write failing composed-flow tests**

Add a cloud verification test that asserts:

```ts
const notice = screen.getByTestId("cloud-provider-key-notice");
expect(notice).toHaveTextContent(/isn't required|not required/i);
expect(notice).not.toHaveTextContent(/extraction/i);
expect(
  screen.getByRole("link", { name: /open settings.*providers/i }),
).toHaveAttribute("href", "/settings?tab=providers");
```

Add a cloud environment test asserting the notice is absent. Preserve the existing continuation assertions.

Mock the local `VerifyStep` dependency with a `data-testid="local-verify-step"` stub and add a `local_trusted` test proving `CloudAwareVerifyStep` routes to that component and does not render `cloud-provider-key-notice`:

```ts
vi.mock("../VerifyStep", () => ({
  VerifyStep: () => <div data-testid="local-verify-step" />,
}));
```

- [ ] **Step 2: Verify RED in Docker**

Rebuild `aoa-pr316-working-tree-fast`, then:

```powershell
docker run --rm --user node --entrypoint bash aoa-pr316-working-tree-fast:latest `
  -lc "pnpm --filter @armyofagents/ui exec vitest run src/onboarding/steps/__tests__/CloudDeferredStep.test.tsx src/onboarding/steps/__tests__/VerifyStep.test.tsx src/onboarding/__tests__/CloudProviderKeyNotice.test.tsx"
```

Expected: the composed cloud verification assertion fails because the deferred branch does not mount the notice.

- [ ] **Step 3: Compose the notice into the deferred verification card**

Import `ReactNode` and `CloudProviderKeyNotice`. Add `supportingContent?: ReactNode` to `CloudDeferredStep`, render it below the existing explanation with `mt-3`, and pass:

```tsx
supportingContent={
  <CloudProviderKeyNotice deploymentMode={props.ctx.deploymentMode} />
}
```

only from `CloudAwareVerifyStep`. Do not pass it from `CloudAwareEnvironmentStep` and do not duplicate the notice copy.

- [ ] **Step 4: Verify GREEN in Docker**

Rebuild and rerun the focused command from Step 2.

Expected: all three onboarding test files pass.

- [ ] **Step 5: Commit**

```powershell
git add ui/src/onboarding/steps/CloudDeferredStep.tsx ui/src/onboarding/steps/__tests__/CloudDeferredStep.test.tsx
git commit -m "fix: show provider guidance during cloud onboarding"
```

### Task 4: Integrated Docker Validation and Evidence

**Files:**
- Update outside product diff: `../.tmp-pr316-docker-harness/RESULTS.md`
- Verify: all files changed since `origin/main`

**Interfaces:**
- Consumes: Tasks 1-3 commits and the original harness Dockerfile.
- Produces: authoritative rebuilt image and a results record separating product failures from harness/infrastructure failures.

- [ ] **Step 1: Rebuild the authoritative runtime image from the final checkout**

```powershell
docker buildx build --progress=plain --load --target runtime `
  --file C:\Users\Dell\Desktop\aoa\.tmp-pr316-docker-harness\Dockerfile `
  --tag aoa-pr316-fixed-runtime `
  C:\Users\Dell\Desktop\aoa\AoA
```

Expected: frozen install and offline reinstall pass.

- [ ] **Step 2: Run the combined regression suite**

```powershell
docker run --rm --user node --entrypoint bash aoa-pr316-fixed-runtime:latest `
  -lc "pnpm test:run -- packages/shared/src/validators/company-portability-import-target.test.ts server/src/__tests__/organization-access.test.ts server/src/__tests__/organizations-route-contract.test.ts server/src/__tests__/organizations-transaction.integration.test.ts server/src/__tests__/companies-import-authz-route.test.ts ui/src/__tests__/CompanyImport.test.tsx ui/src/onboarding/__tests__/resolveCreateCompanyOrg.test.ts ui/src/onboarding/__tests__/CreateAnotherCompany.test.tsx ui/src/components/settings/__tests__/PluginDetailSlideOver.test.tsx ui/src/onboarding/steps/__tests__/CloudDeferredStep.test.tsx ui/src/onboarding/steps/__tests__/VerifyStep.test.tsx ui/src/onboarding/__tests__/CloudProviderKeyNotice.test.tsx"
```

Expected: all focused regression tests pass.

- [ ] **Step 3: Run repository verification in Docker**

```powershell
docker run --rm --user node --entrypoint bash aoa-pr316-fixed-runtime:latest -lc "pnpm -r typecheck"
docker run --rm --user node --entrypoint bash aoa-pr316-fixed-runtime:latest -lc "pnpm build"
docker run --rm --user node --entrypoint bash aoa-pr316-fixed-runtime:latest -lc "pnpm --filter @armyofagents/server lint"
docker run --rm --user node --entrypoint bash aoa-pr316-fixed-runtime:latest -lc "pnpm test:run -- --maxWorkers=4"
```

Expected: typecheck, build, and lint pass. Classify any full-suite failure against the original harness baseline in `RESULTS.md`; rerun any new failure in isolation before deciding whether it is a product regression.

- [ ] **Step 4: Verify the diff and record evidence**

```powershell
git diff --check origin/main...HEAD
git status --short --branch
git log --oneline --decorate origin/main..HEAD
```

Append exact image ID, commands, exit codes, durations, focused counts, and any isolated aggregate failures to the harness `RESULTS.md`. Keep the harness evidence outside the product commit.

- [ ] **Step 5: Run whole-branch review**

Review `origin/main...HEAD` for spec compliance, tenant isolation, cache behavior, test quality, and accidental scope expansion. Resolve all Critical/Important findings through the subagent review loop before handoff.
