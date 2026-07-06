import { describe, it, expect, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
}));

vi.mock("@armyofagents/db", () => {
  const makeTable = () =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "$inferSelect" || prop === "$inferInsert") return {};
          return Symbol(String(prop));
        },
      },
    );
  return {
    assets: makeTable(),
    discussionEntries: makeTable(),
  };
});

import { createArtifactTool } from "../create-artifact-tool.js";

function makeCtx(createSpy: ReturnType<typeof vi.fn>, assetRows: unknown[] = [{ contentType: "application/pdf", byteSize: 100, sha256: "h", originalFilename: "deck.pdf" }]) {
  return {
    companyId: "c1", agentId: "agent-1", discussionRunMode: "direct", runId: null, threadFreshness: {},
    db: {
      select: () => ({ from: () => ({ where: () => Promise.resolve(assetRows) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    },
    services: { artifacts: { create: createSpy } },
  } as unknown as Parameters<ReturnType<typeof createArtifactTool>["execute"]>[1];
}

describe("create_artifact tool — asset path", () => {
  it("produces an asset-backed version when assetId is given", async () => {
    const create = vi.fn().mockResolvedValue({ id: "art-1", versions: [{ id: "v1" }] });
    const tool = createArtifactTool();
    const res = await tool.execute({ title: "Deck", type: "design", assetId: "asset-1" }, makeCtx(create));
    expect(res.success).toBe(true);
    expect(create).toHaveBeenCalledWith("c1", "agent-1", expect.objectContaining({
      storageKind: "asset", assetId: "asset-1", contentType: "application/pdf", filename: "deck.pdf", byteSize: 100,
    }));
  });

  it("returns ASSET_NOT_FOUND (without calling create) when the asset is not company-owned", async () => {
    const create = vi.fn();
    const tool = createArtifactTool();
    const res = await tool.execute({ title: "Deck", type: "design", assetId: "asset-foreign" }, makeCtx(create, []));
    expect(res.success).toBe(false);
    expect(res.error).toBe("ASSET_NOT_FOUND");
    expect(create).not.toHaveBeenCalled();
  });
});
