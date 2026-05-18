import { describe, expect, it, vi } from "vitest";
vi.mock("drizzle-orm", () => ({ and: vi.fn((...a:any)=>({and:a})), eq: vi.fn((a:any,b:any)=>({eq:[a,b]})), desc: vi.fn((x:any)=>x), gt: vi.fn((a:any,b:any)=>({gt:[a,b]})), sql: Object.assign(()=>({}), { raw:()=>({}) }) }));
vi.mock("@armyofagents/db", () => ({ internalAgentConversations: {}, internalAgentMessages: { conversationId: "cid", id: "id", createdAt: "createdAt" } }));
import { conversationService } from "../services/internal-agent/conversation.js";

describe("getMessagesSince", () => {
  it("returns chronological messages strictly after the marker id", async () => {
    const captured: any = {};
    const db: any = { select: () => ({ from: () => ({ where: (w:any)=>{ captured.where = w; return { orderBy: () => ({ limit: () => ({ then: (r:any)=>Promise.resolve([{id:"m3"},{id:"m2"}]).then(r) }) }) }; } }) }) };
    const out = await conversationService(db).getMessagesSince("conv1", "m1", 50);
    expect(out.map((m:any)=>m.id)).toEqual(["m2","m3"]);
  });
});
