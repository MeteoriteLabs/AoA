import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({
  api: {
    get: vi.fn(),
  },
}));

import { marketplaceApi } from "../marketplace";
import { api } from "../client";

describe("marketplaceApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("URL-encodes catalog item IDs when resolving install plans", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      rootItem: { id: "agent:aoa-curated/senior-engineer", name: "Senior Engineer", type: "agent", version: "1.0.0" },
      steps: [],
      conflicts: [],
    });

    await marketplaceApi.resolvePlan("company-1", "agent:aoa-curated/senior-engineer");

    expect(api.get).toHaveBeenCalledWith(
      "/companies/company-1/marketplace/resolve/agent%3Aaoa-curated%2Fsenior-engineer",
    );
  });
});
