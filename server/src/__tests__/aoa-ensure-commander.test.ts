import { beforeEach, describe, expect, it, vi } from "vitest";
const { eqMock, andMock } = vi.hoisted(() => ({ eqMock: vi.fn((a:unknown,b:unknown)=>({eq:[a,b]})), andMock: vi.fn((...a:unknown[])=>({and:a})) }));
vi.mock("drizzle-orm", () => ({ and: andMock, eq: eqMock }));
vi.mock("@armyofagents/db", () => { const t=(n:string)=>new Proxy({},{get:(_x,p)=>typeof p==="string"?Symbol(`${n}.${p}`):undefined}); return { agents:t("agents"), internalAgentConfig:t("iac") }; });
import { ensureCommanderAgent } from "../services/internal-agent/aoa-agents/ensure-commander.js";
function sel(rows:unknown[]){const c:any={};c.from=()=>c;c.where=()=>c;c.then=(r:(v:unknown[])=>unknown)=>Promise.resolve(rows).then(r);return c;}
describe("ensureCommanderAgent", () => {
  beforeEach(() => { eqMock.mockClear(); andMock.mockClear(); });
  it("returns existing commander id, no insert", async () => {
    const insert = vi.fn();
    const db:any = { select:()=>sel([{id:"cmd-1"}]), insert, update:()=>({set:()=>({where:()=>Promise.resolve([])})}) };
    expect(await ensureCommanderAgent(db,"co-1")).toBe("cmd-1"); expect(insert).not.toHaveBeenCalled();
  });
  it("creates kind='aoa' role='general' runtimeConfig.aoa.role='lead' + links config", async () => {
    const av:any[]=[]; const sv:any[]=[];
    const db:any = { select:()=>sel([]), insert:()=>({values:(v:any)=>{av.push(v);return{returning:()=>Promise.resolve([{id:"cmd-new"}])};}}), update:()=>({set:(v:any)=>{sv.push(v);return{where:()=>Promise.resolve([])};}}) };
    expect(await ensureCommanderAgent(db,"co-1")).toBe("cmd-new");
    expect(av[0].kind).toBe("aoa");
    expect(av[0].role).toBe("general");
    expect(av[0].runtimeConfig.aoa).toEqual({ role: "lead" });
    expect(av[0].runtimeConfig.heartbeat).toEqual({ enabled:false, intervalSec:0 });
    expect(sv.some((s)=>s.agentId==="cmd-new")).toBe(true);
  });
});
