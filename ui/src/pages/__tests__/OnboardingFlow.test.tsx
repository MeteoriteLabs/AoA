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

describe("OnboardingFlowPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.searchParams = new URLSearchParams();
    state.selectedCompanyId = null;
    state.session = { user: { id: "u1" } };
    state.flowProps = null as never;
    state.orgProps = null as never;
  });

  it("founder: runs the FlowEngine on the selected company's org layer", async () => {
    state.selectedCompanyId = "existing-co";
    renderWithProviders(<OnboardingFlowPage journey="founder" />);
    await screen.findByText("finish-flow");
    expect(state.flowProps.companyId).toBe("existing-co");
    expect(state.orgProps).toBeNull();
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

  it("invited: shows a terminal pending page on finish instead of looping to /", async () => {
    renderWithProviders(<OnboardingFlowPage journey="invited" />);
    const finish = await screen.findByText("finish-flow");
    expect(state.flowProps.companyId).toBeNull(); // user layer
    fireEvent.click(finish);
    expect(await screen.findByText(/awaiting approval/i)).toBeTruthy();
    // must NOT navigate to "/" — that is exactly what re-triggers the invited loop
    expect(mockNavigate).not.toHaveBeenCalledWith("/", { replace: true });
  });
});
