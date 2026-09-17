import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useUniverseState } from "./useUniverseState";
import { universeLayoutApi } from "../../api/universe-layout";
import { ApiError } from "../../api/client";

vi.mock("../../api/universe-layout", () => ({
  universeLayoutApi: { get: vi.fn(), apply: vi.fn(), receipt: vi.fn() },
}));
const mockApi = vi.mocked(universeLayoutApi);

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const snapshot = (revision: number) => ({
  schemaVersion: 1,
  revision,
  document: {
    panels: [],
    order: [],
    selected: null,
    maximized: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    nextOpenedOrdinal: 1,
  },
});
const op = { type: "viewport" as const, x: 1, y: 2, zoom: 1 };

async function ready(revision = 0) {
  mockApi.get.mockResolvedValue(snapshot(revision));
  const hook = renderHook(() => useUniverseState("c1", "conv1"), {
    wrapper: makeWrapper(),
  });
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hook;
}

describe("useUniverseState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the snapshot and exposes document + revision", async () => {
    const { result } = await ready(3);
    expect(result.current.revision).toBe(3);
    expect(result.current.document?.panels).toEqual([]);
  });

  it("flush sends a patch with the current expectedRevision and reports saved", async () => {
    mockApi.apply.mockResolvedValue({ operationId: "x", revision: 3, schemaVersion: 1 });
    const { result } = await ready(2);
    await act(async () => {
      await result.current.queueOps([op], true);
    });
    expect(mockApi.apply).toHaveBeenCalledTimes(1);
    const patch = mockApi.apply.mock.calls[0]![2];
    expect(patch.expectedRevision).toBe(2);
    expect(patch.operations).toEqual([op]);
    expect(result.current.status).toBe("saved");
  });

  it("batches multiple queued ops into one patch on flush", async () => {
    mockApi.apply.mockResolvedValue({ operationId: "z", revision: 1, schemaVersion: 1 });
    const { result } = await ready();
    const op2 = { type: "viewport" as const, x: 9, y: 9, zoom: 2 };
    await act(async () => {
      result.current.queueOps([op]);
      result.current.queueOps([op2]);
      await result.current.flush();
    });
    expect(mockApi.apply).toHaveBeenCalledTimes(1);
    expect(mockApi.apply.mock.calls[0]![2].operations).toEqual([op, op2]);
  });

  it("a 409 sets conflict status and re-fetches the acknowledged base", async () => {
    mockApi.apply.mockRejectedValue(new ApiError("stale", 409, null));
    const { result } = await ready();
    mockApi.get.mockClear();
    await act(async () => {
      result.current.queueOps([op]);
      await result.current.flush().catch(() => {});
    });
    expect(result.current.status).toBe("conflict");
    expect(mockApi.get).toHaveBeenCalled();
  });

  it("a network error sets offline and keeps the ops for a retry", async () => {
    mockApi.apply.mockRejectedValueOnce(new Error("network"));
    const { result } = await ready();
    await act(async () => {
      result.current.queueOps([op]);
      await result.current.flush().catch(() => {});
    });
    expect(result.current.status).toBe("offline");
    mockApi.apply.mockResolvedValueOnce({ operationId: "y", revision: 1, schemaVersion: 1 });
    await act(async () => {
      await result.current.flush();
    });
    expect(mockApi.apply).toHaveBeenCalledTimes(2);
    expect(mockApi.apply.mock.calls[1]![2].operations).toEqual([op]);
    expect(result.current.status).toBe("saved");
  });
});
