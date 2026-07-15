import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHealth: vi.fn(),
  getSession: vi.fn(),
  getInvite: vi.fn(),
  acceptInvite: vi.fn(),
}));

vi.mock("../api/health", () => ({
  healthApi: { get: mocks.getHealth },
}));
vi.mock("../api/auth", () => ({
  authApi: { getSession: mocks.getSession },
}));
vi.mock("../api/access", () => ({
  accessApi: {
    getInvite: mocks.getInvite,
    acceptInvite: mocks.acceptInvite,
  },
}));
vi.mock("@/lib/router", () => ({
  useParams: () => ({ token: "invite-token" }),
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

import { InviteLandingPage } from "../pages/InviteLanding";

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <InviteLandingPage />
    </QueryClientProvider>,
  );
}

describe("InviteLandingPage authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue(null);
    mocks.acceptInvite.mockResolvedValue({ id: "join-1" });
    mocks.getInvite.mockResolvedValue({
      id: "invite-1",
      inviteType: "company_join",
      allowedJoinTypes: "both",
      expiresAt: "2026-08-01T00:00:00.000Z",
    });
  });

  it("requires sign-in for human acceptance when local_trusted has Google auth ready", async () => {
    mocks.getHealth.mockResolvedValue({
      status: "ok",
      deploymentMode: "local_trusted",
      authReady: true,
    });

    renderPage();

    expect(await screen.findByText(/sign in or create an account/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in \/ create account/i })).toHaveAttribute(
      "href",
      "/auth?next=%2Finvite%2Finvite-token",
    );
    expect(screen.getByRole("button", { name: /submit join request/i })).toBeDisabled();
  });

  it("keeps unauthenticated agent acceptance available when board auth is ready", async () => {
    mocks.getHealth.mockResolvedValue({
      status: "ok",
      deploymentMode: "local_trusted",
      authReady: true,
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /join as agent/i }));
    fireEvent.change(screen.getByLabelText(/agent name/i), { target: { value: "Scout" } });

    expect(screen.queryByText(/sign in or create an account/i)).not.toBeInTheDocument();
    const submitButton = screen.getByRole("button", { name: /submit join request/i });
    expect(submitButton).toBeEnabled();
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mocks.acceptInvite).toHaveBeenCalledWith("invite-token", {
        requestType: "agent",
        agentName: "Scout",
        adapterType: "codex_local",
        capabilities: null,
      });
    });
  });

  it("keeps legacy local_trusted human acceptance compatible without authReady", async () => {
    mocks.getHealth.mockResolvedValue({
      status: "ok",
      deploymentMode: "local_trusted",
    });

    renderPage();

    expect(await screen.findByRole("button", { name: /submit join request/i })).toBeEnabled();
    expect(screen.queryByText(/sign in or create an account/i)).not.toBeInTheDocument();
  });

  it("allows an authenticated human to submit when board auth is ready", async () => {
    mocks.getHealth.mockResolvedValue({
      status: "ok",
      deploymentMode: "local_trusted",
      authReady: true,
    });
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });

    renderPage();

    const submitButton = await screen.findByRole("button", { name: /submit join request/i });
    expect(submitButton).toBeEnabled();
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mocks.acceptInvite).toHaveBeenCalledWith("invite-token", { requestType: "human" });
    });
  });
});
