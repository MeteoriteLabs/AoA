# AoA Agents Framework — Plan B: Coordination (@mention + delegation)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. `- [ ]` checkboxes.
> **Fidelity:** structural — depends on **Plan A landed** (`aoa-agents/dispatcher.ts`, `runner.ts`, `runExtractionConsumer` shim, `kind='aoa'` rows, `agent_wakeup_requests`). Steps marked **[verify@exec]** must re-confirm the named symbol against landed code before implementing. Spec: `docs/superpowers/specs/2026-05-17-aoa-agents-framework-design.md` §8.

**Goal:** Make AoA agents (incl. Commander) addressable: `@mention` an AoA agent in a discussion/comment, or have Commander delegate to a sub-agent, → a durable wakeup → the Plan-A dispatcher runs it. No task board.

**Architecture:** Reuse the existing `@mention → wakeup` primitive (`issues.ts:1563 findMentionedAgents` + `agent_wakeup_requests`). Two changes: (1) mention-resolution stops excluding non-`org` kinds so `kind='aoa'` agents resolve; (2) the Plan-A dispatcher gains a second drain — `agent_wakeup_requests.status='queued'` for `kind='aoa'` agents → `runAoaAgent` with the wakeup payload. Commander↔sub-agent delegation is just an internal-agent tool that enqueues such a wakeup.

**Tech Stack:** TS, Drizzle, Vitest, Express. **Worktree/branch/test cmd/git hygiene:** identical to Plan A's header. **Plan B of 4.**

---

## File Structure
**Modify:** `server/src/services/issues.ts` (`findMentionedAgents` kind filter); `server/src/services/internal-agent/aoa-agents/dispatcher.ts` (add wakeup-queue drain); `server/src/services/internal-agent/aoa-agents/triggers.ts` (recognize `mention`/`manual`); `server/src/services/internal-agent/tool-registry.ts` (+ delegate tool).
**Create:** `server/src/services/internal-agent/tools/delegate-to-subagent.ts`; tests `server/src/__tests__/aoa-mention-resolution.test.ts`, `aoa-wakeup-dispatch.test.ts`, `aoa-delegate-tool.test.ts`.
**Reuse unchanged:** `agent_wakeup_requests` schema, `runAoaAgent` (Plan A), the wakeup-creation path that `findMentionedAgents` callers already use (`issues.ts:787-814`).

---

## Milestone B1 — Mention-resolution includes `kind='aoa'`

`issues.ts:1563` currently: `db.select({id,name}).from(agents).where(and(eq(agents.companyId,companyId), eq(agents.kind,"org")))` — comment says it *excludes* Commander-team. Include `aoa` (keep `org`).

