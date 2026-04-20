import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiList = vi.fn();
const apiDismiss = vi.fn();
const apiUndismiss = vi.fn();

vi.mock("@/api/inbox-dismissals", () => ({
  inboxDismissalsApi: {
    list: (...args: unknown[]) => apiList(...args),
    dismiss: (...args: unknown[]) => apiDismiss(...args),
    undismiss: (...args: unknown[]) => apiUndismiss(...args),
  },
}));

import {
  DISMISSED_LOCAL_STORAGE_KEY,
  useInboxBadge,
} from "../hooks/useInboxBadge";

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const MIGRATION_FLAG_KEY = "paperclip:inbox:dismissed:migrated";

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function fakeDismissal(itemKey: string, overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-04-20T00:00:00Z").toISOString();
  return {
    id: `d-${itemKey}`,
    userId: "me",
    companyId: COMPANY_A,
    itemKey,
    dismissedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("useInboxBadge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("does not call the API when companyId is missing", () => {
    renderHook(() => useInboxBadge(null), { wrapper: wrapper() });
    expect(apiList).not.toHaveBeenCalled();
  });

  it("loads dismissals and exposes a Set and isDismissed check", async () => {
    apiList.mockResolvedValue([
      fakeDismissal("run:a"),
      fakeDismissal("stale:b"),
    ]);
    // Pre-flag migration so it doesn't fire for this case.
    window.localStorage.setItem(MIGRATION_FLAG_KEY, "1");

    const { result } = renderHook(() => useInboxBadge(COMPANY_A), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current.dismissedSet.size).toBe(2);
    });
    expect(result.current.isDismissed("run:a")).toBe(true);
    expect(result.current.isDismissed("stale:b")).toBe(true);
    expect(result.current.isDismissed("run:c")).toBe(false);
  });

  it("dismiss optimistically adds to dismissedSet before the POST resolves", async () => {
    apiList.mockResolvedValue([]);
    window.localStorage.setItem(MIGRATION_FLAG_KEY, "1");
    let resolveDismiss!: (v: unknown) => void;
    apiDismiss.mockImplementation(
      () => new Promise((r) => (resolveDismiss = r)),
    );

    const { result } = renderHook(() => useInboxBadge(COMPANY_A), {
      wrapper: wrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.dismiss("alert:budget");
    });

    await waitFor(() => {
      expect(result.current.isDismissed("alert:budget")).toBe(true);
    });
    expect(apiDismiss).toHaveBeenCalledWith(COMPANY_A, "alert:budget");

    // Resolve and ensure final state still reflects dismissal after the
    // onSettled invalidation refetch.
    apiList.mockResolvedValue([fakeDismissal("alert:budget")]);
    act(() => {
      resolveDismiss(fakeDismissal("alert:budget"));
    });
    await waitFor(() => {
      expect(result.current.isDismissed("alert:budget")).toBe(true);
    });
  });

  it("undismiss optimistically removes from dismissedSet", async () => {
    apiList.mockResolvedValue([fakeDismissal("run:a")]);
    window.localStorage.setItem(MIGRATION_FLAG_KEY, "1");
    let resolveUndismiss!: (v: unknown) => void;
    apiUndismiss.mockImplementation(
      () => new Promise((r) => (resolveUndismiss = r)),
    );

    const { result } = renderHook(() => useInboxBadge(COMPANY_A), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current.isDismissed("run:a")).toBe(true);
    });

    act(() => {
      result.current.undismiss("run:a");
    });
    await waitFor(() => {
      expect(result.current.isDismissed("run:a")).toBe(false);
    });
    expect(apiUndismiss).toHaveBeenCalledWith(COMPANY_A, "run:a");

    apiList.mockResolvedValue([]);
    act(() => {
      resolveUndismiss(undefined);
    });
  });

  it("migrates legacy localStorage dismissals to server and clears the key", async () => {
    window.localStorage.setItem(
      DISMISSED_LOCAL_STORAGE_KEY,
      JSON.stringify(["run:legacy-1", "stale:legacy-2"]),
    );
    apiList.mockResolvedValue([]);
    apiDismiss.mockImplementation((_c, key) => Promise.resolve(fakeDismissal(key)));

    renderHook(() => useInboxBadge(COMPANY_A), { wrapper: wrapper() });

    await waitFor(() => {
      expect(apiDismiss).toHaveBeenCalledWith(COMPANY_A, "run:legacy-1");
      expect(apiDismiss).toHaveBeenCalledWith(COMPANY_A, "stale:legacy-2");
    });
    await waitFor(() => {
      expect(window.localStorage.getItem(DISMISSED_LOCAL_STORAGE_KEY)).toBeNull();
    });
    expect(window.localStorage.getItem(MIGRATION_FLAG_KEY)).toBe("1");
  });

  it("does not re-migrate once the flag is set", async () => {
    window.localStorage.setItem(MIGRATION_FLAG_KEY, "1");
    window.localStorage.setItem(
      DISMISSED_LOCAL_STORAGE_KEY,
      JSON.stringify(["run:should-not-migrate"]),
    );
    apiList.mockResolvedValue([]);

    renderHook(() => useInboxBadge(COMPANY_A), { wrapper: wrapper() });

    // Give any async migration a chance to fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(apiDismiss).not.toHaveBeenCalled();
    // Pre-existing key is preserved because we did not migrate.
    expect(window.localStorage.getItem(DISMISSED_LOCAL_STORAGE_KEY)).toBeTruthy();
  });

  it("clears legacy key and sets flag when no legacy dismissals exist", async () => {
    apiList.mockResolvedValue([]);

    renderHook(() => useInboxBadge(COMPANY_A), { wrapper: wrapper() });

    await waitFor(() => {
      expect(window.localStorage.getItem(MIGRATION_FLAG_KEY)).toBe("1");
    });
    expect(apiDismiss).not.toHaveBeenCalled();
  });
});
