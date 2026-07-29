import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccessRequiredPage } from "../pages/AccessRequired";
import { renderWithProviders } from "./test-utils";

const refetchJourney = vi.fn();
const switchAccount = vi.fn();

vi.mock("@/api/auth", () => ({
  authApi: {
    getSession: vi.fn(async () => ({
      session: { id: "session-1", userId: "user-1" },
      user: { id: "user-1", email: "second@example.com", name: "Second User" },
    })),
  },
}));

vi.mock("@/api/onboarding", () => ({
  fetchJourney: (...args: unknown[]) => refetchJourney(...args),
}));

vi.mock("@/hooks/useAccountSwitch", () => ({
  useAccountSwitch: () => ({
    switchAccount,
    isSwitching: false,
    error: null,
  }),
}));

describe("AccessRequiredPage", () => {
  it("shows the signed-in identity and provides refresh and account escape", async () => {
    refetchJourney.mockResolvedValue({
      schemaVersion: 1,
      journey: "access_required",
      targetCompanyId: null,
      pendingInvitations: [],
      inviteToken: null,
      canCreateCompany: false,
      resumeFirstRunCompanyId: null,
    });
    const user = userEvent.setup();
    renderWithProviders(<AccessRequiredPage />, {
      initialEntries: ["/access-required"],
    });

    const heading = await screen.findByRole("heading", {
      name: "Access required",
    });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveFocus();
    expect(await screen.findByText(/second@example\.com/)).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /sign out and switch account/i })
    );
    expect(switchAccount).toHaveBeenCalledTimes(1);
  });
});
