import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./test-utils";
import { PrivacyTab } from "../components/settings/PrivacyTab";
import type { InstanceGeneralSettings } from "@paperclipai/shared";

function makeSettings(overrides: Partial<InstanceGeneralSettings> = {}): InstanceGeneralSettings {
  return {
    censorUsernameInLogs: false,
    keyboardShortcuts: false,
    feedbackDataSharingPreference: "not_allowed",
    backupRetention: { dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 1 },
    ...overrides,
  };
}

describe("PrivacyTab", () => {
  it("renders all three sharing options", () => {
    renderWithProviders(
      <PrivacyTab
        settings={makeSettings()}
        isLoading={false}
        error={null}
        isSaving={false}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Always allow")).toBeInTheDocument();
    expect(screen.getByText("Don't allow")).toBeInTheDocument();
    expect(screen.getByText("Ask each time")).toBeInTheDocument();
  });

  it("marks the current preference as checked", () => {
    renderWithProviders(
      <PrivacyTab
        settings={makeSettings({ feedbackDataSharingPreference: "allowed" })}
        isLoading={false}
        error={null}
        isSaving={false}
        onChange={vi.fn()}
      />,
    );

    const allowed = screen.getByRole("radio", { name: /always allow/i });
    const notAllowed = screen.getByRole("radio", { name: /don't allow/i });
    expect(allowed).toHaveAttribute("aria-checked", "true");
    expect(notAllowed).toHaveAttribute("aria-checked", "false");
  });

  it("defaults to not_allowed when settings is undefined (privacy-first)", () => {
    renderWithProviders(
      <PrivacyTab
        settings={undefined}
        isLoading={false}
        error={null}
        isSaving={false}
        onChange={vi.fn()}
      />,
    );

    const notAllowed = screen.getByRole("radio", { name: /don't allow/i });
    expect(notAllowed).toHaveAttribute("aria-checked", "true");
  });

  it("calls onChange with the selected preference on click", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <PrivacyTab
        settings={makeSettings({ feedbackDataSharingPreference: "not_allowed" })}
        isLoading={false}
        error={null}
        isSaving={false}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("radio", { name: /always allow/i }));
    expect(onChange).toHaveBeenCalledWith({ feedbackDataSharingPreference: "allowed" });

    await user.click(screen.getByRole("radio", { name: /ask each time/i }));
    expect(onChange).toHaveBeenCalledWith({ feedbackDataSharingPreference: "prompt" });
  });

  it("disables buttons while saving", () => {
    renderWithProviders(
      <PrivacyTab
        settings={makeSettings()}
        isLoading={false}
        error={null}
        isSaving={true}
        onChange={vi.fn()}
      />,
    );

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toBeDisabled();
    }
  });

  it("shows loading state", () => {
    renderWithProviders(
      <PrivacyTab
        settings={undefined}
        isLoading={true}
        error={null}
        isSaving={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/loading privacy settings/i)).toBeInTheDocument();
  });

  it("shows error state", () => {
    renderWithProviders(
      <PrivacyTab
        settings={undefined}
        isLoading={false}
        error={new Error("boom")}
        isSaving={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/failed to load privacy settings/i)).toBeInTheDocument();
  });

  it("surfaces the Phase F not-yet-wired notice", () => {
    renderWithProviders(
      <PrivacyTab
        settings={makeSettings()}
        isLoading={false}
        error={null}
        isSaving={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("note")).toHaveTextContent(/not yet wired/i);
  });
});
