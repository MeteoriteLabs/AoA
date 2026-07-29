import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Outlet, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";

const mocks = vi.hoisted(() => ({
  getHealth: vi.fn(),
  getSession: vi.fn(),
  fetchJourney: vi.fn(),
  switchAccount: vi.fn(),
  setSelectedCompanyId: vi.fn(),
}));

vi.mock("../api/health", () => ({
  healthApi: { get: mocks.getHealth },
}));
vi.mock("../api/auth", () => ({
  authApi: { getSession: mocks.getSession },
}));
vi.mock("../api/onboarding", () => ({
  fetchJourney: mocks.fetchJourney,
}));
vi.mock("../hooks/useAccountSwitch", () => ({
  useAccountSwitch: () => ({
    switchAccount: mocks.switchAccount,
    isSwitching: false,
    error: null,
  }),
}));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [],
    selectedCompany: null,
    selectedCompanyId: null,
    loading: false,
    setSelectedCompanyId: mocks.setSelectedCompanyId,
  }),
}));
vi.mock("../context/DialogContext", () => ({
  useDialog: () => ({
    newThreadOpen: false,
    newThreadDefaults: {},
    closeNewThread: vi.fn(),
  }),
}));
vi.mock("../components/LobbyLayout", () => ({
  LobbyLayout: () => (
    <div data-testid="lobby-layout">
      <Outlet />
    </div>
  ),
}));
vi.mock("../pages/Lobby", () => ({
  Lobby: () => <div>rendered-lobby</div>,
}));
vi.mock("../pages/OnboardingFlow", () => ({
  OnboardingFlowPage: ({ journey }: { journey: string }) => (
    <div>onboarding-{journey}</div>
  ),
}));
vi.mock("../pages/AccessRequired", () => ({
  AccessRequiredPage: () => <div>access-required-page</div>,
}));
vi.mock("../components/DiscussionCaptureModal", () => ({
  DiscussionCaptureModal: () => null,
}));
vi.mock("../components/NewThreadDialog", () => ({
  NewThreadDialog: () => null,
}));
vi.mock("../components/memory/MemoryQuickSwitcher", () => ({
  MemoryQuickSwitcher: () => null,
}));

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}

function renderApp(initialEntry = "/") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("App post-auth journey gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getHealth.mockResolvedValue({
      status: "ok",
      deploymentMode: "authenticated",
      authReady: true,
    });
    mocks.getSession.mockResolvedValue({
      session: { id: "s1", userId: "u1" },
      user: { id: "u1", email: "person@example.com", name: "Person" },
    });
    mocks.fetchJourney.mockResolvedValue({
      journey: "returning",
      pendingInvitations: [],
    });
  });

  it("does not misclassify a transient session error as signed out", async () => {
    mocks.getSession
      .mockRejectedValueOnce(new Error("Session service unavailable"))
      .mockResolvedValue({
        session: { id: "s1", userId: "u1" },
        user: { id: "u1", email: "person@example.com", name: "Person" },
      });

    renderApp("/");

    expect(
      await screen.findByRole("heading", {
        name: "We could not determine your access",
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    expect(screen.queryByText("rendered-lobby")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Switch account" }));
    expect(mocks.switchAccount).toHaveBeenCalledOnce();

    const callsBeforeRetry = mocks.getSession.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("rendered-lobby")).toBeInTheDocument();
    expect(mocks.getSession.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
  });

  it("routes an invited identity to the company-qualified join flow", async () => {
    mocks.fetchJourney.mockResolvedValue({
      journey: "invited",
      targetCompanyId: "company/a",
      pendingInvitations: [],
    });

    renderApp("/");

    expect(await screen.findByText("onboarding-invited")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/onboarding/join?company=company%2Fa",
      ),
    );
  });
});
