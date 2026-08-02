import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from "../client";
import { pluginsApi } from "../plugins";

describe("pluginsApi.listUiContributions", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("qualifies UI contribution discovery with the selected company", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([]);

    await pluginsApi.listUiContributions("company/with space");

    expect(api.get).toHaveBeenCalledWith(
      "/plugins/ui-contributions?companyId=company%2Fwith%20space",
    );
  });
});
