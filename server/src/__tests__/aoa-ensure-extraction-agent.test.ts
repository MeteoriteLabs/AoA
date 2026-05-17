import { beforeEach, describe, expect, it, vi } from "vitest";
const { eqMock, andMock } = vi.hoisted(() => ({ eqMock: vi.fn((a:unknown,b:unknown)=>({eq:[a,b]})), andMock: vi.fn((...a:unknown[])=>({and:a})) }));
vi.mock("drizzle-orm", () => ({ and: andMock, eq: eqMock }));
vi.mock("@armyofagents/db", () => { const t=(n:string)=>new Proxy({},{get:(_x,p)=>typeof p==="string"?Symbol(`${n}.${p}`):undefined}); return { agents:t("agents"), aoaAgentTriggers:t("agt") }; });
import { ensureExtractionAgent, EXTRACTION_AGENT_NAME } from "../services/internal-agent/aoa-agents/ensure-extraction-agent.js";
function sel(rows:unknown[]){const c:any={};c.from=()=>c;c.where=()=>c;c.then=(r:(v:unknown[])=>unknown)=>Promise.resolve(rows).then(r);return c;}
describe("ensureExtractionAgent", () => {
  beforeEach(() => { eqMock.mockClear(); andMock.mockClear(); });
  it("creates kind='aoa' member + enabled outbox trigger + seeded instruction", async () => {
    const av:any[]=[]; const tv:any[]=[]; let n=0;
    const db:any = { select:()=>sel([]), insert:()=>{const w=n++;return{values:(v:any)=>{(w===0?av:tv).push(v);return{returning:()=>Promise.resolve([{id:w===0?"ext-1":"trg-1"}])};}};} };
    const id = await ensureExtractionAgent(db,"co-1");
    expect(id).toBe("ext-1");
    expect(av[0].kind).toBe("aoa"); expect(av[0].role).toBe("general");
    expect(av[0].runtimeConfig.aoa.role).toBe("member");
    expect(typeof av[0].runtimeConfig.aoa.instruction).toBe("string");
    expect(av[0].runtimeConfig.aoa.instruction).toContain("submit-extracted-items");
    expect(tv[0].kind).toBe("outbox");
    expect(tv[0].config).toEqual({ source: "discussion_entry_pending" });
  });
  it("idempotent: existing id, no insert", async () => {
    const insert = vi.fn();
    expect(await ensureExtractionAgent({ select:()=>sel([{id:"ext-x"}]), insert } as any,"co-1")).toBe("ext-x");
    expect(insert).not.toHaveBeenCalled();
  });
});
