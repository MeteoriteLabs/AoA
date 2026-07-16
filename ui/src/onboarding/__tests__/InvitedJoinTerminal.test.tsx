import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { InvitedJoinTerminal } from "../InvitedJoinTerminal";
import { queryKeys } from "@/lib/queryKeys";

const mockNavigate = vi.hoisted(() => vi.fn());
const routerState = vi.hoisted(() => ({ searchParams: new URLSearchParams() }));
vi.mock("@/lib/router", () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [routerState.searchParams],
  useLocation: () => ({
    pathname: "/onboarding/join",
    search: routerState.searchParams.toString() ? `?${routerState.searchParams.toString()}` : "",
  }),
}));
const mockRemoveQueries = vi.hoisted(() => vi.fn());
const mockInvalidateQueries = vi.hoisted(() => vi.fn(async () => undefined));
// Stable object — the real QueryClient is render-stable; a fresh object per
// render would churn the component's effect deps and re-run the poll loop.
const mockQueryClient = vi.hoisted(() => ({
  removeQueries: mockRemoveQueries,
  invalidateQueries: mockInvalidateQueries,
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => mockQueryClient,
}));
const fetchJourney = vi.hoisted(() => vi.fn());
const finalizeInvitedJoin = vi.hoisted(() => vi.fn());
vi.mock("../../api/onboarding", () => ({ fetchJourney, finalizeInvitedJoin }));

const invitedJourney = {
  journey: "invited",
  targetCompanyId: "c1",
  pendingInvitations: [
    { companyId: "c1", companyName: "Acme", inviteId: "r1", role: "team_member", createdAt: "" },
  ],
  inviteToken: null,
};

