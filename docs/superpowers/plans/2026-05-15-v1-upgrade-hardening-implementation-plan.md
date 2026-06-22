# V1 Upgrade Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden `v1-upgrade` marketplace, environment, workspace Git, and agent-instruction flows so the branch is safe to PR.

**Architecture:** Apply small, test-first fixes around existing boundaries instead of redesigning whole subsystems. Backend services/routes enforce trust and permissions; UI adds contextual confirmations and state-aware controls; E2E/browser verification covers realistic user journeys.

**Tech Stack:** TypeScript, Express, Drizzle, Vitest, React, React Query, Testing Library, Playwright.

---

## File Structure

**Marketplace skill source validation**
- Modify: `packages/shared/src/marketplace.ts`
- Modify: `packages/shared/src/__tests__/marketplace-schema.test.ts`
- Modify: `server/src/services/marketplace-install/skill-bundle-materializer.ts`
- Modify: `server/src/__tests__/skill-bundle-materializer.test.ts`

**Marketplace plugin update permissions**
- Modify: `server/src/routes/marketplace-company.ts`
- Modify: `server/src/__tests__/marketplace-company-customized.test.ts`
- Modify: `ui/src/components/settings/sections/MarketplaceUpdatesPanel.tsx`
- Test: `ui/src/components/settings/sections/__tests__/MarketplaceUpdatesPanel.test.tsx`

**Environment authorization and validation**
- Modify: `packages/shared/src/validators/environment.ts`
- Modify: `server/src/routes/environments.ts`
- Modify: `server/src/services/environments.ts`
- Modify: `server/src/services/secrets.ts`
- Modify: `server/src/__tests__/environments-routes.test.ts`
- Modify: `server/src/__tests__/environments-service.test.ts`
- Modify: `server/src/__tests__/secrets-service.test.ts`
- Modify: `ui/src/components/settings/sections/EnvironmentsSection.tsx`
- Test: `ui/src/__tests__/EnvironmentsSection.test.tsx`

**Workspace Git backend safety**
- Modify: `server/src/services/git.ts`
- Modify: `server/src/routes/workspace-git.ts`
- Modify: `server/src/__tests__/git-service.test.ts`
- Modify: `server/src/__tests__/workspace-git-api.test.ts`

**Workspace Git/PR UI safety**
- Modify: `ui/src/api/execution-workspaces.ts`
- Modify: `ui/src/api/github-integration.ts`
- Modify: `ui/src/components/workspace/tools/GitPanel.tsx`
- Modify: `ui/src/components/workspace/CreatePrDialog.tsx`
- Modify: `ui/src/__tests__/GitPanel.test.tsx`
- Modify: `ui/src/__tests__/CreatePrDialog.test.tsx`
- Create: `tests/e2e/workspace-git-safety.spec.ts`

**Marketplace agent instruction migration**
- Modify: `server/src/services/marketplace-install/agent-runtime.ts`
- Modify: `server/src/services/marketplace-install/agent-create.ts`
- Modify: `server/src/__tests__/marketplace-agent-runtime.test.ts`
- Modify: `server/src/__tests__/marketplace-install-agent.test.ts`

**Final verification**
- Browser verify via local app on a fresh or seeded company.

---

### Task 1: Marketplace Skill Bundle Source Validation

**Files:**
- Modify: `packages/shared/src/marketplace.ts`
- Modify: `packages/shared/src/__tests__/marketplace-schema.test.ts`
- Modify: `server/src/services/marketplace-install/skill-bundle-materializer.ts`
- Modify: `server/src/__tests__/skill-bundle-materializer.test.ts`

- [ ] **Step 1: Add failing shared schema tests**

Add tests to `packages/shared/src/__tests__/marketplace-schema.test.ts`:

```ts
it.each([
  "owner/repo",
  "https://github.com/owner/repo",
  "https://github.com/owner/repo.git",
])("accepts GitHub marketplace skill repo %s", (repo) => {
  const parsed = MarketplaceSkillBundleSchema.parse({
    type: "github-directory",
    repo,
    commitSha: "abc123",
    path: "skills/research",
    treeUrl: "https://github.com/owner/repo/tree/abc123/skills/research",
  });
  expect(parsed.repo).toBe(repo);
});

it.each([
  "file:///tmp/repo",
  "C:/Users/TK/repo",
  "/tmp/repo",
  "https://example.com/owner/repo.git",
  "git@github.com:owner/repo.git",
  "../owner/repo",
])("rejects unsafe marketplace skill repo %s", (repo) => {
  expect(() =>
    MarketplaceSkillBundleSchema.parse({
      type: "github-directory",
      repo,
      commitSha: "abc123",
      path: "skills/research",
      treeUrl: "https://github.com/owner/repo/tree/abc123/skills/research",
    }),
  ).toThrow();
});
```

- [ ] **Step 2: Run shared marketplace schema test and verify failure**

Run:

```bash
pnpm vitest run packages/shared/src/__tests__/marketplace-schema.test.ts
```

Expected: unsafe repo cases fail because schema currently accepts `repo: z.string()`.

- [ ] **Step 3: Implement repo validator**

In `packages/shared/src/marketplace.ts`, add a validator:

```ts
const GITHUB_OWNER_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GITHUB_HTTPS_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/;

export function isMarketplaceGitHubRepo(value: string): boolean {
  return GITHUB_OWNER_REPO_RE.test(value) || GITHUB_HTTPS_RE.test(value);
}
```

Change `MarketplaceSkillBundleSchema.repo`:

