# AoA Agents Framework — Deferred Follow-ups Implementation Plan (F1–F4)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Fresh implementer subagent per milestone + two-stage review (spec-compliance, then code-quality). Controller code-verifies every change against landed source — never trust subagent reports. Steps use `- [ ]` checkboxes.

**Goal:** Fix the four real deferred follow-ups (F1 dual-execution correctness, F2 LiveEvent parity, F3 dead-code retire, F4 temp-file leak) verified against landed code on `commander-subagent-1`, keeping the full Plan A+B+C suite + M1–M6 green. F5 is a non-code note (no action).

**Architecture:** Each follow-up is an independent, bite-sized TDD milestone, independently committable, in strict risk order F1→F2→F3→F4. Tests are Windows-runnable contract/unit tests using the established `vi.hoisted` + Proxy `@armyofagents/db` mock harness (pattern: `server/src/__tests__/aoa-mention-resolution.test.ts`). Regression-gated after every milestone.

**Tech Stack:** Express 5, Drizzle ORM, Vitest. Test cmd: `cd "<worktree>/server" && npx vitest run src/__tests__/<file>`. Worktree: `AoA-2.5/.worktrees/commander-subagent-1` (branch `commander-subagent-1`). Git: add files BY NAME only, never `git add -A`; `docs/superpowers/` is gitignored → `git add -f` for this plan + FOLLOWUPS.md.