describe("InvitedJoinTerminal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    routerState.searchParams = new URLSearchParams();
    fetchJourney.mockResolvedValue(invitedJourney);
    finalizeInvitedJoin.mockResolvedValue({ admitted: false, status: "pending" });
  });
  afterEach(() => vi.useRealTimers());

  it("auto-admits: finalize returns admitted → evicts the journey cache, refreshes companies, enters", async () => {
    finalizeInvitedJoin.mockResolvedValue({ admitted: true, status: "approved" });
    render(<InvitedJoinTerminal />);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true }));
    expect(finalizeInvitedJoin).toHaveBeenCalledWith("c1");
    expect(mockRemoveQueries).toHaveBeenCalledWith({ queryKey: ["onboarding", "journey"], exact: true });
    // Companies list must be refreshed (the pre-membership cache is stale) and
    // BEFORE navigation — otherwise the Lobby renders from the empty cache.
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.companies.all });
    expect(mockRemoveQueries.mock.invocationCallOrder[0]).toBeLessThan(
      mockNavigate.mock.invocationCallOrder[0]!,
    );
    expect(mockInvalidateQueries.mock.invocationCallOrder[0]).toBeLessThan(
      mockNavigate.mock.invocationCallOrder[0]!,
    );
  });

  it("not admitted → shows the pending screen with company + role", async () => {
    render(<InvitedJoinTerminal />);
    expect(await screen.findByText(/joining/i)).toBeTruthy();
    expect(screen.getByText(/Acme/)).toBeTruthy();
    expect(screen.getByText(/Team Member/)).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("polls: enters when the journey flips to returning (founder approved)", async () => {
    render(<InvitedJoinTerminal />);
    await screen.findByText(/joining/i);
    // Approval flips the journey AND removes the invitation from the pending
    // set — both together are the approval signal (a returning journey alone
    // is just "member of some company").
    fetchJourney.mockResolvedValue({
      ...invitedJourney,
      journey: "returning",
      pendingInvitations: [],
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true }));
  });

  it("rejected finalize → terminal not-approved state, never navigates to /", async () => {
    finalizeInvitedJoin.mockResolvedValue({ admitted: false, status: "rejected" });
    render(<InvitedJoinTerminal />);
    expect(await screen.findByText(/not approved/i)).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("journey no longer invited (and not returning) → not-approved terminal", async () => {
    fetchJourney.mockResolvedValue({ ...invitedJourney, journey: "founder", pendingInvitations: [] });
    render(<InvitedJoinTerminal />);
    expect(await screen.findByText(/not approved/i)).toBeTruthy();
  });

  it("prefers the deep-linked ?company= over the resolver's first invitation", async () => {
    routerState.searchParams = new URLSearchParams("company=c2");
    fetchJourney.mockResolvedValue({
      ...invitedJourney,
      pendingInvitations: [
        ...invitedJourney.pendingInvitations,
        { companyId: "c2", companyName: "Beta", inviteId: "r2", role: "team_lead", createdAt: "" },
      ],
    });
    render(<InvitedJoinTerminal />);
    await screen.findByText(/Beta/);
    expect(finalizeInvitedJoin).toHaveBeenCalledWith("c2");
  });

  it("already-a-member: finalize still runs and admits (returning + pending invitation)", async () => {
    // A member of another company invited into c1 — the resolver says
    // "returning", but the pending invitation must drive a finalize attempt,
    // not a bounce to "/" without joining.
    fetchJourney.mockResolvedValue({ ...invitedJourney, journey: "returning" });
    finalizeInvitedJoin.mockResolvedValue({ admitted: true, status: "approved" });
    render(<InvitedJoinTerminal />);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true }));
    expect(finalizeInvitedJoin).toHaveBeenCalledWith("c1");
  });

  it("already-a-member: pending until the invitation clears, then enters", async () => {
    fetchJourney.mockResolvedValue({ ...invitedJourney, journey: "returning" });
    finalizeInvitedJoin.mockResolvedValue({ admitted: false, status: "pending" });
    render(<InvitedJoinTerminal />);
    expect(await screen.findByText(/joining/i)).toBeTruthy();
    expect(screen.getByText(/Acme/)).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
    // Founder approves → the invitation leaves the pending set.
    fetchJourney.mockResolvedValue({
      ...invitedJourney,
      journey: "returning",
      pendingInvitations: [],
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true }));
  });

  it("invite_invalid → distinct copy, keeps polling (founder can still approve)", async () => {
    finalizeInvitedJoin.mockResolvedValue({ admitted: false, status: "invite_invalid" });
    render(<InvitedJoinTerminal />);
    expect(await screen.findByText(/no longer valid/i)).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("transient finalize failure retries on the next tick", async () => {
    // First finalize call blips; the retry (finalize is idempotent) admits.
    finalizeInvitedJoin.mockResolvedValue({ admitted: true, status: "approved" });
    finalizeInvitedJoin.mockRejectedValueOnce(new Error("network"));
    render(<InvitedJoinTerminal />);
    expect(await screen.findByText(/joining/i)).toBeTruthy();
    expect(finalizeInvitedJoin).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true }));
    expect(finalizeInvitedJoin).toHaveBeenCalledTimes(2);
  });

  it("401 from finalize bails to sign-in", async () => {
    finalizeInvitedJoin.mockRejectedValue(
      Object.assign(new Error("finalize failed: 401"), { status: 401 }),
    );
    render(<InvitedJoinTerminal />);
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        `/auth?next=${encodeURIComponent("/onboarding/join")}`,
        { replace: true },
      ),
    );
    expect(finalizeInvitedJoin).toHaveBeenCalledTimes(1);
    // the poll loop stopped — no retry on the next interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(finalizeInvitedJoin).toHaveBeenCalledTimes(1);
  });

  it("journey-poll 401 bails to sign-in", async () => {
    fetchJourney.mockRejectedValue(
      Object.assign(new Error("journey fetch failed: 401"), { status: 401 }),
    );
    render(<InvitedJoinTerminal />);
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        `/auth?next=${encodeURIComponent("/onboarding/join")}`,
        { replace: true },
      ),
    );
    expect(finalizeInvitedJoin).not.toHaveBeenCalled();
    // the poll loop stopped — no retry on the next interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(fetchJourney).toHaveBeenCalledTimes(1);
  });
});
