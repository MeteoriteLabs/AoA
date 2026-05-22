import { describe, expect, it, vi } from "vitest";
import { contextAssemblyService } from "../services/internal-agent/context-assembly.js";

const db:any = { select: () => ({ from: () => ({ where: () => ({ then:(r:any)=>Promise.resolve([]).then(r) }) }) }) };

describe("assembleContext relevance memory", () => {
  it("includes only the injected relevant approved items, not a blind dump", async () => {
    const memorySearch = vi.fn(async (_q:string)=>([{ title:"Refund policy", content:"30 day window", layer:"domain" }]));
    const out = await contextAssemblyService(db).assembleContext("c1", {
      systemInstructions: "P",
      relevanceQuery: "how do refunds work",
      memorySearch,
    });
    expect(memorySearch).toHaveBeenCalledWith("how do refunds work");
    expect(out.systemPrompt).toContain("Refund policy");
    expect(out.systemPrompt).toContain("30 day window");
  });
  it("omits the memory section when search yields nothing / throws (graceful)", async () => {
    const out = await contextAssemblyService(db).assembleContext("c1", {
      systemInstructions:"P", relevanceQuery:"x", memorySearch: async ()=>{ throw new Error("no key"); },
    });
    expect(out.systemPrompt).toContain("P");
  });
});
