# Item 5 — Memory Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Turn the onboarding memory step from one text box into a multi-scope "seed your knowledge" surface — a **company-wide** card (→ identity-layer memory) + one card **per department** (→ domain-layer), each with **drop-any-files** + text; **software departments** show their connected folder/GitHub repo and the Librarian **reads the code**; the founder can also drop extra docs. Text/docs → synthesized `.md` memory items filed by the seeded folder tree; images/binaries → attached directly as memory assets. The Librarian proposes; the founder approves.

**Design spec:** `docs/aoa/plans/2026-07-19-onboarding-improvements-design.md` (Item 5, refined 2026-07-20).

**Architecture:** Extend the existing braindump pipeline (not a new service). React `BraindumpStep`/`LibrarianStep` (`ui/src/onboarding/inflight/`) + `braindumpApi` → `server/src/services/braindump.ts` + route → `braindump_captures` (extended) + `memory_assets` linkage → the Librarian (`aoa-trigger-prompt.ts` directive) reads content/files/repo via its CLI tools → `write_memory` (pending) at the scope's layer/folder. Reuses `routes/assets.ts` upload, `memory_assets`, `write_memory`, `getSeedFoldersForFunctionType`.

**Confirmed contracts (grounding):**
- `write_memory` (MCP tool `index.ts`): agent writing `layer:"identity"|"domain"` → **pending** item (founder approves; Rule #6). Librarian toolAllowlist already has `write_memory` + `find_similar_memory`.
- Asset upload: `POST` under `routes/assets.ts` (all types, 50 MB, namespaced multer).
- `memory_assets`: `companyId` + `folderPath` + `storageKey` — files live in the memory tree by folderPath.
- `braindump_captures`: `department_id` is **notNull** today → migration required for company scope.

**Ordering:** 5a schema+capture (foundation) → 5b multi-scope drop UI → 5c Librarian directive (layer/folder/files/repo) → 5d LibrarianStep grouping + file-type handling. Ship + verify each.

**Global commands:** UI tests `cd ui && npx vitest run <path>`; server tests `cd server && npx vitest run <path>`; migration `pnpm db:generate`; typecheck `npx tsc --noEmit`; live-verify on the isolated `journey3` instance (`:3100`). Commit after each green step.

---

## Phase 5a — Schema + capture plumbing

**Files:**
- Modify: `packages/db/src/schema/braindump_captures.ts` (+ `scope`, nullable `department_id`, `asset_ids`, `repo_ingest`)
- Generate: `packages/db/src/migrations/017x_*.sql` (via `pnpm db:generate`)
- Modify: `packages/shared/src/validators/braindump.ts` (submit payload: `scope`, `assetIds`, `repoIngest`, nullable `departmentId`)
- Modify: `ui/src/api/braindump.ts` (submit carries the new fields)
- Modify: `server/src/services/braindump.ts` + route (persist new fields; create `memory_assets` at the scope folder)
- Test: `server/src/__tests__/braindump.test.ts`

- [ ] **Step 1: Read the current capture service + route + memory_assets service**

Read `server/src/services/braindump.ts`, its route (`server/src/routes/braindump.ts`), and how `memory_assets` rows are created elsewhere (grep `memoryAssets` inserts). Pin: the submit function signature, how `librarianAgentId`/dispatch works, and the `memory_assets` insert shape (companyId, folderPath, storageKey, + any required cols).

- [ ] **Step 2: Extend the schema (failing typecheck first)**

In `packages/db/src/schema/braindump_captures.ts`:
```ts
// department_id: nullable now (company-scope captures have no department)
departmentId: uuid("department_id").references(() => projects.id, { onDelete: "cascade" }),
scope: text("scope").notNull().default("department"), // "company" | "department"
assetIds: jsonb("asset_ids").$type<string[]>().notNull().default([]),
repoIngest: boolean("repo_ingest").notNull().default(false),
```
(Import `boolean` from `drizzle-orm/pg-core`.) Update any `.notNull()` uniqueIndex on `(companyId, departmentId, idempotencyKey)` to tolerate null departmentId — use a partial/COALESCE index or add `scope` to the key.

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `packages/db/src/migrations/017x_*.sql` adding `scope`, `asset_ids`, `repo_ingest`, and dropping `department_id`'s NOT NULL. Review the SQL — never hand-edit; if wrong, fix the schema + regenerate.

- [ ] **Step 4: Extend the submit validator (failing test)**

In `packages/shared/src/validators/braindump.ts`, extend the submit schema: `scope: z.enum(["company","department"])`, `departmentId: z.string().uuid().nullable()`, `assetIds: z.array(z.string().uuid()).default([])`, `repoIngest: z.boolean().default(false)`. Add a `.refine` that `scope==="department"` ⇒ `departmentId != null`, and `scope==="company"` ⇒ `departmentId == null`. Write a validator unit test asserting both refinements; run it (fail → implement → pass).

- [ ] **Step 5: Write the failing service test**

In `server/src/__tests__/braindump.test.ts` (drizzle-mock / sequence-db pattern), assert submit persists `scope`/`assetIds`/`repoIngest` and creates a `memory_assets` row per assetId at the scope's folder path (company root `""` for company; the department's seeded root for department). Run → fail.