```ts
repo: z.string().refine(isMarketplaceGitHubRepo, {
  message: "Marketplace skill bundle repo must be owner/repo or https://github.com/owner/repo(.git)",
}),
```

- [ ] **Step 4: Harden materializer URL derivation**

In `server/src/services/marketplace-install/skill-bundle-materializer.ts`, import `isMarketplaceGitHubRepo` and make `repoUrlForBundle` reject non-GitHub sources even if called without schema parsing:

```ts
function repoUrlForBundle(bundle: MarketplaceSkillBundle): string {
  if (!isMarketplaceGitHubRepo(bundle.repo)) {
    throw new Error("Marketplace skill bundle repo must be a GitHub owner/repo or GitHub HTTPS URL");
  }
  if (bundle.repo.startsWith("https://github.com/")) {
    return bundle.repo.endsWith(".git") ? bundle.repo : `${bundle.repo}.git`;
  }
  return `https://github.com/${bundle.repo}.git`;
}
```

- [ ] **Step 5: Add materializer regression tests**

Add to `server/src/__tests__/skill-bundle-materializer.test.ts`:

```ts
it.each([
  "file:///tmp/repo",
  "C:/Users/TK/repo",
  "/tmp/repo",
  "https://example.com/owner/repo.git",
])("rejects unsafe bundle repo without cloning %s", async (repo) => {
  await expect(
    materializeSkillBundle(makeBundle({ repo }), {
      destination: path.join(await tempDir("bundle-unsafe-repo-"), "out"),
    }),
  ).rejects.toThrow(/github/i);
});
```

- [ ] **Step 6: Run targeted tests**

Run:

```bash
pnpm vitest run packages/shared/src/__tests__/marketplace-schema.test.ts server/src/__tests__/skill-bundle-materializer.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit Task 1**

```bash
git add packages/shared/src/marketplace.ts packages/shared/src/__tests__/marketplace-schema.test.ts server/src/services/marketplace-install/skill-bundle-materializer.ts server/src/__tests__/skill-bundle-materializer.test.ts
git commit -m "fix: restrict marketplace skill bundle sources"
```

---

### Task 2: Marketplace Plugin Update Permission Gate

**Files:**
- Modify: `server/src/routes/marketplace-company.ts`
- Modify: `server/src/__tests__/marketplace-company-customized.test.ts`
- Modify: `ui/src/components/settings/sections/MarketplaceUpdatesPanel.tsx`
- Modify: `ui/src/components/settings/sections/__tests__/MarketplaceUpdatesPanel.test.tsx`

- [ ] **Step 1: Add failing server permission test**

In `server/src/__tests__/marketplace-company-customized.test.ts`, update the authz mock to expose `assertCanManageInstanceSettings`, then add:

```ts
import { assertCanManageInstanceSettings } from "../routes/authz.js";

it("requires instance-admin permission before applying plugin marketplace updates", async () => {
  vi.mocked(assertCanManageInstanceSettings).mockImplementationOnce(() => {
    const err = new Error("Instance admin access required") as Error & { status?: number };
    err.status = 403;
    throw err;
  });
  const upgrade = vi.fn(async () => ({ version: "1.0.0", status: "ready" }));
  const { app } = buildPluginApplyApp({
    updateRow: baseUpdateRow,
    pluginRows: [[basePluginRow]],
    upgrade,
  });

  const res = await request(app)
    .post("/api/companies/c1/marketplace/updates/upd-plugin-1/apply")
    .send({});

  expect(res.status).toBe(403);
  expect(upgrade).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run plugin update test and verify failure**

Run:

```bash
pnpm vitest run server/src/__tests__/marketplace-company-customized.test.ts
```

Expected: new test fails because update apply does not call the instance-admin gate.

- [ ] **Step 3: Add permission gate**

In `server/src/routes/marketplace-company.ts`, import and call `assertCanManageInstanceSettings` inside the plugin branch before any plugin lookup or lifecycle call:

```ts
import { assertBoard, assertCanManageInstanceSettings, assertCompanyAccess } from "./authz.js";
```

```ts
if (update.itemType === "plugin") {
  assertCanManageInstanceSettings(req);
  // existing plugin apply flow
}
```

- [ ] **Step 4: Add UI unauthorized state test**

In `ui/src/components/settings/sections/__tests__/MarketplaceUpdatesPanel.test.tsx`, add a test where `marketplaceApi.applyUpdate` rejects with `ApiError("Instance admin access required", 403, ...)` and assert a destructive toast or inline disabled state:

```ts
it("shows instance-admin requirement when plugin update apply is forbidden", async () => {
  mockApplyUpdate.mockRejectedValueOnce(new ApiError("Instance admin access required", 403, { error: "Instance admin access required" }));
  renderPanelWithPendingPluginUpdate();
  await userEvent.click(await screen.findByRole("button", { name: /apply/i }));
  expect(await screen.findByText(/instance admin access required/i)).toBeInTheDocument();
});
```

- [ ] **Step 5: Implement UI forbidden-state copy**

Update `MarketplaceUpdatesPanel.tsx` catch block for 403 so forbidden plugin updates show a product-specific message instead of only the raw API error:

```ts
body: err instanceof ApiError && err.status === 403
  ? "Requires instance admin permission."
  : err instanceof Error ? err.message : undefined,
