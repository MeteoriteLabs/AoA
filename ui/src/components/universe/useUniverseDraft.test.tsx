import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useUniverseDraft } from "./useUniverseDraft";
import { universeDraftApi } from "../../api/universe-draft";
import { ApiError } from "../../api/client";

vi.mock("../../api/universe-draft", () => ({
  universeDraftApi: { get: vi.fn(), save: vi.fn() },
}));
const mockApi = vi.mocked(universeDraftApi);

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const dest = { kind: "task" as const, id: "t1" };
const draft = (revision: number, text = "", attachmentAssetIds: string[] = []) => ({
  revision,
  text,
  attachmentAssetIds,
});

async function ready(initial = draft(0)) {
  mockApi.get.mockResolvedValue(initial);
  const hook = renderHook(() => useUniverseDraft("c1", "conv1", dest), {
    wrapper: makeWrapper(),
  });
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hook;
}

describe("useUniverseDraft", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the draft", async () => {
    const { result } = await ready(draft(2, "hi", ["a1"]));
    expect(result.current.draft).toEqual(draft(2, "hi", ["a1"]));
    expect(result.current.revision).toBe(2);
  });

  it("save flushes with the current expectedRevision and reports saved", async () => {
    mockApi.save.mockResolvedValue(draft(3, "typed"));
    const { result } = await ready(draft(2, "old"));
    await act(async () => {
      await result.current.save("typed", [], true);
    });
    expect(mockApi.save).toHaveBeenCalledTimes(1);
    const [, , , patch] = mockApi.save.mock.calls[0]!;
    expect(patch.expectedRevision).toBe(2);
    expect(patch.text).toBe("typed");
    expect(result.current.status).toBe("saved");
    expect(result.current.draft).toEqual(draft(3, "typed"));
  });

  it("a 409 sets conflict and re-fetches", async () => {
    mockApi.save.mockRejectedValue(new ApiError("stale", 409, null));
    const { result } = await ready(draft(0));
    mockApi.get.mockClear();
    await act(async () => {
      try {
        await result.current.save("x", [], true);
      } catch {
        /* expected save failure */
      }
    });
    expect(result.current.status).toBe("conflict");
    expect(mockApi.get).toHaveBeenCalled();
  });

  it("a network error keeps the edit and retries", async () => {
    mockApi.save.mockRejectedValueOnce(new Error("net"));
    const { result } = await ready(draft(0));
    await act(async () => {
      try {
        await result.current.save("x", [], true);
      } catch {
        /* expected save failure */
      }
    });
    expect(result.current.status).toBe("offline");
    mockApi.save.mockResolvedValueOnce(draft(1, "x"));
    await act(async () => {
      await result.current.flush();
    });
    expect(mockApi.save).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("saved");
  });

  it("submitSnapshot freezes the draft and acknowledge clears exactly that snapshot", async () => {
    mockApi.save.mockResolvedValue(draft(5, ""));
    const { result } = await ready(draft(4, "hello"));
    const sent = result.current.submitSnapshot("s1");
    expect(sent).toEqual({
      revision: 4,
      text: "hello",
      attachmentAssetIds: [],
      clientSubmissionId: "s1",
    });
    await act(async () => {
      await result.current.acknowledge(sent!);
    });
    const [, , , lastPatch] = mockApi.save.mock.calls[0]!;
    expect(lastPatch.text).toBe("");
  });
});
