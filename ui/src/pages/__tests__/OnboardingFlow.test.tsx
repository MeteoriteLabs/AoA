import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../__tests__/test-utils";
import { OnboardingFlowPage } from "../OnboardingFlow";

const state = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  selectedCompanyId: null as string | null,
  session: { user: { id: "u1" } } as unknown,
  flowProps: null as unknown as {
    companyId: string | null;
    onFinished?: () => void;
  },
  orgProps: null as unknown as {
    ctx: { companyId: string | null };
    onComplete: () => void;
  },
  firstRunProps: null as unknown as {
    companyId: string;
    onComplete: () => void;
  },
}));
const mockNavigate = vi.hoisted(() => vi.fn());
const mockRemoveQueries = vi.hoisted(() => vi.fn());
const mockGetOnboardingProgress = vi.hoisted(() => vi.fn());
const mockAdvanceOnboarding = vi.hoisted(() => vi.fn());
const mockGetSession = vi.hoisted(() => vi.fn());
const mockSwitchAccount = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ removeQueries: mockRemoveQueries }),
  };
});

vi.mock("@/lib/router", () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [state.searchParams],
}));
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: state.selectedCompanyId }),
}));
vi.mock("../../api/auth", () => ({
  authApi: { getSession: mockGetSession },
}));
vi.mock("../../hooks/useAccountSwitch", () => ({
  useAccountSwitch: () => ({
    switchAccount: mockSwitchAccount,
    isSwitching: false,
    error: null,
  }),
}));
vi.mock("../../api/onboarding", () => ({
  onboardingApi: { getProgress: vi.fn(), advance: vi.fn() },
  getOnboardingProgress: mockGetOnboardingProgress,
  advanceOnboarding: mockAdvanceOnboarding,
}));
vi.mock("../../onboarding/FlowEngine", () => ({
  FlowEngine: (props: {
    companyId: string | null;
    onFinished?: () => void;
  }) => {
    state.flowProps = props;
    return (
      <button type="button" onClick={() => props.onFinished?.()}>
        finish-flow
      </button>
    );
  },
  // DRY dark-shell fix: OnboardingFlow.tsx now reuses FlowEngine's exported
  // DarkShell instead of hand-duplicating the `.onboarding-dark` +
  // ConstellationBg wrapper — a passthrough stand-in is enough for this suite.
  DarkShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../onboarding/steps/OrgStep", () => ({
  OrgStep: (props: {
    ctx: { companyId: string | null };
    onComplete: () => void;
  }) => {
    state.orgProps = props;
    return <div>org-step-direct</div>;
  },
}));
vi.mock("../../onboarding/InvitedJoinTerminal", () => ({
  InvitedJoinTerminal: () => <div>invited-join-terminal</div>,
}));
// The founder's post-spine tail (persona fork + in-flight) now renders INLINE in
// OnboardingFlow via FirstRunHome. Stub it to a button that fires onComplete so
// this suite can assert the orchestration (spine → tail → Lobby) without pulling
// in the whole in-flight sequencer + its API calls.
vi.mock("../../onboarding/FirstRunHome", () => ({
  FirstRunHome: (props: { companyId: string; onComplete: () => void }) => {
    state.firstRunProps = props;
    return (
      <button type="button" onClick={() => props.onComplete()}>
        finish-tail
      </button>
    );
  },
}));

