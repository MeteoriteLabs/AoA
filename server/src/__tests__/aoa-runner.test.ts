import { describe, expect, it, vi } from "vitest";
const { execMock, createEventMock, buildMcpMock } = vi.hoisted(() => ({
  execMock: vi.fn().mockResolvedValue({ exitCode: 0 }),
  createEventMock: vi.fn().mockResolvedValue(undefined),
  buildMcpMock: vi.fn(() => ({ mcpServers: {} })),
}));
vi.mock("drizzle-orm", () => ({ and:(...a:unknown[])=>({and:a}), eq:(a:unknown,b:unknown)=>({eq:[a,b]}) }));
vi.mock("@armyofagents/db", () => { const t=(n:string)=>new Proxy({},{get:(_x,p)=>typeof p==="string"?Symbol(`${n}.${p}`):undefined}); return { agents:t("a"), internalAgentRuns:t("iar"), discussionEntries:t("de") }; });
vi.mock("../adapters/registry.js", () => ({ getServerAdapter: () => ({ execute: execMock, getRuntimeCommandSpec: () => ({}) }) }));
vi.mock("../services/costs.js", () => ({ costService: () => ({ createEvent: createEventMock }) }));
vi.mock("../services/internal-agent/cli-mode.js", () => ({ buildMcpConfig: buildMcpMock }));
vi.mock("../services/heartbeat.js", () => ({ resolveAdapterExecutionContext: () => ({ executionTarget:{}, runtimeCommandSpec:{} }) }));
vi.mock("../services/internal-agent/aoa-agents/bridge-path.js", () => ({ resolveBridgeEntrypoint: () => "/x/mcp-bridge.js" }));
vi.mock("node:fs/promises", () => ({ writeFile: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../middleware/logger.js", () => ({ logger:{ child:()=>({info:vi.fn(),warn:vi.fn(),error:vi.fn()}) } }));
import { runAoaAgent } from "../services/internal-agent/aoa-agents/runner.js";
function ch(ret:unknown[]){const c:any={};c.values=()=>c;c.set=()=>c;c.where=()=>c;c.from=()=>c;c.returning=()=>Promise.resolve(ret);c.then=(r:(v:unknown[])=>unknown)=>Promise.resolve(ret).then(r);return c;}
it("happy: bridge attached via adapterConfig.args, run completed, cost emitted, agentId stamped", async () => {
  const insertedRuns:any[]=[];
  const db:any = {
    select:()=>ch([{ id:"ext-1", companyId:"co-1", adapterType:"process", adapterConfig:{}, runtimeConfig:{ aoa:{ instruction:"do extraction" } } }]),
    insert:()=>({ values:(v:any)=>{ insertedRuns.push(v); return { returning:()=>Promise.resolve([{id:"run-1"}]) }; } }),
    update:()=>ch([{ id:"e1" }]), // claim returns non-empty (claimed)
  };
  await runAoaAgent(db, "ext-1", { companyId:"co-1", source:"discussion_entry_pending", entryId:"e1" });
  expect(buildMcpMock).toHaveBeenCalled();
  const execArg = execMock.mock.calls[0][0];
  expect(execArg.config.args).toContain("--mcp-config");
  expect(insertedRuns[0].agentId).toBe("ext-1");          // Finding R1: run attributed to the agent
  expect(createEventMock).toHaveBeenCalledTimes(1);
  expect(createEventMock.mock.calls[0][1].agentId).toBe("ext-1");
  expect(createEventMock.mock.calls[0][1].costCents).toBe(0); // §16.3 zeroed
});
it("failure isolated: adapter throws → never rethrows", async () => {
  execMock.mockRejectedValueOnce(new Error("boom"));
  const db:any = { select:()=>ch([{ id:"ext-1", companyId:"co-1", adapterType:"process", adapterConfig:{}, runtimeConfig:{} }]), insert:()=>ch([{id:"run-2"}]), update:()=>ch([{id:"e2"}]) };
  await expect(runAoaAgent(db,"ext-1",{ companyId:"co-1", source:"discussion_entry_pending", entryId:"e2" })).resolves.toBeUndefined();
});
it("not claimable (concurrent): atomic claim empty → adapter NOT called, returns", async () => {
  execMock.mockClear();
  const claimChain:any = { set:()=>claimChain, where:()=>claimChain, returning:()=>Promise.resolve([]) }; // claim RETURNING empty
  let upd=0;
  const db:any = {
    select:()=>ch([{ id:"ext-1", companyId:"co-1", adapterType:"process", adapterConfig:{}, runtimeConfig:{} }]),
    insert:()=>ch([{ id:"run-9" }]),
    update:()=> (upd++ === 0 ? claimChain : ch([{ id:"run-9" }])), // 1st update = the claim (empty ⇒ abort)
  };
  await expect(runAoaAgent(db,"ext-1",{ companyId:"co-1", source:"discussion_entry_pending", entryId:"e9" })).resolves.toBeUndefined();
  expect(execMock).not.toHaveBeenCalled();
});
