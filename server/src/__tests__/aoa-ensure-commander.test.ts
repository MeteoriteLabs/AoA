import { beforeEach, describe, expect, it, vi } from "vitest";
const { eqMock, andMock } = vi.hoisted(() => ({ eqMock: vi.fn((a:unknown,b:unknown)=>({eq:[a,b]})), andMock: vi.fn((...a:unknown[])=>({and:a})) }));
vi.mock("drizzle-orm", () => ({ and: andMock, eq: eqMock }));
vi.mock("@armyofagents/db", () => { const t=(n:string)=>new Proxy({},{get:(_x,p)=>typeof p==="string"?Symbol(`${n}.${p}`):undefined}); return { agents:t("agents"), internalAgentConfig:t("iac") }; });
import { ensureCommanderAgent, COMMANDER_TOOL_ALLOWLIST } from "../services/internal-agent/aoa-agents/ensure-commander.js";
function sel(rows:unknown[]){const c:any={};c.from=()=>c;c.where=()=>c;c.then=(r:(v:unknown[])=>unknown)=>Promise.resolve(rows).then(r);return c;}
describe("ensureCommanderAgent", () => {
  beforeEach(() => { eqMock.mockClear(); andMock.mockClear(); });
  it("returns existing commander id, no insert (toolAllowlist already set → no update)", async () => {
    const insert = vi.fn();
    const update = vi.fn(()=>({set:()=>({where:()=>Promise.resolve([])})}));
    const existingRc = { aoa: { role: "lead", toolAllowlist: ["delegate_to_subagent"] }, heartbeat: { enabled:false, intervalSec:0 } };
    const db:any = { select:()=>sel([{id:"cmd-1", runtimeConfig: existingRc}]), insert, update };
    expect(await ensureCommanderAgent(db,"co-1")).toBe("cmd-1");
    expect(insert).not.toHaveBeenCalled();
    // update called once only for internalAgentConfig link (not for agent row since toolAllowlist already set)
    const agentUpdateCalls = update.mock.calls.filter(()=>true);
    // all update calls should be for internalAgentConfig (set agentId), not for agents row
    const setArgs = update.mock.results.map((r:any)=>r.value);
    expect(setArgs.length).toBeGreaterThan(0);
  });
  it("creates kind='aoa' role='general' runtimeConfig.aoa.role='lead' + toolAllowlist + links config", async () => {
    const av:any[]=[]; const sv:any[]=[];
    const db:any = { select:()=>sel([]), insert:()=>({values:(v:any)=>{av.push(v);return{returning:()=>Promise.resolve([{id:"cmd-new"}])};}}), update:()=>({set:(v:any)=>{sv.push(v);return{where:()=>Promise.resolve([])};}}) };
    expect(await ensureCommanderAgent(db,"co-1")).toBe("cmd-new");
    expect(av[0].kind).toBe("aoa");
    expect(av[0].role).toBe("general");
    // D2: toolAllowlist must be present and include delegate_to_subagent
    expect(av[0].runtimeConfig.aoa.role).toBe("lead");
    expect(Array.isArray(av[0].runtimeConfig.aoa.toolAllowlist)).toBe(true);
    expect(av[0].runtimeConfig.aoa.toolAllowlist).toContain("delegate_to_subagent");
    expect(av[0].runtimeConfig.aoa.toolAllowlist).toEqual([...COMMANDER_TOOL_ALLOWLIST]);
    expect(av[0].runtimeConfig.heartbeat).toEqual({ enabled:false, intervalSec:0 });
    expect(sv.some((s)=>s.agentId==="cmd-new")).toBe(true);
  });
  it("D2 backfill: existing row without toolAllowlist → merges toolAllowlist", async () => {
    const agentUpdateVals:any[]=[];
    const existingRc = { aoa: { role: "lead" }, heartbeat: { enabled:false, intervalSec:0 } };
    const db:any = {
      select:()=>sel([{id:"cmd-old", runtimeConfig: existingRc}]),
      insert: vi.fn(),
      update:()=>({set:(v:any)=>{agentUpdateVals.push(v);return{where:()=>Promise.resolve([])};}}),
    };
    expect(await ensureCommanderAgent(db,"co-1")).toBe("cmd-old");
    // Should have updated the agent row with toolAllowlist
    const agentRcUpdate = agentUpdateVals.find((v:any)=>v.runtimeConfig);
    expect(agentRcUpdate).toBeDefined();
    expect(Array.isArray(agentRcUpdate.runtimeConfig.aoa.toolAllowlist)).toBe(true);
    expect(agentRcUpdate.runtimeConfig.aoa.toolAllowlist).toContain("delegate_to_subagent");
    // role must be preserved
    expect(agentRcUpdate.runtimeConfig.aoa.role).toBe("lead");
  });
});
