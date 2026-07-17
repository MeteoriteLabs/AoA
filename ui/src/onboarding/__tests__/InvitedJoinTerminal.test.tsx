import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
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
    { companyId: "c1", companyName: "Acme", inviteId: "r1", role: "team_member", createdAt: "", filed: true },
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
    // Filed path (consent captured at token-accept time) — bare call, no
    // acceptOpenInvite flag. The single-arg exact match also proves no second
    // argument was passed.
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
        { companyId: "c2", companyName: "Beta", inviteId: "r2", role: "team_lead", createdAt: "", filed: true },
      ],
    });
    render(<InvitedJoinTerminal />);
    await screen.findByText(/Beta/);
    // Filed path — bare call, no acceptOpenInvite flag.
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
    // Filed path — bare call, no acceptOpenInvite flag.
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

  describe("multi-invite (anchored target, Codex P2)", () => {
    const invA = {
      companyId: "cA",
      companyName: "Acme",
      inviteId: "rA",
      role: "team_member",
      createdAt: "2026-01-01T00:00:00.000Z",
      filed: true,
    };
    // B is tokenless (filed: false): if the page WRONGLY switched to it, it
    // would render B's consent card ("invited to join Beta") — a loud regression.
    const invB = {
      companyId: "cB",
      companyName: "Beta",
      inviteId: "iB",
      role: "team_lead",
      createdAt: "2026-01-02T00:00:00.000Z",
      filed: false,
    };

    it("APPROVE: deep-linked A approved, B still pending → enters A, never switches to B", async () => {
      routerState.searchParams = new URLSearchParams("company=cA");
      fetchJourney.mockResolvedValue({
        journey: "invited",
        targetCompanyId: "cA",
        pendingInvitations: [invA, invB],
        inviteToken: null,
      });
      finalizeInvitedJoin.mockResolvedValue({ admitted: false, status: "pending" }); // tick 1: A pending
      render(<InvitedJoinTerminal />);
      // Bound to A, not B.
      await screen.findByText(/joining/i);
      expect(screen.getByText(/Acme/)).toBeTruthy();
      expect(screen.queryByText(/Beta/)).toBeNull();
      // Founder approves A: it leaves the pending set (B remains) and a
      // membership now exists → journey flips to "returning".
      fetchJourney.mockResolvedValue({
        journey: "returning",
        targetCompanyId: "cA",
        pendingInvitations: [invB],
        inviteToken: null,
      });
      finalizeInvitedJoin.mockResolvedValue({ admitted: true, status: "approved" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000);
      });
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true }));
      // Resolved the anchored company A, never B (no finalize, no consent card).
      expect(finalizeInvitedJoin).toHaveBeenCalledWith("cA");
      expect(finalizeInvitedJoin).not.toHaveBeenCalledWith("cB");
      expect(finalizeInvitedJoin).not.toHaveBeenCalledWith("cB", expect.anything());
      expect(screen.queryByText(/Beta/)).toBeNull();
    });

    it("REJECT: deep-linked A rejected, B still pending → not-approved for A, never switches to B", async () => {
      routerState.searchParams = new URLSearchParams("company=cA");
      fetchJourney.mockResolvedValue({
        journey: "invited",
        targetCompanyId: "cA",
        pendingInvitations: [invA, invB],
        inviteToken: null,
      });
      finalizeInvitedJoin.mockResolvedValue({ admitted: false, status: "pending" }); // tick 1: A pending
      render(<InvitedJoinTerminal />);
      await screen.findByText(/joining/i);
      expect(screen.getByText(/Acme/)).toBeTruthy();
      // Founder rejects A: it leaves the pending set; B keeps the journey "invited".
      fetchJourney.mockResolvedValue({
        journey: "invited",
        targetCompanyId: "cB",
        pendingInvitations: [invB],
        inviteToken: null,
      });
      finalizeInvitedJoin.mockResolvedValue({ admitted: false, status: "rejected" }); // A's outcome
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000);
      });
      expect(await screen.findByText(/not approved/i)).toBeTruthy();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(finalizeInvitedJoin).toHaveBeenCalledWith("cA");
      expect(finalizeInvitedJoin).not.toHaveBeenCalledWith("cB");
      expect(finalizeInvitedJoin).not.toHaveBeenCalledWith("cB", expect.anything());
      expect(screen.queryByText(/Beta/)).toBeNull();
    });

    it("REJECT while a member elsewhere: journey stays 'returning' but finalize disambiguates → not-approved (no false enter)", async () => {
      routerState.searchParams = new URLSearchParams("company=cA");
      // journey is "returning" throughout — the user is already a member of a
      // DIFFERENT company C, so the label alone can't tell "A approved" from
      // "A rejected". Only the idempotent finalize can.
      fetchJourney.mockResolvedValue({
        journey: "returning",
        targetCompanyId: "cC",
        pendingInvitations: [invA, invB],
        inviteToken: null,
      });
      finalizeInvitedJoin.mockResolvedValue({ admitted: false, status: "pending" });
      render(<InvitedJoinTerminal />);
      await screen.findByText(/joining/i);
      expect(screen.getByText(/Acme/)).toBeTruthy();
      // A rejected — journey STAYS "returning" (still a member of C). A label-only
      // resolver would wrongly enter; finalize's definitive "rejected" wins.
      fetchJourney.mockResolvedValue({
        journey: "returning",
        targetCompanyId: "cC",
        pendingInvitations: [invB],
        inviteToken: null,
      });
      finalizeInvitedJoin.mockResolvedValue({ admitted: false, status: "rejected" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000);
      });
      expect(await screen.findByText(/not approved/i)).toBeTruthy();
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe("re-invite after reject (Codex round-12 P2)", () => {
    // invite1 and invite2 share the anchored company (cA) but carry DISTINCT
    // inviteIds — the founder rejecting invite1 and minting invite2 keeps the
    // companyId (the round-3 anchor) but yields a fresh per-invite id. Both are
    // tokenless (filed:false) so each needs its own explicit consent.
    const invite1 = {
      companyId: "cA",
      companyName: "Acme",
      inviteId: "i1",
      role: "team_member",
      createdAt: "2026-01-01T00:00:00.000Z",
      filed: false,
    };
    const invite2 = {
      companyId: "cA",
      companyName: "Acme",
      inviteId: "i2",
      role: "team_member",
      createdAt: "2026-01-02T00:00:00.000Z",
      filed: false,
    };

    it("a fresh tokenless invite for the anchored company re-opens the consent gate → acceptable without reload", async () => {
      routerState.searchParams = new URLSearchParams("company=cA");
      fetchJourney.mockResolvedValue({
        journey: "invited",
        targetCompanyId: "cA",
        pendingInvitations: [invite1],
        inviteToken: null,
      });
      render(<InvitedJoinTerminal />);
      // invite1 is tokenless → consent card, no auto-finalize.
      expect(await screen.findByText(/invited to join Acme/i)).toBeTruthy();
      expect(finalizeInvitedJoin).not.toHaveBeenCalled();
      // Consent to invite1: the request is filed and sits pending with the founder.
      finalizeInvitedJoin.mockResolvedValue({ admitted: false, status: "pending" });
      fireEvent.click(screen.getByRole("button", { name: /join acme/i }));
      expect(await screen.findByText(/with the admin for approval/i)).toBeTruthy();
      expect(finalizeInvitedJoin).toHaveBeenCalledTimes(1);
      expect(finalizeInvitedJoin).toHaveBeenCalledWith("cA", { acceptOpenInvite: true });
      // Founder REJECTS invite1 and RE-INVITES: invite1 leaves the pending set and
      // a fresh tokenless invite2 (new inviteId, SAME company) surfaces in one
      // poll — the component stays mounted throughout.
      fetchJourney.mockResolvedValue({
        journey: "invited",
        targetCompanyId: "cA",
        pendingInvitations: [invite2],
        inviteToken: null,
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000);
      });
      // RED pre-fix: finalizedRef (and the latched consent) from invite1 trap
      // invite2 out of BOTH branches — the page stays stuck on the pending screen
      // and this consent button never reappears. Post-fix: the changed inviteId
      // re-arms the gate and the consent card returns for invite2.
      const joinAgain = await screen.findByRole("button", { name: /join acme/i });
      expect(joinAgain).toBeTruthy();
      // Accepting the re-invite finalizes invite2 (a SECOND finalize, with the
      // tokenless consent assertion) and enters.
      finalizeInvitedJoin.mockResolvedValue({ admitted: true, status: "approved" });
      fireEvent.click(joinAgain);
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true }));
      expect(finalizeInvitedJoin).toHaveBeenCalledTimes(2);
      expect(finalizeInvitedJoin).toHaveBeenLastCalledWith("cA", { acceptOpenInvite: true });
    });

    it("does not re-finalize the SAME invitation across ticks (no-loop guard preserved)", async () => {
      // A filed invite that stays pending across several polls must finalize
      // EXACTLY once — the same inviteId never re-arms, so finalizedRef still
      // guards repeated finalize of one invitation.
      fetchJourney.mockResolvedValue(invitedJourney); // c1 / r1 / filed:true
      finalizeInvitedJoin.mockResolvedValue({ admitted: false, status: "pending" });
      render(<InvitedJoinTerminal />);
      expect(await screen.findByText(/with the admin for approval/i)).toBeTruthy();
      expect(finalizeInvitedJoin).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000 * 3);
      });
      expect(finalizeInvitedJoin).toHaveBeenCalledTimes(1);
    });
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

  describe("consent gate (tokenless detection, filed: false)", () => {
    const tokenlessJourney = {
      ...invitedJourney,
      pendingInvitations: [
        { companyId: "c1", companyName: "Acme", inviteId: "i9", role: "team_member", createdAt: "", filed: false },
      ],
    };

    it("renders the consent card and does NOT finalize until Join is clicked; click → finalize → enter", async () => {
      fetchJourney.mockResolvedValue(tokenlessJourney);
      finalizeInvitedJoin.mockResolvedValue({ admitted: true, status: "approved" });
      render(<InvitedJoinTerminal />);
      expect(await screen.findByText(/invited to join Acme as Team Member/i)).toBeTruthy();
      // Polling continues, but no tick may auto-finalize a tokenless invite.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000);
      });
      expect(finalizeInvitedJoin).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: /join acme/i }));
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true }));
      // The consent-click finalize is the tokenless CLAIM branch — it must
      // carry the server-side consent assertion.
      expect(finalizeInvitedJoin).toHaveBeenCalledWith("c1", { acceptOpenInvite: true });
    });

    it("click → finalize pending → pending screen (request now filed)", async () => {
      fetchJourney.mockResolvedValue(tokenlessJourney);
      finalizeInvitedJoin.mockResolvedValue({ admitted: false, status: "pending" });
      render(<InvitedJoinTerminal />);
      fireEvent.click(await screen.findByRole("button", { name: /join acme/i }));
      expect(await screen.findByText(/with the admin for approval/i)).toBeTruthy();
      expect(finalizeInvitedJoin).toHaveBeenCalledWith("c1", { acceptOpenInvite: true });
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("invite revoked while the consent card is shown → not-approved terminal, never finalizes", async () => {
      fetchJourney.mockResolvedValue(tokenlessJourney);
      render(<InvitedJoinTerminal />);
      expect(await screen.findByText(/invited to join/i)).toBeTruthy();
      // Revocation removes the invitation from the pending set.
      fetchJourney.mockResolvedValue({ ...invitedJourney, journey: "founder", pendingInvitations: [] });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000);
      });
      expect(await screen.findByText(/not approved/i)).toBeTruthy();
      expect(finalizeInvitedJoin).not.toHaveBeenCalled();
    });
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