```

- [ ] **Step 6: Run targeted tests**

Run:

```bash
pnpm vitest run server/src/__tests__/marketplace-company-customized.test.ts ui/src/components/settings/sections/__tests__/MarketplaceUpdatesPanel.test.tsx
```

Expected: all pass.

- [ ] **Step 7: Commit Task 2**

```bash
git add server/src/routes/marketplace-company.ts server/src/__tests__/marketplace-company-customized.test.ts ui/src/components/settings/sections/MarketplaceUpdatesPanel.tsx ui/src/components/settings/sections/__tests__/MarketplaceUpdatesPanel.test.tsx
git commit -m "fix: require admin for marketplace plugin updates"
```

---

### Task 3: Environment Authorization, Validation, and Binding Cleanup

**Files:**
- Modify: `packages/shared/src/validators/environment.ts`
- Modify: `server/src/routes/environments.ts`
- Modify: `server/src/services/environments.ts`
- Modify: `server/src/services/secrets.ts`
- Modify: `server/src/__tests__/environments-routes.test.ts`
- Modify: `server/src/__tests__/environments-service.test.ts`
- Modify: `server/src/__tests__/secrets-service.test.ts`
- Modify: `ui/src/components/settings/sections/EnvironmentsSection.tsx`
- Modify: `ui/src/__tests__/EnvironmentsSection.test.tsx`

- [ ] **Step 1: Add failing authz route tests**

Update `server/src/__tests__/environments-routes.test.ts` to stop mocking authz as unconditional success. Mock both `assertBoard` and `assertCompanyAccess`, import `errorHandler`, and update `buildApp` so thrown auth errors are mapped to HTTP responses:

```ts
function buildApp(mockSvc: unknown) {
  const app = express();
  app.use(express.json());
  app.use(environmentRoutes({ svc: mockSvc as never }));
  app.use(errorHandler);
  return app;
}
```

Then add:

```ts
it.each(["GET", "POST", "PATCH", "DELETE"] as const)(
  "%s rejects non-board actors before touching environment service",
  async (method) => {
    vi.mocked(assertBoard).mockImplementationOnce(() => {
      const err = new Error("Board access required") as Error & { status?: number };
      err.status = 403;
      throw err;
    });
    const svc = {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const app = buildApp(svc);
    const route = method === "GET"
      ? `/companies/${companyId}/environments`
      : `/companies/${companyId}/environments/${envId}`;
    const req = request(app)[method.toLowerCase() as "get" | "post" | "patch" | "delete"](route);
    const res = method === "POST" || method === "PATCH"
      ? await req.send({ name: "Prod", envVars: {} })
      : await req;
    expect(res.status).toBe(403);
    expect(svc.create).not.toHaveBeenCalled();
    expect(svc.update).not.toHaveBeenCalled();
    expect(svc.delete).not.toHaveBeenCalled();
  },
);
```

- [ ] **Step 2: Add failing environment env validation tests**

Add to `server/src/__tests__/environments-routes.test.ts`:

```ts
it("rejects invalid env var names before create", async () => {
  const svc = { create: vi.fn() };
  const app = buildApp(svc);
  const res = await request(app)
    .post(`/companies/${companyId}/environments`)
    .send({ name: "Bad", envVars: { "bad-key": { type: "plain", value: "x" } } });
  expect(res.status).toBe(422);
  expect(svc.create).not.toHaveBeenCalled();
});

it("rejects invalid env binding shapes before update", async () => {
  const svc = { update: vi.fn() };
  const app = buildApp(svc);
  const res = await request(app)
    .patch(`/companies/${companyId}/environments/${envId}`)
    .send({ envVars: { API_KEY: { secretId: "missing-type" } } });
  expect(res.status).toBe(422);
  expect(svc.update).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run environment route tests and verify failure**

Run:

```bash
pnpm vitest run server/src/__tests__/environments-routes.test.ts
```

Expected: new authz and validation tests fail.

- [ ] **Step 4: Require board actor in environment routes**

In `server/src/routes/environments.ts`, import `assertBoard` and call it before `assertCompanyAccess` for every route:

```ts
assertBoard(req);
assertCompanyAccess(req, companyId);
```

- [ ] **Step 5: Expose env normalization helper from secrets service**

In `server/src/services/secrets.ts`, add a public method:

```ts
normalizeEnvConfigForPersistence: async (
  companyId: string,
  envValue: unknown,
  opts?: { strictMode?: boolean },
) => normalizeEnvConfig(companyId, envValue, opts),
```

- [ ] **Step 6: Normalize env vars in environment create/update**

In `server/src/routes/environments.ts`, after schema parse and before service call:

```ts
const normalizedData = { ...parsed.data };
if (secretsSvc && Object.prototype.hasOwnProperty.call(parsed.data, "envVars")) {
  normalizedData.envVars = await secretsSvc.normalizeEnvConfigForPersistence(
    companyId,
    parsed.data.envVars ?? {},
    { strictMode: true },
  );
}
```

Use `normalizedData` for `svc.create` and `svc.update`, then sync bindings from `created.envVars` or `updated.envVars`.

- [ ] **Step 7: Delete stale environment bindings**

In `server/src/services/environments.ts`, add optional dependency or method support for cleanup, or keep route-level cleanup after successful delete:

```ts
if (secretsSvc) {
  await secretsSvc.syncEnvBindingsForTarget(companyId, {
    targetType: "environment",
    targetId: id,
    pathPrefix: "env",
  }, {});
}
```

Call cleanup only after service confirms the environment existed.

- [ ] **Step 8: Add binding cleanup test**

Add a route or secrets-service test asserting delete calls `syncEnvBindingsForTarget` with `{}` after `svc.delete` returns a row.

```ts
expect(mockSyncEnvBindingsForTarget).toHaveBeenCalledWith(
  companyId,
  { targetType: "environment", targetId: envId, pathPrefix: "env" },
  {},
);
```

- [ ] **Step 9: Add UI error display test**

In `ui/src/__tests__/EnvironmentsSection.test.tsx`, mock create/update to reject invalid env var response and assert the dialog shows the server error instead of silently closing:

```ts
it("keeps create dialog open and shows env validation errors", async () => {
  mockCreateEnvironment.mockRejectedValueOnce(new ApiError("Invalid environment variable name: bad-key", 422, {}));
  renderSection();
  await userEvent.click(screen.getByRole("button", { name: /new environment/i }));
  await userEvent.type(screen.getByLabelText(/name/i), "Bad");
  await addEnvRow("bad-key", "plain", "x");
  await userEvent.click(screen.getByRole("button", { name: /^create$/i }));
  expect(await screen.findByText(/invalid environment variable name/i)).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
```

- [ ] **Step 10: Run targeted tests**

Run:

```bash
pnpm vitest run server/src/__tests__/environments-routes.test.ts server/src/__tests__/secrets-service.test.ts ui/src/__tests__/EnvironmentsSection.test.tsx
```

Expected: all pass.

- [ ] **Step 11: Commit Task 3**

```bash
git add packages/shared/src/validators/environment.ts server/src/routes/environments.ts server/src/services/environments.ts server/src/services/secrets.ts server/src/__tests__/environments-routes.test.ts server/src/__tests__/environments-service.test.ts server/src/__tests__/secrets-service.test.ts ui/src/components/settings/sections/EnvironmentsSection.tsx ui/src/__tests__/EnvironmentsSection.test.tsx
git commit -m "fix: harden environment management"
```

---

### Task 4: Workspace Git Backend Safety

**Files:**
- Modify: `server/src/services/git.ts`
- Modify: `server/src/routes/workspace-git.ts`
- Modify: `server/src/__tests__/git-service.test.ts`
- Modify: `server/src/__tests__/workspace-git-api.test.ts`

- [ ] **Step 1: Add failing selected-files commit tests**

Add to `server/src/__tests__/git-service.test.ts`:

```ts
it("does not include pre-staged unrelated safe files in selected-file commit", async () => {
  const repo = await setup();
  await fs.writeFile(path.join(repo, "selected.txt"), "selected\n", "utf8");
  await fs.writeFile(path.join(repo, "staged.txt"), "staged\n", "utf8");
  await git(repo, ["add", "staged.txt"]);

  await commit(repo, "Selected only", ["selected.txt"]);

  const committedFiles = await runGit(["show", "--name-only", "--format=", "HEAD"], repo);
  expect(committedFiles.split("\n").filter(Boolean)).toEqual(["selected.txt"]);
  const status = await getStatus(repo);
  expect(status.files.some((f) => f.path === "staged.txt")).toBe(true);
});

it("does not include pre-staged denied files in selected-file commit", async () => {
  const repo = await setup();
  await fs.writeFile(path.join(repo, "selected.txt"), "selected\n", "utf8");
  await fs.writeFile(path.join(repo, ".env"), "SECRET=bad\n", "utf8");
  await git(repo, ["add", ".env"]);

  await commit(repo, "Selected only", ["selected.txt"]);

  const committedFiles = await runGit(["show", "--name-only", "--format=", "HEAD"], repo);
  expect(committedFiles).toContain("selected.txt");
  expect(committedFiles).not.toContain(".env");
});
```

- [ ] **Step 2: Add failing push remote tests**

Add to `server/src/__tests__/git-service.test.ts`:

```ts
it.each([
  "https://attacker.example/repo.git",
  "file:///tmp/repo.git",
  "C:/tmp/repo.git",
])("rejects raw push remote %s", async (remote) => {
  const { repo } = await setupWithRemote();
  await expect(push(repo, remote)).rejects.toThrow(/remote/i);
});

it("rejects unknown configured remote names", async () => {
  const { repo } = await setupWithRemote();
  await expect(push(repo, "upstream")).rejects.toThrow(/remote/i);
});
```

- [ ] **Step 3: Run git service tests and verify failure**

Run:

```bash
pnpm vitest run server/src/__tests__/git-service.test.ts
```

Expected: selected-file tests and unsafe remote tests fail.

- [ ] **Step 4: Commit only selected files**

In `server/src/services/git.ts`, replace plain commit with `--only`:

```ts
await runGit(["add", "--", ...validatedFiles], gitRoot);
const commitOutput = await runGit(["commit", "--only", "-m", message, "--", ...validatedFiles], gitRoot);
```

- [ ] **Step 5: Validate push remotes**

In `server/src/services/git.ts`, add helper:

```ts
function isRawRemoteValue(value: string): boolean {
  return /^(?:https?:|ssh:|git:|file:)/i.test(value)
    || path.isAbsolute(value)
    || /^[A-Za-z]:[\\/]/.test(value)
    || value.includes("/") || value.includes("\\");
}
```

Before pushing:

```ts
if (isRawRemoteValue(targetRemote)) {
  throw new Error("Push remote must be a configured remote name, not a URL or path");
}
const remotes = (await runGit(["remote"], gitRoot)).split("\n").filter(Boolean);
if (!remotes.includes(targetRemote)) {
  throw new Error(`Unknown git remote: ${targetRemote}`);
}
```

Resolve target remote URL with:

```ts
const pushUrl = await runGit(["remote", "get-url", "--push", targetRemote], gitRoot);
```

Scope auth header to that URL:

```ts
const authArgs = [
  "-c", `http.${pushUrl}.extraheader=Authorization: Basic ${authToken}`,
  "push", targetRemote, targetBranch,
];
```

- [ ] **Step 6: Validate branch argument**

Add helper:

```ts
function isSafeBranchName(value: string): boolean {
  return value.length > 0
    && !value.startsWith("-")
    && !value.includes("..")
    && !value.includes("\\")
    && !/[\0\s~^:?*[]/.test(value);
}
```

Reject invalid branch before push.

- [ ] **Step 7: Improve route error mapping**

In `server/src/routes/workspace-git.ts`, treat remote validation errors as 400:

```ts
if (
  msg.includes("remote")
  || msg.includes("branch")
  || msg.includes("detached HEAD")
) {
  res.status(400).json({ error: msg });
  return;
}
```

- [ ] **Step 8: Add route tests for raw remote rejection**

In `server/src/__tests__/workspace-git-api.test.ts`, add:

```ts
it("returns 400 for raw URL remote", async () => {
  mockPush.mockRejectedValue(new Error("Push remote must be a configured remote name, not a URL or path"));
  const app = createApp();
  const res = await request(app)
    .post("/api/execution-workspaces/ws-1/git/push")
    .send({ remote: "https://attacker.example/repo.git" });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 9: Run targeted tests**

Run:

```bash
pnpm vitest run server/src/__tests__/git-service.test.ts server/src/__tests__/workspace-git-api.test.ts
```

Expected: all pass.

- [ ] **Step 10: Commit Task 4**

```bash
git add server/src/services/git.ts server/src/routes/workspace-git.ts server/src/__tests__/git-service.test.ts server/src/__tests__/workspace-git-api.test.ts
git commit -m "fix: harden workspace git operations"
```

---

### Task 5: Workspace Git and PR User Flow Safety

**Files:**
- Modify: `ui/src/api/execution-workspaces.ts`
- Modify: `ui/src/api/github-integration.ts`
- Modify: `ui/src/components/workspace/tools/GitPanel.tsx`
- Modify: `ui/src/components/workspace/CreatePrDialog.tsx`
- Modify: `ui/src/__tests__/GitPanel.test.tsx`
- Modify: `ui/src/__tests__/CreatePrDialog.test.tsx`
- Create: `tests/e2e/workspace-git-safety.spec.ts`

- [ ] **Step 1: Define workspace safety status API shape**

Add to `ui/src/api/execution-workspaces.ts`:

```ts
export interface WorkspaceMutationSafety {
  activeRun: null | {
    id: string;
    status: string;
    startedAt: string | null;
    agentName?: string | null;
  };
  task: null | {
    id: string;
    title: string;
    status: string;
  };
  requiresConfirmation: {
    commit: boolean;
    push: boolean;
    createPr: boolean;
  };
}
```

Add API:

```ts
safety: (id: string) => api.get<WorkspaceMutationSafety>(`/execution-workspaces/${id}/git/safety`),
```

- [ ] **Step 2: Add backend safety route**

Add `GET /execution-workspaces/:id/git/safety` to `server/src/routes/workspace-git.ts`. It returns active run/task data for human UI only and does not block agent/MCP API use.

Minimum response:

```json
{
  "activeRun": null,
  "task": { "id": "issue-1", "title": "Task", "status": "in_progress" },
  "requiresConfirmation": { "commit": false, "push": false, "createPr": true }
}
```

- [ ] **Step 3: Add failing GitPanel confirmation tests**

In `ui/src/__tests__/GitPanel.test.tsx`, mock safety API and add:

```ts
it("asks for confirmation before human commit when an agent run is active", async () => {
  mockGetGitStatus.mockResolvedValue({
    gitAvailable: true,
    branch: "ENG-99-fix-auth",
    detachedHead: false,
    remote: null,
    ahead: null,
    behind: null,
    clean: false,
    files: [{ path: "src/app.ts", status: "modified", staged: false }],
  });
  mockGetGitSafety.mockResolvedValue({
    activeRun: { id: "run-1", status: "running", startedAt: "2026-05-15T00:00:00Z", agentName: "Senior Engineer" },
    task: { id: "issue-1", title: "Fix auth", status: "in_progress" },
    requiresConfirmation: { commit: true, push: true, createPr: true },
  });
  renderPanel();
  await userEvent.click(await screen.findByRole("checkbox", { name: /src\/app.ts/i }));
  await userEvent.type(screen.getByLabelText(/commit message/i), "Fix auth");
  await userEvent.click(screen.getByRole("button", { name: /commit 1 file/i }));
  expect(await screen.findByRole("dialog", { name: /agent is currently working/i })).toBeInTheDocument();
  expect(screen.getByText(/Fix auth/)).toBeInTheDocument();
});
```

- [ ] **Step 4: Add failing push state tests**

Add:

```ts
it("shows Push N commits when branch is ahead and Pushed when up to date", async () => {
  mockGetGitStatus.mockResolvedValueOnce({
    gitAvailable: true,
    branch: "ENG-99-fix-auth",
    detachedHead: false,
    remote: "origin",
    ahead: 2,
    behind: 0,
    clean: true,
    files: [],
  });
  renderPanel();
  expect(await screen.findByRole("button", { name: /push 2 commits/i })).toBeEnabled();
});
```

- [ ] **Step 5: Add failing CreatePrDialog warning tests**

In `ui/src/__tests__/CreatePrDialog.test.tsx`, add:

```ts
it("warns before creating PR when task is not complete", async () => {
  mockGetIssue.mockResolvedValue({ id: "issue-1", title: "T", description: "", status: "in_progress" });
  mockGetGitSafety.mockResolvedValue({
    activeRun: null,
    task: { id: "issue-1", title: "T", status: "in_progress" },
    requiresConfirmation: { commit: false, push: false, createPr: true },
  });
  renderDialog();
  await userEvent.click(await screen.findByTestId("pr-submit"));
  expect(await screen.findByRole("dialog", { name: /task is not marked complete/i })).toBeInTheDocument();
  expect(mockCreatePR).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Implement reusable confirmation component**

Inside `ui/src/components/workspace/tools/GitPanel.tsx` or a new local component, add a compact confirmation dialog:

```tsx
function WorkspaceMutationConfirmDialog({
  open,
  action,
  safety,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  action: "commit" | "push" | "createPr";
  safety: WorkspaceMutationSafety | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {safety?.activeRun ? "Agent is currently working" : "Task is not marked complete"}
          </DialogTitle>
          <DialogDescription>
            Continuing may capture unfinished work or send incomplete work for review.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1 text-sm">
          {safety?.task && <p>Task: {safety.task.title}</p>}
          {safety?.task && <p>Status: {safety.task.status}</p>}
          {safety?.activeRun && <p>Run: {safety.activeRun.status}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onConfirm}>Continue anyway</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 7: Wire confirmation before commit/push**

In `GitPanel.tsx`:

- fetch `executionWorkspacesApi.safety(workspace.id)`
- before commit/push mutation, if safety requires confirmation for human UI, open dialog
- on confirm, run original mutation
- keep agent/MCP behavior backend-driven; UI confirmation only affects browser human flow

- [ ] **Step 8: Wire confirmation before create PR**

In `CreatePrDialog.tsx`:

- fetch workspace safety
- on submit, if `requiresConfirmation.createPr`, show confirmation before `githubIntegrationApi.createPR`
- include task status and active run status

- [ ] **Step 9: Update button labels**

In `GitPanel.tsx`:

```ts
const commitLabel = selectedFiles.size > 0 ? `Commit ${selectedFiles.size} file${selectedFiles.size === 1 ? "" : "s"}` : "Commit selected";
const pushLabel = ahead && ahead > 0 ? `Push ${ahead} commit${ahead === 1 ? "" : "s"}` : "Pushed";
```

PR button already becomes `View PR #N` when metadata has PR; add/adjust tests to lock it.

- [ ] **Step 10: Add E2E workspace Git safety scenarios**

Create `tests/e2e/workspace-git-safety.spec.ts` with scenarios:

```ts
test("human sees active-run confirmation before creating PR", async ({ page, request }) => {
  const seeded = await seedWorkspaceWithActiveRun(request);
  await page.goto(`/${seeded.companyPrefix}/workspaces/${seeded.workspaceId}`);
  await page.getByRole("button", { name: /create pr/i }).click();
  await expect(page.getByRole("dialog", { name: /agent is currently working/i })).toBeVisible();
  await expect(page.getByText(seeded.issueTitle)).toBeVisible();
  await page.getByRole("button", { name: /cancel/i }).click();
  await expect(page.getByRole("dialog", { name: /agent is currently working/i })).not.toBeVisible();
});

test("existing PR changes button to View PR", async ({ page, request }) => {
  const seeded = await seedWorkspaceWithExistingPr(request);
  await page.goto(`/${seeded.companyPrefix}/workspaces/${seeded.workspaceId}`);
  await expect(page.getByRole("link", { name: /view pr #/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^create pr$/i })).not.toBeVisible();
});
```

Add deterministic E2E seeding helpers in `tests/e2e/helpers/seed-workspace.ts` for `seedWorkspaceWithActiveRun` and `seedWorkspaceWithExistingPr`. The helpers should create an isolated company, issue, execution workspace, and optional heartbeat run/PR metadata through existing API routes or direct test database helpers already used by neighboring E2E tests.

- [ ] **Step 11: Run targeted UI tests**

Run:

```bash
pnpm vitest run ui/src/__tests__/GitPanel.test.tsx ui/src/__tests__/CreatePrDialog.test.tsx
```

Expected: all pass.

- [ ] **Step 12: Run E2E Git safety flow**

Run:

```bash
pnpm test:e2e -- tests/e2e/workspace-git-safety.spec.ts
```

Expected: all scenarios pass, screenshots saved for review if configured.

- [ ] **Step 13: Commit Task 5**

```bash
git add ui/src/api/execution-workspaces.ts ui/src/api/github-integration.ts ui/src/components/workspace/tools/GitPanel.tsx ui/src/components/workspace/CreatePrDialog.tsx ui/src/__tests__/GitPanel.test.tsx ui/src/__tests__/CreatePrDialog.test.tsx tests/e2e/workspace-git-safety.spec.ts server/src/routes/workspace-git.ts server/src/__tests__/workspace-git-api.test.ts
git commit -m "fix: add workspace git safety confirmations"
```

---

### Task 6: Marketplace Agent Legacy Instruction Migration

**Files:**
- Modify: `server/src/services/marketplace-install/agent-runtime.ts`
- Modify: `server/src/services/marketplace-install/agent-create.ts`
- Modify: `server/src/__tests__/marketplace-agent-runtime.test.ts`
- Modify: `server/src/__tests__/marketplace-install-agent.test.ts`

- [ ] **Step 1: Add failing runtime normalization test**

In `server/src/__tests__/marketplace-agent-runtime.test.ts`, add:

```ts
it("converts legacy promptTemplate into AGENTS.md instructions", () => {
  const parsed = parseMarketplaceAgentTemplate(
    JSON.stringify({
      role: "general",
      adapterType: "codex_local",
      adapterConfig: {
        promptTemplate: "You are the legacy agent instructions.",
      },
    }),
    AGENT_ITEM,
  );

  const normalized = normalizeMarketplaceAgentTemplate({
    parsed,
    catalogItem: AGENT_ITEM,
    availableAdapterTypes: ["codex_local"],
  });

  expect(normalized.instructions).toEqual({
    type: "inline",
    entryFile: "AGENTS.md",
    files: { "AGENTS.md": "You are the legacy agent instructions." },
  });
});

it("rejects marketplace agents with no instructions", () => {
  const parsed = parseMarketplaceAgentTemplate(
    JSON.stringify({ adapterType: "codex_local", adapterConfig: {} }),
    AGENT_ITEM,
  );
  expect(() =>
    normalizeMarketplaceAgentTemplate({
      parsed,
      catalogItem: AGENT_ITEM,
      availableAdapterTypes: ["codex_local"],
    }),
  ).toThrow(/instructions/i);
});
```

- [ ] **Step 2: Run runtime test and verify failure**

Run:

```bash
pnpm vitest run server/src/__tests__/marketplace-agent-runtime.test.ts
```

Expected: legacy prompt conversion fails because current code creates empty `AGENTS.md`.

- [ ] **Step 3: Implement legacy conversion**

In `server/src/services/marketplace-install/agent-runtime.ts`, for `parsed.kind === "legacy"`:

```ts
const adapterConfig = parsed.template.adapterConfig ?? {};
const legacyPrompt = typeof adapterConfig.promptTemplate === "string"
  ? adapterConfig.promptTemplate.trim()
  : "";
if (!legacyPrompt) {
  throw new Error("Marketplace agent template must include instructions or adapterConfig.promptTemplate");
}
```

Return:

```ts
instructions: {
  type: "inline",
  entryFile: "AGENTS.md",
  files: { "AGENTS.md": legacyPrompt },
},
```

- [ ] **Step 4: Add install test for materialization and clear behavior**

In `server/src/__tests__/marketplace-install-agent.test.ts`, add:

```ts
it("materializes legacy promptTemplate as AGENTS.md and clears it after success", async () => {
  const materializeManagedBundle = vi.fn(async (_agent, files, options) => ({
    bundle: { files: [], entryFile: options.entryFile, managedRootPath: "/tmp/agent", resolvedEntryPath: "/tmp/agent/AGENTS.md", warnings: [] },
    adapterConfig: {
      instructionsBundleMode: "managed",
      instructionsRootPath: "/tmp/agent",
      instructionsEntryFile: "AGENTS.md",
      instructionsFilePath: "/tmp/agent/AGENTS.md",
    },
  }));
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      adapterType: "codex_local",
      adapterConfig: { promptTemplate: "Legacy instructions" },
    }),
  })) as any;

  await installAgent({
    catalogItem: AGENT_TEMPLATE,
    companyId: "c1",
    db: db as any,
    desiredName: "Legacy",
    availableAdapterTypes: ["codex_local"],
    instructionsService: { materializeManagedBundle } as any,
  });

  expect(materializeManagedBundle).toHaveBeenCalledWith(
    expect.anything(),
    { "AGENTS.md": "Legacy instructions" },
    expect.objectContaining({ clearLegacyPromptTemplate: true }),
  );
  expect(updates[0].adapterConfig.promptTemplate).toBeUndefined();
});
```

- [ ] **Step 5: Preserve new instruction bundles over promptTemplate**

Add test:

```ts
it("prefers agent.v1 instruction bundle over adapterConfig.promptTemplate", async () => {
  // agent.v1 with instructions.files and adapterConfig.promptTemplate
  // expect materializeManagedBundle files to contain fetched AGENTS.md, not promptTemplate text
});
```

- [ ] **Step 6: Run targeted tests**

Run:

```bash
pnpm vitest run server/src/__tests__/marketplace-agent-runtime.test.ts server/src/__tests__/marketplace-install-agent.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit Task 6**

```bash
git add server/src/services/marketplace-install/agent-runtime.ts server/src/services/marketplace-install/agent-create.ts server/src/__tests__/marketplace-agent-runtime.test.ts server/src/__tests__/marketplace-install-agent.test.ts
git commit -m "fix: migrate legacy marketplace agent instructions"
```

---

### Task 7: End-to-End Verification and Browser Review

**Files:**
- No production code unless failures require fixes.

- [ ] **Step 1: Run full targeted hardening suite**

Run:

```bash
pnpm vitest run \
  packages/shared/src/__tests__/marketplace-schema.test.ts \
  server/src/__tests__/skill-bundle-materializer.test.ts \
  server/src/__tests__/marketplace-company-customized.test.ts \
  server/src/__tests__/environments-routes.test.ts \
  server/src/__tests__/secrets-service.test.ts \
  server/src/__tests__/git-service.test.ts \
  server/src/__tests__/workspace-git-api.test.ts \
  server/src/__tests__/marketplace-agent-runtime.test.ts \
  server/src/__tests__/marketplace-install-agent.test.ts \
  ui/src/components/settings/sections/__tests__/MarketplaceUpdatesPanel.test.tsx \
  ui/src/__tests__/EnvironmentsSection.test.tsx \
  ui/src/__tests__/GitPanel.test.tsx \
  ui/src/__tests__/CreatePrDialog.test.tsx
```

Expected: all pass.

- [ ] **Step 2: Run full repo verification**

Run:

```bash
pnpm -r typecheck
pnpm test:run
git diff --check origin/main...HEAD
```

Expected:

- typecheck passes
- full Vitest suite passes
- diff-check passes after existing whitespace issues are cleaned

- [ ] **Step 3: Run E2E flows**

Run:

```bash
pnpm test:e2e -- tests/e2e/marketplace-install-flow.spec.ts
pnpm test:e2e -- tests/e2e/workspace-git-safety.spec.ts
pnpm test:e2e -- tests/e2e/secrets-vaults.spec.ts
```

Expected: all pass.

- [ ] **Step 4: Start local app for browser review**

Run:

```bash
$env:PORT='3130'; $env:HOST='127.0.0.1'; $env:AOA_UI_DEV_MIDDLEWARE='true'; pnpm dev
```

Open:

```text
http://127.0.0.1:3130
```

- [ ] **Step 5: Browser verify marketplace update permission**

Manual/browser flow:

1. Navigate to `/:companyPrefix/settings?tab=marketplace&section=updates`.
2. Confirm pending updates render grouped by type.
3. As non-instance-admin seeded user, plugin update apply should show "requires instance admin" and not apply.
4. As instance admin/local trusted user, plugin update apply should proceed.
5. If plugin update has capability delta, confirm permission review modal still appears.

- [ ] **Step 6: Browser verify environment flows**

Manual/browser flow:

1. Navigate to `/:companyPrefix/settings?tab=environments`.
2. Create local environment with valid plain env var.
3. Create sandbox Docker environment with image, workdir, shell, and no invalid network.
4. Try invalid env var name; confirm dialog stays open and shows error.
5. Try invalid secret binding shape if UI allows raw binding; confirm error.
6. Delete environment; confirm it disappears and no stale secret binding remains in Secrets binding tab.
7. Confirm agent/task creation can still select an existing environment.

- [ ] **Step 7: Browser verify workspace Git flows**

Manual/browser flow:

1. Open a workspace with changed files.
2. Select one file and verify button says `Commit 1 file`.
3. Commit while no active run exists; confirm no warning.
4. Seed or use an active run workspace; click commit and confirm warning includes task title/status/run.
5. Cancel confirmation and confirm no commit occurs.
6. Continue anyway and confirm commit succeeds.
7. Push when ahead; confirm button says `Push N commit(s)`.
8. After push, confirm button becomes pushed/up-to-date disabled state.
9. Open Create PR while active run exists; confirm warning.
10. Open Create PR when task status is not done; confirm incomplete-task warning.
11. Create PR after confirmation; confirm button becomes `View PR #N`.

- [ ] **Step 8: Browser verify marketplace agent instructions**

Manual/browser flow:

1. Install a new `agent.v1` marketplace agent with `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `HEARTBEAT.md`.
2. Open the agent Instructions tab.
3. Confirm all bundle files appear and `AGENTS.md` is entry file.
4. Add an extra instruction file from UI and save.
5. Confirm Loaded skills panel still shows attached skills separately.
6. Install a legacy promptTemplate fixture agent in test/dev catalog.
7. Confirm promptTemplate content appears as managed `AGENTS.md`, not as blank instructions.

- [ ] **Step 9: Capture final review evidence**

Record:

- command outputs for targeted tests
- full typecheck/test output
- E2E command output
- browser-tested URLs and pass/fail notes
- any screenshots from Playwright `test-results`

- [ ] **Step 10: Final review with subagents**

Dispatch read-only review agents for:

- marketplace/install/security
- environments/secrets/authz
- workspace Git/PR UX and backend safety

Require findings first with file/line references. Fix any P1/P2 before PR.

- [ ] **Step 11: Commit verification cleanup**

If verification required small fixes:

```bash
git add <changed-files>
git commit -m "test: verify v1 upgrade hardening flows"
```

If no fixes were needed, do not create an empty commit.

---

## Final PR Readiness Checklist

- [ ] Marketplace skill bundle source validation rejects unsafe sources.
- [ ] Plugin marketplace update apply requires instance-admin permission.
- [ ] Agents/MCP cannot manage raw environments.
- [ ] Board company users can still manage environments.
- [ ] Environment env vars validate and normalize before persistence.
- [ ] Environment delete cleans secret bindings.
- [ ] Git commit commits only selected files.
- [ ] Git push rejects raw URLs and unknown remotes.
- [ ] Git auth header is scoped to validated remote URL.
- [ ] Human commit/push/create PR warns on active run.
- [ ] Create PR warns on incomplete task.
- [ ] Agent/MCP workspace Git autonomy remains intact.
- [ ] PR button becomes View PR when PR exists.
- [ ] Legacy marketplace promptTemplate becomes managed AGENTS.md.
- [ ] New instructions bundles remain preferred.
- [ ] Targeted tests pass.
- [ ] Full typecheck passes.
- [ ] Full Vitest suite passes.
- [ ] E2E/browser flows pass.
- [ ] `git diff --check origin/main...HEAD` passes.
