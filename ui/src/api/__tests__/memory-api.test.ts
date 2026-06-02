import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from "../client";
import { memoryApi } from "../memory";

describe("memoryApi.neighbors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("URL-encodes memory item ids and forwards graph query options", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      center: {
        type: "memory_item",
        id: "item/1",
        companyId: "company-1",
        label: "Pricing",
      },
      nodes: [],
      edges: [],
    });

    await memoryApi.neighbors("company-1", "item/1", {
      depth: 1,
      kinds: ["belongs_to", "related_to"],
    });

    expect(api.get).toHaveBeenCalledWith(
      "/companies/company-1/memory/items/item%2F1/neighbors?depth=1&kinds=belongs_to%2Crelated_to",
    );
  });
});
