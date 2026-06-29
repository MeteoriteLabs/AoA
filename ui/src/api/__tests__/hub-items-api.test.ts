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

  it("serializes includeSnoozed for explicit snoozed views", async () => {
    get.mockResolvedValueOnce([]);

    await hubItemsApi.list("company-1", { includeSnoozed: true });

    expect(get).toHaveBeenCalledWith(
      "/companies/company-1/hub-items?includeSnoozed=true&limit=50",
    );
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

  it("sends all personal-state mutation bodies through the sparse state route", async () => {
    patch.mockResolvedValue({});

    await hubItemsApi.markUnread("company-1", "hub-1");
    await hubItemsApi.snooze("company-1", "hub-1", "2026-07-01T00:00:00.000Z");
    await hubItemsApi.unsnooze("company-1", "hub-1");
    await hubItemsApi.dismiss("company-1", "hub-1");
    await hubItemsApi.undismiss("company-1", "hub-1");

    expect(patch).toHaveBeenNthCalledWith(
      1,
      "/companies/company-1/hub-items/hub-1/state",
      { kind: "unread" },
    );
    expect(patch).toHaveBeenNthCalledWith(
      2,
      "/companies/company-1/hub-items/hub-1/state",
      { kind: "snooze", until: "2026-07-01T00:00:00.000Z" },
    );
    expect(patch).toHaveBeenNthCalledWith(
      3,
      "/companies/company-1/hub-items/hub-1/state",
      { kind: "unsnooze" },
    );
    expect(patch).toHaveBeenNthCalledWith(
      4,
      "/companies/company-1/hub-items/hub-1/state",
      { kind: "dismiss" },
    );
    expect(patch).toHaveBeenNthCalledWith(
      5,
      "/companies/company-1/hub-items/hub-1/state",
      { kind: "undismiss" },
    );
  });

  it("posts lifecycle action, undo, bulk, and audit requests to the W1c routes", async () => {
    post.mockResolvedValue({});
    get.mockResolvedValueOnce([]);

    await hubItemsApi.act("company-1", "hub-1", {
      action: "resolve",
      expectedVersion: 2,
      reason: "Done",
    });
    await hubItemsApi.undo("company-1", "hub-1", {
      auditId: "audit-1",
      expectedVersion: 3,
    });
    await hubItemsApi.bulkAction("company-1", {
      bulkId: "bulk-1",
      items: [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", action: "dismiss" }],
    });
    await hubItemsApi.audit("company-1", "hub-1");

    expect(post).toHaveBeenNthCalledWith(
      1,
      "/companies/company-1/hub-items/hub-1/action",
      { action: "resolve", expectedVersion: 2, reason: "Done" },
    );
    expect(post).toHaveBeenNthCalledWith(
      2,
      "/companies/company-1/hub-items/hub-1/undo",
      { auditId: "audit-1", expectedVersion: 3 },
    );
    expect(post).toHaveBeenNthCalledWith(
      3,
      "/companies/company-1/hub-items/bulk-action",
      {
        bulkId: "bulk-1",
        items: [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", action: "dismiss" }],
      },
    );
    expect(get).toHaveBeenCalledWith("/companies/company-1/hub-items/hub-1/audit");
  });
});