**Verified premises (controller code-truth, 2026-05-18 — re-verify at fix time if dispatcher/routes/heartbeat shifted):**
- F1: `routes/issues.ts:787` (issue-update path) & `:1170` (POST `/issues/:id/comments`) resolve `svc.findMentionedAgents`, build a `wakeups` Map, then loop `heartbeat.wakeup(agentId, wakeup)`. For `kind='aoa'`: `enqueueWakeup` (heartbeat.ts:3874) passes both guards (`:3922` timer-only; `:3926` `wakeOnDemand` defaults **true** via `parseHeartbeatPolicy:1707`), `bypassIssueExecutionLock=true` (`:3931`, `reason==="issue_comment_mentioned"`) → normal path inserts `agent_wakeup_requests` status=`queued` (`:4326`) + `heartbeat_runs` status=`queued` (`:4345`) + `startNextQueuedRunForAgent` (**exec #1**). Dispatcher Phase-3 (dispatcher.ts:179-185: `status='queued' AND kind='aoa'`, **no source filter**) claims the same row → `runAoaAgent` (**exec #2**). Mention wakeup uses `source:"automation"`, `reason:"issue_comment_mentioned"`, `payload:{issueId,commentId}` (routes/issues.ts:801-816, :1184-1199) — **NOT** `source:'mention'` as FOLLOWUPS.md prose said. Pattern to mirror: `delegate-to-subagent.ts:57-64` (direct `agent_wakeup_requests` insert, single execution, NOT affected). `findMentionedAgents` (services/issues.ts:1563) resolves `inArray(agents.kind,["org","aoa"])`.
- F2: `submit-extracted-items.ts` has **no** `publishLiveEvent` (full file verified). `extraction.ts:630-638` emits `{companyId, type:"discussion.extraction.completed", payload:{discussionId: entry.discussionId, entryId, itemCount}}` via `publishLiveEvent` from `./live-events.js`. Tool resolves `discussionId` ONLY inside `if (itemList.length>0)` (lines 106-119) — empty-items completion has no discussionId in scope; fix must resolve unconditionally. `companyId` = `ctx.companyId`.
- F3: zero production callers of `ensurePlatformAgent` (only def `platform-agent.ts` + `platform-agent-seed.test.ts`). Other `platform`-kind refs are comments only (`agents.ts:380`, `extraction-sweeper.ts:18`). `agents.ts:378-391` `list()` = positive allowlist `eq(agents.kind, options?.kind ?? "org")` — structurally independent of platform rows. Cost attribution uses aoa agentId (`runner.ts:43-48`, `:110-114`) — no path needs the platform row.
- F4: `runner.ts:81-82` writes `tmpdir()/aoa-mcp-<agentId>-<runId>.json`, **no `unlink`** anywhere (126 lines verified). `cfgPath` is `const` inside the `try`.
- F5: worktree `CLAUDE.md` correctly says "31 tools". Stale "29 tools" is in the main-repo working copy (outside branch) — self-resolves on merge. **No action.**

**Regression guards that must stay green:** `aoa-mention-resolution.test.ts` (B1 contract — F1 must not change `findMentionedAgents`), `mention-resolver-humans-coverage.test.ts` (asserts exactly 2 `findMentionedAgents(` calls in routes/issues.ts — F1 keeps both), `issues-routes-create-fk-validation.test.ts` (mocks `findMentionedAgents`), `aoa-dispatcher.test.ts` (Phase-1/2/3), `submit-extracted-items*.test.ts`, `aoa-runner*.test.ts`, plus full Plan A+B+C suite + M1–M6.

---

## File Structure

| File | Responsibility | Touched by |
|------|----------------|------------|
| `server/src/services/issues.ts` | Add `resolveAgentKinds(ids)` + `enqueueAoaMentionWakeup(companyId, agentId, opts)` to `issueService`; import `agentWakeupRequests` | F1 |
| `server/src/routes/issues.ts` | At BOTH dispatch loops (~823, ~1205): partition `wakeups` by kind — aoa → `svc.enqueueAoaMentionWakeup`, org/unknown → `heartbeat.wakeup` (unchanged) | F1 |
| `server/src/__tests__/aoa-mention-wakeup-routing.test.ts` | NEW — F1 contract test (aoa → 1 wakeup row, 0 heartbeat; org → heartbeat path) | F1 |
| `server/src/services/internal-agent/tools/submit-extracted-items.ts` | Resolve discussionId unconditionally; emit `discussion.extraction.completed` after terminal status, mirroring extraction.ts:630-638 | F2 |
| `server/src/__tests__/submit-extracted-items-live-event.test.ts` | NEW — F2: asserts the publish (shape + ordering + empty-items case) | F2 |
| `server/src/services/internal-agent/subagents/platform-agent.ts` | DELETE (retired; Decision #100 / spec §11) | F3 |
| `server/src/__tests__/platform-agent-seed.test.ts` | DELETE (retired with documented rationale) | F3 |
| `server/src/services/internal-agent/aoa-agents/runner.ts` | Hoist `cfgPath` to `let … = null`; best-effort `unlink` in a `finally` | F4 |
| `server/src/__tests__/aoa-runner-tmpfile-cleanup.test.ts` | NEW — F4: temp file unlinked on success AND adapter-throw | F4 |
| `docs/superpowers/plans/2026-05-17-aoa-agents-framework-FOLLOWUPS.md` | Mark F1–F5 resolved with commit SHAs (force-add) | end |

---

## Milestone F1 — @mention → AoA single-execution (correctness; CRITICAL)

**Design (controller-decided, register-aligned + strictly safer):** Partition at the **dispatch loop** (after the `wakeups` Map is fully built, so ALL existing dedup / self-mention / author skips are preserved byte-identically). For each entry: if the agent is `kind='aoa'` → insert `agent_wakeup_requests` directly (mirroring `delegate-to-subagent.ts:57-64`) carrying the wakeup's own `source`/`reason`/`payload`, and DO NOT call `heartbeat.wakeup`; if `kind='org'` or unknown → existing `heartbeat.wakeup(agentId, wakeup)` path **unchanged**. This routes ALL aoa wakeups from issues-routes through the path Phase-3 already owns (single execution). `kind='org'` behavior is provably identical (same call, same args). Apply symmetrically at both sites (~823 update path, ~1205 comment path).

**Files:**
- Modify: `server/src/services/issues.ts` (import `agentWakeupRequests`; add 2 methods to the returned `issueService` object near `findMentionedAgents` ~line 1574)
- Modify: `server/src/routes/issues.ts` (the two `for (const [agentId, wakeup] of wakeups.entries())` loops, ~823 and ~1205)
- Test: `server/src/__tests__/aoa-mention-wakeup-routing.test.ts` (NEW)

- [ ] **Step 1: Re-verify premises against landed code (no edits)**

Controller (or implementer) re-confirms BEFORE coding (the register's F1 execution note demands this): `grep -n "enqueueWakeup\|source === \"timer\"\|source !== \"timer\"\|wakeOnDemand" server/src/services/heartbeat.ts` still shows guards at the `timer`-only / `wakeOnDemand`-default-true logic; `dispatcher.ts` Phase-3 `where(and(eq(agentWakeupRequests.status,"queued"), eq(agents.kind,"aoa"), …))` still has **no source filter**; `routes/issues.ts` still has 2 dispatch loops calling `heartbeat.wakeup`. If any premise shifted, STOP and report `NEEDS_CONTEXT` with the diff — do NOT code against a false premise.

- [ ] **Step 2: Write the failing test**

Create `server/src/__tests__/aoa-mention-wakeup-routing.test.ts` using the EXACT harness of `aoa-mention-resolution.test.ts` (vi.hoisted drizzle mock; Proxy-table `@armyofagents/db` mock incl. `agentWakeupRequests`; same `../errors.js`, `../middleware/logger.js`, service-collaborator mocks; `import { issueService } from "../services/issues.js"`). Test the two NEW service methods directly with a sequence/capture mock `db`:

```ts
describe("F1: AoA @mention uses direct wakeup insert, never heartbeat (single execution)", () => {
  it("resolveAgentKinds returns a Map<id,kind> from one agents query", async () => {
    const captured: any[] = [];
    const db: any = { select: () => makeSelectChain([
      { id: "a-aoa", kind: "aoa" }, { id: "a-org", kind: "org" },
    ]) };
    const svc = issueService(db);
    const kinds = await svc.resolveAgentKinds(["a-aoa", "a-org"]);
    expect(kinds.get("a-aoa")).toBe("aoa");
    expect(kinds.get("a-org")).toBe("org");
  });

  it("resolveAgentKinds([]) returns empty Map without querying", async () => {
    const select = vi.fn();
    const svc = issueService({ select } as any);
    const kinds = await svc.resolveAgentKinds([]);
    expect(kinds.size).toBe(0);
    expect(select).not.toHaveBeenCalled();
  });

  it("enqueueAoaMentionWakeup inserts ONE agent_wakeup_requests row status=queued and touches no heartbeat", async () => {
    const insertValues = vi.fn().mockResolvedValue(undefined);
    const insertedInto: unknown[] = [];
    const db: any = {
      insert: (tbl: unknown) => { insertedInto.push(tbl); return { values: insertValues }; },
    };
    const svc = issueService(db);
    await svc.enqueueAoaMentionWakeup("co-1", "a-aoa", {
      source: "automation", reason: "issue_comment_mentioned",
      payload: { issueId: "i-1", commentId: "c-1" },
    });
    expect(insertValues).toHaveBeenCalledTimes(1);
    const row = insertValues.mock.calls[0][0];
    expect(row).toMatchObject({
      companyId: "co-1", agentId: "a-aoa", status: "queued",
      reason: "issue_comment_mentioned", payload: { issueId: "i-1", commentId: "c-1" },
    });
    expect(typeof row.source).toBe("string"); // mirrors landed source (automation)
  });
});
```

(`makeSelectChain` copied verbatim from `aoa-mention-resolution.test.ts`.)

- [ ] **Step 3: Run test — verify it FAILS**

`cd "<worktree>/server" && npx vitest run src/__tests__/aoa-mention-wakeup-routing.test.ts`
Expected: FAIL — `svc.resolveAgentKinds is not a function` / `svc.enqueueAoaMentionWakeup is not a function`.

- [ ] **Step 4: Implement the two service methods**

In `server/src/services/issues.ts`: add `agentWakeupRequests` to the `@armyofagents/db` import (line 3-24 block). In the object returned by `issueService` (sibling of `findMentionedAgents`, ~line 1574), add:

```ts
    resolveAgentKinds: async (ids: string[]): Promise<Map<string, string>> => {
      const unique = [...new Set(ids)].filter(Boolean);
      if (unique.length === 0) return new Map();
      const rows = await db
        .select({ id: agents.id, kind: agents.kind })
        .from(agents)
        .where(inArray(agents.id, unique));
      return new Map(rows.map((r) => [r.id, r.kind]));
    },

    // F1: AoA agents are dispatched by the AoA dispatcher Phase-3, which drains
    // agent_wakeup_requests {status:'queued', kind:'aoa'} with NO source filter.
    // Calling heartbeat.wakeup for an aoa agent ALSO enqueues a heartbeat_run
    // (dual execution). Mirror delegate-to-subagent.ts: insert the wakeup row
    // directly and let Phase-3 own the single execution.
    enqueueAoaMentionWakeup: async (
      companyId: string,
      agentId: string,
      opts: { source?: string | null; reason?: string | null; payload?: unknown },
    ): Promise<void> => {
      await db.insert(agentWakeupRequests).values({
        companyId,
        agentId,
        source: opts.source ?? "automation",
        reason: opts.reason ?? "issue_comment_mentioned",
        payload: (opts.payload ?? null) as Record<string, unknown> | null,
        status: "queued",
      });
    },
```

- [ ] **Step 5: Run test — verify it PASSES**

`cd "<worktree>/server" && npx vitest run src/__tests__/aoa-mention-wakeup-routing.test.ts` → PASS (3/3).

- [ ] **Step 6: Wire the route partition at BOTH dispatch loops**

In `server/src/routes/issues.ts`, replace the dispatch loop at the **issue-update path** (~823):

```ts
      const aoaKinds = await svc
        .resolveAgentKinds([...wakeups.keys()])
        .catch(() => new Map<string, string>());
      for (const [agentId, wakeup] of wakeups.entries()) {
        if (aoaKinds.get(agentId) === "aoa") {
          svc
            .enqueueAoaMentionWakeup(issue.companyId, agentId, {
              source: wakeup.source,
              reason: wakeup.reason,
              payload: wakeup.payload,
            })
            .catch((err) =>
              logger.warn({ err, issueId: issue.id, agentId }, "failed to enqueue aoa mention wakeup"),
            );
        } else {
          heartbeat
            .wakeup(agentId, wakeup)
            .catch((err) => logger.warn({ err, issueId: issue.id, agentId }, "failed to wake agent on issue update"));
        }
      }
```

Apply the symmetric replacement at the **comment path** (~1205) — same structure, using `currentIssue.companyId` / the `issueId`/`commentId` already in `wakeup.payload`, and the comment-path log message `"failed to wake agent on issue comment"`. (`wakeup.source`/`.reason`/`.payload` are present on every entry both loops build — verified routes/issues.ts:801-816, :1184-1199, :772-781, :1144-1164.)

- [ ] **Step 7: Run targeted + regression suite**

```
cd "<worktree>/server" && npx vitest run \
  src/__tests__/aoa-mention-wakeup-routing.test.ts \
  src/__tests__/aoa-mention-resolution.test.ts \
  src/__tests__/mention-resolver-humans-coverage.test.ts \
  src/__tests__/issues-routes-create-fk-validation.test.ts \
  src/__tests__/aoa-dispatcher.test.ts
```
Expected: ALL PASS. (`mention-resolver-humans-coverage` still sees exactly 2 `findMentionedAgents(` calls; B1 contract unchanged.) Controller then reads the two route loops in landed source to confirm org path is byte-identical and aoa path calls only the direct insert.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/issues.ts server/src/routes/issues.ts server/src/__tests__/aoa-mention-wakeup-routing.test.ts
git commit -m "$(cat <<'EOF'
fix(aoa): route @mention wakeups for kind='aoa' agents via direct insert (F1)

AoA agents are drained by dispatcher Phase-3 (status='queued', kind='aoa',
no source filter). Calling heartbeat.wakeup for them ALSO enqueued a
heartbeat_run -> dual execution per @mention. Partition at the dispatch
loop: aoa -> direct agent_wakeup_requests insert (mirrors
delegate-to-subagent); org -> heartbeat.wakeup unchanged. Both route sites.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Milestone F2 — submit-extracted-items LiveEvent parity (freshness; medium)

**Files:**
- Modify: `server/src/services/internal-agent/tools/submit-extracted-items.ts`
- Test: `server/src/__tests__/submit-extracted-items-live-event.test.ts` (NEW)

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/submit-extracted-items-live-event.test.ts`. Mock `../../live-events.js` (relative to the tool file, but the test imports the tool and asserts the mock) with a hoisted `publishLiveEventMock`; mock `@armyofagents/db` (Proxy tables `discussionExtractedItems`, `discussionEntries`, `discussions`) and `drizzle-orm` (`eq`,`and`,`sql`). Build a `ctx` with `companyId:"co-1"` and a capture/sequence `ctx.db`. Cases:

```ts
it("emits discussion.extraction.completed mirroring extraction.ts shape (with items)", async () => {
  // ctx.db: insert ok; select(discussionEntries) -> [{discussionId:"d-1"}];
  //         update(discussions) ok; update(discussionEntries) ok
  await submitExtractedItemsTool.execute(
    { entryId: "e-1", items: [{ type: "task", content: "x" }] }, ctx);
  expect(publishLiveEventMock).toHaveBeenCalledWith({
    companyId: "co-1",
    type: "discussion.extraction.completed",
    payload: { discussionId: "d-1", entryId: "e-1", itemCount: 1 },
  });
});

it("emits the event even when items is empty (discussionId resolved unconditionally)", async () => {
  // ctx.db: select(discussionEntries) -> [{discussionId:"d-9"}]; update ok
  await submitExtractedItemsTool.execute({ entryId: "e-9", items: [] }, ctx);
  expect(publishLiveEventMock).toHaveBeenCalledWith({
    companyId: "co-1",
    type: "discussion.extraction.completed",
    payload: { discussionId: "d-9", entryId: "e-9", itemCount: 0 },
  });
});

it("publishes AFTER the terminal status update (ordering parity with extraction.ts)", async () => {
  const order: string[] = [];
  // ctx.db.update(discussionEntries).set(...).where(...) pushes "terminal";
  // publishLiveEventMock pushes "publish"
  await submitExtractedItemsTool.execute({ entryId: "e-1", items: [] }, ctx);
  expect(order.indexOf("publish")).toBeGreaterThan(order.indexOf("terminal"));
});
```

- [ ] **Step 2: Run test — verify it FAILS**

`cd "<worktree>/server" && npx vitest run src/__tests__/submit-extracted-items-live-event.test.ts`
Expected: FAIL — `publishLiveEventMock` never called.

- [ ] **Step 3: Implement**

In `submit-extracted-items.ts`: add top-of-file import `import { publishLiveEvent } from "../../live-events.js";` (verify the relative path resolves from `server/src/services/internal-agent/tools/` to `server/src/services/live-events.ts` — it is `../../live-events.js`; confirm by file existence before committing). Resolve `discussionId` **unconditionally** (move the `discussionEntries`→`discussionId` select out of the `if (itemList.length>0)` block into a single lookup used by BOTH the pendingItemCount update and the event). After the terminal-status `update(discussionEntries)` (current lines ~129-137), add:

```ts
    if (resolvedDiscussionId) {
      publishLiveEvent({
        companyId: ctx.companyId,
        type: "discussion.extraction.completed",
        payload: {
          discussionId: resolvedDiscussionId,
          entryId: entryIdStr,
          itemCount: itemList.length,
        },
      });
    }
```

Keep the existing I-1 pendingItemCount increment using the same resolved id (no second query). Do not change the I-2 guarded terminal write.

- [ ] **Step 4: Run test — verify it PASSES**

`cd "<worktree>/server" && npx vitest run src/__tests__/submit-extracted-items-live-event.test.ts` → PASS (3/3).

- [ ] **Step 5: Regression**

```
cd "<worktree>/server" && npx vitest run \
  src/__tests__/submit-extracted-items-live-event.test.ts \
  $(node -e "process.stdout.write(require('fs').readdirSync('src/__tests__').filter(f=>/submit-extracted-items|extraction|aoa-runner|aoa-dispatcher/.test(f)).map(f=>'src/__tests__/'+f).join(' '))")
```
(Or list those files explicitly.) Expected: ALL PASS — existing submit-extracted-items tests still green (I-1/I-2 untouched).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/internal-agent/tools/submit-extracted-items.ts server/src/__tests__/submit-extracted-items-live-event.test.ts
git commit -m "$(cat <<'EOF'
feat(aoa): emit discussion.extraction.completed from submit_extracted_items (F2)

Mirrors extraction.ts:630-638 so UIs subscribed to the LiveEvent refresh
when an AoA agent completes extraction. discussionId resolved
unconditionally (empty-items completions emit too). Published after the
terminal status write (ordering parity).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Milestone F3 — retire orphaned platform-agent.ts (cleanup; spec §11 / Decision #100)

**Files:**
- Delete: `server/src/services/internal-agent/subagents/platform-agent.ts`
- Delete: `server/src/__tests__/platform-agent-seed.test.ts`

- [ ] **Step 1: Re-confirm zero production references (no edits)**

`grep -rn "ensurePlatformAgent\|PLATFORM_AGENT_NAME\|platform-agent" server/src | grep -v __tests__` → expect ONLY `platform-agent.ts` itself. `grep -rn "kind.*platform\|\"platform\"\|'platform'" server/src --include=*.ts | grep -v __tests__ | grep -v platform-agent.ts` → expect only the two doc comments (`agents.ts:380`, `extraction-sweeper.ts:18`) and nothing that constructs/depends on a `kind='platform'` row. If a real production caller exists, STOP — report `NEEDS_CONTEXT` (premise changed).

- [ ] **Step 2: Delete the retired files**

```bash
git rm server/src/services/internal-agent/subagents/platform-agent.ts \
       server/src/__tests__/platform-agent-seed.test.ts
```

- [ ] **Step 3: Verify no broken imports / type errors**

`cd "<worktree>/server" && npx tsc --noEmit -p tsconfig.json` (or the repo's typecheck) → no new errors referencing the deleted module. Then run the AoA suite:
```
cd "<worktree>/server" && npx vitest run \
  src/__tests__/aoa-dispatcher.test.ts \
  src/__tests__/agents-list-excludes-platform.test.ts \
  src/__tests__/ensure-extraction-agent.test.ts \
  src/__tests__/ensure-commander.test.ts
```
Expected: ALL PASS (minus the deliberately-deleted `platform-agent-seed.test.ts`). The two comment refs in `agents.ts:380` / `extraction-sweeper.ts:18` are accurate history — leave them.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/internal-agent/subagents/platform-agent.ts server/src/__tests__/platform-agent-seed.test.ts
git commit -m "$(cat <<'EOF'
chore(aoa): retire orphaned platform-agent.ts (F3; Decision #100 / spec §11)

ensurePlatformAgent has zero production callers since Plan A migrated
extraction to kind='aoa' (ensure-extraction-agent.ts). agentService.list
is a positive kind allowlist; cost/budget attribution uses the aoa
agentId. Retired with its seed test; rationale Decision #100 (platform
agent superseded by kind='aoa').

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Milestone F4 — runner MCP-config temp-file cleanup (hygiene)

**Files:**
- Modify: `server/src/services/internal-agent/aoa-agents/runner.ts`
- Test: `server/src/__tests__/aoa-runner-tmpfile-cleanup.test.ts` (NEW)

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/aoa-runner-tmpfile-cleanup.test.ts`. Hoisted-mock `node:fs/promises` so `writeFile` is a no-op and `unlink` is a spy; mock `@armyofagents/db`, `../../../adapters/registry.js` (`getServerAdapter` → `{ execute }`), `../cli-mode.js` (`buildMcpConfig`), `../../heartbeat.js` (`resolveAdapterExecutionContext`), `./bridge-path.js`, `../../costs.js` (`costService`), `../../../middleware/logger.js`. Provide a `db` that returns an agent + insert run id + claim ok. Cases:

```ts
it("unlinks the mcp temp file after a successful adapter run", async () => {
  adapterExecute.mockResolvedValue(undefined);
  await runAoaAgent(db, "a-1", { companyId: "co-1", source: "wakeup" });
  expect(unlinkMock).toHaveBeenCalledTimes(1);
  expect(String(unlinkMock.mock.calls[0][0])).toMatch(/aoa-mcp-a-1-.*\.json$/);
});

it("unlinks the mcp temp file even when the adapter throws", async () => {
  adapterExecute.mockRejectedValue(new Error("boom"));
  await runAoaAgent(db, "a-1", { companyId: "co-1", source: "wakeup" });
  expect(unlinkMock).toHaveBeenCalledTimes(1);
});

it("a failing unlink never throws out of runAoaAgent", async () => {
  adapterExecute.mockResolvedValue(undefined);
  unlinkMock.mockRejectedValue(new Error("ENOENT"));
  await expect(runAoaAgent(db, "a-1", { companyId: "co-1", source: "wakeup" }))
    .resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run test — verify it FAILS**

`cd "<worktree>/server" && npx vitest run src/__tests__/aoa-runner-tmpfile-cleanup.test.ts`
Expected: FAIL — `unlinkMock` not called (no cleanup exists).

- [ ] **Step 3: Implement**

In `runner.ts`: add `unlink` to the `node:fs/promises` import (`import { writeFile, unlink } from "node:fs/promises";`). Hoist the temp path: declare `let cfgPath: string | null = null;` BEFORE the outer `try` (alongside `let runId`). Assign `cfgPath = join(tmpdir(), ...)` where it is currently `const` (line 81). Add a `finally` to the OUTER try/catch (after the existing `catch` at ~124) that best-effort unlinks:

```ts
  } finally {
    if (cfgPath) {
      await unlink(cfgPath).catch(() => { /* best-effort; never break the run */ });
    }
  }
```

Do not alter the existing `catch` body or the run-status writes.

- [ ] **Step 4: Run test — verify it PASSES**

`cd "<worktree>/server" && npx vitest run src/__tests__/aoa-runner-tmpfile-cleanup.test.ts` → PASS (3/3).

- [ ] **Step 5: Regression**

```
cd "<worktree>/server" && npx vitest run \
  src/__tests__/aoa-runner-tmpfile-cleanup.test.ts \
  src/__tests__/aoa-dispatcher.test.ts
```
Plus any existing `aoa-runner*` test files (list explicitly). Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/internal-agent/aoa-agents/runner.ts server/src/__tests__/aoa-runner-tmpfile-cleanup.test.ts
git commit -m "$(cat <<'EOF'
fix(aoa): unlink mcp-config temp file after every run (F4)

runner.ts wrote tmpdir()/aoa-mcp-<agentId>-<runId>.json and never removed
it -> unbounded tmpdir growth. Hoist cfgPath; best-effort unlink in a
finally (swallows errors, never breaks the run's hard-error boundary).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Closeout

- [ ] **Full regression sweep** — run the broader AoA + mention + extraction + dispatcher + runner suites together; confirm green (Windows-skipped integration tests remain skipped, not failed).
- [ ] **Update FOLLOWUPS.md** — mark F1–F4 RESOLVED with their commit SHAs; record F5 as "no action — self-resolves on merge"; `git add -f docs/superpowers/plans/2026-05-17-aoa-agents-framework-FOLLOWUPS.md docs/superpowers/plans/2026-05-17-aoa-agents-framework-FOLLOWUPS-PLAN.md` + commit.
- [ ] **Final code-quality review** subagent over the whole follow-up diff (4 commits).
- [ ] Hand back to controller → then Plan D → then `finishing-a-development-branch`.

### Execution discipline
Fresh implementer subagent per milestone (F1 may use a more capable model — correctness-critical; F2/F3/F4 are mechanical → cheap model). Two-stage review (spec-compliance → code-quality) between milestones. Controller code-verifies every diff against landed source — never trust subagent reports. STOP / `NEEDS_CONTEXT` rather than guess or weaken a regression test. F1 Step 1 and F3 Step 1 are mandatory re-verification gates.
