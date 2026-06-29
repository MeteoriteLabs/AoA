import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const patch = vi.fn();
const post = vi.fn();

vi.mock("../client", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    patch: (...args: unknown[]) => patch(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

import { hubItemsApi } from "../hub-items";

describe("hubItemsApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists lane-filtered hub items", async () => {
    get.mockResolvedValueOnce([]);

    await hubItemsApi.list("company-1", {
      lane: "waiting_on_you",
      status: "open",
      limit: 50,
    });

    expect(get).toHaveBeenCalledWith(
      "/companies/company-1/hub-items?lane=waiting_on_you&status=open&limit=50",
    );
  });

  it("lists with default limit when optional params are omitted", async () => {
    get.mockResolvedValueOnce([]);

    await hubItemsApi.list("company-1");

    expect(get).toHaveBeenCalledWith("/companies/company-1/hub-items?limit=50");
  });

  it("serializes includeDismissed and clamps numeric limits", async () => {
    get.mockResolvedValueOnce([]);
    await hubItemsApi.list("company-1", { includeDismissed: true, limit: 500 });

    expect(get).toHaveBeenCalledWith(
      "/companies/company-1/hub-items?includeDismissed=true&limit=50",
    );

    get.mockClear();
    get.mockResolvedValueOnce([]);
    await hubItemsApi.list("company-1", { limit: 0 });

    expect(get).toHaveBeenCalledWith("/companies/company-1/hub-items?limit=1");
  });

  it("falls back to default limit for non-finite caller input", async () => {
    get.mockResolvedValueOnce([]);

    await hubItemsApi.list("company-1", { limit: Number.NaN });

    expect(get).toHaveBeenCalledWith("/companies/company-1/hub-items?limit=50");
  });

  it("fetches counts", async () => {
    get.mockResolvedValueOnce({ open: 2, unread: 1 });

    await hubItemsApi.counts("company-1");

    expect(get).toHaveBeenCalledWith("/companies/company-1/hub-items/counts");
  });

  it("marks an item read through sparse state route", async () => {
    patch.mockResolvedValueOnce({});

    await hubItemsApi.markRead("company-1", "hub-1");

    expect(patch).toHaveBeenCalledWith(
      "/companies/company-1/hub-items/hub-1/state",
      { kind: "read" },
    );
  });
});