- [ ] **Step 1: [verify@exec] (Finding R2 — find ALL agent-kind mention sites, not just one).** Re-read `issues.ts:1563` `findMentionedAgents` (the agent-kind filter). **The sibling at `:1579` resolves @username → HUMAN user IDs — it has NO agent-kind filter; do NOT touch it.** Then `grep -rn "kind.*\"org\"\|findMentionedAgents\|@mention" server/src/services/*.ts server/src/routes/*.ts | grep -iE "mention|kind"` to find **every** site that resolves agent mentions with a `kind='org'` filter (discussions/comments may have their own). Each such site gets the same flip in Step 4. Confirm `inArray` import in each file (`grep -n inArray <file>`); add if missing.
- [ ] **Step 2: Failing test**
```ts
// server/src/__tests__/aoa-mention-resolution.test.ts
import { describe, expect, it, vi } from "vitest";
const { inArrayMock, andMock, eqMock } = vi.hoisted(() => ({
  inArrayMock: vi.fn((c:unknown,v:unknown)=>({inArray:[c,v]})),
  andMock: vi.fn((...a:unknown[])=>({and:a})), eqMock: vi.fn((a:unknown,b:unknown)=>({eq:[a,b]})),
}));
vi.mock("drizzle-orm", async (orig) => ({ ...(await orig() as object), and: andMock, eq: eqMock, inArray: inArrayMock }));
// Capture the kind filter argument the query builds.
it("resolves agents of kind org AND aoa (not org-only)", async () => {
  // Arrange a recording db where .where(...) records its predicate; assert
  // the kind predicate is inArray(agents.kind, ["org","aoa"]) not eq(kind,"org").
  // (Harness mirrors existing issues.ts service tests; assert the recorded
  //  predicate contains inArray over ["org","aoa"].)
  expect(["org","aoa"]).toEqual(["org","aoa"]); // placeholder asserted-shape; replace with recorded-predicate assertion per Step 1 harness
});
```
> The assertion records the WHERE predicate (the existing issues service tests show the recording-db pattern — mirror it). Behavior asserted: kind ∈ {org,aoa}.
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement** — at **every agent-kind mention site found in Step 1** (≥ `issues.ts:1563`; plus any discussion/comment resolver) replace `eq(agents.kind, "org")` with `inArray(agents.kind, ["org", "aoa"])`. Update the stale comment to: `// resolves org + aoa (Commander-team) agents; platform stays excluded`. **Do not** alter the human-mention resolver (`:1579`) or any `kind='org'` *enumeration* site (those are M1 list filters — out of scope; `agent-read-sites-org-filter.test.ts` must stay green, see Step 5).
- [ ] **Step 5: Run → PASS.** Then run `cd <worktree>/server && npx vitest run src/__tests__/agent-read-sites-org-filter.test.ts src/__tests__/agents-list-excludes-platform.test.ts` — confirm **still green** (mention is a *different* site than the list enumerations; M1's `kind='org'` list filters are untouched, so those tests must stay green; if one breaks, you changed a list site by mistake — revert that).
- [ ] **Step 6: Commit** `git add server/src/services/issues.ts server/src/__tests__/aoa-mention-resolution.test.ts && git commit -m "feat(aoa-B): @mention resolves kind='aoa' agents (platform still excluded)"`

---

## Milestone B2 — Dispatcher drains the wakeup queue for AoA agents

Plan A's dispatcher (`aoa-agents/dispatcher.ts`) drains the `outbox` trigger. B2 adds a second phase: `agent_wakeup_requests.status='queued'` whose `agentId` is a `kind='aoa'` agent → atomic-claim the wakeup (`status queued→processing` RETURNING) → `runAoaAgent(db, agentId, { companyId, source:'wakeup', wakeupId, ...payload })` → on completion mark wakeup `done`. Reuses Plan A's runner + #99/M2 invariant pattern (claim before work — here the work unit is the wakeup row, not a discussion entry).

- [ ] **Step 1: [verify@exec]** Re-read landed `aoa-agents/dispatcher.ts` (Plan A) + `agent_wakeup_requests` columns (`status`, `payload`, `agentId`, `companyId`, `claimedAt`, `finishedAt`, `error`). Confirm the runner accepts an arbitrary `AoaTriggerPayload` (Plan A defined `{companyId,source,entryId?,[k]:unknown}` — wakeup uses `wakeupId` instead of `entryId`).
- [ ] **Step 2: Failing test**
```ts
// server/src/__tests__/aoa-wakeup-dispatch.test.ts
import { describe, expect, it, vi } from "vitest";
const { runAoaMock } = vi.hoisted(() => ({ runAoaMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../services/internal-agent/aoa-agents/runner.js", () => ({ runAoaAgent: runAoaMock }));
vi.mock("drizzle-orm", () => ({ and:(...a:unknown[])=>({and:a}), eq:(a:unknown,b:unknown)=>({eq:[a,b]}), lt:(a:unknown,b:unknown)=>({lt:[a,b]}), inArray:(a:unknown,b:unknown)=>({inArray:[a,b]}) }));
vi.mock("@armyofagents/db", () => { const t=(n:string)=>new Proxy({},{get:(_x,p)=>typeof p==="string"?Symbol(`${n}.${p}`):undefined}); return { agentWakeupRequests:t("awr"), agents:t("a"), discussionEntries:t("de"), discussions:t("d"), internalAgentRuns:t("iar") }; });
vi.mock("../services/internal-agent/aoa-agents/triggers.js", () => ({ listEnabledOutboxAgents: vi.fn().mockResolvedValue([]) }));
vi.mock("../middleware/logger.js", () => ({ logger:{ child:()=>({info:vi.fn(),warn:vi.fn(),error:vi.fn()}) } }));
import { runAoaDispatch } from "../services/internal-agent/aoa-agents/dispatcher.js";
it("claims a queued wakeup for a kind='aoa' agent and runs it", async () => {
  // seq-mock: phase1 orphan=[], outbox-drain=[], wakeup-select=[{id:'w1',agentId:'ext-1',companyId:'co-1',payload:{note:'x'}}], claim RETURNING=[{id:'w1'}]
  const db = makeSeqDbForWakeup();
  await runAoaDispatch(db, { limiterMax:2, staleMs:600_000 });
  expect(runAoaMock).toHaveBeenCalledWith(db, "ext-1", expect.objectContaining({ companyId:"co-1", source:"wakeup", wakeupId:"w1" }));
});
```
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement** — in `runAoaDispatch`, after the outbox-drain phase add a wakeup-drain phase: select `agent_wakeup_requests` `status='queued'` joined to `agents` where **`agents.kind='aoa'` AND `agents.status NOT IN ('paused','terminated')`** (limit 200); per row, atomic-claim `update(agentWakeupRequests).set({status:'processing',claimedAt:now}).where(and(eq(id,w.id),eq(status,'queued'))).returning()`; if claimed, `await runAoaAgent(db, w.agentId, { companyId:w.companyId, source:'wakeup', wakeupId:w.id, ...(w.payload as object) })` under the same `limiter`; then `update(...).set({status:'done',finishedAt:now}).where(eq(id,w.id))`. Errors isolated (runner never throws; on dispatcher-level error set wakeup `error`+`status='failed'`). Reuse the #99/M2 claim-before-work invariant (claim the WAKEUP row here). **Finding R3:** the `kind='aoa'` join means worker-agent wakeups (`kind!='aoa'`) are **never** consumed here — they remain for the existing heartbeat consumer (two safe consumers, disjoint by kind + atomic claim). The paused/terminated filter keeps pause consistent with the outbox path (D3 relies on it).
- [ ] **Step 5: Run BOTH** `npx vitest run src/__tests__/aoa-wakeup-dispatch.test.ts src/__tests__/aoa-dispatcher.test.ts src/__tests__/extraction-sweeper.test.ts` → all green (outbox path + sweeper shim unchanged).
- [ ] **Step 6: Commit** `git add server/src/services/internal-agent/aoa-agents/dispatcher.ts server/src/__tests__/aoa-wakeup-dispatch.test.ts && git commit -m "feat(aoa-B): dispatcher drains the wakeup queue for kind='aoa' agents"`

---

## Milestone B3 — Commander→sub-agent delegation tool

A new internal-agent tool `delegate-to-subagent` (registered in `tool-registry.ts`, callable by Commander via the bridge): resolves a target AoA agent by name within the company, enqueues an `agent_wakeup_requests` row (`source:'aoa.delegate'`, `payload:{instruction}`). B2's wakeup drain then runs it.

- [ ] **Step 1: [verify@exec]** Re-read `tool-registry.ts` + the `AgentTool` shape (same as Plan A A5 Step 1) + `agent_wakeup_requests` insert columns.
- [ ] **Step 2: Failing test**
```ts
// server/src/__tests__/aoa-delegate-tool.test.ts
import { describe, expect, it, vi } from "vitest";
vi.mock("drizzle-orm", () => ({ and:(...a:unknown[])=>({and:a}), eq:(a:unknown,b:unknown)=>({eq:[a,b]}) }));
vi.mock("@armyofagents/db", () => { const t=(n:string)=>new Proxy({},{get:(_x,p)=>typeof p==="string"?Symbol(`${n}.${p}`):undefined}); return { agents:t("a"), agentWakeupRequests:t("awr") }; });
import { delegateToSubagentTool } from "../services/internal-agent/tools/delegate-to-subagent.js";
it("resolves target by name and enqueues a wakeup with the instruction", async () => {
  const ins:any[]=[];
  const db:any = { select:()=>({from:()=>({where:()=>({then:(r:any)=>Promise.resolve([{id:"sub-1"}]).then(r)})})}), insert:()=>({values:(v:any)=>{ins.push(v);return Promise.resolve([]);}}) };
  const res = await delegateToSubagentTool.handler({ agentName:"Discussion Extraction", instruction:"process entry e1" }, { db, companyId:"co-1" } as any);
  expect(res.success).toBe(true);
  expect(ins[0].agentId).toBe("sub-1");
  expect(ins[0].source).toBe("aoa.delegate");
  expect(ins[0].payload).toEqual({ instruction:"process entry e1" });
  expect(ins[0].status).toBe("queued");
});
```
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement** the tool (mirror the `AgentTool` shape from Step 1; logic exact): params `{agentName:string, instruction:string}`; `select agents.id where companyId=ctx.companyId and kind='aoa' and name=agentName` → if none, `return {success:false,error:'no such AoA agent'}`; else `insert(agentWakeupRequests).values({companyId:ctx.companyId, agentId, source:'aoa.delegate', reason:'commander_delegation', payload:{instruction}, status:'queued'})`; `return {success:true,data:{agentId},summary:'delegated'}`. Register in `createToolRegistry()`.
- [ ] **Step 5: Run → PASS.**
- [ ] **Step 6: Commit** `git add server/src/services/internal-agent/tools/delegate-to-subagent.ts server/src/services/internal-agent/tool-registry.ts server/src/__tests__/aoa-delegate-tool.test.ts && git commit -m "feat(aoa-B): delegate-to-subagent tool (Commander→sub-agent via wakeup)"`

---

## Milestone B4 — Regression
- [ ] **Step 1:** Run the full Plan-A suite + B suite together; all green. Mention/list-site separation holds (`agent-read-sites-org-filter`, `agents-list-excludes-platform` still green — those are enumeration sites, untouched).
- [ ] **Step 2: Commit** (no-op if clean) / checkpoint.

## Self-Review
**Spec coverage:** §8 bullets → B1 (mention incl. aoa), B2 (wakeup→dispatch, the "directive→wakeup→runner" path), B3 (Commander delegation). No separate task board (reuses `agent_wakeup_requests`+runs). **Placeholder scan:** B1 Step 2 assertion is a documented "record-the-predicate, mirror existing issues-service test" instruction (named precedent) — the *behavior* (kind∈{org,aoa}) is exact. **[verify@exec]** tags mark every Plan-A-dependent symbol. **Type consistency:** `runAoaAgent(db,agentId,{companyId,source,...})` payload extended with `wakeupId` (additive, matches Plan A's `[k]:unknown`); `delegateToSubagentTool` uses the A5 `AgentTool` shape. **Fidelity note:** B is high-structural; finalize B1's recorded-predicate harness + the `AgentTool` shape against landed Plan-A code at execution.
