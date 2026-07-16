import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../__tests__/test-utils";
import { OnboardingFlowPage } from "../OnboardingFlow";

const state = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  selectedCompanyId: null as string | null,
  session: { user: { id: "u1" } } as unknown,
  flowProps: null as unknown as { companyId: string | null; onFinished?: () => void },
  orgProps: null as unknown as { ctx: { companyId: string | null }; onComplete: () => void },
}));
const mockNavigate = vi.hoisted(() => vi.fn());
const mockRemoveQueries = vi.hoisted(() => vi.fn());
const mockGetOnboardingProgress = vi.hoisted(() => vi.fn());
const mockAdvanceOnboarding = vi.hoisted(() => vi.fn());

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
  authApi: { getSession: () => Promise.resolve(state.session) },
}));
vi.mock("../../api/onboarding", () => ({
  onboardingApi: { getProgress: vi.fn(), advance: vi.fn() },
  getOnboardingProgress: mockGetOnboardingProgress,
  advanceOnboarding: mockAdvanceOnboarding,
}));
vi.mock("../../onboarding/FlowEngine", () => ({
  FlowEngine: (props: { companyId: string | null; onFinished?: () => void }) => {
    state.flowProps = props;
    return (
      <button type="button" onClick={() => props.onFinished?.()}>
        finish-flow
      </button>
    );
  },
}));
vi.mock("../../onboarding/steps/OrgStep", () => ({
  OrgStep: (props: { ctx: { companyId: string | null }; onComplete: () => void }) => {
    state.orgProps = props;
    return <div>org-step-direct</div>;
  },
}));
vi.mock("../../onboarding/InvitedJoinTerminal", () => ({
  InvitedJoinTerminal: () => <div>invited-join-terminal</div>,
}));

describe("OnboardingFlowPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.searchParams = new URLSearchParams();
    state.selectedCompanyId = null;
    state.session = { user: { id: "u1" } };
    state.flowProps = null as never;
    state.orgProps = null as never;
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

  it("founder: evicts the cached journey before returning to the Lobby", async () => {
    state.selectedCompanyId = "completed-co";
    renderWithProviders(<OnboardingFlowPage journey="founder" />);

    fireEvent.click(await screen.findByText("finish-flow"));

    expect(mockRemoveQueries).toHaveBeenCalledWith({
      queryKey: ["onboarding", "journey"],
      exact: true,
    });
    expect(mockRemoveQueries.mock.invocationCallOrder[0]).toBeLessThan(
      mockNavigate.mock.invocationCallOrder[0]!,
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