describe("OnboardingFlowPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.searchParams = new URLSearchParams();
    state.selectedCompanyId = null;
    state.session = { user: { id: "u1" } };
    state.flowProps = null as never;
    state.orgProps = null as never;
    mockGetSession.mockResolvedValue(state.session);
    mockGetOnboardingProgress.mockResolvedValue({
      completedStates: ["AUTHENTICATED", "PROFILE_SET"],
    });
    mockAdvanceOnboarding.mockResolvedValue({
      completedStates: ["AUTHENTICATED", "PROFILE_SET"],
    });
  });

  it("founder: runs the FlowEngine on the selected company's org layer", async () => {
    state.selectedCompanyId = "existing-co";
    renderWithProviders(<OnboardingFlowPage journey="founder" />);
    await screen.findByText("finish-flow");
    expect(state.flowProps.companyId).toBe("existing-co");
    expect(state.orgProps).toBeNull();
  });

  it("founder: after the spine, runs the inline tail, then evicts the journey cache and hands off to the Lobby", async () => {
    state.selectedCompanyId = "completed-co";
    renderWithProviders(<OnboardingFlowPage journey="founder" />);

    // Finishing the spine hands off to the INLINE tail (not the dashboard),
    // scoped to the selected company.
    fireEvent.click(await screen.findByText("finish-flow"));
    const finishTail = await screen.findByText("finish-tail");
    expect(state.firstRunProps.companyId).toBe("completed-co");
    // No premature navigation — the spine finishing must NOT go anywhere yet.
    expect(mockNavigate).not.toHaveBeenCalled();

    // Completing the tail evicts the cached journey BEFORE navigating to the Lobby.
    fireEvent.click(finishTail);
    expect(mockRemoveQueries).toHaveBeenCalledWith({
      queryKey: ["onboarding", "journey"],
    });
    expect(mockRemoveQueries.mock.invocationCallOrder[0]).toBeLessThan(
      mockNavigate.mock.invocationCallOrder[0]!
    );
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("founder + ?new=1: drives org-create directly on the user layer, then resumes clean", async () => {
    state.selectedCompanyId = "existing-co"; // already-complete company must be ignored
    state.searchParams = new URLSearchParams("new=1");
    renderWithProviders(<OnboardingFlowPage journey="founder" />);
    await screen.findByText("org-step-direct");
    expect(state.orgProps.ctx.companyId).toBeNull(); // user layer, not existing-co
    // finishing the org step resumes the NEW company via a clean /onboarding
    state.orgProps.onComplete();
    expect(mockNavigate).toHaveBeenCalledWith("/onboarding", { replace: true });
  });

  it("founder + ?new=1: persists PROFILE_SET before rendering OrgStep for a legacy user", async () => {
    state.searchParams = new URLSearchParams("new=1");
    mockGetOnboardingProgress.mockResolvedValue(null);

    renderWithProviders(<OnboardingFlowPage journey="founder" />);

    await screen.findByText("org-step-direct");
    expect(mockGetOnboardingProgress).toHaveBeenCalledWith(null);
    expect(mockAdvanceOnboarding).toHaveBeenCalledWith({
      companyId: null,
      journey: "founder",
      requestedState: "PROFILE_SET",
    });
  });

  it("keeps a session lookup failure recoverable with retry and account switching", async () => {
    mockGetSession
      .mockRejectedValueOnce(new Error("Session service unavailable"))
      .mockResolvedValueOnce({ user: { id: "u1" } });

    renderWithProviders(<OnboardingFlowPage journey="founder" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Session service unavailable",
    );
    fireEvent.click(screen.getByRole("button", { name: "Switch account" }));
    expect(mockSwitchAccount).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("finish-flow");
    expect(mockGetSession).toHaveBeenCalledTimes(2);
  });

  it("retries preparation for a new organization without abandoning onboarding", async () => {
    state.searchParams = new URLSearchParams("new=1");
    mockGetOnboardingProgress
      .mockRejectedValueOnce(new Error("Progress service unavailable"))
      .mockResolvedValueOnce({
        completedStates: ["AUTHENTICATED", "PROFILE_SET"],
      });

    renderWithProviders(<OnboardingFlowPage journey="founder" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Progress service unavailable",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(screen.getByText("org-step-direct")).toBeInTheDocument(),
    );
    expect(mockGetOnboardingProgress).toHaveBeenCalledTimes(2);
  });

  it("invited: renders the join terminal on finish instead of looping to /", async () => {
    renderWithProviders(<OnboardingFlowPage journey="invited" />);
    const finish = await screen.findByText("finish-flow");
    expect(state.flowProps.companyId).toBeNull(); // user layer
    fireEvent.click(finish);
    expect(await screen.findByText("invited-join-terminal")).toBeTruthy();
    // must NOT navigate to "/" — that is exactly what re-triggers the invited loop
    expect(mockNavigate).not.toHaveBeenCalledWith("/", { replace: true });
  });
});