- [ ] **Step 6: Implement the capture + linkage**

Extend the `braindump` service + route to accept the new fields, persist them, and insert `memory_assets` (companyId, folderPath = company-root or department-seeded-root, storageKey resolved from each assetId) — best-effort per asset. Run the service test → pass.

- [ ] **Step 7: Wire the API client**

`ui/src/api/braindump.ts` — `braindumpApi.submit` sends `scope`, `departmentId`, `assetIds`, `repoIngest`. Typecheck.

- [ ] **Step 8: Commit**

```bash
git add packages/db ui/src/api/braindump.ts packages/shared/src/validators/braindump.ts server/src/services/braindump.ts server/src/routes/braindump.ts server/src/__tests__/braindump.test.ts
git commit -m "feat(memory): braindump capture supports company/department scope + file assets + repoIngest"
```

---

## Phase 5b — Multi-scope drop UI

**Files:**
- Modify: `ui/src/onboarding/inflight/BraindumpStep.tsx` (company card + per-department cards, drop zones, sub-text, chips)
- Add (if needed): `ui/src/onboarding/inflight/FileDropZone.tsx` (reusable drop + upload + chips)
- Test: `ui/src/onboarding/inflight/__tests__/BraindumpStep.test.tsx`

- [ ] **Step 1: Read the current BraindumpStep + an existing upload caller**

Read `BraindumpStep.tsx` (current per-department cards + `repoChipFor`) and an existing file-upload UI (grep `assetsApi`/`upload` in `ui/src`) to reuse the upload call + progress/chip pattern.

- [ ] **Step 2: Failing test — company card + per-department cards render**

Assert `BraindumpStep` renders one **"Company"** card at the top + one card per department, each with a textarea + a drop zone + sub-text ("notes, docs, a repo, a logo, diagrams, PDFs…"), and a software department's card shows its repo/folder chip + a "read this repo" affordance. Run → fail.

- [ ] **Step 3: Implement the multi-scope UI**

Rework `BraindumpStep` into: `[{ scope:"company", departmentId:null, name:"Company", ... }, ...departments]`. Each card = textarea + `<FileDropZone>` (uploads via the asset API, collects `assetIds`, shows chips) + sub-text. Software dept card shows the connected repo/folder + a `repoIngest` toggle (default on). Submit posts one capture per non-empty card with its `scope`/`departmentId`/`assetIds`/`repoIngest`. Skip still fires `onDone`. Run tests + typecheck → pass.

- [ ] **Step 4: Live-verify + commit**

Rebuild UI; on `journey3` open the Braindump step — confirm the Company card + department cards, drop a file (chip appears), a software dept shows its repo. Commit.

---

## Phase 5c — Librarian directive (layer / folder / files / repo)

