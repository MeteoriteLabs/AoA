import { useEffect } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import {
  advanceSessionEpoch,
  resetSessionEpochForTests,
} from "@/lib/sessionEpoch";
import { IdentityScopedLiveUpdates } from "../IdentityScopedLiveUpdates";

const lifecycle = vi.hoisted(() => ({
  mounts: 0,
  unmounts: 0,
}));

vi.mock("../LiveUpdatesProvider", () => ({
  LiveUpdatesProvider: ({ children }: { children: React.ReactNode }) => {
    useEffect(() => {
      lifecycle.mounts += 1;
      return () => {
        lifecycle.unmounts += 1;
      };
    }, []);
    return <div data-testid="live-updates">{children}</div>;
  },
}));

vi.mock("@/api/auth", () => ({
  authApi: { getSession: vi.fn(async () => null) },
}));

function session(userId: string) {
  return { user: { id: userId } };
}

describe("IdentityScopedLiveUpdates", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    lifecycle.mounts = 0;
    lifecycle.unmounts = 0;
    resetSessionEpochForTests();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queryClient.setQueryData(queryKeys.auth.session, session("user-a"));
  });

  it("remounts the live transport when the authenticated identity changes", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <IdentityScopedLiveUpdates>
          <span>child</span>
        </IdentityScopedLiveUpdates>
      </QueryClientProvider>
    );
    expect(screen.getByText("child")).toBeInTheDocument();
    expect(lifecycle.mounts).toBe(1);

    await act(async () => {
      queryClient.setQueryData(queryKeys.auth.session, session("user-b"));
    });

    await waitFor(() => expect(lifecycle.mounts).toBe(2));
    expect(lifecycle.unmounts).toBe(1);
  });

  it("remounts before sign-out when the explicit session epoch advances", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <IdentityScopedLiveUpdates>
          <span>child</span>
        </IdentityScopedLiveUpdates>
      </QueryClientProvider>
    );

    act(() => advanceSessionEpoch());

    expect(lifecycle.mounts).toBe(2);
    expect(lifecycle.unmounts).toBe(1);
  });
});