**Files:**
- Modify: `server/src/services/internal-agent/aoa-agents/aoa-trigger-prompt.ts` (`braindump.ingest` directive)
- Modify: `server/src/services/default-agent-instructions.ts` (Librarian instruction) + `server/src/onboarding-assets/librarian/*` if instruction text changes
- Test: `server/src/__tests__/aoa-trigger-prompt.test.ts`

- [ ] **Step 1: Failing test — directive carries scope layer + folder + files + repo**

Assert the `braindump.ingest` directive includes: the **target layer** (`identity` for `scope:"company"`, `domain` for `scope:"department"`), the **target folder(s)** (company root vs. the department's seeded folder list), the **dropped-file paths** (so the CLI agent reads them), and — when `repoIngest` — the **repo path** + a code-reading instruction. Assert the guardrail ("propose only; nothing invented; images/binaries attach as-is, not converted to .md") is present. Run → fail.

- [ ] **Step 2: Implement the directive extension**

Extend the braindump branch of `aoa-trigger-prompt.ts` to inject layer + folder list + file paths + (conditional) repo path + the file-type rule (synthesize `.md` for text/docs; leave images/binaries as attached assets). Pass the seeded folder tree via the capture's scope. Update the Librarian instruction to accept the passed layer (currently hardcoded `domain`). Run → pass.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/internal-agent/aoa-agents/aoa-trigger-prompt.ts server/src/services/default-agent-instructions.ts server/src/onboarding-assets/librarian server/src/__tests__/aoa-trigger-prompt.test.ts
git commit -m "feat(memory): Librarian directive — scope layer, seeded-folder placement, files + repo, .md vs attach"
```

---

## Phase 5d — LibrarianStep grouping + file-type handling

**Files:**
- Modify: `ui/src/onboarding/inflight/LibrarianStep.tsx` (group proposals by scope; show attached files + repo-read state)
- Test: `ui/src/onboarding/inflight/__tests__/LibrarianStep.test.tsx`

- [ ] **Step 1: Failing test — proposals grouped by scope + attached files shown**

Assert `LibrarianStep` polls all captures (company + departments), groups the proposed memory items under **Company** / each **Department**, shows attached files (assets) + a repo-read progress state, and the existing inline Approve still works per item. Run → fail.

- [ ] **Step 2: Implement the grouping**

Extend `LibrarianStep` to fetch captures across scopes, render grouped sections, surface attached assets + repo-read status; approve flow unchanged. Run tests + typecheck → pass.

- [ ] **Step 3: Live-verify the whole loop + commit**

On `journey3`: submit braindumps (company + a software department with a repo + a dropped logo). Confirm (a) the Librarian fires per scope, (b) proposes identity items for company + domain items for the department filed in seeded folders, (c) the logo is attached as an asset (not converted), (d) they appear grouped in LibrarianStep and approve into Memory. Commit.

---

## Self-review coverage map

| Design point | Phase |
|--------------|-------|
| Company-wide (identity) + per-department (domain) scopes | 5a (schema/scope) + 5b (UI cards) + 5c (layer) |
| Drop-any-files → memory tree (`memory_assets`) | 5a (linkage) + 5b (drop UI) |
| Software dept: show repo + Librarian reads code + extra drops | 5b (repo chip/toggle) + 5c (repo directive) |
| Folder-guided placement (seeded tree) | 5c (folder list in directive) |
| `.md` for text/docs; images/binaries attached directly | 5c (file-type rule) + 5d (show attached) |
| Sub-text guidance | 5b |
| Propose-only, founder approves | reuses `write_memory` pending + LibrarianStep approve |

## Open items to pin during execution
- The exact folder path for a department's memory root (first seeded folder vs. a dedicated root) — pin in 5a Step 1.
- Repo read: live workspace `cwd` vs. a cloned path — pin in 5c Step 2 (depends on workspace availability at ingest).
- Bounding for repo reads (depth/size/time caps) — carry from the design; assert a cap constant exists.
